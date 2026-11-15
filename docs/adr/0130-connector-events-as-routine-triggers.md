# 0130. Every connector with a natural event offers it as a routine trigger

- Status: Accepted
- Date: 2026-11-02
- Builds on: 0016 (connectors in two layers), 0038 (mailboxes and the email trigger), 0053 (routines), 0106 (routines started by a webhook), 0117 (outside content)
- Code: `packages/engine/src/frameio.ts` and `connectors/oauth-return.ts` (`LOOPBACK_OAUTH_REDIRECT`, addenda), `packages/engine/src/connector-triggers.ts` (`CONNECTOR_EVENTS`, `checkConnectorTrigger`, `syncConnectorTrigger`, `connectorCallPasses`, `connectorEventsOf`), `packages/engine/src/routines.ts` (the `connector` trigger), `packages/engine/src/routine-hooks.ts` (the filter, Standard Webhooks' `webhook-id`), `packages/engine/src/connectors/custom.ts` (`events`), `packages/db/src/schema/work.ts` (`routine_hooks.source`), migration `0185_routine_hook_source`, `apps/server/src/routes/app/routines.ts`, `apps/server/src/routes/app/context.ts` (`routineConnectorDeps`), web `ConnectorTrigger.tsx` and `RoutinesPage.tsx`, phone `routines/RoutineForm.tsx`, `logic.ts`, `hooks.tsx`

## Context

A beta user asked for a routine that starts when an email reaches an inbox of the MillionSend they connected. Mailboxes connected here (Gmail and Outlook through Composio, IMAP) already start routines (ADR 0038); a MillionSend inbox is reached through the MillionSend connector (an MCP server), and the path that made it a mailbox was withdrawn (ADR 0102). Without a default trigger, people copy a webhook routine's address into the service by hand, or ask the agent to poll. The same holds for most services people connect: something happens there (a payment, a form answer, a new lead) and they want an agent to act on it.

## Decision

1. **A standing rule.** Every connector whose service has a natural event offers it as a ready trigger in the routine editor, on the web and the phone, named in the person's words ("Quando chegar um email em vendas@…"), with the filters people expect for it. Adding a connector includes deciding its default events; a connector with none says so in its preset review.
2. **One generic path: a webhook routine registered for the person.** A connector event is a webhook routine (ADR 0106) whose address the server registers at the service through the connection itself (its MCP tools), and takes back when the routine is paused, changed, moved to another trigger or deleted. `routine_hooks.source` (migration 0185, JSON) keeps the connection, the event, its filter and the service's webhook id. It inherits everything the webhook path has: the address as the credential (stored only as a hash), 300 calls a minute per client address and 60 per routine, 256 KB bodies, one run at a time with bursts merged, the outside-content envelope for the body (ADR 0117), and dedupe of repeated deliveries within 24 hours by `Idempotency-Key`, `X-GitHub-Delivery` or Standard Webhooks' `webhook-id`.
3. **The filter runs before any run.** A call that isn't the event, or that its filter leaves out, answers 202 and starts nothing, so a service that can't filter at its side never wakes the agent for nothing.
4. **Consent stays with the connection.** A routine may wait on a connection's events only when its agent may read that connection (`custom:<connection>:read`, granted by whoever manages it): the agent never hears of what it couldn't read itself. Changing the routine's agent checks it again.
5. **A service that refuses the webhook** leaves the routine with `status: "error"` and the service's reason; the apps show "Com erro" as for a mailbox, and saving the routine tries again.
6. **First event: MillionSend's received email** (`millionsend.email.received`). Registered with MillionSend's `create_webhook` (`inbox.email.received`, every inbox of the team, or one by `inboxId` through the API), taken back with `delete_webhook`. Filters: the inbox's address (`to`), senders (addresses or `@domains`) and words in the subject. MillionSend signs its calls with a secret its MCP tools never return, so the address is the credential, as for an unsigned webhook routine. The connection lists it in `events`, which is how the apps know to offer "Email no MillionSend".

## Connectors with a natural event, and how each would be surfaced

| Connector | Event people want | Way in |
| --- | --- | --- |
| MillionSend | email received in an inbox | done here: `create_webhook` through the MCP connection |
| Gmail, Outlook (Composio) | new email | done (ADR 0038): the email trigger, Composio's mail triggers |
| IMAP mailboxes | new email | done (ADR 0038): polling |
| GitHub | PR opened, issue, push | done for PRs through the workspace's GitHub App webhook (`github.pr_opened`); more events on the same endpoint |
| Sentry | new issue | done through the workspace's Sentry webhook (`sentry.issue_created`) |
| Stripe, Paddle, PayPal, Square, Mercado Pago, AbacatePay, RevenueCat | payment succeeded or failed, subscription changed | the service's webhook API through its connection, as MillionSend's |
| Linear, Asana, ClickUp, monday, Todoist, Jira (Atlassian) | task created or assigned | the service's webhook through its connection, or Composio triggers |
| Slack, Microsoft Teams | message in a channel, mention | Composio triggers (managed OAuth) |
| HubSpot, Salesforce, Attio, Close | new lead or deal stage | Composio triggers, else the service's webhook |
| Calendly, Google Calendar | event booked, event starting | Composio triggers |
| Jotform, Tally, Typeform | form answered | the service's webhook through its connection |
| Intercom, Zendesk | new conversation or ticket | the service's webhook, or Composio triggers |
| Vercel, Netlify, Railway | deploy succeeded or failed | done for deploys through the workspace's webhook (`deploy.succeeded`); per project through the connection |
| Notion, Airtable, Google Sheets, Google Drive | page, row or file changed | Composio triggers (polling at Composio) |
| Shopify-like stores (Wix) | new order | the service's webhook through its connection |

Each new one is one entry in `CONNECTOR_EVENTS` (how to register, take back and read its payload), its words in the apps, and a test; Composio's triggers go through the same `source`, created with Composio's trigger API instead of an MCP tool.

## Consequences

- People pick an event instead of wiring an address; the routine's page still shows the routine's runs and its address isn't needed.
- A routine on every inbox of a busy team receives every email the team gets and drops what its filter leaves out; past 60 calls a minute the routine's limit refuses the rest, and the service retries them.
- A webhook the service kept after a delete that failed calls an address that answers 404 until the service gives up on it.
- An agent's own routine tools don't make connector routines yet; people make them in Rotinas.

## Alternatives considered

- **Polling the service through its MCP tools:** its tools answer text for a model, a poll per routine costs calls when nothing happens, and new mail would wait for the next poll.
- **A mailbox per MillionSend inbox (ADR 0102):** withdrawn; it needed a key of its own beside the connector.
- **A table per connector event:** one JSON column on the routine's address holds what each event needs, and the address is already the routine's way in.

## Addendum (2026-11-14): Frame.io's comments and uploads

Production teams receive raw footage and review notes in Frame.io, and deliver new versions there. Frame.io's official MCP server (`https://mcp.frame.io/v1/mcp`, a preset now: OAuth with Dynamic Client Registration, clients with a secret only) reads and writes files, versions and comments, but its tools make no webhooks, so the generic path of §2 can't register one. Its events come the way Sentry's do instead: through the workspace's own webhook for the service (`webhooks.ts`, provider `frameio`, `/api/webhooks/frameio/{id}`), which an account owner or content admin makes once at next.frame.io › Settings › Webhooks, following the steps the routine form shows.

1. **Two events.** `frameio.comment_created` (Frame.io's `comment.created`, replies included) and `frameio.file_uploaded` (`file.upload.completed`: a new version is an upload too, so `file.versioned` is left out rather than fire twice). Each delivery's identity is the comment's or the file's id, so Frame.io's retries fire nothing twice.
2. **Read in code before the run.** Frame.io sends ids only. Before a routine runs, the server reads the comment (its text, author, timecode, file) or the file (its name, version, link) through the workspace's Frame.io connection, with no model involved, within three seconds (Frame.io waits five, then retries); the run starts with the ids alone when nothing could be read. The answers are kept as the service gave them besides the fields picked from them, and reach the model inside the outside-content envelope like any event.
3. **Consent as in §4.** Only a routine whose agent may read that connection gets what was read; any other gets the ids.
4. **Signature.** Frame.io signs with `X-Frameio-Signature: v0=<hex>`, the HMAC-SHA256 of `v0:<timestamp>:<body>` with the webhook's own signing secret, its timestamp within five minutes. Frame.io's settings page may not show that secret (only its API returns it, once), so until a secret is pasted the address alone is the credential, as for MillionSend (§6); once one is pasted, every call must be signed with it.
5. **Templates.** "Comentários do Frame.io" and "Arquivos novos no Frame.io" start from these events.

## Addendum (2026-11-15): Frame.io's sign-in comes back by a pasted address

Frame.io's authorization server registers clients for only a few redirects: `localhost` and `127.0.0.1` (programs on the person's computer), claude.ai's and chatgpt.com's; it refused `https://dougbot.app/api/app/connectors/oauth/callback` (`invalid_redirect_uri`). Its server takes no key either, so the "connect with a key" way out offered to vendors that don't approve us would never work.

1. **A loopback redirect.** A preset marked `pasteBack` registers and signs in with `LOOPBACK_OAUTH_REDIRECT` (`http://127.0.0.1:33418/dougbot/connectors/oauth`, `oauth-return.ts`), and exchanges the code with the same address. Nothing listens there: the person's browser ends on a page that doesn't open.
2. **The person pastes that page's address.** The connect dialog opens the sign-in in a new tab and asks for the address it ended on; the app reads its `state` and `code` (`packages/client/src/lib/oauth-paste.ts`) and finishes with the person's session through `POST …/connectors/oauth/complete`, which takes a state whose `returnTo` starts with `paste:` as it takes the phone's and the desktop window's. The state stays bound to that person and organization, and PKCE to this server, so an address seen by anyone else can't be used.
3. **Sign-in only.** A `pasteBack` preset is listed with `oauth` alone and a key sent for it is refused (`connector.oauth_only`). The phone app, whose browser session can't hand that address back, says to connect it from a computer.
4. If Adobe approves this server's address later, removing `pasteBack` from the preset brings the usual one-click return back; connections already made keep working (refresh tokens don't name a redirect).
