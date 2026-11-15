/**
 * Live voice with OpenAI's GPT-Live (ADR doug-0006): the model, its price and the voices an agent can have. Pure data, read
 * by the server (sessions, usage) and by the apps (an agent's voice picker), so it has no imports.
 *
 * A session's voice is fixed when it starts, and its configuration is strict: a voice OpenAI doesn't know refuses the
 * session. The server then starts it again with `DEFAULT_LIVE_VOICE` (`startLiveSession`), so a name dropped from this
 * list costs a voice, never a call.
 */
export const LIVE_VOICE_MODEL = "gpt-live-1";

/** OpenAI's API base for live sessions. */
export const LIVE_VOICE_API = "https://api.openai.com/v1";

/** $0.05 a minute, billed by the second (checked on openai.com, 2026-11-14), in nano-USD a second. */
export const LIVE_VOICE_NANO_USD_PER_SECOND = 833_334;

/** A WebRTC session bills at least this many seconds. */
export const LIVE_VOICE_MIN_SECONDS = 15;

export const DEFAULT_LIVE_VOICE = "marin";

/** A voice's language, the accent it speaks with, and how it sounds (OpenAI's own voice table for GPT-Live). */
export interface LiveVoiceInfo {
  id: string;
  lang: "en" | "pt" | "de" | "fr" | "hi" | "ja" | "ko";
  /** The regional influence OpenAI lists; null for the voices it lists none for. */
  accent: "australian" | "british" | "irish" | "northAmerican" | "brazilian" | "filipino" | "southernUs" | null;
  presentation: "feminine" | "masculine";
}

/**
 * OpenAI's GPT-Live voices (its voice table, checked 2026-11-15), by their API names; each is shown by its own name, never
 * translated. Marin and Cedar first: every key takes them.
 */
export const LIVE_VOICE_CATALOG = [
  { id: "marin", lang: "en", accent: null, presentation: "feminine" },
  { id: "cedar", lang: "en", accent: null, presentation: "masculine" },
  { id: "bossa", lang: "pt", accent: "brazilian", presentation: "feminine" },
  { id: "tempo", lang: "pt", accent: "brazilian", presentation: "masculine" },
  { id: "gleam", lang: "en", accent: "northAmerican", presentation: "feminine" },
  { id: "meridian", lang: "en", accent: "northAmerican", presentation: "masculine" },
  { id: "delta", lang: "en", accent: "southernUs", presentation: "feminine" },
  { id: "cinder", lang: "en", accent: "southernUs", presentation: "masculine" },
  { id: "vesper", lang: "en", accent: "british", presentation: "masculine" },
  { id: "willow", lang: "en", accent: "irish", presentation: "feminine" },
  { id: "stone", lang: "en", accent: "irish", presentation: "masculine" },
  { id: "quartz", lang: "en", accent: "australian", presentation: "feminine" },
  { id: "ripple", lang: "en", accent: "australian", presentation: "masculine" },
  { id: "beacon", lang: "en", accent: "filipino", presentation: "masculine" },
  { id: "nuri", lang: "de", accent: null, presentation: "feminine" },
  { id: "juni", lang: "de", accent: null, presentation: "feminine" },
  { id: "flitz", lang: "de", accent: null, presentation: "masculine" },
  { id: "brise", lang: "fr", accent: null, presentation: "feminine" },
  { id: "sillage", lang: "fr", accent: null, presentation: "masculine" },
  { id: "nira", lang: "hi", accent: null, presentation: "feminine" },
  { id: "harema", lang: "ja", accent: null, presentation: "feminine" },
  { id: "shida", lang: "ja", accent: null, presentation: "masculine" },
  { id: "noeul", lang: "ko", accent: null, presentation: "feminine" },
] as const satisfies readonly LiveVoiceInfo[];

/** The voices offered, by their API names. */
export const LIVE_VOICES = LIVE_VOICE_CATALOG.map((v) => v.id);

/** The voices an agent with none picked gets one of (kept as they were, so no agent's voice changes on its own). */
const AUTO_VOICES = [
  "marin",
  "cedar",
  "bossa",
  "quartz",
  "ripple",
  "vesper",
  "willow",
  "stone",
  "gleam",
  "meridian",
  "tempo",
  "beacon",
  "delta",
  "cinder",
] as const;

export type LiveVoice = (typeof LIVE_VOICE_CATALOG)[number]["id"];

export const isLiveVoice = (v: unknown): v is LiveVoice =>
  typeof v === "string" && (LIVE_VOICES as readonly string[]).includes(v);

export const liveVoiceInfo = (v: string): LiveVoiceInfo | undefined => LIVE_VOICE_CATALOG.find((x) => x.id === v);

/** "meridian" → "Meridian". */
export const liveVoiceLabel = (v: string) => v.charAt(0).toUpperCase() + v.slice(1);

/**
 * A voice for an agent that has none picked: the same agent always gets the same one, and agents on one call tend to
 * sound different from each other.
 */
export function liveVoiceFor(agentId: string, chosen?: string | null): string {
  if (chosen && isLiveVoice(chosen)) return chosen;
  let hash = 0;
  for (const ch of agentId) hash = (hash * 31 + ch.charCodeAt(0)) >>> 0;
  return AUTO_VOICES[hash % AUTO_VOICES.length] ?? DEFAULT_LIVE_VOICE;
}

/**
 * The voices an agent with none picked may get, its own first (`liveVoiceFor`): the next ones when a colleague already
 * has it, so every agent of a workspace sounds like itself.
 */
export function liveVoiceChoices(agentId: string): string[] {
  const own = AUTO_VOICES.indexOf(liveVoiceFor(agentId) as (typeof AUTO_VOICES)[number]);
  return [...AUTO_VOICES.slice(own), ...AUTO_VOICES.slice(0, own)];
}

/** What `seconds` of live voice cost, in nano-USD (the minimum billed included). */
export const liveVoiceCost = (seconds: number) =>
  Math.max(LIVE_VOICE_MIN_SECONDS, Math.ceil(seconds)) * LIVE_VOICE_NANO_USD_PER_SECOND;
