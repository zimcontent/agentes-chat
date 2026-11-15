# doug-0010: images and videos generated from a credit wallet, through the Zim Mídia service

Status: accepted. This instance's own. 2026-11-15.

## Context

The team already generates images and videos for clients through the Zim Studio and its MCP server, with provider
accounts the Zim pays for (CRUN.AI, APIMODELS, BytePlus ModelArk, Meta Muse). People asked to do the same inside the
DougBot, and agents need it without anyone opening another app or adding an MCP server: a routine that writes a post
should be able to make its picture. Generation costs real money per call, so it needs a wallet that people top up, a
price shown before anything runs, and brakes on what an agent spends alone.

## Decision

1. **A separate service holds the keys, the prices and the wallet.** "Zim Mídia" (repository `zimcontent/zim-midia`)
   runs on the second-brain VPS with its own PostgreSQL, only on its internal network. It keeps the provider keys, the
   catalog with the Zim Studio's credit prices (1,000 credits = US$ 1, at least 10 per generation), one wallet per
   workspace and the Mercado Pago top-ups. This server never holds a provider key: it signs each call with
   `ZIM_MEDIA_SECRET` (HMAC over time, method, path and the body's hash) and never hands the service's address to a
   browser. Without `ZIM_MEDIA_URL` and `ZIM_MEDIA_SECRET` nothing of this exists: no page, no tools.
2. **Credits are reserved, then kept or given back.** The service takes the price from the wallet when it accepts a
   generation and returns it when the provider refuses, fails or never finishes. The same `idempotencyKey` returns
   the same generation without charging again: a tool call's key is `run:<run>:<tool call>`, a person's is the page's
   id for that click.
3. **The file lands in the Drive.** When a generation ends, `media.poll` (an outbox job, ADR 0005) brings the file
   through this server into the Drive with `createFileArtifact`, as the person or the agent who asked, once (the
   `media_generations` row's claim). An agent's image waits inside its tool call and comes attached to its reply; a
   video returns at once and is posted in the conversation the agent asked from when it's ready, or a message says
   why it failed and that the credits went back.
4. **Agents have an allowance and a threshold.** `generate_image` and `generate_video` are built-in tools with the
   catalog and prices in their description. Each agent has `media_monthly_credits` (default 5,000; 0 takes the tools
   away) and `media_ask_above` (default 500; null never asks). A call priced above the threshold is sensitive and
   becomes an approval request in the chat (ADR 0015), with the price on its card; an agent whose Approvals are
   "Nunca perguntar" asks nothing (ADR 0173). The run policy counts them as internal work (area `media`), so a
   routine may generate within the same brakes (ADR 0053).
5. **People generate on the Mídia page.** Members see the balance, the models and their prices, generate with
   reference pictures from their computer (sent to the service, kept there for a day) and see their own and the
   workspace's generations. Who has `manage_billing` tops the wallet up: the server asks the service for a Mercado
   Pago checkout and opens it; credit only arrives after the service reads the payment back from Mercado Pago's API,
   once per payment.
6. **Tables are this instance's own**, outside the numbered migrations (`EXTRA_COLUMNS`): `media_generations` and the
   two agent columns.

## Consequences

- The wallet and the provider keys live in one place another app (the Zim Studio, a future client) can also use.
- A server that runs this code without the service shows nothing new.
- The credit prices follow the Zim Studio's table, copied into the service. Changing a price is a change there.
