# doug-0035: the Doug calls phones, through its owner's line

Status: accepted. This instance's own. 2026-11-19.

## Context

People asked for the Doug to call someone's phone and talk, the way it already talks on a call in the app (ADR doug-0006):
"call Diego and explain how the app works", "call me back when the edit is ready". A phone call needs a telephone
network, which this server doesn't have, and the voice must stay the Doug's: its words, its knowledge, and what was said
coming back to the conversation that asked.

Tested by hand on 2026-11-18: a small calling service (Twilio dials; the call's audio, G.711 µ-law at 8 kHz, goes over
Twilio's Media Streams to a GPT-Live session on its WebSocket transport, voice `tempo` for Brazilian Portuguese) called
phones in Brazil and the US. GPT-Live doesn't speak first by itself: the service asks it to greet with
`session.commentary.append` once the session starts. It streams audio without pause, silence included, so the service
paces it to the phone and drops what wasn't played yet when the person starts talking. A call billed about US$ 0.12 a
minute to a Brazilian mobile (Twilio US$ 0.066, GPT-Live US$ 0.05) and US$ 0.064 to a US number.

## Decision

1. **A calling service outside this server.** The telephone network, its credentials and the audio bridge live in a
   separate service, reached over the network (ADR 0002 §5): this server never holds a carrier's credentials and never
   carries a call's audio. Its contract is three calls: `GET <url>/line` (the token checked, answers `{ from }`, the
   number it calls from), `POST <url>/call` (`{ to, about, name?, agent: { name, role }, report }`, answers `{ sid }`),
   and, when the call ends, a `POST` to `report` with `{ status: "ended" | "failed", seconds, lines: [{ who, text }] }`.
   Both directions carry a bearer token or a one-use secret; nothing else is trusted.
2. **The line is the owner's, not the workspace's.** `phone_lines` is keyed by person: an owner connects their service
   once (its address, https only, and its token, sealed like provider keys, ADR 0007, shown by its last 4 characters)
   and the Doug of every workspace they own calls through it. A workspace calls through its owners' lines, the asking
   person's own first. Only an owner connects a line, and only their own (Configurações › Voz, `PhoneLineCard`). Like
   `connector_sign_ins` and `agent_twins`, the table is a person's, so it has no `org_id`.
3. **Only the Doug calls, only when an owner or an administrator asks, and every call is approved.** `phone_call` is
   listed for the workspace's right hand (ADR 0137) alone, in a run an owner or an administrator is behind (not a
   routine), where an owner has a line. It is `sensitive`: each call is a card a person approves; "Aprovar sempre" keeps
   one number (`rememberTarget`), so calls to the person's own phone can go without asking.
4. **The Doug writes the brief.** The voice on the phone knows only what the call is given: the agent's name and role and
   the `brief` the Doug writes with what it knows and finds with its tools before calling (what the call is for, the
   facts, what to ask, what to leave out; never a secret).
5. **What was said comes back once, to the conversation that asked.** Each call is a `phone_calls` row with the hash of
   a one-use secret; the service reports to `/api/webhooks/phone-call/{callId}/{secret}`. The transcript, outside text,
   reaches the Doug inside `untrustedBlock` as a `wait_result` notice only it reads (`readOutside`), which wakes it to
   tell the people there how the call went: what was talked about, what was decided or promised and by whom, what is
   left to do, an insight worth their attention, and to do what it promised. Nobody answering is said the same way.
6. **No spending cap for now.** Each call is billed by the owner's own service; a cap, if wanted later, goes on the line.

## Consequences

- The Doug's voice on the phone is the service's choice (GPT-Live today), not the workspace's GPT-Live key.
- A call can't ask the team anything while it lasts: what the person wants checked is promised and done after, from the
  transcript. Bringing the call's delegations to the Doug while it lasts (as the call with one agent does, ADR doug-0006
  §9) is the next step.
- Voicemail is not told apart from a person yet: the service should detect it and leave a short message or hang up.
