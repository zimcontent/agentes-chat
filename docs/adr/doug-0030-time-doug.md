# doug-0030: The Doug team as a template, and the brand step of the onboarding

Status: accepted. This instance's own. 2026-11-18. Builds on ADR 0137 §10 (the right hand's team card), ADR 0155 §6
(a template's team made at once), ADR 0159 (personal workspaces), ADR 0162 (the onboarding and the team's hello),
ADR 0053 (routines) and the skills of Settings › Skills (installs from a GitHub link, updates by themselves).

## Context

The team gallery offers six business templates and six personal ones, each a few agents of a line of instructions,
one channel and one routine each, and a skill or two, inside the team card's limits (6 agents, 4 skills, a skill's
body of 20,000 characters). This instance runs a team of its own that does real work every day: a manager, design,
video, a paid ads HQ of ten, strategy, social media, code and finance. Each of its agents has instructions worked out
in months of use, routines, house skills (how to edit a talking-head video, the ads HQ's manual) and skills other
people publish. New workspaces asked to start from that team, not from a blank one, and the owner wants it to be the
first choice of the onboarding.

That team, as it runs here, also holds its clients' names, people, brands, accounts and numbers. None of that may
leave: what a new workspace gets is the craft, never the data.

## Decision

1. **The material is the craft alone, kept in the repository.** `packages/engine/src/doug-team/` holds one Markdown
   file per agent (`agents/<handle>.md`: name, handle, role, line, its drawing, its HQ team and who it reports to,
   whether it needs a computer, its routines, its house skills, its third-party skills, then its instructions) and one
   folder per house skill (`skills/<slug>/SKILL.md`). Every client fact was taken out when they were written: an agent
   reads its client's brand, accounts and history from the workspace (the brand skill below, its memory, its
   connections), never from its instructions.
2. **Built in, read once.** `bun run doug-team:build` (`packages/engine/scripts/doug-team-build.ts`) writes the files
   as text into `doug-team/files.gen.ts`, so the packaged server reads them from its own bundle and never from a
   folder beside it; a test fails while the generated file differs from the material. `doug-team/index.ts` parses
   them once (`dougAgents`, `dougSkills`).
3. **A leak test by hash.** `packages/engine/test/doug-team-leak.test.ts` reads every file of `doug-team/` and fails on
   an email address, a phone number, an address outside github.com and raw.githubusercontent.com, or a denied word: the
   house's clients, people, companies and projects, kept only as SHA-256 hashes of the word (lower case, no accents)
   and of two words in a row, so the test itself names none of them.
4. **The template, apart from the gallery.** `doug` is not one of the gallery's templates: it outgrew the team card's
   limits and needs a screen of its own, with the brand step after it. `GET …/team-templates` keeps answering the
   business types (or a personal workspace's areas), so an app that knows nothing of the Doug team (the web and the
   phone as they were) is never handed one: `?with=doug` gives it apart, in `doug`, with every agent listed (`members`)
   and checked by default, and the person unchecks who they don't want. It reuses the same calls (`createAgent`,
   `createChannel`, `addChannelMember`, `createRoutine`, the skills' rows) in its own path (`doug-team/create.ts`,
   `useDougTeam`), in one transaction, and posts the same card in the person's DM with the right hand, created, with
   Desfazer for a day (`undoTeam`).
   - **The DOUG is the right hand.** No agent is made for it: the workspace records the team
     (`organization_settings.doug_team`) and `rightHandPrompt` adds the DOUG's instructions as "# Your role in this
     workspace", under the product's own block, which wins where they differ. Its role is the workspace's, so **only
     an admin gives it** (`manage_agents`): a member who may create agents (`create_agents`) makes the team but the
     DOUG's role is left out, named on the receipt (`skipped: rightHand`). The right hand's routines are likewise for
     who manages them.
   - **The role is the DOUG's alone.** The record names the agent the team made on the right hand; the role reads only
     while that id is this run's agent, and it is the workspace's right hand (`agents.builtin`). A workspace that
     hands the right hand's mark to another agent afterwards (`makeRightHand`, ADR 0137's addendum) gets no DOUG's
     instructions on it: the new right hand talks as itself, and the old one, no longer the right hand, isn't read as
     one either. The mark and the DOUG are two facts, and the role needs both.
   - **A channel per HQ**: design, video, ads (the MARK and its nine, who report to it, `reports_to_agent_id`),
     strategy, social media, code and finance, named in the person's language (`dougTeam.channels.*`), with `-2` where
     the name is a private channel they aren't in, as the other templates do. A personal workspace (ADR 0159) makes
     **no channel**: its agents live in their DM with the person, and their routines report there (`target: dm`), as
     the personal templates do. A team's workspace gets the channels; one person's does not.
   - **Every routine is made paused.** The person turns on the ones they want; nothing runs on its own the first day.
   - **A team made again leaves none of the last one's routines behind.** The right hand is never archived, so a
     routine the last card put on it would outlive Desfazer and double itself in a new team. Before its own routines
     are made, the ones the last card's receipt lists (`created.routineIds`) are deleted on the right hand (as any
     deleted routine is: it never fires again, its history stays). The list is the card's own, not a name match: a
     routine the right hand had before it is no business of this team's, whatever it is called.
   - **House skills** become the workspace's (one already there by that name is used as it is), each given to the
     agents that list it. Skills are an admin's, as on the team card: a member who makes the team gets the agents and
     the receipt says the skills wait for an admin.
   - **Third-party skills** are installed from their public link, only ones published under an open license (MIT,
     Apache-2.0 and the like; the material lists each one's license), through the same path as "From a GitHub link"
     (`importSkillFromUrl`, `importPickedSkills`). Each `.md` pins its `source` to a commit SHA (`…/tree/<sha>/…`),
     fixed by `bun run doug-team:build` and reviewed like any other change to the material, so upstream can't move
     what a workspace installs under it. They never hold the team up: a job (`doug_team.skills`, one per folder of a
     repository, so a folder's skills come from one download) installs them after the card reads `created` and gives
     them to the right agents. The job **only installs once the card is `created`**: a card still `creating` (a job
     that ran while the team's transaction was open) throws, so the outbox reads it again; a card undone, denied or
     replaced installs nothing. A network failure throws too, tried again later.
   - **The window between `created` and `enqueue`.** The team is made in one transaction; the card is written
     `created` right after it commits (`writeCard`), and the job of each folder is enqueued the next thing
     `useDougTeam` does, in the same code path. So a job can never exist before `created` (the outbox can't see what
     isn't there), and a job claimed in the narrow window is the one thing the guard must cover: it reads the card as
     `created` and installs. The remaining danger is the opposite one — the process stopping between `created` and the
     enqueue. Then the card reads `created` with no job and the third-party skills never arrive: the team, its agents
     and its receipt are all there, and a person installs the missing skills from their links as they would any other.
     A failure there costs an install, never the team. A job that runs while the card is still `creating` throws
     `DougTeamNotReady`, and the outbox reads it again, so no try installs under a card that isn't final. The job's
     `dedupeKey` is `doug_team.skills:<cardId>:<url>`, so a second enqueue of the same folder adds nothing.
   - **A skill a person already had stays theirs.** The job marks a skill it made with `metadata.dougTeam` (the card's
     id), and that mark alone is what Desfazer takes back. A skill the workspace had before the card, even installed
     from the same link, is only given to the agents: no mark, and its `metadata` untouched. The only skills it takes
     over are those it made itself, either marked already or installed from the team's own link after the card was
     posted (a repeat after a failure).
   - **Desfazer during the job.** The job reads the card again once it has installed, and a card that was undone (or
     denied, or replaced) meanwhile takes back what that try installed, with their deliveries to the agents: a slow
     download never leaves a skill behind a card that no longer exists.
   - **Updates stay off.** A skill the job installs is left with `autoUpdate` off (the column's default), so an
     upstream change never reaches a prompt without review: an admin turns "Atualizar sozinha" on, as for any skill
     from a link.
   - **The license is kept**: in the skill's `metadata.license` (the license the material lists), beside its own
     frontmatter.
   - **A failure is on the receipt.** A skill that fails for good (the link holds no such skill now, or it is past the
     skill limits) is written to the card's `created.failedSkills` (`slug`, `code`), which the app shows; the others
     still install.
   - **The slug is the skill's name.** The material names each third-party skill by its slug, and the thing that
     decides whether it is the right one is that SKILL.md's own `name`: a folder the link holds under another name is
     refused with `skill.name_mismatch`, never installed under the slug the workspace expects. The slug is the key
     Desfazer, the card's lists and the agents' deliveries go by; a skill upstream renamed is a different skill, and
     filing it under the team's slug would hand the agents something nobody reviewed under that name.
   - **Desfazer finds them all**, even from a job that failed halfway: the job marks each skill it made (or a repeat
     found as its own) with `metadata.dougTeam` (the card's id), and `undoTeam` removes the card's `created.skillIds`
     and every skill so marked, in one statement. Their ids also join the card's, so the receipt counts them; a repeat
     never adds one twice, and a skill a person had before the card is never in either list.
   - **The computer notice.** The answer and the template say which chosen agents work on a computer
     (`needs_computer`), for the app's notice and its "connect a computer" button.
   - **Only the hello after it**: the team's hello job (ADR 0162) with one line per agent in its words
     (`dougTeam.agents.*.hello`), the right hand first. Nothing else is posted.
5. **The brand is a workspace skill, and its step is required where the app draws it.** When the Doug team was made
   during the onboarding, "Sua marca" comes next (`brand`, after `agents` in the steps). The company's name and a tone
   of voice (tapped from a list, written, or both) are required; the site, Instagram, audience and the brand manual's
   files (uploaded to the Drive first) and links are optional. `PUT …/brand` writes the workspace skill
   "Marca <empresa>" (`marca`, a new version each time) in the sections the agents that read a brand look for (the
   company and what it isn't, audience, tone of voice, visual identity, networks and formats, pillars, compliance,
   the manual), with what wasn't said marked "A definir" for them to ask or propose instead of inventing, and gives it
   to the ROSA, the SONY, the SOCIAL MEDIA and the CHESS.
   - **The step never traps anyone.** The brand is required only where the app that finishes the onboarding draws the
     step: it sends `holdBrand` and `saveOnboarding` answers 409 `onboarding.brand_pending` while the brand still
     waits; `GET /me` says `brandPending` to that app alone. The web and the phone are both that app: each sends
     `holdBrand: true` and draws the step itself (its brand screens ship beside this team, so the step it holds for is
     the one it opens). An app that knows nothing of the step (an older build, or the desktop) sends no `holdBrand`,
     finishes the onboarding and opens the workspace; the brand is then asked for in the DOUG's DM
     (`rightHandPrompt`'s "not set up yet"), so a workspace that got its team never works on a piece without it. Once
     the onboarding is over, `brandPending` reads false (it means "the onboarding still waits"); the brand skill is
     still written by the same route, and the DOUG asks for it in the chat.
   - **The prompt asks, it does not write.** The DOUG has no tool that writes the brand: the line of its prompt names
     where the person fills it in (the onboarding's brand step, or with whoever manages the agents), and only appears
     to a person who may write it (`manage_agents`, the same right `PUT …/brand` asks for). Anyone else reads none of
     it: they could do nothing with it.
   - **The prompt asks its own question.** `brandPending` is the step's and `GET /me`'s ("the onboarding still waits").
     The DOUG's prompt reads `brandMissing` instead: the team was made (`doug_team`) and the workspace has no skill
     marked `metadata.brand`, whatever the onboarding's date. A workspace whose onboarding ended without a brand, by an
     app that doesn't draw the step, keeps being asked for it in the DOUG's DM; saving the brand stops it. The two
     predicates never replace one another.
6. **Words.** The template's name, description, each agent's role, line and hello, the channels and the tones are in
   `@dougbot/i18n` (`dougTeam.*`), in every language through `bun run i18n:apply`. The instructions and skills stay
   in Brazilian Portuguese, the language the team works in.

## Consequences

- A change to the team's craft is a change to the Markdown and `bun run doug-team:build`; the leak test runs on it,
  over the material, the `dougTeam.*` words and this ADR (`packages/engine/test/doug-team-leak.test.ts`).
- A workspace makes the Doug team once while an agent of it is still here (`doug_team.made`); with every one archived,
  or after Desfazer, it may be made again (a brand that already exists goes to the readers the new team gains). A
  double click is one team: the second waits on the workspace's advisory lock (`pg_advisory_xact_lock`) and is refused;
  the card it posted is deleted, so the DM shows one card, `created`, and no second one reading `denied`. The team card
  only supersedes the open ones posted before it, so two clicks at once never knock each other out.
- What the third-party skills hold is their authors'; each is installed from its pinned commit under its license, its
  updates off until an admin turns them on, and a link that stops holding the skill leaves it as it was, on the card's
  `failedSkills`.
- The phone and web screens for the template's choices and the brand step use these routes; they are drawn apart.
