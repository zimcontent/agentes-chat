# doug-0020: The right hand's sector cards

Status: accepted. This instance's own. 2026-11-18. Builds on ADR 0113 (live blocks), 0137 (the right hand), 9004 and
9005 (the ronda and the right hand's day), 0053 (routines and unattended work), 0089 (stretch limits), 0107 (services
through Composio), 0130 §4 (an agent never hears what it couldn't read) and 0173 (approvals).

## Context

The right hand (Doug) tells a person how the operation is going in words. People asked for the operation itself in
the conversation, sector by sector, the way the mock shows it: an "Agenda · quarta, 19" card with the day's events as
coloured blocks and the next call's link, a "WhatsApp · 4 novas" card asking "Eu respondo com a tabela e marco uma
visita?" with Responder, Eu respondo and Ver conversa, and quick pills above the composer (WhatsApp 4, Agenda,
Propostas). Every sector: WhatsApp, Agenda, Aprovações, Propostas, Tarefas, Revisão, Portal.

Writing these with the model costs a run each time, invents numbers, and a block's buttons could only set values,
draw, or send the person's words (`say`). A button that does something real (answer a lead, hand a conversation to a
person) had no place.

## Decision

### 1. A card is a live block the server makes

Each sector card is a live block (ADR 0113, kind `block`, `artifacts.in_drive` false) the server builds from what it
reads in code, with no model: `packages/engine/src/sector-cards/`. `sectors.ts` has one reader per sector, each
reading as the card's person may see it (their WhatsApp numbers, approvals and proposals they may decide, their own
tasks, reviews, the portal), and returning nothing when there is nothing: no card. `cards.ts` posts them as one message
of the right hand (`runId` null, like the stretch card), `meta.artifacts` listing the blocks and `meta.sectorCards`
saying which (`{ day, why, items: [{ sector, key, artifactId }] }`). The words are in the person's language
(`words.ts`, Portuguese for a `pt` locale, English otherwise), like pushes and emails.

### 2. When they come

- **The day's brief.** At the right hand's ronda slot that opens the person's day (ADR 9005 §4), every sector with
  something, in one message ("Bom dia! O teu dia:"), once a day.
- **When something arrives.** At any other slot of that ronda (hourly, 8 to 20, in the person's time zone), the cards
  of what arrived since the slot's window started (`RondaGate.since`) and needs the person: a WhatsApp lead nobody
  answers, a new approval or proposal, a review, a change in the portal. Never the same thing twice a day (each card's
  `key`), at most `CARDS_PER_DAY` (6) such messages a day: the right hand's stretch, so it never spams. The agenda and
  tasks come only in the brief or when asked.
- **When asked.** A pill above the composer (`POST …/agents/{agentId}/sector-cards/{sector}`) posts that sector's card
  at once, or the right hand calls `show_sector_card` (listed only for the right hand, only in a private conversation
  with a person, like `team_status`; `HERE` in `run-policy.ts`).

The ronda's cards are posted in code before the gate's verdict (`fireClaimedRun` in `routines.ts`), so a quiet slot
still brings a lead that came in, and a person who switched their ronda off gets none. The sectors shown go on the
slot's event (`cards`), and the ronda's run is told not to repeat them (`rightHandRondaBrief`).

### 3. The Agenda reads Google Calendar through the workspace's connection

The Agenda card reads the primary calendar of the workspace's Google Calendar connection (the `google-calendar`
preset, through Composio, ADR 0107) with `GOOGLECALENDAR_EVENTS_LIST`, in code, within 6 seconds, only when the right
hand itself has that connection's read scope (ADR 0130 §4: the card never shows what the agent couldn't tell when
asked). What is left of today; in the evening with nothing left, tomorrow's. A call with a Meet link is "Google Meet"
and its link is the card's "Entrar"; Google's `colorId` becomes the event's tone. No connection the right hand may
read: no Agenda card and no Agenda pill. The calendar is read only for the brief and when its pill or tool asks, never
for the pills themselves.

### 4. New parts and buttons in the block spec

`packages/ui/src/blocks/spec.ts` gains:

- `source`: `{ service, title, count }`, the card's header. `service` is one of `SOURCE_SERVICES`; WhatsApp and Google
  Calendar draw their official marks (`blocks/source-marks.ts`), the app's own sectors a kit icon.
- `agenda`: `{ items: [{ time, title, sub, tone }], note, link: { label, open } }`, a day's events, drawn as the app's
  calendar draws events (Google Calendar's look). `tone` is one of `AGENDA_TONES`.
- On a button (`BlockButton`), besides `set`, `draw` and `say`:
  - `open`: a place in the app (`BlockOpen`: `{ place, id, sub, href }`, places in `BLOCK_OPEN_PLACES`). The apps map
    it to their own routes (`packages/client/src/lib/block-open.ts`); `link` is an https address only.
  - `act`: the name of an action the server holds for this block.
  - `primary`: the row's main action. A row with one keeps it as its only lead.

Every card's buttons are an `actions` part, so whatever reads a message's blocks (the phone's notification actions)
finds them in one place.

#### How a button's action is identified and run

- **Identity.** A button's action is the pair (block, `act`): the artifact's id and the button's `act` name. The
  spec only names it. What it does lives in `block_actions` (`schema/sector-cards.ts`, made by `EXTRA_COLUMNS` like
  this instance's other tables): `kind`, `payload`, and `for_user_id`, the person the card is for. Nothing the apps
  send decides what runs.
- **Who makes one.** Only the server: `show_block` refuses a spec with `act` (an agent's block answers with `say` or
  opens with `open`). People can't write the mark that an action ran (`_acted` in the block's state).
- **Running it.** `POST /api/app/organizations/{orgId}/blocks/{artifactId}/acts/{act}` (`runBlockAct`): the caller
  must read the block's conversation and may post there, and be the card's person. The first press claims the row
  (`done_at`); a second is `409 block_act.done`. A failure gives the claim back, to press again. When it ran, the
  block's state gets `_acted: { [act]: "done" }` (`block.state` to everyone looking) and the button shows "Feito".
- **Kinds.**
  - `ask_agent` (`{ text }`): the person's own message to the right hand, in the card's conversation (`replyToBlock`,
    `meta.blockReply`), which starts the right hand's run with that person behind it. What the run does next goes
    through the Tool Gateway and its approvals like any person's request: "Responder" a lead reads the conversation
    and `whatsapp_send` asks before it sends, unless the person's approvals say otherwise (ADR 0053, 0173).
  - `whatsapp_mine` (`{ accountId, chatId }`): "Eu respondo". The person takes the conversation: the number's agent
    is turned off in it (`setWhatsAppChatAgent`), checked as that person (they must be on the number).
- **The other buttons** need no row: `open` is the app's own navigation (a notification action opens the app at that
  place), `say` is `POST …/artifacts/{artifactId}/reply` with the text the view gives.

So a notification action for a card's button is: read the message's blocks, take their `actions` parts, and for each
button call the `act` route, open the place, or send the `say` text.

### 5. The pills

`GET …/agents/{agentId}/sector-pills` (right hand only) lists the sectors with something for the person, with their
counts, and the agenda whenever a calendar connection exists. The web draws them as small buttons above the composer
(`components/SectorPills.tsx`), the phone as the composer's own pills (`ComposerSuggestion` with `mark`, `count` and
`onPress`, `features/chat/SectorPills.tsx`), so their room is measured with the field's.

## Consequences

- A card is accurate (read now, in code) and costs no model call. Its question text is the server's (a lead's last
  words, or what the number's agent noted when it handed the conversation over), not the model's.
- New sectors are a reader in `sectors.ts`, a name in `SECTORS` and its words. A new kind of action is a `kind` in
  `runBlockAct`, with its own checks.
- The cards post a message the right hand didn't write in a run: the ronda's run hears which sectors were shown so it
  doesn't repeat them.
