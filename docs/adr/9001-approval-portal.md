# 9001. The approval portal: a team's board per client and a send with no model in the way

- Status: Accepted
- Date: 2026-11-13
- Numbering: 9001 and up are this distribution's own decisions, apart from the upstream sequence, so the two never take the same number.

## Context

A team that makes content for clients (posts, reels, carousels) often already has a portal where each client
approves what was made, asks for an adjustment and sees what is scheduled. The team's own work happens in the
workspace: people and agents make the post there. Until now, getting it to the portal meant leaving the workspace,
or asking an agent to drive the portal's tools step by step, which costs model calls and fails in the ways an agent
fails. The team also had no single place in the workspace showing, per client, what is waiting for the client, what
the client sent back and what is ready.

## Decision

1. **An optional adapter, behind a bridge.** `ApprovalPortal` (`packages/adapters/src/approval-portal.ts`) is the
   contract: posts by client with their status, the team's cards, a file upload, a send, a send's job, an edit. The one
   implementation talks to a bridge: a small HTTP service the installation runs next to its portal, with a bearer
   token. `APPROVAL_PORTAL_URL` and `APPROVAL_PORTAL_TOKEN` switch it on, together; without them there is no page, no
   route answers and no tool is listed. The token never leaves the server, and nothing about a particular portal is in
   this code: the bridge is where an installation adapts its own.

2. **One board per client.** Seven columns: `todo` and `doing` are the team's cards (a post still to make, a post
   being made); `approval`, `adjusting`, `approved`, `scheduled` and `posted` follow the portal's own status of each
   post (`portalColumnOf`). A column says whose move it is: the client's (`approval`: sent, seen, an adjustment done),
   the team's (`adjusting`: an adjustment asked or under way; `approved`: it waits to be scheduled), nobody's
   (`scheduled`, `posted`). The overview counts the columns per client, the one with the most open work first.

3. **Cards live with the bridge, not in this database.** The portal only knows a post once it is sent, so the two
   first columns need a home. They are the bridge's, kept beside the portal it serves: this server adds no table, and an
   installation without a portal carries nothing of it. A card that is sent stays, tied to its post (§8).

4. **The send is code from end to end.** `sendForApproval` reads each Drive file through the caller's own reader (a
   person's download, an agent's `storedFileOfArtifact`), so every file passes that caller's access check, and all
   files are read before the first goes up. It then uploads them in order and asks for the send; the bridge answers a
   job, read until it is `done` or `failed`. Only the client, the type and the files are required: what a post still
   lacks (cover, caption, editor, date) comes back as `missing` and is completed later. An idempotency key makes a
   retried call send once. A person's button (`POST …/portal/send`) and an agent's tool end in the same function.

5. **Scheduling is a release, not a publication.** `scheduleItem` releases an approved post at a time; the portal's own
   scheduler, which already takes released posts to the publishing service with the portal's caption and files,
   does the rest, and the post turns `scheduled` when that service has it. This server never talks to a publishing
   service and holds no key of one.

6. **Agents get four tools**, built in and listed only with a portal and only in a run a person is behind:
   `portal_board` (read), `portal_card`, `send_for_approval` and `schedule_post` (and `send_new_version`, §17). The last three speak beyond the run's conversation
   (`elsewhere` in the run policy), so a routine never sends, and an agent asks first unless its approvals say
   otherwise. What the board returns (titles, captions, a client's note) is outside text and reaches a model only
   through `untrustedBlock`. The board lists each post with its address at the portal, so the tools answer every
   question about a post by themselves: no agent stands between another agent and the portal.

7. **Who may.** Members read the board. Whoever may give agents work (`assign_work`) changes cards, completes a post,
   sends and schedules. The portal's refusal comes back in its own words as 400 `portal.refused`; a bridge that doesn't answer,
   or refuses this server's token, is 502 `portal.unavailable`.

8. **The strategic schedule.** Beside the board, each client has a schedule the team plans in: lists it names (usually
   weeks), ordered by hand, and the same cards in them. A card carries a brief, a checklist, comments, the team's
   labels (one set for every client, a name and one of ten colours), the workspace members on it, and two dates that
   are never one: `produceOn`, the day whoever is on it makes it, and `date`, the day the post goes out. A card that
   is sent is no longer removed: it keeps its place and is tied to the post (`item`), and from then on its stage is
   the portal's. The stage is never typed, so the schedule's colours follow what the client does there with nobody
   moving a card. `portalPlan` answers a client's schedule; `myPortalWork` answers one member's open work (a card
   they are on whose post isn't with the client, approved or out) as late, today, next and undated, read against
   the portal's own day, which is what Home shows each person.

9. **Agents plan and tell.** `portal_plan` writes a strategy into a client's schedule (lists found by name, so a
   week planned twice is one week; labels and members said by name, all resolved before the first card is made).
   `portal_work` reads a member's work or a client's whole schedule. The two tools that only read are also listed
   for a routine's run, so a routine can tell each person their day; nothing that changes or sends is.

10. **The pipeline.** The overview draws everything not posted yet across every client as one pipeline
    (`portalPipeline`): one entry per card, or per post no card stands for, with its stage, who is on it, its two
    dates, whether its production day is past and the client's note while it waits on an adjustment.

11. **A card is a task.** A card and a workspace task are one piece of work seen from two places, so there is one
    list of what the team has to do, and a card is assigned and worked on the way every task is. Each card gets a
    task in the project named after its client (`source` `portal`, with the client and the card's id), and one
    pass in code (`syncPortalTasks`, every 20 s and right after a person changes a card) carries what changed on
    either side to the other: the title, the description, the production day (the task's due date), who has it
    (the card's first member, a person or an agent) and the stage. No model is asked.
    - The card owns the post: type, caption, files, post date, labels, list. The task owns the work: its
      conversation, its history, the agent's runs.
    - What each side had at the last pass is kept on the task (`source.synced`), so a change is a difference from
      it: the side that moved wins, the card when both did.
    - The task's status is the stage's: `todo`, `doing` → in progress, `approval` and `approved` → in review,
      `adjusting` → in progress, `scheduled` and `posted` → done. Before the post goes up, moving the task on its
      board moves the card; after, the stage is the portal's alone.
    - The pass never deletes. A card whose task a person deleted keeps none; a deleted card cancels its task.
    - An agent a person puts first on a card starts on its task at once, as "ask an agent" does. Its brief says
      the task is a post, where it stands and which tools move it; it sends to the client only when a person says
      so. When the client asks for a change, the agent that has the task is started again.
    - A stage that changed at the portal is said by the right hand, in words written in code: in the task's
      conversation (whoever follows the task is notified) and, for a change the client made or a post going out,
      in the client's group, the open channel whose name carries the client's id. The client's own words are never
      copied there: they stay on the card, where an agent reads them as outside text.
    - One installation has one portal, so its tasks live in one workspace: the one that already has them, else
      the installation's first.
12. **The workspace's assistant manages the posts** (`approval-portal-watch.ts`, and the tick in
    `approval-portal-tasks.ts`). What is a rule stays code; the assistant is asked only what a rule can't answer.
    - The bridge calls `POST /api/webhooks/approval-portal` the moment it sees a post change at the portal, with
      the same bearer token this server calls it with and no body: a tick runs then instead of at the worker's
      next turn, and what changed is read from the bridge. A call that fails loses nothing: the worker's tick
      finds the same change.
    - A change the client asks for goes to whoever has the post, by code: an agent starts on it at once, a person
      is named in the line the task's conversation gets. A post nobody has goes to the assistant: one message in
      its owner's own conversation with it (the only place it may assign a task), written by code in the owner's
      name and saying it is automatic, listing the posts with their client and kind and nothing the client wrote.
      Who takes each is the assistant's judgment.
    - The posts' days are watched by code: on the day a post is to be made, and the day after when it still hasn't
      gone up, the assistant says so once in the task's conversation (from 8h in the owner's time), naming the
      person who has it; a post nobody has goes to the assistant the same way. What was said is kept on the task
      (`source.nudged`). Older ones are not gone over again.
    - A post that went up some other way and is still open (with the client, sent back, or approved) is given a
      card by the pass, so it has a task like any other and what the client says about it reaches someone; the
      editor the portal names is put on it when one person or agent answers to that name. One that went up in the
      last 15 minutes is left alone: it may be a card's own post, a moment before the card is tied to it. One the
      client already sent back is said and handed on as if the change had just come in.
    - A card may be `done`: finished without going through the portal (work brought from another board). It stays
      in its list as history, reads as out, and gets no task.
    - The assistant reads the board on every turn, from the tasks alone (no call to the portal, no model): how
      many posts are on the way per client, the late ones, the next three days', what a client sent back and what
      has nobody, with the rule of how it hands one on.

13. **A client has a colour.** Wherever several clients' work shows together (the overview's client cards, the
    pipeline's cards and table) whose a card is should read at a glance. The team picks one of twelve named
    colours per client on the client's own page (`assign_work`); the apps draw it in their own palette: the
    client's mark solid in it, each of its cards in the pipeline as glass in it (with the label of its name), a
    dot before its name in a table. Never a bar down a card's edge.
    It lives with the bridge, beside
    the labels (`GET /v1/cores`, `POST /v1/cores/<client>`), and reaches the apps on the overview's client summary
    (`color`), so no page asks for it apart. A bridge from before the colours answers 404 and every client has
    none; a client with none keeps the hue of its name.
14. **A published post opens its file in the Drive.** In a client's list of what went out, beside the way to the
    published post, a post whose card carries files links to the first of them in the workspace's own Drive. A post
    with no card, or a card with no files, shows no such link.
15. **One bar moves a board.** A board wider than its frame has the rail above its columns to drag it by. The track
    that sat at its foot said the same thing twice and is gone.

16. **A client has a logo.** On the client's own page whoever may give agents work sets a square picture (the
    workspace logo's checks: JPEG, PNG or WebP up to 2 MB, by its bytes, no metadata). The bytes stay in this
    server's platform bucket, beside the workspace's logo, and are read by the workspace's members at
    `GET /api/app/portal-logos/{orgId}/{client}/{file}`; the bridge keeps only the file's name, with the colours.
    The apps draw it as the client's mark, before the picture of the group named after the client and before its
    initials.

17. **A change the client asks for comes back without anyone's click.** From the client's request to the new
    version in front of them, every step is a rule in code; a model is asked only to make the change itself.
    - **Who takes it.** Whoever has the post's task. A post nobody has here goes to whoever the portal says holds
      it (its designer, the video's editor: `PortalItem.editor`), when one person or agent of the workspace answers
      to that name: the pass assigns the task and puts them first on the card. Only a post with neither goes to the
      assistant to hand on (§12), with the name the portal gives for whoever holds it when that is someone outside
      the workspace (letters and digits of it only).
    - **An agent** starts on it at once, in the task's conversation, like every task it is asked to implement; a
      run it already has there takes the request as its next message. Its brief names the post and tells it to put
      the new version up itself.
    - **The new version is a send in code.** `send_new_version` (an agent's tool, `sendNewVersion`) takes the post
      and the whole post's files again, in order, read through the caller's own reader like the first send, and
      asks the bridge for a new version (`ApprovalPortal.newVersion`, a job like a send's). Only a post the client
      sent back takes one. It speaks beyond the conversation (`elsewhere`), so a routine never calls it; in a run
      a person is behind it asks nobody, unless the agent itself is set to always ask.
    - **No OK of the team in between.** The first send waits for a person's word (§6); a change the client asked
      for doesn't. A portal that holds a team's version back for a review of its own is given that OK by the
      bridge, for a version this server sent and for one that reached the portal any other way.
    - **A person** who has the post is named in the task's conversation and told to put the new version up at the
      portal itself, with the post's address. This server has no upload of its own for people: the portal's is
      the one they already use.
    - **One more request meanwhile.** When the client writes again on a post they already wait on a change of
      (the time of their last note moved, kept on the task as `source.synced.card.note`), it is one more request:
      said again and handed to whoever has the post like the first, and an agent's run on it takes it as its next
      message.
    - **The assistant looks when it stalls.** The loop needs nobody while it runs, so the one who watches it is
      the assistant, by a rule: a post still waiting for its new version two hours after the client asked
      (`watchPortalAdjustments`, from 8h in the owner's time) is told to it once, in its owner's own conversation
      with it, with who has the post. What to do about it is its judgment. When the change was asked is kept on
      the task (`source.asked`) while the post is still the team's to give back.
    - **Said where the team reads.** When the post is back with the client, whoever put the version there, the
      assistant says so in words written in code, in the task's conversation and in the client's group, with the
      post's address at the portal. The same address closes the line about the change being asked.
18. **The portal is one workspace's.** A server can hold more than one business, and each is its own operation:
    one agency's clients, cards and posts are never another's. The portal belongs to the workspace that holds its
    tasks (§11), or the server's first one until a card makes a task (`portalHere`, `portalWorkspace`). Anywhere
    else every `…/portal` route answers 404 `portal.off` as if the server had none, its agents get none of the
    portal's tools, and `GET /me` says `portal: false` for that workspace, so the apps show no Portal there (the
    sidebar, the Go to menu, "Your tasks" on Home).
    - **An admin picks the sidebar's tools.** Settings › General has "Ferramentas na barra": a switch per tool
      (the sidebar's, plus WhatsApp and video review) that takes it out of the sidebar and More for everyone in
      that workspace (`organization_settings.hidden_tools`, `PATCH …/settings` `hiddenTools`, also in `GET /me`).
      It hides an entry, never a permission: each person still orders what stays, as before.
19. **The team approves in the client's place, by hand.** A client sometimes stops answering at the portal while
    the post is due, or says yes somewhere else (a call, WhatsApp). An administrator then has "Aprovar pelo cliente"
    on a post waiting on the client (the Approval column: sent, seen, or its new version sent), with an optional
    reason (`POST …/portal/clients/{client}/items/{item}/approve`, `approveForClient`). It is code, never an agent's
    tool: the post turns `approved` at the portal through the bridge's edit, which the portal keeps in the post's
    history, and from there everything is as if the client had approved it (the watch sees the status change, the
    card's task follows, the client's "after approve" runs). Who did it and why go on the card's comments and in
    the audit log (`portal.approved_for_client`). Only administrators: approving for a client is a decision about
    the client, not about the team's work, so `assign_work` is not enough.
20. **A client's materials live beside the schedule, not in it.** Agencies keep things per client that are nobody's
    work: the Instagram login, the brand's links, the avatar, the ad account. Brought from another board they arrive
    as cards, and as cards they became tasks and counted as open work. A list now has a kind: `plan` (the schedule,
    as before) or `materials` (the bridge keeps `secao: "materiais"` on the list). The client's page has a tab for
    them, "Materiais do cliente", after Postados: the same board, with no calendar, no stage and no legend.
    - **Read from where the card is.** The bridge marks each card it lists `material` when its list is one of
      materials, so moving a card, or a whole list, changes it with nothing else to keep in step.
    - **Nobody's work.** A material card is left out of the client's board, the overview's count, the pipeline and
      "Your tasks". It gets no task; one it already had is canceled and marked `shelved`, and opens again where the
      card stands if the card goes back to the schedule.
    - **Moved from its menus.** A card's menu, the "…" and a right click alike, lists every list of both parts, the
      other part's under its own heading. A list's menu moves it, with its cards, to the other part.
    - Logins kept here are as safe as a card's description: anyone who reads the portal reads them. The Vault
      (ADR 0144) stays the place for a secret an agent uses.

## Consequences

- The clients' side doesn't change: the same portal, the same link. The team stops opening it to administer.
- The cards are outside this server's backup: whoever runs a bridge keeps its state.
- A file is held in memory on its way to the bridge, so one file is capped at 512 MiB.
- The apps show the page only when `GET /api/app/auth-config` says `approvalPortal` and the workspace is the portal's (`portal` in `GET /me`, §18).

## Addendum 2026-11-17: a post's date is a person's, set when they schedule it

Posts reached the client with the card's day as their date, and a `direct` client's approval in the review scheduled
the post for that day by itself; an agent could also schedule with `schedule_post`. The team's rule is that a post is
scheduled only by a person, by hand, and that what goes to the client carries no date at all.

- A send for approval carries no date: `PortalSend` has none, the route drops one an older app still sends, and the
  web and phone forms no longer ask for it. The card keeps its own day; it never becomes the post's.
- An edit of a post (`PortalItemEdit`) only clears a date and never sets `scheduled` or `published`. A post gets its
  date only through `scheduleItem`, the Schedule button a person presses.
- No agent schedules: `schedule_post` is gone, from every run and from the right hand's routines at `never`. The
  portal's watch tells the agents to leave an approved post for the team.
- A `direct` client's approval in the review (docs/adr/doug-0012-editor-delivery.md) still turns the post `approved` at the
  portal, and stops there: the conversation is told it is ready and that the team schedules it.
- What waits for that person shows on Home: `GET …/portal/to-schedule` (`portalToSchedule`) lists the approved posts
  not released yet, across every client, the longest waiting first, and "Waiting on you" draws each with "Schedule",
  which opens the same dialog as the board (a day and a time, by hand). Only for who may give agents work
  (`assign_work`), in the workspace the portal is.

## Addendum 2026-11-18: a client's name and removal are the team's, kept on this side

The team asked to edit a client from its card: its name, its picture, and to delete it. The portal's API
(`packages/adapters/src/approval-portal.ts`) knows a client only by its slug and has calls for its colour and its logo
(`setClientColor`, `setClientLogo`, §13, §16) and nothing else: no create, no rename, no delete of a client. The apps
list a client once the portal has a post or a card of it. So:

- **Name.** The team's name for a client is kept here, per workspace and client, in `portal_client_settings`
  (`display_name`, a column added through `EXTRA_COLUMNS` like the table itself): `PUT …/portal/clients/{client}/name`
  (`assign_work`, audited as `portal.client_renamed`), one line of at most 60 characters, empty going back to the
  slug's reading. The overview returns it (`name`), and the apps keep the last read's names
  (`rememberPortalClientNames`), so `portalClientName` (and the initials drawn from it) says it on every screen. The
  portal, its client page and the agents' tools keep the slug.
- **Removal.** A client is hidden, not deleted: `PUT …/portal/clients/{client}/hidden` (`hidden_at`, audited as
  `portal.client_hidden` and `portal.client_shown`). A hidden client leaves the overview's clients and every list and
  count the apps read (pipeline, to schedule, each one's work); its posts and cards stay at the portal, untouched, and
  its board still opens by its address. The overview lists it under `hidden`; the web shows "Hidden clients" at the
  overview's foot, each with "Show again", for who may change the portal. The apps call this "Remove client" and say
  in the confirmation, which names the client, that it can come back.
- **Picture and colour** stay the portal's, now also set from the phone: a long press or "…" on a client's card on the
  Portal tab opens its sheet (name, a picture from the photo library or none, colour, remove), for `assign_work`. A
  change of colour or logo is now audited too (`portal.client_color_set`, `portal.client_logo_set`,
  `portal.client_logo_removed`).
- **Creating a client** is not offered, rather than faked: the portal would need a call that makes a tenant (its slug
  and name, answering the slug) and a read that lists every tenant, even one with no post or card yet. Until it has
  them, a new client is made at the portal itself and shows here with its first post or card.
