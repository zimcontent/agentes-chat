import {
  fitMediaFiles,
  type MediaFileSet,
  type MediaGenerateInput,
  type MediaGenerationView,
  type MediaGenKind,
  type MediaInputMode,
  type MediaModel,
  type MediaModeSpec,
  type MediaRefFile,
  type ModelBrand,
  mediaAspects,
  mediaDropTarget,
  mediaMissing,
  mediaModeSpec,
  mediaModes,
  mediaPrice,
  mediaRequestFiles,
  mediaServiceMode,
  pickMediaMode,
  useAuthConfig,
} from "@agenteschat/client";

/**
 * Mídia on the phone (docs/adr/doug-0011): the rules the screens read, kept apart from them so they are tested. The
 * models, modes and prices are the shared client's (`@agenteschat/client` media), the same reading as the web's page.
 */

/** Whether this server has Mídia on: the web shows it on the same flag. */
export function useMediaOn(): boolean {
  return useAuthConfig().data?.zimMedia === true;
}

/**
 * The modes the phone offers: the prompt alone and the ones that take pictures. A reference video or sound, and the
 * modes that work on a clip (follow, edit, extend), stay on the computer, where the file is at hand.
 */
export const PHONE_MODES: readonly MediaInputMode[] = ["text", "first", "frames", "references"];

/** The phone's modes of a model at a quality, in the Studio's order. */
export function phoneModes(model: MediaModel | undefined, quality: string | undefined): MediaInputMode[] {
  if (!model) return [];
  if (model.kind === "image") return mediaModes(model, quality);
  return mediaModes(model, quality).filter(
    // A video model's references mode on the phone holds pictures only: one that takes none isn't offered.
    (m) => PHONE_MODES.includes(m) && (m !== "references" || mediaModeSpec(model, quality, m).images > 0),
  );
}

/** The models the phone can ask: an image model always, a video model with at least one of the phone's modes. */
export function phoneModels(models: readonly MediaModel[], kind: MediaGenKind): MediaModel[] {
  return models.filter((m) => m.kind === kind && (kind === "image" || phoneModes(m, m.defaultQuality).length > 0));
}

/** Whether a model's computer-only modes were left out here (the form says where they are). */
export function hidesModes(model: MediaModel | undefined, quality: string | undefined): boolean {
  if (!model || model.kind === "image") return false;
  return mediaModes(model, quality).length > phoneModes(model, quality).length;
}

/** The lengths a video model offers, in seconds. */
export function durationsOf(model: MediaModel | undefined): number[] {
  const d = model?.durations;
  if (!d) return [];
  if (d.fixed?.length) return d.fixed;
  return Array.from({ length: Math.max(0, d.max - d.min + 1) }, (_, i) => d.min + i);
}

/** A file on its way up: where it lands and its local picture, shown there meanwhile. */
export interface PendingRef {
  id: string;
  target: "firstFrame" | "lastFrame" | "images";
  uri: string;
}

/** The files with the ones on their way counted in, for the room a new pick finds. */
export function withPending(files: MediaFileSet, pending: readonly PendingRef[]): MediaFileSet {
  const next: MediaFileSet = { ...files, images: [...files.images] };
  for (const p of pending) {
    const stand: MediaRefFile = { token: p.id, kind: "image", name: "", url: p.uri };
    if (p.target === "images") next.images.push(stand);
    else next[p.target] = stand;
  }
  return next;
}

/** Where each of `count` picked pictures goes, in order: the empty frames first, then the references; null: no room. */
export function imageTargets(spec: MediaModeSpec, files: MediaFileSet, count: number): PendingRef["target"][] {
  let room = files;
  const out: PendingRef["target"][] = [];
  for (let i = 0; i < count; i++) {
    const at = mediaDropTarget(spec, room, "image");
    if (at !== "firstFrame" && at !== "lastFrame" && at !== "images") break;
    out.push(at);
    room = withPending(room, [{ id: `stand-${i}`, target: at, uri: "" }]);
  }
  return out;
}

/** How many more pictures the mode takes, frames and references together. */
export function imageRoom(spec: MediaModeSpec, files: MediaFileSet): number {
  return (
    (spec.firstFrame && !files.firstFrame ? 1 : 0) +
    (spec.lastFrame && !files.lastFrame ? 1 : 0) +
    Math.max(0, spec.images - files.images.length)
  );
}

/** What the person chose on the form; anything left out (or no longer offered) falls back to the model's default. */
export interface MediaChoice {
  kind: MediaGenKind;
  modelId?: string | undefined;
  quality?: string | undefined;
  aspect?: string | undefined;
  seconds?: number | undefined;
  audio: boolean;
  mode: MediaInputMode;
  files: MediaFileSet;
  prompt: string;
  uploading: boolean;
}

/** What still stops the button, the web's words (`mediaGen.missing.*`). */
export type MediaWhy = "uploading" | "prompt" | NonNullable<ReturnType<typeof mediaMissing>>;

/** The form worked out: what it shows, what it sends and what it costs. */
export interface MediaForm {
  models: MediaModel[];
  model: MediaModel | undefined;
  quality: string | undefined;
  aspects: string[];
  aspect: string | undefined;
  durations: number[];
  seconds: number | undefined;
  /** Whether the person picks the sound (the model makes it optional). */
  audioChoice: boolean;
  withSound: boolean;
  modes: MediaInputMode[];
  mode: MediaInputMode;
  spec: MediaModeSpec;
  files: MediaFileSet;
  why: MediaWhy | null;
  /** The request without its words and its id. */
  ask: Omit<MediaGenerateInput, "prompt" | "clientId">;
  /** The price the form works out itself; null when only the server can (`useMediaQuote`). */
  price: number | null;
}

/** The form's state from the person's choices, with the web's rules (`MediaPage`'s `MediaForm`). */
export function mediaForm(models: readonly MediaModel[], c: MediaChoice): MediaForm {
  const ofKind = phoneModels(models, c.kind);
  const model = ofKind.find((m) => m.id === c.modelId) ?? ofKind[0];
  const quality = model && c.quality && model.qualities.includes(c.quality) ? c.quality : model?.defaultQuality;
  const aspects = mediaAspects(model, quality);
  // The Zim Studio's default: 16:9 for a video, square for an image, when the model offers it.
  const preferred = c.kind === "video" ? "16:9" : "1:1";
  const aspect =
    c.aspect && aspects.includes(c.aspect) ? c.aspect : aspects.includes(preferred) ? preferred : aspects[0];
  const durations = durationsOf(model);
  const seconds =
    c.seconds !== undefined && durations.includes(c.seconds) ? c.seconds : (model?.durations?.default ?? durations[0]);
  const audioChoice = c.kind === "video" && model?.audio === "optional";
  const withSound = model?.audio === "always" ? true : model?.audio === "none" ? false : c.audio;
  const modes = phoneModes(model, quality);
  const mode = pickPhoneMode(model, quality, c.mode);
  const spec = mediaModeSpec(model, quality, mode);
  const files = fitMediaFiles(c.files, spec);
  const missing = c.kind === "video" ? mediaMissing(spec, files) : null;
  const why: MediaWhy | null = c.uploading ? "uploading" : (missing ?? (c.prompt.trim() ? null : "prompt"));
  const ask: MediaForm["ask"] = {
    model: model?.id ?? "",
    ...(quality ? { quality } : {}),
    ...(aspect ? { aspect } : {}),
    ...(c.kind === "video" ? { ...(seconds !== undefined ? { seconds } : {}), audio: withSound } : {}),
    ...mediaRequestFiles(files),
    // The service works the mode out by itself for a model that lists none.
    ...(c.kind === "video" && model?.modesByQuality?.[quality ?? ""] ? { mode: mediaServiceMode(mode) } : {}),
  };
  const price = mediaPrice(model, {
    ...(quality ? { quality } : {}),
    ...(seconds !== undefined ? { seconds } : {}),
    audio: withSound,
  });
  return {
    models: ofKind,
    model,
    quality,
    aspects,
    aspect,
    durations,
    seconds,
    audioChoice,
    withSound,
    modes,
    mode,
    spec,
    files,
    why,
    ask,
    price,
  };
}

/** The mode after a change of model or quality, kept among the phone's: the web's nearest, else the first offered. */
export function pickPhoneMode(
  model: MediaModel | undefined,
  quality: string | undefined,
  current: MediaInputMode,
): MediaInputMode {
  if (model?.kind === "image") return "references";
  const modes = phoneModes(model, quality);
  const near = pickMediaMode(model, quality, current);
  // A clip mode (from the web, or a model change) lands on the references, the nearest that keeps files, as there.
  const wanted: MediaInputMode[] = [near, "references", "first", "text"];
  return wanted.find((m) => modes.includes(m)) ?? modes[0] ?? "text";
}

/** How a generation shows in the grid. */
export type TileLook = "image" | "video" | "running" | "failed";

export function tileLook(g: Pick<MediaGenerationView, "status" | "kind" | "artifactId">): TileLook {
  if (g.status === "failed") return "failed";
  if (g.status === "running" || !g.artifactId) return "running";
  return g.kind;
}

/**
 * The id `ProviderLogo` draws for a model's maker: the mark the app has for it (Gemini for Google's models, Alibaba's
 * for Qwen), else the brand's own name, which the logo shows as its initial on a tile.
 */
const BRAND_MARK: Partial<Record<ModelBrand, string>> = {
  meta: "meta",
  google: "gemini",
  minimax: "minimax",
  xai: "xai",
  openai: "openai",
  qwen: "alibaba",
};

export function brandLogoId(brand: ModelBrand | null, label: string): string {
  if (!brand) return label;
  return BRAND_MARK[brand] ?? brand;
}

/** The side of a grid's square tile: `columns` across `width`, with the screen's sides and the gaps between. */
export function tileSide(width: number, columns = 3, gap = 4, side = 16): number {
  return Math.max(0, Math.floor((width - side * 2 - gap * (columns - 1)) / columns));
}

/** "16:9" as a width over height; null for anything else ("auto", empty), and the box stays square. */
export function aspectRatioOf(aspect: string | undefined): number | null {
  const m = /^(\d+(?:\.\d+)?):(\d+(?:\.\d+)?)$/.exec(aspect?.trim() ?? "");
  if (!m) return null;
  const ratio = Number(m[1]) / Number(m[2]);
  return Number.isFinite(ratio) && ratio > 0 ? ratio : null;
}
