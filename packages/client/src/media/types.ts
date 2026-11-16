/** Media generation from the workspace's credit wallet (ADR doug-0011): what the Mídia page reads. */

export type MediaGenKind = "image" | "video";

export type MediaPrice = number | { perSecond: boolean; credits: number; silentCredits: number };

export interface MediaModel {
  id: string;
  kind: MediaGenKind;
  label: string;
  description: string;
  qualities: string[];
  defaultQuality: string;
  aspects: string[];
  maxRefs?: number;
  durations?: { min: number; max: number; fixed?: number[]; default: number };
  audio?: "optional" | "always" | "none";
  /** The older form of `inputs.firstFrame`. */
  firstFrame?: boolean;
  /** Only where the aspects change with the quality. */
  aspectsByQuality?: Record<string, string[]>;
  /** What a video model takes besides the prompt (read through `mediaInputs`). */
  inputs?: {
    images: number;
    videos: number;
    audios: number;
    firstFrame: boolean;
    lastFrame: boolean;
    imagesByQuality?: Record<string, number>;
    framesOrRefs?: boolean;
    firstFrameOnly?: boolean;
  };
  /** The Studio's modes per quality: text_to_video, multi_reference, first_n_last_frames, video_reference, edit, extend. */
  modesByQuality?: Record<string, string[]>;
  prices: Record<string, MediaPrice>;
}

export type MediaRefKind = "image" | "video" | "audio";

/** A file sent to the service for a generation (kept a day); `seconds` for a video or an audio. */
export interface MediaRef {
  ref: string;
  kind: MediaRefKind;
  seconds?: number;
}

export interface MediaPack {
  id: string;
  brl: number;
  credits: number;
  highlight?: boolean;
}

export interface MediaOverview {
  balance: number;
  models: MediaModel[];
  packs: MediaPack[];
  /** Who manages billing may top the wallet up. */
  canTopUp: boolean;
}

export interface MediaGenerationView {
  id: string;
  kind: MediaGenKind;
  model: string;
  prompt: string;
  options: { quality?: string; aspect?: string; seconds?: number; audio?: boolean };
  credits: number;
  status: "running" | "succeeded" | "failed";
  error: string | null;
  userId: string | null;
  agentId: string | null;
  /** The Drive file it became. */
  artifactId: string | null;
  createdAt: string;
  finishedAt: string | null;
}

export interface MediaGenerateInput {
  model: string;
  prompt: string;
  quality?: string;
  aspect?: string;
  seconds?: number;
  audio?: boolean;
  /** Tokens from `uploadRef`: reference images. */
  refs?: string[];
  firstFrame?: string;
  /** Only with `firstFrame`. */
  lastFrame?: string;
  videoRefs?: string[];
  audioRefs?: string[];
  /** This click's id: a retried request doesn't pay twice. */
  clientId: string;
}

/** What a price asks: a generation without its id, the words optional. */
export type MediaQuoteInput = Omit<MediaGenerateInput, "clientId" | "prompt"> & { prompt?: string };

export interface MediaTopup {
  id: string;
  pack: string;
  amountBrl: number;
  credits: number;
  status: "pending" | "approved" | "rejected";
  createdAt: string;
  approvedAt: string | null;
}

export interface MediaApi {
  overview(orgId: string): Promise<MediaOverview>;
  generations(orgId: string, mine: boolean): Promise<MediaGenerationView[]>;
  generation(orgId: string, id: string): Promise<MediaGenerationView>;
  uploadRef(orgId: string, file: File | Blob): Promise<MediaRef>;
  /** The price from the server, the service's quote when a reference video is in it. */
  quote(orgId: string, input: MediaQuoteInput): Promise<number | null>;
  generate(orgId: string, input: MediaGenerateInput): Promise<{ generation: MediaGenerationView; balance: number }>;
  topup(orgId: string, pack: string): Promise<{ topup: MediaTopup; checkoutUrl: string }>;
  topupStatus(orgId: string, id: string): Promise<{ topup: MediaTopup; balance: number }>;
}

/** The price of a request, the service's arithmetic (half to even, at least 10); null when it doesn't fit the model. */
export function mediaPrice(
  model: MediaModel | undefined,
  input: { quality?: string; seconds?: number; audio?: boolean; videoRefs?: string[] },
): number | null {
  // A reference video's own seconds can count: only the service's quote knows (`useMediaQuote`).
  if (!model || input.videoRefs?.length) return null;
  const price = model.prices[input.quality ?? model.defaultQuality];
  if (price === undefined) return null;
  if (typeof price === "number") return price;
  const silent = model.audio === "none" || (model.audio === "optional" && input.audio === false);
  const perUnit = silent ? price.silentCredits : price.credits;
  const d = model.durations;
  const asked = Math.round(input.seconds ?? d?.default ?? 5);
  const seconds = d?.fixed?.length ? (d.fixed.find((s) => s >= asked) ?? Math.max(...d.fixed)) : asked;
  const value = price.perSecond ? perUnit * seconds : perUnit;
  const floor = Math.floor(value);
  const half = Math.abs(value - floor - 0.5) < 1e-8;
  return Math.max(10, half ? (floor % 2 === 0 ? floor : floor + 1) : Math.round(value));
}
