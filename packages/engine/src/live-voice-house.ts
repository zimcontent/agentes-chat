import { HOUSE_VOICE_SAMPLE_RATE, type HouseVoiceTokens, houseVoiceCost } from "@agenteschat/providers/live-voice";

/**
 * The house voice's session (docs/adr/doug-0036-house-voice.md): Qwen Audio 3.1 Realtime Flash, which speaks OpenAI
 * Realtime's protocol, translated to and from the GPT-Live events the apps and the server already use (ADR doug-0006),
 * so a call, a room, Ouvir and a sample work the same on either voice. Pure: it gets the model's events and the app's
 * commands, and says what to send each way. The relay (`live-voice-relay.ts`) owns the sockets.
 *
 * What maps to what:
 * - GPT-Live delegates on its own; here the model calls the function `get_work_done`, which becomes
 *   `session.delegation.created` with the call's id, and its answer (`session.commentary.append` on that id) the
 *   function's output, with a new answer asked for.
 * - GPT-Live mutes its input on request; here the relay drops the app's audio while muted.
 * - Instructions added during the session go into the session's instructions; quiet notes are system messages; a line
 *   to say now is a system message and an answer asked for, held while one is being spoken.
 * - The person starting to speak stops the voice (`session.speech.started`, the app empties what it was going to play).
 */

/** An event in GPT-Live's dialect, as the apps and `agentCall` read them. */
export interface LiveDialectEvent {
  type: string;
  delta?: string;
  reason?: string;
  delegation?: { id: string; target?: string };
  usage?: { seconds?: number };
}

/** A command in GPT-Live's dialect, from the app or the server's side of a call. */
export interface LiveDialectCommand {
  type: string;
  delegation_id?: string | null;
  content?: string;
}

export interface HouseSessionSetup {
  instructions: string;
  voice: string;
  /** The app's language: what the person speaks and the voice answers in. */
  language: string | null;
  /** Whether it can hand work to the agent (calls); Ouvir and samples only speak. */
  delegate: boolean;
  /** It speaks first, on its own (Ouvir, a sample, the agent that opens a call). */
  speakFirst: boolean;
}

export interface HouseSessionOut {
  /** To the model, as JSON. */
  upstream(event: object): void;
  /** To the app and the server's side of the call. */
  event(event: LiveDialectEvent): void;
  /** The voice's audio, PCM16 at 24 kHz, to the app. */
  audio(pcm: Uint8Array): void;
}

/** The function the model calls to hand work to the agent (ADR doug-0006 §9 and §10: "já vejo"). */
export const WORK_TOOL = "get_work_done";

const WORK_TOOL_SPEC = {
  type: "function",
  name: WORK_TOOL,
  description:
    'Hands what the person asked to your real self in the chat, with your tools: to look something up, check, do, write or send. Say one short natural line first ("já vejo"). The result comes back to you to tell.',
  parameters: {
    type: "object",
    properties: { request: { type: "string", description: "What was asked, in the person's words." } },
    required: ["request"],
  },
} as const;

/** The model's own languages for transcription and speech (Empirio's list, 2026-11-19). */
const MODEL_LANGUAGES = ["zh", "en", "ja", "ko", "vi", "th", "id", "ar", "fr", "de", "es", "pt", "ru", "it"];

export const modelLanguage = (language: string | null) => {
  const base = (language ?? "").toLowerCase().split(/[-_]/)[0] ?? "";
  return MODEL_LANGUAGES.includes(base) ? base : "auto";
};

/** What starts a voice that speaks first: the model won't answer an empty conversation. */
export const START_CUE = "(The call just connected. Begin now, as your instructions say.)";

/** Instructions added during a session grow it; past this, the oldest added go (the base stays). */
const MAX_ADDED_CHARS = 6000;

/** The session's first message to the model. */
export function houseSessionUpdate(setup: HouseSessionSetup, instructions = setup.instructions) {
  const lang = modelLanguage(setup.language);
  return {
    type: "session.update",
    session: {
      type: "realtime",
      instructions,
      audio: {
        input: {
          format: { type: "audio/pcm", rate: HOUSE_VOICE_SAMPLE_RATE },
          transcription: { model: "fun-asr" },
          // Fillers ("é…", "hmm") neither end the person's turn nor cut the voice off.
          turn_detection: { type: "smart_turn", threshold: 0.5, silence_duration_ms: 700 },
        },
        output: { format: { type: "audio/pcm", rate: HOUSE_VOICE_SAMPLE_RATE }, voice: setup.voice },
      },
      input_language: lang,
      output_language: lang,
      ...(setup.delegate ? { tools: [WORK_TOOL_SPEC], tool_choice: "auto" } : {}),
    },
  };
}

const delegateLine = `\n\n# Doing work\nTo delegate, call the ${WORK_TOOL} tool with what was asked, right after your short line.`;

type ModelEvent = {
  type?: string;
  delta?: string;
  transcript?: string;
  error?: { message?: string; code?: string };
  response?: {
    status?: string;
    output?: { type?: string; call_id?: string; name?: string }[];
    usage?: {
      input_tokens_details?: { text_tokens?: number; audio_tokens?: number };
      output_tokens_details?: { text_tokens?: number; audio_tokens?: number };
    };
  };
};

export function houseSession(setup: HouseSessionSetup, out: HouseSessionOut) {
  const base = setup.delegate ? `${setup.instructions}${delegateLine}` : setup.instructions;
  let added: string[] = [];
  let started = false;
  let closed = false;
  let muted = false;
  /** An answer is being made: `response.create` waits for it to end. */
  let answering = false;
  let wantAnswer = false;
  const tokens: HouseVoiceTokens = { audioIn: 0, textIn: 0, audioOut: 0, textOut: 0 };
  let costNanoUsd = 0;

  const instructions = () => (added.length ? `${base}\n\n# Added during the call\n${added.join("\n")}` : base);
  const system = (text: string) =>
    out.upstream({
      type: "conversation.item.create",
      item: { type: "message", role: "system", content: [{ type: "input_text", text }] },
    });
  const answer = () => {
    if (answering) {
      wantAnswer = true;
      return;
    }
    answering = true;
    wantAnswer = false;
    out.upstream({ type: "response.create" });
  };

  return {
    /** The first message, once the model's socket is open. */
    open() {
      out.upstream(houseSessionUpdate(setup, instructions()));
    },

    /** One event from the model. */
    fromModel(data: string) {
      let e: ModelEvent;
      try {
        e = JSON.parse(data) as ModelEvent;
      } catch {
        return;
      }
      switch (e.type) {
        case "session.updated":
          if (started) return;
          started = true;
          out.event({ type: "session.started" });
          if (setup.speakFirst) {
            // The model answers only once the conversation has a person's message: a cue, said by nobody.
            out.upstream({
              type: "conversation.item.create",
              item: { type: "message", role: "user", content: [{ type: "input_text", text: START_CUE }] },
            });
            answer();
          }
          return;
        case "response.output_audio.delta":
          if (e.delta) out.audio(Buffer.from(e.delta, "base64"));
          return;
        case "response.output_audio_transcript.delta":
          if (e.delta) out.event({ type: "session.output_transcript.delta", delta: e.delta });
          return;
        case "conversation.item.input_audio_transcription.completed":
          if (e.transcript?.trim())
            out.event({ type: "session.input_transcript.delta", delta: `${e.transcript.trim()} ` });
          return;
        case "input_audio_buffer.speech_started":
          // The person talks over the voice: the app stops what it was playing.
          out.event({ type: "session.speech.started" });
          return;
        case "response.created":
          answering = true;
          return;
        case "response.done": {
          answering = false;
          const u = e.response?.usage;
          if (u) {
            const t: HouseVoiceTokens = {
              audioIn: u.input_tokens_details?.audio_tokens ?? 0,
              textIn: u.input_tokens_details?.text_tokens ?? 0,
              audioOut: u.output_tokens_details?.audio_tokens ?? 0,
              textOut: u.output_tokens_details?.text_tokens ?? 0,
            };
            tokens.audioIn += t.audioIn;
            tokens.textIn += t.textIn;
            tokens.audioOut += t.audioOut;
            tokens.textOut += t.textOut;
            costNanoUsd += houseVoiceCost(t);
          }
          out.event({ type: "session.output.done" });
          for (const item of e.response?.output ?? [])
            if (item.type === "function_call" && item.name === WORK_TOOL && item.call_id)
              out.event({ type: "session.delegation.created", delegation: { id: item.call_id } });
          if (wantAnswer) answer();
          return;
        }
        case "error":
          // A refused command (an answer asked for while one was being made, say) leaves the session as it was.
          if (/active response|in progress/i.test(e.error?.message ?? "")) wantAnswer = true;
          return;
        default:
          return;
      }
    },

    /** A command from the app or the server's side of the call. */
    command(c: LiveDialectCommand) {
      if (closed) return;
      const content = (c.content ?? "").trim();
      switch (c.type) {
        case "session.input_audio.mute":
          muted = true;
          return;
        case "session.input_audio.unmute":
          muted = false;
          return;
        case "session.instructions.append":
          if (!content) return;
          if (c.delegation_id) {
            // An instruction about work it delegated ("you didn't catch it"): the function's answer.
            out.upstream({
              type: "conversation.item.create",
              item: { type: "function_call_output", call_id: c.delegation_id, output: content },
            });
            answer();
            return;
          }
          added.push(content.slice(0, 1800));
          while (added.join("\n").length > MAX_ADDED_CHARS && added.length > 1) added = added.slice(1);
          out.upstream({ type: "session.update", session: { type: "realtime", instructions: instructions() } });
          return;
        case "session.thinking.append":
          // Quiet context: nothing is said now.
          if (content) system(content.slice(-1800));
          return;
        case "session.commentary.append":
          if (!content) return;
          if (c.delegation_id)
            out.upstream({
              type: "conversation.item.create",
              item: { type: "function_call_output", call_id: c.delegation_id, output: content.slice(0, 1800) },
            });
          else system(`Say this now, in your own words, briefly: ${content.slice(0, 1800)}`);
          answer();
          return;
        case "session.close":
          closed = true;
          out.event({ type: "session.closed", reason: "close_requested" });
          return;
        default:
          return;
      }
    },

    /** The app's microphone (PCM16 at 24 kHz): to the model unless muted. */
    audioIn(pcm: Uint8Array) {
      if (closed || muted || !started || pcm.byteLength === 0) return;
      out.upstream({ type: "input_audio_buffer.append", audio: Buffer.from(pcm).toString("base64") });
    },

    muted: () => muted,
    started: () => started,
    closed: () => closed,
    /** What it cost us so far (never shown: the workspace pays credits). */
    cost: () => ({ tokens: { ...tokens }, costNanoUsd }),
  };
}

export type HouseSession = ReturnType<typeof houseSession>;
