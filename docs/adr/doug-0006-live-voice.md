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
4. **An agent's voice** is `agents.voice`, one of `LIVE_VOICES` (`@dougbot/providers/live-voice`), picked by its
   owner or an admin like its look (`setAgentVoice`); with none picked its id gives one (`liveVoiceFor`). A voice OpenAI
   doesn't know refuses a session, so the server tries once more with `marin`.
5. **Voice rooms.** A conversation has at most one live room (`live_voice_rooms`, unique while live). People join from
   the header's phone ("Entrar na chamada" while one is live) and reach each other directly, a WebRTC connection per
   pair, signalled through the server and each person's socket (`live.signal`). The host's browser runs one GPT-Live
   session per agent (up to 5): each hears every person's microphone and the other agents, mixed in Web Audio, and each
   agent's voice goes on to every person as a track of its own, so every app lights the tile of whoever speaks. When
   the host leaves, the next person in takes the room and opens the voices again with what was said so far.
6. **Who speaks is code, with one judgment.** The rule is `live-floor` (`@dougbot/client/lib/live-floor`), applied
   by the host: an agent speaks when someone calls it by name, in a call of one person and one agent, or right after it
   spoke when the person answers. Among agents it is a lively meeting (addendum 2026-11-15): one may bring a colleague
   in by name; when it finishes, the small model may pick a colleague to build on it, push back or add their role's
   angle (`next`, `moment: after`) before the people answer; and while it talks, after a sentence and at most every
   4 s, the small model may say a colleague cuts in now (`during`, `when: now`), when the one talking is faded out
   through its own gain node, its words so far kept as a line ending in "…", and told it was cut off, or follows as
   soon as it finishes (`when: after`). Nobody cuts in while a person is talking. The limits: 5 passes from agent to
   agent and 6 agent turns in a row without a person speaking, 2 for any one agent (back and forth once, never a
   duet); past that the word goes back to the people and every agent only listens until a person speaks. This is what
   keeps agents from answering each other forever. The agent with the word
   hears the call; the others are muted and get what they missed as quiet notes when the word comes to them, with a cue
   to answer. With one person on the call everything said is for the agents: the agent with the word keeps it (the one
   that opens a new call greets, asked to if GPT-Live waits for a sound), and when nobody has it the workspace's small
   model, through the gateway (`kind: router`), picks who answers, never "none"; if it can't say, the agent that spoke
   last, else the first. With several people an agent keeps the word 20 s after it got it or spoke; past that the small
   model says whether an agent should answer and which, "none" unless the people clearly wait for one. Anyone can give
   the word by hand, or set the agents to only listen. (Addendum 2026-11-15: before, the first agent lost the word to
   the person's first words, since it hadn't spoken yet, and the judge's "none" left a one-person call silent.)
   Addendum 2026-11-15 (the meeting's lead): a call with agents is led by the team's right hand, put first on it by
   the server even when not picked; it has the word whenever nobody else does (the start, past the limits, several
   people talking), so somebody always hears the people, and it is told to bring colleagues in by name rather than
   answer everything. What the people say no longer comes from the browser's speech recognition, which failed quietly
   (a person named an agent and the one with the word kept answering): it is the transcript of the GPT-Live session
   with the word, which hears them; a name said mid-sentence passes the word at once (once a sentence), the new holder
   told what came before its name; the line goes to whoever's microphone was loudest meanwhile. After an agent
   finishes, the small model now usually brings in a colleague who hasn't spoken on it.
7. **Captions and notes.** The host writes down everyone's words from GPT-Live's transcripts (the people's as the
   agent with the word hears them); lines go to the room and to everyone's captions. When the call
   ends for everyone (or the last person leaves) the notes are posted to the conversation as the person who ended it,
   mentioning the workspace's right hand (ADR 0137, Doug BOSS here; the call's first agent where there is none), whose
   reply is the summary: what was talked about, what was decided, the next steps with owners and dates, and what was
   left open. Work asked for during the call runs during it (§10).
8. **Ouvir.** "Ouvir" in a message's menu opens one session in the voice of the agent that wrote it (in the first
   person), or the narrator's for a person's message, told to explain it humanly, reactions included, never read word
   for word. It starts on silence; "Perguntar" swaps in the microphone, so the person can interrupt and ask. It closes
   a few seconds after the voice goes quiet.

9. **A call with one agent, as the Nordus Live call.** The phone in an agent's DM is always there; without the workspace's key it says where the key goes. The call is a small bar under the header, the conversation in sight. The voice is the agent (first person, never a backend or a voice layer); when it needs work done, looked up or checked it delegates, and the server, on its sideband, posts what the person said since the last ask as their message in the DM (`meta.via: "call"`). The agent works on it as on any message, with its tools, and its answer goes back to the voice (`session.commentary.append`, made speakable: no markdown, links or code read out); while it works the voice is told to hold on, and past 4 minutes that the answer will be in the chat. The call hangs up after 5 minutes without speech. When it ends, always, what was said (GPT-Live's transcripts, on the sideband) is posted in the DM as the person's message asking the agent for the summary (`meta.callSummary`): what was talked about, what was decided and the next steps; the agent writes it with what it knows and the work it did during the call. The channel's call keeps its picker, with agents locked and the same line when there is no key.

10. **One voice at a time, and work during the call** (addendum 2026-11-15, after a real call where agents talked over
    each other and went round in a loop, and nothing could be looked up until the call ended). The host's app no longer
    trusts GPT-Live to stop listening when told (`session.input_audio.mute`): every agent hears through a gain node of
    its own and is heard through another, both open only while it has the word, so an agent without it hears silence
    and nobody hears it, and what it says then doesn't count for the turns. Cutting in is gone; after an agent speaks
    the small model may still bring in a colleague, within tighter limits (3 agent turns in a row without a person, one
    each). Work asked for on the call runs during it: an agent that delegates ("já vejo") hands the host's app
    `session.delegation.created`, the app sends the call's latest lines to `POST …/live-rooms/{id}/ask`, and the server
    posts them as the host's message mentioning the agent (`meta.via: call`); the agent works on it with its tools like
    on any message, everyone on the call sees it working (`live.working`), and its answer, made speakable, comes back to
    the host (`live.answer`), who gives it the word at the next pause (or after 30 s at the next breath) to tell it
    (`session.commentary.append` on its delegation). Agents are told to take only what is in their own role and to name
    the colleague whose it is otherwise. The leg used to answer every delegation with "it goes in the notes", the one-agent
    call included, over the server's own answer on its sideband: now only the one who runs the call answers it.

11. **The maestro** (removed the same day, see the addendum below; kept here for the record. Addendum 2026-11-15, after real calls felt slow, overlapping and costly: a GPT-Live session per agent
    open all call long, every minute billed, silence included, and realtime voice models near random at knowing when
    to stay quiet in a group, per MP-Bench). A second kind of room, `mode: maestro`, offered first when the server has
    it, where the server decides who speaks and what, and the voice only speaks:
    - **Ears on the device.** Each person's app runs voice detection itself (free, instant): only what it hears as
      speech becomes a 16 kHz WAV sent to `POST …/live-rooms/{id}/heard`, written down by the workspace's speech engines
      (the voice messages' chain, ADR 0100). Silence costs nothing. The moment its person starts talking it stops every
      voice, here and for everyone (`hush`, `live.hush`).
    - **One brain, rules first.** Who was named or asked answers (adjacency pairs, decided in code, `addressedIn`);
      for the rest one short call on the meeting lead's own model (billed to it, the workspace's small model otherwise)
      picks which agent speaks and writes the line, in JSON. Never the same agent twice in a row; at most 3 agent lines
      without a person, 6 when the call opens on a topic. It reads `packages/engine/src/live-call.md` (the base every
      agent follows on a call: one at a time, short lines, react by name, numbers in words, "já vejo" before work, only
      your own role's work; compiled from OpenAI, ElevenLabs, LiveKit, Vapi and Retell's voice guides and turn-taking
      research), then the workspace's notes (`organization_settings.live_call_notes`, Configurações › Voz) and each
      agent's (`agents.live_call_notes`, its page).
    - **Few tokens.** The stable part (the .md, the team, the workspace) comes first for the provider's prompt cache;
      the call is the latest 14 lines word for word and a running summary of the rest, redone every 16 lines; the
      answer is capped at 350 tokens; nothing runs while nobody talks.
    - **Voices.** ElevenLabs Flash v2.5 (Portuguese, the first sound in a fraction of a second, US$ 0.04 per 1,000
      characters), with the server's key (`ELEVENLABS_API_KEY`); each agent gets a voice of the account that sounds like
      its GPT-Live one (feminine or masculine), or its own (`agents.call_voice`). A line streams into memory once and
      every app reads it at `GET …/speech/{utteranceId}` (`live.say`), playing lines in order with a human gap. The
      next line is prepared while the one before plays, so agents answer each other without silence.
    - **Work during the call** as in §10: the line says "já vejo", the request goes to the conversation mentioning the
      agent, and the answer is told at the next pause. The running cost of voice and transcription shows on the call.

### Addendum 2026-11-15: the GPT-Live room stays the default

After trying both, the GPT-Live room (§10) sounded better than the maestro (§11): one speech model per agent keeps
its own voice, timing and interruptions, where the maestro's transcription, text model and synthesis add a beat to
every turn. So the GPT-Live room is the only kind of call, and the maestro (§11) is gone: its code, its routes
(`…/heard`, `…/hush`, `…/speech/{id}`) and its choice in the call dialog. The tables keep `live_voice_rooms.mode`
(always `live` now) and `agents.call_voice` (unused) rather than drop columns in a migration. The room takes what
worked in the maestro:

- Every voice gets the maestro's speech rules (`CALL_STYLE` in `live-voice-prompt.ts`, cut from its `live-call.md`: short
  lines, react by name, numbers in words, never a fact it wasn't given), the meeting's topic, and the workspace's and
  its own call notes.
- A name speech to text got slightly wrong still passes the word (`namedAgent` in `live-floor.ts`, the same rule as
  `addressedIn`).
- Each agent keeps a voice of its own (`keepLiveVoices`): one no colleague in the workspace has, saved on the agent
  the first time it joins a call, so it never changes with who else is on.
- People are called in by name (`inviteToLiveRoom`, `POST …/live-rooms/{roomId}/invite`, from the call or the start
  dialog): one who can't see the conversation is added when the caller may add people there, a message mentions them
  (the mention's notification, push included), and their open apps ring (`live.ring`) with a way in.

### Addendum 2026-11-16: calls in the phone app, and on the desktop app

The same rooms, and the call with one agent from its DM, on iPhone and Android (`apps/mobile/src/features/call/*`):

- **WebRTC on the phone** is `react-native-webrtc` (MIT, with its Expo config plugin), the same browser API the web
  uses: a connection to each other person on the call (perfect negotiation through the server's `live.signal`), and
  one GPT-Live session per agent when the phone runs them (`PhoneLeg`, the web's `LiveLeg`).
- **Where the sound goes** is `react-native-incall-manager` (ISC): the call's audio session (the system's voice
  processing and echo cancelling), the earpiece by default ("modo telefone", the proximity sensor darkening the screen
  at the ear), the loudspeaker on a tap ("viva voz"), a headset when one is on.
- **Who runs the agents.** A phone can't pass audio it receives on to the others (libwebrtc doesn't send a remote
  track again), so the web's mix of every voice into every agent can't run there. People say where they join from
  (`phone` on the room's people); the server's `pickLiveHost` keeps the agents with a person on the web or the desktop
  app whenever one is in, and hands them back to a phone only when nobody on a computer is left. A phone that runs the
  agents gives them its own microphone; the one with the word is heard (its track enabled) and hears (the session's
  input unmuted), the others are muted. With other people on phones only, they hear each other but not the agents,
  and the call says so ("só o seu celular ouve os agentes").
- **One set of turn rules.** Who has the word, the cues each voice gets, the small model's picks and the answers to
  work asked on the call are `LiveHost` (`packages/client/src/lib/live-host.ts`), with no audio in it: the phone runs
  it, tested with fake voices; the web's `RoomCall` still has its own copy of the same rules and moves to it next.
- **The background.** iOS keeps the call with the screen locked (`UIBackgroundModes` audio), and the workspace's socket
  stays open while a call is on (`callActive`), for its signals and pings. Android keeps it while the app is open; a
  foreground service for the microphone in the background, and the system's call screens (CallKit, Android's
  ConnectionService) for a call that rings with the app closed, are next. Today a call that reaches a closed app is
  the mention's push, and the app rings (`live.ring`) once it is open.

The desktop app needs no code of its own: its window is the site, and the web view lets it in (on macOS WKWebView's
microphone requests are granted under the app's own system permission, `NSMicrophoneUsageDescription` and the
`audio-input` entitlement; on Windows WebView2 asks once per site), and plays the call's audio without a click. The
microphone's words on both now say they are for calls too.

## Consequences

- Live voice is optional and costs nothing until a workspace adds a key; calls between people alone need no key.
- People reach each other peer to peer with a public STUN server and no TURN: a strict network can keep two people
  from hearing each other. A TURN server, or an SFU, is the next step if that happens.
- People's captions and turns come from the agent with the word, so a call needs at least one agent voice on;
  calls between people alone have no captions.
- The phone app has no calls yet.
- The voice list follows OpenAI's voice table for GPT-Live as of 2026-11-15 (`LIVE_VOICE_CATALOG`: language, accent,
  feminine or masculine); a name they drop costs a voice, never a call. The voice picker plays each voice as the agent
  saying hello (a `sample` session, at least 15 s billed), records it in the page so hearing it again is free, and
  says when the key doesn't have the voice (OpenAI's answer names the one that spoke).
