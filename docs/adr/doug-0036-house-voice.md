# doug-0036: the house voice on calls, paid in credits

Status: accepted. This instance's own. 2026-11-19.

## Context

Live voice (ADR doug-0006) runs on GPT-Live with each workspace's own OpenAI key: a workspace without one has no calls
with agents and no Ouvir, and every workspace pays OpenAI on its own card, about US$ 0.05 a minute per agent. Most
workspaces never add a key.

Qwen Audio 3.1 Realtime Flash, through Empirio Labs, is a duplex voice model on OpenAI Realtime's protocol (one socket,
PCM16 at 24 kHz, server voice detection, function calling, Portuguese). It is billed by token. Measured on 2026-11-19
with a real 16-turn conversation of 11 minutes, it cost US$ 0.051, about R$ 0.28. Each answer bills the conversation so
far again, with no cache, so the cost per minute grows with the call. Its answer starts 2.5 to 3 seconds after the
person stops, slower than GPT-Live.

The workspace already has a credit wallet for media (ADR doug-0011), which phone calls on the house voice also spend
(docs/adr/doug-0035-phone-calls.md).

## Decision

1. **The house voice is the default.** One key, the server's (`EMPIRIO_API_KEY`). With it and the wallet
   (`ZIM_MEDIA_URL`, `ZIM_MEDIA_SECRET`), calls with agents, voice rooms, Ouvir and voice samples use Qwen in every
   workspace, without a key of its own. A workspace can pick GPT-Live on its own key instead in Configurações › Voz
   (`organization_settings.live_voice_engine`, `setLiveVoiceEngine`). Null means the default.
2. **Paid in credits by the minute.** The wallet's `qwen-live` price is 20 credits a minute (about R$ 0.20), set in
   Zim Mídia (`CALL_CREDITS_PER_MINUTE_QWEN_LIVE`), apart from phone calls' `qwen` (100, which covers the carrier). A
   session starts only with credits for a minute (`live_voice.no_credits`), lasts what the wallet pays for, and is
   charged once when it ends, by the second, keyed by its id (`settleHouse`). Its credits stay on the session row and go
   to the usage file at a credit's worth (US$ 0.001, `provider: empirio`), so the agent's budget and the person's limit
   count them as before. Who configures may set a monthly limit in credits (`live_voice_monthly_credits`,
   `live_voice.month_limit`).
3. **The audio goes through this server.** The model takes the key in a header, so a browser can't open its socket
   without seeing the key. `POST …/live-voice/sessions` with `relay` in `transports` answers a one-use ticket; the app
   opens `/api/live-voice/relay?ticket=` within a minute, on the replica that started it, and sends its microphone as
   binary PCM16 frames and GPT-Live's commands as JSON. The server opens the model's socket with its key and runs the
   session there (`openHouseRelay`).
4. **One dialect for both voices.** `houseSession` (`live-voice-house.ts`) translates between the model's events and
   GPT-Live's, so the apps' rooms, the call with one agent, Ouvir and the voice picker work unchanged:
   - delegating is the function `get_work_done`, which becomes `session.delegation.created`, and the work's answer
     (`session.commentary.append` on it) becomes the function's output, with an answer asked for;
   - muting drops the app's audio at the relay;
   - instructions added during a call go into the session's instructions;
   - quiet notes are system messages;
   - a line to say now is a system message and an answer, held while one is being spoken;
   - the person starting to speak (`session.speech.started`) empties what the app was about to play;
   - a voice that speaks first gets a cue message, since the model won't answer an empty conversation.
5. **Billed seconds** are the relay's count: every second of a session, except in a room the seconds an agent's voice
   is muted, when the model hears nothing. A session that never opened costs nothing.
6. **Its own voices.** The model's voices don't carry across from GPT-Live. Twelve of its 88 speak Portuguese well,
   feminine and masculine (`HOUSE_VOICE_CATALOG`), each checked on 2026-11-19 saying a Portuguese line (its transcript and its pitch). Each agent keeps one of each engine:
   `agents.house_voice` is picked by its owner or an admin in the same picker (`setAgentVoice` with `engine: "house"`),
   and is otherwise one that sounds like its GPT-Live voice (`houseVoiceFor`).
7. **Older apps.** An app that sends only a WebRTC offer (a phone build from before this) gets GPT-Live when the
   workspace has a key, else `live_voice.update_app`. The web and desktop apps try the relay first and send their
   offer only when the server asks for it (`{ transport: "offer" }`).

## Consequences

- Every workspace on a server with the house voice can call its agents from the first day, paying only for what it
  uses, and nobody needs an OpenAI account.
- Answers are slower than GPT-Live's by a second or two. A workspace that minds can switch to GPT-Live.
- The browser plays the voice through a WebRTC connection to its own page, because browsers cancel echo only for
  WebRTC audio. Without that, the voice would hear itself.
- Long calls cost more per minute, since the conversation is billed again with each answer. At 20 credits a minute
  the margin stays above four times the cost up to an hour, by the measured rates. Trimming old turns from the session
  is the next step if calls get longer.
- The relay holds a session's socket on the server, so a session's audio goes through it both ways (about 48 KB/s
  each way).
- The phone apps still call on GPT-Live: playing and capturing PCM there needs a native audio module and a new build.
  Until then a workspace on the house voice calls from the phone only with a GPT-Live key.
- Empirio Labs receives the call's audio, the agent's instructions and what was said, while the call lasts. The privacy
  policy lists it when the server has the house voice (`svc.houseVoice`).
