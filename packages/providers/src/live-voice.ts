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

/** The voices offered, by their API names; each is shown by its own name, never translated. */
export const LIVE_VOICES = [
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

export type LiveVoice = (typeof LIVE_VOICES)[number];

export const isLiveVoice = (v: unknown): v is LiveVoice =>
  typeof v === "string" && (LIVE_VOICES as readonly string[]).includes(v);

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
  return LIVE_VOICES[hash % LIVE_VOICES.length] ?? DEFAULT_LIVE_VOICE;
}

/** What `seconds` of live voice cost, in nano-USD (the minimum billed included). */
export const liveVoiceCost = (seconds: number) =>
  Math.max(LIVE_VOICE_MIN_SECONDS, Math.ceil(seconds)) * LIVE_VOICE_NANO_USD_PER_SECOND;
