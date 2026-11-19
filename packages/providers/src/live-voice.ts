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

// ─── The house voice: Qwen Audio 3.1 Realtime Flash ──────────────────────────
//
// The default voice for calls, Ouvir and samples inside the apps (docs/adr/doug-0036-house-voice.md): one key, the
// server's (`EMPIRIO_API_KEY`), and the workspace pays in credits from the Zim Mídia wallet by the minute. The audio goes
// between the app and this server over a WebSocket (PCM16 at 24 kHz), and between this server and the model over
// another, so the key never leaves the server.

/** The model, through Empirio Labs' realtime API (OpenAI Realtime's protocol). */
export const HOUSE_VOICE_MODEL = "qwen-audio-3-1-realtime-flash";
export const HOUSE_VOICE_URL = `wss://api.empiriolabs.ai/v1/realtime?model=${HOUSE_VOICE_MODEL}`;
/** The wallet's engine for it (Zim Mídia's `qwen-live`, priced apart from phone calls). */
export const HOUSE_VOICE_ENGINE = "qwen-live";
/** Its audio, both ways: 16-bit little-endian mono at this rate. */
export const HOUSE_VOICE_SAMPLE_RATE = 24_000;
export const DEFAULT_HOUSE_VOICE = "longanqian_v3.1";

/** One of the model's own voices (they don't carry across from GPT-Live), and how it sounds. */
export interface HouseVoiceInfo {
  id: string;
  /** How it's shown: the voice's own name, never translated. */
  label: string;
  presentation: "feminine" | "masculine";
}

/**
 * The voices offered, of the model's 88 (Empirio's list, 2026-11-19): ones its multilingual voices speak Portuguese
 * with, feminine and masculine. The default first.
 */
export const HOUSE_VOICE_CATALOG = [
  { id: "longanqian_v3.1", label: "Anqian", presentation: "feminine" },
  { id: "eric_v3.1", label: "Eric", presentation: "masculine" },
  { id: "luna_v3.1", label: "Luna", presentation: "feminine" },
  { id: "luca_v3.1", label: "Luca", presentation: "masculine" },
  { id: "emily_v3.1", label: "Emily", presentation: "feminine" },
  { id: "brian_v3.1", label: "Brian", presentation: "masculine" },
  { id: "ava_v3.1", label: "Ava", presentation: "feminine" },
  { id: "david_v3.1", label: "David", presentation: "masculine" },
  { id: "loongstella_v3.1", label: "Stella", presentation: "feminine" },
  { id: "andy_v3.1", label: "Andy", presentation: "masculine" },
  { id: "abby_v3.1", label: "Abby", presentation: "feminine" },
  { id: "daniel", label: "Daniel", presentation: "masculine" },
] as const satisfies readonly HouseVoiceInfo[];

export const HOUSE_VOICES = HOUSE_VOICE_CATALOG.map((v) => v.id);
export type HouseVoice = (typeof HOUSE_VOICE_CATALOG)[number]["id"];

export const isHouseVoice = (v: unknown): v is HouseVoice =>
  typeof v === "string" && (HOUSE_VOICES as readonly string[]).includes(v);

export const houseVoiceInfo = (v: string): HouseVoiceInfo | undefined => HOUSE_VOICE_CATALOG.find((x) => x.id === v);

/**
 * An agent's house voice: the one picked, else one that sounds like its GPT-Live voice (feminine or masculine), the same
 * agent always getting the same one.
 */
export function houseVoiceFor(agentId: string, chosen?: string | null, liveVoice?: string | null): string {
  if (chosen && isHouseVoice(chosen)) return chosen;
  const presentation = liveVoiceInfo(
    liveVoice && isLiveVoice(liveVoice) ? liveVoice : liveVoiceFor(agentId),
  )?.presentation;
  const pool = HOUSE_VOICE_CATALOG.filter((v) => !presentation || v.presentation === presentation);
  let hash = 0;
  for (const ch of agentId) hash = (hash * 31 + ch.charCodeAt(0)) >>> 0;
  return pool[hash % pool.length]?.id ?? DEFAULT_HOUSE_VOICE;
}

/**
 * What the house voice costs us, from the usage it reports at the end of each answer (Empirio's prices, 2026-11-19, in
 * nano-USD a token). A spoken answer is billed for its audio output only. Shown to nobody: the workspace pays credits.
 */
export const HOUSE_VOICE_NANO_USD_PER_TOKEN = { audioIn: 1_860, textIn: 460, audioOut: 3_740, textOut: 1_400 } as const;

export interface HouseVoiceTokens {
  audioIn: number;
  textIn: number;
  audioOut: number;
  textOut: number;
}

export const houseVoiceCost = (t: HouseVoiceTokens) =>
  t.audioIn * HOUSE_VOICE_NANO_USD_PER_TOKEN.audioIn +
  t.textIn * HOUSE_VOICE_NANO_USD_PER_TOKEN.textIn +
  t.audioOut * HOUSE_VOICE_NANO_USD_PER_TOKEN.audioOut +
  (t.audioOut > 0 ? 0 : t.textOut * HOUSE_VOICE_NANO_USD_PER_TOKEN.textOut);

/** A credit of the wallet is a thousandth of a dollar (Zim Mídia's catalog): in nano-USD. */
export const CREDIT_NANO_USD = 1_000_000;

/** Which voice engine a workspace's calls use: the house voice (credits) or GPT-Live on its own key. */
export const LIVE_VOICE_ENGINES = ["house", "gpt-live"] as const;
export type LiveVoiceEngine = (typeof LIVE_VOICE_ENGINES)[number];
