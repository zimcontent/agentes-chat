import type { MediaModel, MediaRefKind, MediaServiceMode } from "./types";

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
  // The service never takes frames and references in one request (the Zim Studio's rule), so a model that takes
  // both makes the person pick one side.
  out.framesOrRefs = out.firstFrame && out.images + out.videos + out.audios > 0;
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
  /** A local address for its preview (or the Drive file's own, for one picked from the library). */
  url: string;
  seconds?: number;
}

/** The files a request carries, by role. */
export interface MediaFileSet {
  firstFrame?: MediaRefFile;
  lastFrame?: MediaRefFile;
  /** The one video a mode works on: the clip to edit, to extend or to follow (`video_reference`). */
  video?: MediaRefFile;
  images: MediaRefFile[];
  videos: MediaRefFile[];
  audios: MediaRefFile[];
}

export const NO_MEDIA_FILES: MediaFileSet = { images: [], videos: [], audios: [] };

/**
 * What the page asks for, the Zim Studio's input modes (its `modos-de-entrada.ts`, `seedance25.ts`, `minimax-h3.ts`):
 * the prompt alone, a first frame, a first and a last frame, several references, a video to follow (MiniMax H3), a
 * video to edit or to extend. A mode is one choice that decides the whole input block, so frames and references never
 * meet in one request.
 */
export type MediaInputMode = "text" | "first" | "frames" | "references" | "video_reference" | "edit" | "extend";

/** What one mode takes: the slots it shows and how many references of each kind its grid holds. */
export interface MediaModeSpec {
  mode: MediaInputMode;
  firstFrame: boolean;
  lastFrame: boolean;
  /** The one video the mode works on, its own large slot. */
  video: boolean;
  images: number;
  videos: number;
  audios: number;
}

const ORDER: MediaInputMode[] = ["text", "first", "frames", "references", "video_reference", "edit", "extend"];

/**
 * The modes a model offers at a quality, in the Studio's order. "Primeiro quadro" exists where the model takes a first
 * frame, "Primeiro e último quadro" where it takes a last one too, "Multi referências" where its references mode takes
 * any file, and the video modes where the quality lists them. An image model has one way in: its references.
 */
export function mediaModes(model: MediaModel | undefined, quality?: string): MediaInputMode[] {
  if (!model) return [];
  if (model.kind === "image") return (model.maxRefs ?? model.inputs?.images ?? 0) > 0 ? ["references"] : [];
  const q = quality ?? model.defaultQuality;
  const listed = model.modesByQuality?.[q];
  const has = (name: string) => !listed || listed.includes(name);
  const clips = model.inputs?.videos ?? 0;
  return ORDER.filter((mode) => {
    const spec = mediaModeSpec(model, q, mode);
    switch (mode) {
      case "text":
        return has("text_to_video");
      case "first":
        return spec.firstFrame;
      case "frames":
        return spec.lastFrame;
      case "references":
        return has("multi_reference") && spec.images + spec.videos + spec.audios > 0;
      default:
        return Boolean(listed?.includes(mode)) && clips > 0;
    }
  });
}

/** What `mode` takes for `model` at `quality` (whether the model offers the mode is `mediaModes`). */
export function mediaModeSpec(
  model: MediaModel | undefined,
  quality: string | undefined,
  mode: MediaInputMode,
): MediaModeSpec {
  const none: MediaModeSpec = {
    mode,
    firstFrame: false,
    lastFrame: false,
    video: false,
    images: 0,
    videos: 0,
    audios: 0,
  };
  if (!model) return none;
  const limits = mediaInputs(model, quality);
  if (model.kind === "image") return mode === "references" ? { ...none, images: limits.images } : none;
  const q = quality ?? model.defaultQuality;
  const i = model.inputs;
  const pictures = i ? (i.imagesByQuality?.[q] ?? i.images) : 0;
  switch (mode) {
    case "first":
      return { ...none, firstFrame: limits.firstFrame };
    case "frames":
      return { ...none, firstFrame: limits.lastFrame, lastFrame: limits.lastFrame };
    case "references":
      return { ...none, images: limits.images, videos: i?.videos ?? 0, audios: limits.audios };
    case "video_reference":
    case "extend":
      return { ...none, video: true };
    case "edit":
      // The clip and, beside it, optional references, where the model takes more than the one video being edited
      // (Seedance 2.5). Omni Flash's edit takes the clip alone, as in the Studio.
      return (i?.videos ?? 0) > 1
        ? { ...none, video: true, images: i?.firstFrameOnly ? 0 : pictures, audios: i?.audios ?? 0 }
        : { ...none, video: true };
    default:
      return none;
  }
}

/** The service's name for a page mode: both frame modes are its `first_n_last_frames`. */
export function mediaServiceMode(mode: MediaInputMode): MediaServiceMode {
  if (mode === "text") return "text_to_video";
  if (mode === "first" || mode === "frames") return "first_n_last_frames";
  if (mode === "references") return "multi_reference";
  return mode;
}

/** The modes to fall back on, nearest first, when the chosen one isn't there any more. */
const NEAREST: Record<MediaInputMode, MediaInputMode[]> = {
  text: [],
  first: ["frames", "references"],
  frames: ["first", "references"],
  references: ["first", "edit", "video_reference"],
  video_reference: ["references", "edit", "extend"],
  edit: ["extend", "video_reference", "references"],
  extend: ["edit", "video_reference", "references"],
};

/**
 * The mode after the model or the quality changed: the same one when it's still there, else the nearest that keeps
 * the files (a first frame stays a frame, a clip stays a clip), else the prompt alone.
 */
export function pickMediaMode(
  model: MediaModel | undefined,
  quality: string | undefined,
  current: MediaInputMode,
): MediaInputMode {
  const modes = mediaModes(model, quality);
  if (modes.includes(current)) return current;
  return NEAREST[current].find((m) => modes.includes(m)) ?? (modes.includes("text") ? "text" : (modes[0] ?? "text"));
}

/**
 * The files that fit a mode. Frames that stay frames and the clip that stays the clip keep their places, the rest
 * moves by kind, in order, to what the mode has (references to frames and back, a reference video to the clip and
 * back), and whatever finds no room goes, so a file the new choice refuses never rides along unseen.
 */
export function fitMediaFiles(files: MediaFileSet, spec: MediaModeSpec): MediaFileSet {
  const keepFirst = spec.firstFrame ? files.firstFrame : undefined;
  const keepLast = spec.lastFrame ? files.lastFrame : undefined;
  const keepVideo = spec.video ? files.video : undefined;
  const loose = (f: MediaRefFile | undefined, kept: MediaRefFile | undefined) => (f && !kept ? [f] : []);
  const pictures = [...loose(files.firstFrame, keepFirst), ...loose(files.lastFrame, keepLast), ...files.images];
  const clips = [...loose(files.video, keepVideo), ...files.videos];
  const firstFrame = keepFirst ?? (spec.firstFrame ? pictures.shift() : undefined);
  const lastFrame = keepLast ?? (spec.lastFrame ? pictures.shift() : undefined);
  const video = keepVideo ?? (spec.video ? clips.shift() : undefined);
  return {
    ...(firstFrame ? { firstFrame } : {}),
    ...(lastFrame ? { lastFrame } : {}),
    ...(video ? { video } : {}),
    images: pictures.slice(0, spec.images),
    videos: clips.slice(0, spec.videos),
    audios: files.audios.slice(0, spec.audios),
  };
}

/** Every file of a set, for freeing their previews. */
export function mediaFilesOf(files: MediaFileSet): MediaRefFile[] {
  return [files.firstFrame, files.lastFrame, files.video, ...files.images, ...files.videos, ...files.audios].filter(
    (f): f is MediaRefFile => f !== undefined,
  );
}

/** What a mode still needs before it can go, the Studio's checks. */
export type MediaMissing = "firstFrame" | "lastFrame" | "reference" | "videoReference" | "editVideo" | "extendVideo";

/** The first thing the mode still needs; null when nothing is missing. */
export function mediaMissing(spec: MediaModeSpec, files: MediaFileSet): MediaMissing | null {
  if (spec.firstFrame && !files.firstFrame) return "firstFrame";
  if (spec.lastFrame && !files.lastFrame) return "lastFrame";
  if (spec.video && !files.video)
    return spec.mode === "edit" ? "editVideo" : spec.mode === "extend" ? "extendVideo" : "videoReference";
  // A video model's references are the request itself (its spec takes clips or sounds too); an image model's are
  // optional.
  if (spec.mode === "references" && spec.videos + spec.audios > 0 && !mediaFilesOf(files).length) return "reference";
  return null;
}

/** The request's files: the clip a mode works on goes first among the reference videos. */
export function mediaRequestFiles(files: MediaFileSet) {
  const videos = [...(files.video ? [files.video] : []), ...files.videos];
  return {
    ...(files.images.length ? { refs: files.images.map((f) => f.token) } : {}),
    ...(files.firstFrame ? { firstFrame: files.firstFrame.token } : {}),
    ...(files.lastFrame ? { lastFrame: files.lastFrame.token } : {}),
    ...(videos.length ? { videoRefs: videos.map((f) => f.token) } : {}),
    ...(files.audios.length ? { audioRefs: files.audios.map((f) => f.token) } : {}),
  };
}

/** Where a file goes in the request. */
export type MediaFileTarget = "firstFrame" | "lastFrame" | "video" | "images" | "videos" | "audios";

/** The kind of file each place takes: frames are pictures, the clip a video. */
export const MEDIA_TARGET_KIND: Record<MediaFileTarget, MediaRefKind> = {
  firstFrame: "image",
  lastFrame: "image",
  video: "video",
  images: "image",
  videos: "video",
  audios: "audio",
};

/** Where a file dropped on the whole block (or pasted) goes by its kind, in the mode as it is; null with no room. */
export function mediaDropTarget(spec: MediaModeSpec, files: MediaFileSet, kind: MediaRefKind): MediaFileTarget | null {
  if (kind === "image") {
    if (spec.firstFrame && !files.firstFrame) return "firstFrame";
    if (spec.lastFrame && !files.lastFrame) return "lastFrame";
    return files.images.length < spec.images ? "images" : null;
  }
  if (kind === "video") {
    if (spec.video && !files.video) return "video";
    return files.videos.length < spec.videos ? "videos" : null;
  }
  return files.audios.length < spec.audios ? "audios" : null;
}

/**
 * The mode a dropped file asks for when the current one takes nothing of its kind (a picture dropped on "Vídeo por
 * prompt" opens "Primeiro quadro"); null when no mode of the model takes it.
 */
export function mediaModeFor(
  model: MediaModel | undefined,
  quality: string | undefined,
  kind: MediaRefKind,
): MediaInputMode | null {
  const modes = mediaModes(model, quality);
  const wants: MediaInputMode[] =
    kind === "image"
      ? ["first", "references"]
      : kind === "video"
        ? ["references", "video_reference", "edit"]
        : ["references"];
  const takes = (spec: MediaModeSpec) =>
    kind === "image"
      ? spec.firstFrame || spec.images > 0
      : kind === "video"
        ? spec.video || spec.videos > 0
        : spec.audios > 0;
  return wants.find((m) => modes.includes(m) && takes(mediaModeSpec(model, quality, m))) ?? null;
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
