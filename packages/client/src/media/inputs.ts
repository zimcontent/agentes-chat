import type { MediaModel, MediaRefKind } from "./types";

/**
 * What a model takes besides the prompt at one quality (ADR doug-0011), the same reading as the server's
 * `modelInputs` (`packages/engine/src/media-generation.ts`): an image model takes `maxRefs` pictures; a video model
 * what `inputs` says, narrowed by the quality's modes when the catalog lists them.
 */
export interface MediaInputLimits {
  images: number;
  videos: number;
  audios: number;
  firstFrame: boolean;
  lastFrame: boolean;
  /** References or frames, never both. */
  framesOrRefs: boolean;
}

export function mediaInputs(model: MediaModel | undefined, quality?: string): MediaInputLimits {
  const none = { images: 0, videos: 0, audios: 0, firstFrame: false, lastFrame: false, framesOrRefs: false };
  if (!model) return none;
  if (model.kind === "image") return { ...none, images: model.maxRefs ?? model.inputs?.images ?? 0 };
  const q = quality ?? model.defaultQuality;
  const i = model.inputs;
  const firstFrame = i?.firstFrame ?? model.firstFrame ?? false;
  const out: MediaInputLimits = {
    images: i ? (i.imagesByQuality?.[q] ?? i.images) : 0,
    videos: i?.videos ?? 0,
    audios: i?.audios ?? 0,
    firstFrame,
    lastFrame: firstFrame && (i?.lastFrame ?? false),
    framesOrRefs: i?.framesOrRefs ?? false,
  };
  if (i?.firstFrameOnly) {
    out.images = 0;
    out.lastFrame = false;
  }
  const modes = model.modesByQuality?.[q];
  if (modes) {
    const has = (...names: string[]) => names.some((n) => modes.includes(n));
    if (!has("multi_reference")) out.images = 0;
    if (!has("multi_reference", "video_reference")) out.audios = 0;
    if (!has("multi_reference", "video_reference", "edit", "extend")) out.videos = 0;
    if (!has("first_n_last_frames")) {
      out.firstFrame = false;
      out.lastFrame = false;
    }
  }
  return out;
}

/** The aspects a model offers at a quality. */
export function mediaAspects(model: MediaModel | undefined, quality?: string): string[] {
  if (!model) return [];
  return model.aspectsByQuality?.[quality ?? model.defaultQuality] ?? model.aspects;
}

/** A file the person sent for a generation: its token and what the form shows of it. */
export interface MediaRefFile {
  token: string;
  kind: MediaRefKind;
  name: string;
  /** A local address for its preview. */
  url: string;
  seconds?: number;
}

/** The files a request carries, by role. */
export interface MediaFileSet {
  firstFrame?: MediaRefFile;
  lastFrame?: MediaRefFile;
  images: MediaRefFile[];
  videos: MediaRefFile[];
  audios: MediaRefFile[];
}

export const NO_MEDIA_FILES: MediaFileSet = { images: [], videos: [], audios: [] };

/** With `framesOrRefs`, which side a request uses. */
export type MediaFileSide = "frames" | "refs";

/**
 * The files that still fit after the model, the quality or the side changed: whatever the new choice doesn't take
 * goes, extra files past a smaller maximum go, and a last frame never stays without its first.
 */
export function fitMediaFiles(files: MediaFileSet, limits: MediaInputLimits, side: MediaFileSide): MediaFileSet {
  const frames = !limits.framesOrRefs || side === "frames";
  const refs = !limits.framesOrRefs || side === "refs";
  const firstFrame = frames && limits.firstFrame ? files.firstFrame : undefined;
  return {
    firstFrame,
    lastFrame: firstFrame && limits.lastFrame ? files.lastFrame : undefined,
    images: refs ? files.images.slice(0, limits.images) : [],
    videos: refs ? files.videos.slice(0, limits.videos) : [],
    audios: refs ? files.audios.slice(0, limits.audios) : [],
  };
}

/** Every file of a set, for freeing their previews. */
export function mediaFilesOf(files: MediaFileSet): MediaRefFile[] {
  return [files.firstFrame, files.lastFrame, ...files.images, ...files.videos, ...files.audios].filter(
    (f): f is MediaRefFile => f !== undefined,
  );
}

/** The largest reference file of each kind, in bytes: what the server and the service take. */
export const MEDIA_REF_LIMITS: Record<MediaRefKind, number> = {
  image: 12 * 1024 * 1024,
  video: 50 * 1024 * 1024,
  audio: 15 * 1024 * 1024,
};

/** What the file picker offers for each kind (the server checks the bytes anyway). */
export const MEDIA_REF_ACCEPT: Record<MediaRefKind, string> = {
  image: "image/jpeg,image/png,image/webp",
  video: "video/mp4,video/quicktime,video/webm",
  audio: "audio/mpeg,audio/mp3,audio/wav,audio/x-wav,audio/mp4,audio/x-m4a,audio/aac,audio/ogg",
};
