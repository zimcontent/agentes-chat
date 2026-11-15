/**
 * Text to speech: an agent's words as a recording it sends (docs/adr/doug-0004-whatsapp-bridge.md, addendum
 * 2026-11-15, its voice notes on WhatsApp). Optional: with no key the agent writes. ElevenLabs today, behind this
 * interface; the key stays on the server.
 */

export interface VoiceOutOption {
  id: string;
  name: string;
  /** What the provider says of it (accent, gender, age, use), for the list. */
  labels: string[];
}

export interface VoiceOut {
  readonly id: "elevenlabs";
  /** The voices the account has: its own (cloned, designed) and the provider's. */
  voices(): Promise<VoiceOutOption[]>;
  /** `text` in `voice`, as an MP3. */
  speak(input: { voice: string; text: string }): Promise<{ bytes: Uint8Array; mimeType: string }>;
  /** A short sample of the voice, as the provider keeps it; null when it keeps none. */
  preview(voice: string): Promise<{ bytes: Uint8Array; mimeType: string } | null>;
}

export class VoiceOutError extends Error {
  constructor(
    readonly status: number,
    message: string,
  ) {
    super(message);
    this.name = "VoiceOutError";
  }
}

/** A male voice that speaks Portuguese naturally on the multilingual model, until the number picks one. */
export const DEFAULT_VOICE_OUT = "pNInz6obpgDQGcFmaJgB";
/** A voice id as ElevenLabs makes them. */
export const isVoiceOutId = (v: unknown): v is string => typeof v === "string" && /^[A-Za-z0-9]{10,40}$/.test(v);
/** The longest text spoken at once: a voice note is a few sentences, never a document read out. */
export const VOICE_OUT_MAX_CHARS = 1200;

const BASE = "https://api.elevenlabs.io";
const TIMEOUT_MS = 60_000;

export function createElevenLabsVoiceOut(apiKey: string, options: { fetch?: typeof fetch } = {}): VoiceOut {
  const http = options.fetch ?? fetch;
  const call = async (path: string, init: RequestInit = {}) => {
    let res: Response;
    try {
      res = await http(`${BASE}${path}`, {
        ...init,
        headers: { "xi-api-key": apiKey, ...(init.headers ?? {}) },
        signal: AbortSignal.timeout(TIMEOUT_MS),
      });
    } catch (error) {
      throw new VoiceOutError(0, `ElevenLabs didn't answer: ${String(error)}`);
    }
    if (!res.ok) {
      const detail = (await res.text().catch(() => "")).slice(0, 300);
      throw new VoiceOutError(res.status, `ElevenLabs refused (${res.status})${detail ? `: ${detail}` : ""}`);
    }
    return res;
  };
  type Listed = { voice_id?: unknown; name?: unknown; labels?: unknown; preview_url?: unknown };
  let listed: { at: number; voices: Listed[] } | null = null;
  const list = async () => {
    if (listed && Date.now() - listed.at < 10 * 60_000) return listed.voices;
    const body = (await (await call("/v1/voices")).json().catch(() => null)) as { voices?: unknown } | null;
    const voices = Array.isArray(body?.voices) ? (body.voices as Listed[]) : [];
    listed = { at: Date.now(), voices };
    return voices;
  };
  return {
    id: "elevenlabs",
    async voices() {
      return (await list()).flatMap((v) => {
        if (!isVoiceOutId(v.voice_id) || typeof v.name !== "string") return [];
        const labels =
          v.labels && typeof v.labels === "object"
            ? Object.values(v.labels as Record<string, unknown>).filter((l): l is string => typeof l === "string")
            : [];
        return [{ id: v.voice_id, name: v.name.slice(0, 80), labels: labels.slice(0, 5) }];
      });
    },
    async speak({ voice, text }) {
      if (!isVoiceOutId(voice)) throw new VoiceOutError(400, "Not a voice");
      const res = await call(`/v1/text-to-speech/${voice}?output_format=mp3_44100_128`, {
        method: "POST",
        headers: { "Content-Type": "application/json", Accept: "audio/mpeg" },
        body: JSON.stringify({ text: text.slice(0, VOICE_OUT_MAX_CHARS), model_id: "eleven_multilingual_v2" }),
      });
      return { bytes: new Uint8Array(await res.arrayBuffer()), mimeType: "audio/mpeg" };
    },
    async preview(voice) {
      const found = (await list()).find((v) => v.voice_id === voice);
      const url = typeof found?.preview_url === "string" ? found.preview_url : "";
      // Only the provider's own storage, over HTTPS: the address comes from its answer, never from a person.
      let address: URL;
      try {
        address = new URL(url);
      } catch {
        return null;
      }
      const host = address.hostname;
      if (address.protocol !== "https:" || !(host.endsWith(".googleapis.com") || host.endsWith("elevenlabs.io"))) {
        return null;
      }
      const res = await http(address, { redirect: "error", signal: AbortSignal.timeout(TIMEOUT_MS) }).catch(() => null);
      if (!res?.ok) return null;
      const bytes = new Uint8Array(await res.arrayBuffer());
      return bytes.byteLength > 0 && bytes.byteLength < 5_000_000 ? { bytes, mimeType: "audio/mpeg" } : null;
    },
  };
}

/** A fake for tests: it says what it was asked, and keeps it. */
export function createFakeVoiceOut(): VoiceOut & { spoken: { voice: string; text: string }[] } {
  const spoken: { voice: string; text: string }[] = [];
  return {
    id: "elevenlabs",
    spoken,
    async voices() {
      return [{ id: DEFAULT_VOICE_OUT, name: "Adam", labels: ["male"] }];
    },
    async speak(input) {
      spoken.push(input);
      return { bytes: new TextEncoder().encode(`mp3:${input.text}`), mimeType: "audio/mpeg" };
    },
    async preview() {
      return { bytes: new Uint8Array([1, 2, 3]), mimeType: "audio/mpeg" };
    },
  };
}
