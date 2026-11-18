# doug-0020: The Doug team as a template, and the brand step of the onboarding

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
   - **A channel per HQ**: design, video, ads (the MARK and its nine, who report to it, `reports_to_agent_id`),
     strategy, social media, code and finance, named in the person's language (`dougTeam.channels.*`), with `-2` where
     the name is a private channel they aren't in, as the other templates do. A personal workspace (ADR 0159) makes
     **no channel**: its agents live in their DM with the person, and their routines report there (`target: dm`), as
     the personal templates do. A team's workspace gets the channels; one person's does not.
   - **Every routine is made paused.** The person turns on the ones they want; nothing runs on its own the first day.
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
   - **Updates stay off.** A skill the job installs is left with `autoUpdate` off (the column's default), so an
     upstream change never reaches a prompt without review: an admin turns "Atualizar sozinha" on, as for any skill
     from a link.
   - **The license is kept**: in the skill's `metadata.license` (the license the material lists), beside its own
     frontmatter.
   - **A failure is on the receipt.** A skill that fails for good (the link holds no such skill now, or it is past the
     skill limits) is written to the card's `created.failedSkills` (`slug`, `code`), which the app shows; the others
     still install.
   - **Desfazer finds them all**, even from a job that failed halfway: the job marks each skill it made (or a repeat
     found) with `metadata.dougTeam` (the card's id), and `undoTeam` removes the card's `created.skillIds` and every
     skill so marked, in one statement. Their ids also join the card's, so the receipt counts them; a repeat never
     adds one twice.
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
     waits; `GET /me` says `brandPending` to that app alone. An app that knows nothing of the step (the web and the
     phone as they were) sends no `holdBrand`, finishes the onboarding and opens the workspace; the brand is then
     asked for in the DOUG's DM (`rightHandPrompt`'s "not set up yet"), so a workspace that got its team never works
     on a piece without it. Once the onboarding is over, `brandPending` reads false (it means "the onboarding still
     waits"); the brand skill is still written by the same route, and the DOUG asks for it in the chat.
6. **Words.** The template's name, description, each agent's role, line and hello, the channels and the tones are in
   `@agenteschat/i18n` (`dougTeam.*`), in every language through `bun run i18n:apply`. The instructions and skills stay
   in Brazilian Portuguese, the language the team works in.

## Consequences

- A change to the team's craft is a change to the Markdown and `bun run doug-team:build`; the leak test runs on it,
  over the material, the `dougTeam.*` words and this ADR (`packages/engine/test/doug-team-leak.test.ts`).
- A workspace makes the Doug team once while an agent of it is still here (`doug_team.made`); with every one archived,
  or after Desfazer, it may be made again (a brand that already exists goes to the readers the new team gains). A
  double click is one team: the second waits on the workspace's advisory lock (`pg_advisory_xact_lock`) and is refused.
- What the third-party skills hold is their authors'; each is installed from its pinned commit under its license, its
  updates off until an admin turns them on, and a link that stops holding the skill leaves it as it was, on the card's
  `failedSkills`.
- The phone and web screens for the template's choices and the brand step use these routes; they are drawn apart.
