import type { Message } from "@agenteschat/client";
import { VOICE_SPEEDS, voiceParts } from "@agenteschat/client/lib/voice";
import type { VoiceSend } from "./outbox";

/**
 * Voice on the phone (ADR 0100), the part with no device in it: how levels become a wave, and voice messages on their
 * way. What the web shares is in `@agenteschat/client/lib/voice`.
 */

/** A level from 0 to 1 from the recorder's decibels (-160 to 0); what is below -50 is silence. */
export function levelOf(db: number | undefined): number {
  if (db === undefined || !Number.isFinite(db)) return 0.04;
  return Math.min(1, Math.max(0.04, (db + 50) / 50));
}

/** The wave's grid (ADR 0100): square cells of 4, columns 6 apart, and the square handle a played wave moves by. */
export const WAVE_CELL = 4;
export const WAVE_PITCH = 6;
export const WAVE_HANDLE = 8;

/** How many columns fit in `width`. */
export function columnsIn(width: number): number {
  "worklet";
  return Math.max(1, Math.floor((width + WAVE_PITCH - WAVE_CELL) / WAVE_PITCH));
}

/**
 * A played wave's columns on `width`: how many, and where the first starts. They leave the handle's width and 2 at
 * both ends, centred on whole points, so at 0:00 the handle stands before the first column and at the end after the
 * last, flush with the wave's ends, as WhatsApp's dot does.
 */
export function playedColumns(width: number): { count: number; start: number } {
  const count = columnsIn(width - 2 * (WAVE_HANDLE + 2));
  return { count, start: Math.round((width - (count * WAVE_PITCH - (WAVE_PITCH - WAVE_CELL))) / 2) };
}

/** Where a played wave's handle starts at `progress`: flush with its left end at 0:00, with its right end at the end. */
export function handleAt(progress: number, width: number): number {
  "worklet";
  return progress * (width - WAVE_HANDLE);
}

/** Where `x` falls on a played wave `width` wide: the handle's middle there, up to 0.999 at the end. */
export function waveAt(x: number, width: number): number {
  "worklet";
  return Math.max(0, Math.min(0.999, (x - WAVE_HANDLE / 2) / (width - WAVE_HANDLE)));
}

export const nextSpeed = (speed: number) =>
  VOICE_SPEEDS[(VOICE_SPEEDS.indexOf(speed as (typeof VOICE_SPEEDS)[number]) + 1) % VOICE_SPEEDS.length] ?? 1;

/**
 * The words said in a voice message, for its player: not what was typed beside the take, not when no engine could make
 * them out, nor before the server answers.
 */
export function spokenWords(message: Pick<Message, "body" | "meta" | "local">): string | null {
  return message.local ? null : voiceParts(message).words;
}

export const hasWords = (message: Pick<Message, "body" | "meta" | "local">) => spokenWords(message) !== null;

/** The upload's form fields besides the recording; an older server ignores `text` and `attachments`. */
export function voiceFields(item: VoiceSend): [string, string][] {
  const fields: [string, string][] = [
    ["durationMs", String(item.durationMs)],
    ["peaks", JSON.stringify(item.peaks)],
    ["clientId", item.clientId],
  ];
  if (item.threadId) fields.push(["threadId", item.threadId]);
  if (item.replyTo) fields.push(["replyTo", item.replyTo]);
  if (item.language) fields.push(["language", item.language]);
  if (item.text?.trim()) fields.push(["text", item.text]);
  if (item.artifacts?.length) fields.push(["attachments", JSON.stringify(item.artifacts.map((a) => a.id))]);
  return fields;
}

/** Tries before the bubble says it didn't go (the first miss is often a blip the next try fixes). */
const FAILED_AFTER = 2;

/** The bubble until the real message arrives: my audio, not playable yet, no words; what I typed above it, my files. */
export const localVoiceMessage = (item: VoiceSend): Message => ({
  id: `local-${item.clientId}`,
  channelId: item.channelId,
  threadId: item.threadId,
  author: { type: "person", id: item.authorId },
  body: item.text ?? "",
  mentionedAgentIds: [],
  agentRunId: null,
  meta: {
    voice: {
      clipId: `local:${item.clientId}`,
      durationMs: item.durationMs,
      peaks: item.peaks,
      ...(item.text ? { text: item.text } : {}),
    },
    ...(item.artifacts?.length ? { artifacts: item.artifacts } : {}),
    // Why it didn't go yet, under "Não foi enviada" once it failed: a sender is never left guessing.
    ...(item.lastError ? { sendError: item.lastError } : {}),
    // The server has it (it answered 202): it posts the message once the words are made out, which can take a moment;
    // the bubble stops saying "Enviando…" meanwhile (the recording is safe there).
    ...(item.accepted ? { voiceAccepted: true } : {}),
  },
  clientId: item.clientId,
  local: (item.tries ?? 0) >= FAILED_AFTER ? "failed" : "pending",
  createdAt: item.createdAt,
});

/** Waits between upload tries, while the phone has no way through. */
export function retryDelayMs(attempt: number): number {
  return [2_000, 5_000, 15_000, 30_000][Math.min(attempt, 3)] ?? 30_000;
}

/** An answer to an upload: done, wait and try again, or never going to work. */
export function uploadVerdict(status: number): "done" | "retry" | "refused" {
  if (status >= 200 && status < 300) return "done";
  if (status === 408 || status === 429 || status >= 500) return "retry";
  return "refused";
}
