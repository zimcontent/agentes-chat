import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

/**
 * A light copy of a video, for watching it on a phone over a mobile connection (docs/adr/doug-0007-video-review.md):
 * H.264 with the long side at 960, a capped rate (about 1 Mb/s) and AAC, its index at the front so it plays as it
 * arrives. The original stays as it was, for delivery.
 */
export type LightCopy = (video: Uint8Array) => Promise<Uint8Array>;

/** The long side of a light copy: a phone's screen, not the delivery's 1920. */
export const LIGHT_LONG_SIDE = 960;
/** The longest a light copy may take before it is given up on (a review video is a few minutes at most). */
const LIGHT_TIMEOUT_MS = 10 * 60_000;

/** ffmpeg's arguments for a light copy of `input` written to `output`. */
export function lightCopyArgs(input: string, output: string): string[] {
  const side = LIGHT_LONG_SIDE;
  return [
    "-hide_banner",
    "-loglevel",
    "error",
    "-y",
    "-i",
    input,
    // The long side to 960 at most (never larger), the short one even and in proportion.
    "-vf",
    `scale='if(gt(iw,ih),min(${side},iw),-2)':'if(gt(iw,ih),-2,min(${side},ih))'`,
    "-c:v",
    "libx264",
    "-preset",
    "veryfast",
    "-crf",
    "27",
    "-maxrate",
    "1200k",
    "-bufsize",
    "2400k",
    "-profile:v",
    "main",
    "-pix_fmt",
    "yuv420p",
    "-c:a",
    "aac",
    "-b:a",
    "96k",
    "-ac",
    "2",
    "-movflags",
    "+faststart",
    // A server that also answers people: two threads, never all of them.
    "-threads",
    "2",
    output,
  ];
}

/**
 * The copy of an editor's video that goes to the post (docs/adr/doug-0012-editor-delivery.md): H.264 with the long
 * side at 1920 at most, a quality a feed keeps (CRF 20, capped at 12 Mb/s), AAC at 192k, its index at the front. Far
 * lighter than an editor's master (several GB of ProRes or a high-rate export), good enough to publish from.
 */
export function postCopyArgs(input: string, output: string): string[] {
  const side = 1920;
  return [
    "-hide_banner",
    "-loglevel",
    "error",
    "-y",
    "-i",
    input,
    "-vf",
    `scale='if(gt(iw,ih),min(${side},iw),-2)':'if(gt(iw,ih),-2,min(${side},ih))'`,
    "-c:v",
    "libx264",
    "-preset",
    "medium",
    "-crf",
    "20",
    "-maxrate",
    "12M",
    "-bufsize",
    "24M",
    "-profile:v",
    "high",
    "-pix_fmt",
    "yuv420p",
    "-c:a",
    "aac",
    "-b:a",
    "192k",
    "-ac",
    "2",
    "-movflags",
    "+faststart",
    "-threads",
    "2",
    output,
  ];
}

/**
 * Copies of a video made from a file on disk into another, never whole in memory: what an editor's master of up to
 * 2 GB needs. `light` is the phones' copy (`lightCopyArgs`), `post` the one that goes to the post (`postCopyArgs`).
 */
export type VideoCopies = (kind: "light" | "post", input: string, output: string) => Promise<void>;

/** The longest a post copy may take: a few minutes of 1080p at the medium preset on two threads. */
const POST_TIMEOUT_MS = 40 * 60_000;

/** ffmpeg on this server's path, or null: without it no copy is made from a file. */
export function createFfmpegVideoCopies(binary = Bun.which("ffmpeg")): VideoCopies | null {
  if (!binary) return null;
  return async (kind, input, output) => {
    const args = kind === "post" ? postCopyArgs(input, output) : lightCopyArgs(input, output);
    const proc = Bun.spawn([binary, ...args], { stdout: "ignore", stderr: "pipe" });
    const timer = setTimeout(() => proc.kill(), kind === "post" ? POST_TIMEOUT_MS : LIGHT_TIMEOUT_MS * 3);
    const code = await proc.exited.finally(() => clearTimeout(timer));
    if (code !== 0) {
      const why = (await new Response(proc.stderr).text()).trim().slice(-400);
      throw new Error(`ffmpeg ended with ${code}: ${why}`);
    }
  };
}

/** ffmpeg on this server's path, or null: without it the apps play the original. */
export function createFfmpegLightCopy(binary = Bun.which("ffmpeg")): LightCopy | null {
  if (!binary) return null;
  return async (video) => {
    const dir = await mkdtemp(join(tmpdir(), "light-"));
    try {
      const input = join(dir, "in.mp4");
      const output = join(dir, "out.mp4");
      await writeFile(input, video);
      const proc = Bun.spawn([binary, ...lightCopyArgs(input, output)], { stdout: "ignore", stderr: "pipe" });
      const timer = setTimeout(() => proc.kill(), LIGHT_TIMEOUT_MS);
      const code = await proc.exited.finally(() => clearTimeout(timer));
      if (code !== 0) {
        const why = (await new Response(proc.stderr).text()).trim().slice(-400);
        throw new Error(`ffmpeg ended with ${code}: ${why}`);
      }
      return new Uint8Array(await readFile(output));
    } finally {
      await rm(dir, { recursive: true, force: true }).catch(() => undefined);
    }
  };
}
