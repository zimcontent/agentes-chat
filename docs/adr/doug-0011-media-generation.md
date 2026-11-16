# doug-0011: images and videos generated from a credit wallet, through the Zim Mídia service

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

## Addendum (2026-11-15): the Studio's whole catalog and its inputs

1. **The catalog says what each model takes.** Besides `maxRefs` and `firstFrame`, a model may carry `inputs` (how
   many reference images, videos and audios, whether it takes a first and a last frame, a quality with another image
   count, `framesOrRefs` for one that takes frames or references but never both, `firstFrameOnly` for one whose only
   picture is the opening frame), `modesByQuality` (the Studio's modes per quality) and `aspectsByQuality`. The server
   (`modelInputs`) and the page (`mediaInputs`) read them the same way: the modes narrow the inputs when the catalog
   lists them for a quality, the older fields still read for a model that has no `inputs`.
2. **References are pictures, videos or audios.** `POST …/media/refs` takes a picture up to 12 MB, a video (MP4, MOV,
   WebM) up to 50 MB or an audio (MP3, WAV, M4A, AAC, OGG) up to 15 MB, its kind read from its bytes, never its name;
   an MP4 is an audio only when its brand or the browser says so. The service answers with the kind and, for a video
   or an audio, its seconds. A generation carries `lastFrame`, `videoRefs` and `audioRefs` besides `refs` and
   `firstFrame`.
3. **A reference video is priced by the service.** The Studio's rule for one (Seedance 2.5 also charges the clip's
   seconds) lives in the service, so the page asks `POST …/media/quote` before it shows the price, and an agent's
   call with a reference video has no price until the service quotes it: with a threshold set it always asks a person
   first, and its monthly allowance is checked against the quote before the generation starts.
4. **Agents pick the model by what they hold.** `generate_video` takes `closing_image_id`, `reference_ids`,
   `video_reference_ids` and `audio_reference_ids` (Drive files or attachments), and its description lists per model,
   per quality where it changes, which of them it takes. A call with files the model refuses is answered before
   anything is sent or paid.
5. **The page shows only what fits.** The form offers the first and last frames (the last once a first is in),
   reference images, videos and audios as the chosen model and quality take them, a choice between frames and
   references for a `framesOrRefs` model, and drops what a new model or quality doesn't take.
