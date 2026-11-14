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
- Only what arrives or is sent after a number connects is kept. WhatsApp's history sync returns part of the past at best, so it isn't read.
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
