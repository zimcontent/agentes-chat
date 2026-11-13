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
   installation without a portal carries nothing of it. A card that is sent leaves the cards when the send ends well.

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
   `portal_board` (read), `portal_card`, `send_for_approval` and `schedule_post`. The last three speak beyond the run's conversation
   (`elsewhere` in the run policy), so a routine never sends, and an agent asks first unless its approvals say
   otherwise. What the board returns (titles, captions, a client's note) is outside text and reaches a model only
   through `untrustedBlock`.

7. **Who may.** Members read the board. Whoever may give agents work (`assign_work`) changes cards, completes a post,
   sends and schedules. The portal's refusal comes back in its own words as 400 `portal.refused`; a bridge that doesn't answer,
   or refuses this server's token, is 502 `portal.unavailable`.

## Consequences

- The clients' side doesn't change: the same portal, the same link. The team stops opening it to administer.
- The cards are outside this server's backup: whoever runs a bridge keeps its state.
- A file is held in memory on its way to the bridge, so one file is capped at 512 MiB.
- The apps show the page only when `GET /api/app/auth-config` says `approvalPortal`.
