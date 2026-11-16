# Doug 0001. WhatsApp numbers in the app, through a gateway on the same machine

- Status: Accepted (server side built; not yet tried against a real Evolution Go or a real number)
- Date: 2026-11-13
- Extends: ADR 0002 (external services are optional adapters), ADR 0005 (PostgreSQL is the only required dependency), ADR 0007 (credentials)
- Scope: this instance's own (Doug), numbered apart from the project's ADRs so theirs keep their numbers

## Context

The team works on three or four WhatsApp numbers and wants them inside the workspace: one place to pick a number, see its conversations, send and receive, on the web, the Mac app and the phone. Some numbers stay people-only; for others an agent may be put in charge, and taken off again, by a person.

WhatsApp offers no API for an ordinary number. The options are the Business Platform (a different kind of number, templates, per-conversation prices) or a client that speaks WhatsApp Web. We looked at Evolution Go (Apache-2.0), a Go server over `whatsmeow`: a REST API per number ("instance"), a QR code to pair, events by webhook. Its own admin page manages instances of one server and has no conversation view. It stores no conversations: its message table holds an id, a time and a status.

## Decision

### A gateway behind an adapter, a separate service

- Evolution Go runs as its own container (the compose file's `whatsapp` profile), reached over the network. Nothing of it is in the server process, so its license and ours don't mix (ADR 0002).
- `WhatsAppGateway` (`packages/adapters/src/whatsapp.ts`) is the contract: create an instance, connect, status, log out, delete, send a text, mark read. `createEvolutionGoGateway` is the only implementation; another gateway replaces it without touching the engine.
- On with `WHATSAPP_GATEWAY_URL` and `WHATSAPP_GATEWAY_KEY`. Without them nothing in the app says WhatsApp.
- No port is published: only the app reaches the gateway. Its admin key and each number's token never leave the server; browsers and the phone app talk only to the app.

### Conversations live in our database

- The gateway keeps sessions. Every message, both ways, is written here from the events it posts: `whatsapp_accounts`, `whatsapp_chats`, `whatsapp_messages`, all with `org_id`.
- Addendum 2026-11-14: the past is read too. When a number is linked, WhatsApp sends the phone's conversations in pieces (the gateway asks for the full sync) and each piece is stored as it arrives (`storeWhatsAppHistory`): as read, without moving a conversation above newer ones and without waking the number's agent. How far back it goes is WhatsApp's decision, not ours. Older messages of one conversation are asked of the phone 50 at a time (`requestWhatsAppHistory`), as WhatsApp's own apps do, and arrive only while the phone is on. A number linked before this reads its past the next time it is linked. A piece can be tens of megabytes, so the events' address takes up to 64 MB, only once the secret in it is known to be a number's.
- An event told twice is one message (`account_id`, WhatsApp's id). A message older than the one a chat shows doesn't move the list.
- Files: the event's inline copy is dropped (`WEBHOOK_FILES=false`, and the parser removes it anyway). A file's message is kept as WhatsApp carries it, which is what the gateway needs to fetch the file later. Fetching and storing files is the next step, not built here.

### The events' address

Evolution Go signs nothing. Each number's events go to `/api/webhooks/whatsapp/{secret}`: a 256-bit secret in the address, stored only as its SHA-256, and the event must name that number's own instance. With the compose file the address is `http://agentes:3000`, so events never leave the machine. Reconnecting a number gives it a new address.

### Who may do what

- Connect, rename, remove a number, choose its people and its agent: `manage_connectors`.
- Read and answer a number's conversations: only the people on its list. Whoever connects it starts on the list. An administrator who isn't listed sees that the number exists, never its conversations.
- A per-number list, not a role key: the numbers are few and each has its own people, and a new role key would add a line to every language and every roles screen for one instance's feature.
- Changes go to the number's people alone, as the user event `whatsapp.changed` (ids only); each app reads again what its person may see.

### Behaving like WhatsApp's own apps

A number is banned for what it does, mostly for writing first to many strangers. The server keeps every number inside what a person on WhatsApp Web does:

- While a person writes in a conversation, the other side sees "typing…" (`…/typing`, told every few seconds, ended when they stop), and opening a conversation is what marks it read.
- A number starts at most 20 conversations a day with phone numbers it never talked to (`whatsapp.new_chats_limit`). Conversations it already has are never limited by this.
- A person sends at most 30 messages a minute.
- Nothing hides what the number is: no proxy, no changed fingerprint. These rules lower the risk and don't remove it.

### Agents

Each number has `agent_id`: the agent in charge, or null for people only, and `instructions`: how that agent carries itself on this number (Markdown, up to 20,000 characters, typed or read from a .md file), on top of the agent's own instructions. The same agent can then speak one way in the workspace and another on each number. Only who may change the number reads them. This decision stores and validates it; an agent answering through it (tools under the Tool Gateway, approvals, outside text wrapped as untrusted) is a later decision with its own ADR.

### Tables outside the numbered migrations

The three tables are made at boot by the list of this instance's own statements (`EXTRA_COLUMNS` in `packages/db/src/client.ts`), all `IF NOT EXISTS`, so the project's migrations keep their numbers when its `main` is merged.

## Consequences

- **A number can be banned.** This is not an API WhatsApp offers. Ordinary human use rarely is; an agent answering fast and in volume raises the risk. The setting's description says so.
- **We depend on a fork.** The gateway follows WhatsApp's protocol changes at its maintainers' pace. The adapter is the exit.
- **No image to pull.** The fork publishes none: the image is built from its source on the server.
- **Opening a conversation sends read receipts**, as opening it on the phone does.
- **Not kept yet:** reactions, edits and deletions, files' contents, status updates, channels.
- **Tests** use a fake gateway and recorded event shapes (no network), following ADR 0003. The shapes were read from Evolution Go's source at `a226eac`, not captured from a running server: the first real connection is the test of them.

## As built

- Adapter: `packages/adapters/src/whatsapp.ts` (`createEvolutionGoGateway`, `parseEvolutionEvent`, `createFakeWhatsAppGateway`).
- Engine: `packages/engine/src/whatsapp/accounts.ts` (numbers, their people, the sealed token), `inbound.ts` (events into conversations), `conversations.ts` (lists, sending, reading).
- Routes: `apps/server/src/routes/app/whatsapp.ts` (`/api/app/organizations/{orgId}/whatsapp…`), the receiver in `routes/webhooks.ts`.
- Schema: `packages/db/src/schema/whatsapp.ts`; statements in `packages/db/src/client.ts`.
- Compose: services `whatsapp-db` (makes the gateway's two databases on the same Postgres) and `whatsapp`.
- Addendum 2026-11-14: files go out too. A file sent from the app goes to the gateway as a form (`/send/media`) as a picture (JPEG, PNG, WebP), a video (MP4), a voice message (any recording, which the gateway converts to WhatsApp's own format) or a document (anything else), up to 32 MB. What the gateway sent is kept with the message, so a sent file opens here like a received one. The conversation writes with the kit's own composer: attach, drop, paste, emoji and the microphone.
- Addendum 2026-11-16: the approval portal's notices. The portal (another server) tells a person on WhatsApp that something changed there ("a new version of post X", "post approved"); the bridge it used for that is gone, and it has no WhatsApp of its own. It now asks this server: `POST /api/webhooks/approval-portal/whatsapp`, `Authorization: Bearer <PORTAL_WHATSAPP_TOKEN>` (compared in constant time), body `{ "to": "<digits, E.164 without the plus>", "text": "<up to 2000 characters>", "key": "<optional idempotency key, up to 200>" }`, answer `{ "ok": true, "messageId": "<the message's id here>" }`.
  - Three settings, all optional, and the address is a 404 without any of them: the token, `PORTAL_WHATSAPP_FROM` (the digits of the connected number that sends, found in whichever workspace connected it) and `PORTAL_WHATSAPP_TO` (the only numbers a notice may go to). The list is what keeps a leaked token from writing to strangers from our number, which is what gets a number banned.
  - The text leaves the way a person's does (`deliverWhatsAppText` in `conversations.ts`, used by both) and is kept in the conversation as the number's own: no person and no agent wrote it. It wakes nothing, and it doesn't count as a person taking the conversation over, so the number's agent still answers what the other side writes back.
  - A conversation the number doesn't have yet is made, and spends the same 20 a day the app's own "new conversation" spends (`whatsapp-new:{accountId}`); past it the notice is refused, and conversations it already has are never limited.
  - The same `key` within 24 hours sends nothing again and answers the same `messageId`. The key's SHA-256 is kept on the message itself (`raw.portalKey`; a text has nothing else there), so no table was added; two calls at once with one key are held together in the process that got them. A message deleted for everyone loses its key, and with several server processes two simultaneous calls could both send: accepted for a notice.
  - Refusals: 400 a body that isn't a notice, 401 the token, 403 a number off the list, 404 off (no settings, or no gateway), 409 the sending number isn't connected (`whatsapp.portal_disconnected`; nothing is kept for later, the portal tries again), 413 a body over 16 KB, 429 one new conversation too many today (`whatsapp.new_chats_limit`), 502 the gateway refused or didn't answer (`whatsapp.unavailable`).
  - Code: `packages/engine/src/whatsapp/portal-notice.ts` (`sendPortalWhatsApp`), the route in `apps/server/src/routes/webhooks.ts` (before the generic `/webhooks/:provider/:endpointId`, which its two segments would match), tests `apps/server/test/portal-whatsapp.test.ts` with the fake gateway.
- Addendum 2026-11-14: stickers, and what the phone did elsewhere. The stickers a number sent or received are its sticker shelf (the latest 60, each once by WhatsApp's hash of the file): nothing is stored for it, each is a message that carried one. To send one the gateway must fetch the picture from an address (it takes no upload), so the server signs one for two minutes with the number's own `hook_hash` (`GET /api/webhooks/whatsapp-sticker/{messageId}`), and the gateway sends it as a still sticker. A conversation read on the phone is read here (`ReadSelf`), a message deleted for everyone keeps its row without words or file (kind `deleted`), and an edited one takes its new words.

