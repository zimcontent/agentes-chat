import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

/**
 * A video as an AI can take it in (docs/adr/doug-0034-whatsapp-files.md): no model the agents use watches a video, but
 * every one that sees reads pictures, and the speech engines hear sound. So a video becomes a few frames spread over
 * its length (JPEG, the long side at 768) and its sound as a small MP3, made by ffmpeg on this server.
 */
export interface VideoGlance {
  /** Frames in order, spread over the video; empty when none could be taken. */
  frames: Uint8Array[];
  /** The sound track, mono MP3; null when the video has none. */
  audio: Uint8Array | null;
  /** Its length as ffmpeg read it; null when it couldn't. */
  seconds: number | null;
}

export type GlanceVideo = (video: Uint8Array, options?: { frames?: number }) => Promise<VideoGlance>;

/** Frames taken by default: enough to tell what happens in a phone's clip, few enough for one look. */
export const GLANCE_FRAMES = 4;
/** The most frames one glance takes. */
export const GLANCE_FRAMES_MAX = 8;
/** The long side of a frame: what a model reads well, a fraction of the bytes of the original. */
export const GLANCE_LONG_SIDE = 768;
/** The longest sound kept: what a voice message may be. */
export const GLANCE_AUDIO_SECONDS = 10 * 60;
/** One ffmpeg call's longest wait. */
const STEP_TIMEOUT_MS = 60_000;

/** The length ffmpeg prints when it opens a file (`Duration: 00:01:02.50`), in seconds; null: not there. */
export function durationOf(ffmpegOutput: string): number | null {
  const m = /Duration:\s*(\d+):(\d{2}):(\d{2}(?:\.\d+)?)/.exec(ffmpegOutput);
  if (!m) return null;
  const seconds = Number(m[1]) * 3600 + Number(m[2]) * 60 + Number(m[3]);
  return Number.isFinite(seconds) && seconds > 0 ? seconds : null;
}

/** Where the frames are taken: the middle of each of `count` equal parts, so neither the first nor the last black frame. */
export function glanceTimes(seconds: number | null, count: number): number[] {
  const n = Math.max(1, Math.min(GLANCE_FRAMES_MAX, Math.round(count)));
  if (seconds === null) return [0];
  return Array.from({ length: n }, (_, i) => Math.round(((seconds * (i + 0.5)) / n) * 100) / 100);
}

/** ffmpeg's arguments for one frame of `input` at `at` seconds, written to `output`. */
export function frameArgs(input: string, at: number, output: string): string[] {
  const side = GLANCE_LONG_SIDE;
  return [
    "-hide_banner",
    "-loglevel",
    "error",
    "-y",
    // Before the input: a fast seek to the nearest key frame, then exact.
    "-ss",
    String(at),
    "-i",
    input,
    "-frames:v",
    "1",
    "-vf",
    `scale='if(gt(iw,ih),min(${side},iw),-2)':'if(gt(iw,ih),-2,min(${side},ih))'`,
    "-q:v",
    "4",
    "-threads",
    "2",
    output,
  ];
}

/** ffmpeg's arguments for the sound of `input` as a small mono MP3, written to `output`. */
export function soundArgs(input: string, output: string): string[] {
  return [
    "-hide_banner",
    "-loglevel",
    "error",
    "-y",
    "-i",
    input,
    "-vn",
    "-t",
    String(GLANCE_AUDIO_SECONDS),
    "-ac",
    "1",
    "-ar",
    "16000",
    "-c:a",
    "libmp3lame",
    "-b:a",
    "48k",
    "-threads",
    "2",
    output,
  ];
}

async function run(binary: string, args: string[]) {
  const proc = Bun.spawn([binary, ...args], { stdout: "ignore", stderr: "pipe" });
  const timer = setTimeout(() => proc.kill(), STEP_TIMEOUT_MS);
  const [code, err] = await Promise.all([proc.exited, new Response(proc.stderr).text()]).finally(() =>
    clearTimeout(timer),
  );
  return { code, err };
}

const readOrNull = (path: string) =>
  readFile(path).then(
    (b) => (b.byteLength > 0 ? new Uint8Array(b) : null),
    () => null,
  );

/** ffmpeg on this server's path, or null: without it a video stays a file nobody here watches. */
export function createFfmpegVideoGlance(binary = Bun.which("ffmpeg")): GlanceVideo | null {
  if (!binary) return null;
  return async (video, options = {}) => {
    const dir = await mkdtemp(join(tmpdir(), "glance-"));
    try {
      const input = join(dir, "in");
      await writeFile(input, video);
      // Opening it with no output prints its length and ends with an error: only the length is read.
      const seconds = durationOf((await run(binary, ["-hide_banner", "-i", input])).err);
      const frames: Uint8Array[] = [];
      for (const [i, at] of glanceTimes(seconds, options.frames ?? GLANCE_FRAMES).entries()) {
        const out = join(dir, `f${i}.jpg`);
        await run(binary, frameArgs(input, at, out));
        const frame = await readOrNull(out);
        if (frame) frames.push(frame);
      }
      const sound = join(dir, "sound.mp3");
      // A video with no sound ends with an error and writes nothing: no audio.
      await run(binary, soundArgs(input, sound));
      return { frames, audio: await readOrNull(sound), seconds };
    } finally {
      await rm(dir, { recursive: true, force: true }).catch(() => undefined);
    }
  };
}
