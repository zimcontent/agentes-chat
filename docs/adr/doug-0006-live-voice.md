# doug-0006: live voice, voice rooms with people and agents, and Ouvir, on GPT-Live

Status: accepted. This instance's own. 2026-11-14.

## Context

People want to talk to their agents instead of typing: a call with one agent, a meeting where several people and
several agents brief and brainstorm together, and a way to hear a message instead of reading it, told the way a
colleague would tell it rather than read out word for word.

OpenAI's GPT-Live (`gpt-live-1`, in the API since 2026-09-10) is a full-duplex voice model: one session listens and
speaks at once, over WebRTC from a browser. A session's voice and instructions are fixed when it starts. There are no
ephemeral client keys: the session is created from a trusted backend (`POST /v1/live/sessions` with the browser's SDP
offer), which may attach a sideband socket to the running session (`/v1/live/sessions/{id}/attach`). It bills by the
second (about US$ 0.05 a minute), 15 seconds at least for a WebRTC session.

## Decision

1. **The key is the workspace's.** Settings › Voz takes an OpenAI key with GPT-Live access (`live_voice_keys`), checked
   with OpenAI before it is kept, sealed like provider keys (ADR 0007), shown by its last 4 characters to who may
   `configure`. Voz now shows on every server; the speech-to-text engine (ADR 0100) stays self-hosted only inside it.
2. **Sessions are opened by the server.** The app sends its WebRTC offer to `POST …/live-voice/sessions`; the server
   writes the instructions, opens the session with the key and returns OpenAI's answer. Audio then goes between the
   browser and OpenAI. The key never reaches a client. Each session is a `live_voice_sessions` row.
3. **Billing goes through the Model Gateway's file.** Before a session: the workspace may work, the agent isn't held,
   its budget and the person's monthly limit have room (`assertLiveVoiceAllowed`). When it ends: its seconds (OpenAI's
   own count from the sideband, else the clock, with the 15-second minimum) become one `usage_records` row (`openai`,
   `gpt-live-1`, no tokens) and are added to the agent's and the person's month (`recordLiveVoiceUsage`). The sideband
   also closes a session at its limit (60 minutes on a call, 6 for Ouvir, 30 seconds for a sample); sessions this
   process lost track of are settled by the clock (`sweepLiveVoiceSessions`).
4. **An agent's voice** is `agents.voice`, one of `LIVE_VOICES` (`@agenteschat/providers/live-voice`), picked by its
   owner or an admin like its look (`setAgentVoice`); with none picked its id gives one (`liveVoiceFor`). A voice OpenAI
   doesn't know refuses a session, so the server tries once more with `marin`.
5. **Voice rooms.** A conversation has at most one live room (`live_voice_rooms`, unique while live). People join from
   the header's phone ("Entrar na chamada" while one is live) and reach each other directly, a WebRTC connection per
   pair, signalled through the server and each person's socket (`live.signal`). The host's browser runs one GPT-Live
   session per agent (up to 5): each hears every person's microphone and the other agents, mixed in Web Audio, and each
   agent's voice goes on to every person as a track of its own, so every app lights the tile of whoever speaks. When
   the host leaves, the next person in takes the room and opens the voices again with what was said so far.
6. **Who speaks is code, with one judgment.** The rule is `live-floor` (`@agenteschat/client/lib/live-floor`), applied
   by the host: an agent speaks when someone calls it by name, in a call of one person and one agent, or right after it
   spoke when the person answers. Agents may bring a colleague in by name, at most 2 handoffs and 3 agent turns in a
   row without a person speaking, each agent once: past that the word goes back to the people and every agent only
   listens until a person speaks. This is what keeps agents from answering each other forever. The agent with the word
   hears the call; the others are muted and get what they missed as quiet notes when the word comes to them, with a cue
   to answer. With one person on the call everything said is for the agents: the agent with the word keeps it (the one
   that opens a new call greets, asked to if GPT-Live waits for a sound), and when nobody has it the workspace's small
   model, through the gateway (`kind: router`), picks who answers, never "none"; if it can't say, the agent that spoke
   last, else the first. With several people an agent keeps the word 20 s after it got it or spoke; past that the small
   model says whether an agent should answer and which, "none" unless the people clearly wait for one. Anyone can give
   the word by hand, or set the agents to only listen. (Addendum 2026-11-15: before, the first agent lost the word to
   the person's first words, since it hadn't spoken yet, and the judge's "none" left a one-person call silent.)
7. **Captions and notes.** Each person's browser writes down its own person's words (the Web Speech API), the host
   writes down the agents' (GPT-Live's transcripts); lines go to the room and to everyone's captions. When the call
   ends for everyone (or the last person leaves) the notes are posted to the conversation as the person who ended it,
   mentioning the workspace's right hand (ADR 0137, Doug BOSS here; the call's first agent where there is none), whose
   reply is the summary: what was talked about, what was decided, the next steps with owners and dates, and what was
   left open. Nothing runs during a call: GPT-Live's delegations are
   answered with "it goes in the notes".
8. **Ouvir.** "Ouvir" in a message's menu opens one session in the voice of the agent that wrote it (in the first
   person), or the narrator's for a person's message, told to explain it humanly, reactions included, never read word
   for word. It starts on silence; "Perguntar" swaps in the microphone, so the person can interrupt and ask. It closes
   a few seconds after the voice goes quiet.

9. **A call with one agent, as the Nordus Live call.** The phone in an agent's DM is always there; without the workspace's key it says where the key goes. The call is a small bar under the header, the conversation in sight. The voice is the agent (first person, never a backend or a voice layer); when it needs work done, looked up or checked it delegates, and the server, on its sideband, posts what the person said since the last ask as their message in the DM (`meta.via: "call"`). The agent works on it as on any message, with its tools, and its answer goes back to the voice (`session.commentary.append`, made speakable: no markdown, links or code read out); while it works the voice is told to hold on, and past 4 minutes that the answer will be in the chat. The call hangs up after 5 minutes without speech. When it ends, always, what was said (GPT-Live's transcripts, on the sideband) is posted in the DM as the person's message asking the agent for the summary (`meta.callSummary`): what was talked about, what was decided and the next steps; the agent writes it with what it knows and the work it did during the call. The channel's call keeps its picker, with agents locked and the same line when there is no key.

## Consequences

- Live voice is optional and costs nothing until a workspace adds a key; calls between people alone need no key.
- People reach each other peer to peer with a public STUN server and no TURN: a strict network can keep two people
  from hearing each other. A TURN server, or an SFU, is the next step if that happens.
- Captions of people depend on the browser (Chrome and Edge have the Web Speech API); where it is missing, the agent
  with the word hears people anyway and its transcript drives the turns.
- The phone app has no calls yet.
- The voice list follows OpenAI's voice table for GPT-Live as of 2026-11-15 (`LIVE_VOICE_CATALOG`: language, accent,
  feminine or masculine); a name they drop costs a voice, never a call. The voice picker plays each voice as the agent
  saying hello (a `sample` session, at least 15 s billed), records it in the page so hearing it again is free, and
  says when the key doesn't have the voice (OpenAI's answer names the one that spoke).
