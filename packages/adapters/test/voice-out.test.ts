import { expect, test } from "bun:test";
import { createElevenLabsVoiceOut, VoiceOutError } from "../src/voice-out";

/** ElevenLabs as the agents' voice: what we ask it, and what we take from its answers. */

const VOICE = "pNInz6obpgDQGcFmaJgB";

function elevenLabs(previewUrl: string) {
  const asked: { url: string; method: string; key: string | null; body: unknown }[] = [];
  const http = (async (input: string | URL | Request, init?: RequestInit) => {
    const url = String(input);
    asked.push({
      url,
      method: init?.method ?? "GET",
      key: new Headers(init?.headers).get("xi-api-key"),
      body: init?.body ? JSON.parse(String(init.body)) : undefined,
    });
    if (url.endsWith("/v1/voices")) {
      return Response.json({
        voices: [
          { voice_id: VOICE, name: "Adam", labels: { gender: "male", accent: "american" }, preview_url: previewUrl },
          { voice_id: "../etc", name: "Bad" },
        ],
      });
    }
    if (url.includes("/v1/text-to-speech/")) return new Response(new Uint8Array([9, 9, 9]));
    if (url === previewUrl) return new Response(new Uint8Array([1, 2]));
    return new Response("no", { status: 404 });
  }) as typeof fetch;
  return { asked, voiceOut: createElevenLabsVoiceOut("key-1", { fetch: http }) };
}

test("voices are the account's, each with its labels; one that isn't an id is left out", async () => {
  const { voiceOut, asked } = elevenLabs("https://storage.googleapis.com/x/adam.mp3");
  expect(await voiceOut.voices()).toEqual([{ id: VOICE, name: "Adam", labels: ["male", "american"] }]);
  expect(asked[0]).toMatchObject({ url: "https://api.elevenlabs.io/v1/voices", key: "key-1" });
});

test("speaking asks for an MP3 on the multilingual model; a voice that isn't one is refused before any call", async () => {
  const { voiceOut, asked } = elevenLabs("https://storage.googleapis.com/x/adam.mp3");
  const audio = await voiceOut.speak({ voice: VOICE, text: "Oi! Tudo bem?" });
  expect([...audio.bytes]).toEqual([9, 9, 9]);
  expect(asked[0]).toMatchObject({
    url: `https://api.elevenlabs.io/v1/text-to-speech/${VOICE}?output_format=mp3_44100_128`,
    method: "POST",
    body: { text: "Oi! Tudo bem?", model_id: "eleven_multilingual_v2" },
  });
  expect(await voiceOut.speak({ voice: "../x", text: "oi" }).catch((e) => e)).toBeInstanceOf(VoiceOutError);
  expect(asked).toHaveLength(1);
});

test("a sample comes only from the provider's own storage", async () => {
  const good = elevenLabs("https://storage.googleapis.com/x/adam.mp3");
  expect([...((await good.voiceOut.preview(VOICE))?.bytes ?? [])]).toEqual([1, 2]);
  const bad = elevenLabs("https://evil.example/adam.mp3");
  expect(await bad.voiceOut.preview(VOICE)).toBeNull();
  expect(bad.asked.some((a) => a.url.startsWith("https://evil.example"))).toBe(false);
});
