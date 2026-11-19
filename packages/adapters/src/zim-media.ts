import { createHash, createHmac } from "node:crypto";

/**
 * The Zim Mídia service (ADR doug-0011): image and video generation through the Zim's provider accounts, paid from
 * a credit wallet per workspace. The provider keys and the wallet live in that service; this server only signs its
 * calls (`ZIM_MEDIA_URL`, `ZIM_MEDIA_SECRET`) and never hands an address of the service to a browser.
 */

/** What a video model takes besides the prompt, as the Zim Studio offers it. */
export interface MediaInputs {
  /** Reference images (multi-reference). */
  images: number;
  /** Reference videos. */
  videos: number;
  /** Reference audios. */
  audios: number;
  firstFrame: boolean;
  /** A last frame, only with a first one. */
  lastFrame: boolean;
  /** A quality that takes another number of reference images than `images`. */
  imagesByQuality?: Record<string, number>;
  /** References or frames, never both in one request. */
  framesOrRefs?: boolean;
  /** The only picture it takes is the first frame. */
  firstFrameOnly?: boolean;
}

/**
 * The Studio's names for what a quality does: `text_to_video`, `multi_reference`, `first_n_last_frames`,
 * `video_reference`, `edit`, `extend`.
 */
export type MediaMode = string;

/** The modes a request may name (`MediaRequest.mode`); without one the service works it out from the files. */
export const MEDIA_MODES = [
  "text_to_video",
  "multi_reference",
  "first_n_last_frames",
  "video_reference",
  "edit",
  "extend",
] as const;
export type MediaRequestMode = (typeof MEDIA_MODES)[number];

export interface MediaModel {
  id: string;
  kind: "image" | "video";
  label: string;
  description: string;
  qualities: string[];
  defaultQuality: string;
  aspects: string[];
  /** Only where the aspects change with the quality. */
  aspectsByQuality?: Record<string, string[]>;
  /** Images: how many reference pictures (0 takes none). */
  maxRefs?: number;
  /** Videos. */
  durations?: { min: number; max: number; fixed?: number[]; default: number };
  audio?: "optional" | "always" | "none";
  /** The older form of `inputs.firstFrame`. */
  firstFrame?: boolean;
  inputs?: MediaInputs;
  modesByQuality?: Record<string, MediaMode[]>;
  prices: Record<string, number | { perSecond: boolean; credits: number; silentCredits: number }>;
}

export interface MediaPack {
  id: string;
  brl: number;
  credits: number;
  highlight?: boolean;
}

export interface MediaRequest {
  model: string;
  prompt: string;
  quality?: string;
  aspect?: string;
  seconds?: number;
  audio?: boolean;
  /** Tokens from `uploadRef`: reference images. */
  refs?: string[];
  /** An image token. */
  firstFrame?: string;
  /** An image token, only with `firstFrame`. */
  lastFrame?: string;
  /** Video tokens. */
  videoRefs?: string[];
  /** Audio tokens. */
  audioRefs?: string[];
  /**
   * What to do with the files, the Studio's mode: an `edit` or `extend` changes or continues the one video in
   * `videoRefs`, where the same files alone would read as references. Left out, the service works it out.
   */
  mode?: MediaRequestMode;
}

export type MediaRefKind = "image" | "video" | "audio";

/** A file the service keeps for a day to hand its provider; `seconds` for a video or an audio, measured there. */
export interface MediaRef {
  ref: string;
  kind: MediaRefKind;
  seconds?: number;
}

export interface MediaQuote {
  model: string;
  kind: "image" | "video";
  quality: string;
  aspect: string;
  seconds: number;
  audio: boolean;
  credits: number;
}

export interface MediaActor {
  type: "user" | "agent";
  id: string;
  name?: string;
}

export interface MediaGeneration {
  id: string;
  kind: "image" | "video";
  model: string;
  options: { quality: string; aspect: string; seconds: number; audio: boolean };
  prompt: string;
  credits: number;
  actor: MediaActor;
  status: "running" | "succeeded" | "failed";
  outputType: string | null;
  error: { code: string | null; message: string | null } | null;
  createdAt: string;
  finishedAt: string | null;
}

export interface MediaLedgerRow {
  id: number;
  kind: "topup" | "reserve" | "release" | "adjust" | "call";
  credits: number;
  balance_after: number;
  generation_id: string | null;
  topup_id: string | null;
  note: string | null;
  created_at: string;
}

export interface MediaTopup {
  id: string;
  pack: string;
  amountBrl: number;
  credits: number;
  status: "pending" | "approved" | "rejected";
  createdAt: string;
  approvedAt: string | null;
}

export interface ZimMedia {
  /**
   * `calls`: each house voice's price in credits per minute: `qwen` for phone calls (docs/adr/doug-0035-phone-calls.md),
   * `qwen-live` for calls inside the apps (docs/adr/doug-0036-house-voice.md).
   */
  catalog(): Promise<{
    models: MediaModel[];
    packs: MediaPack[];
    calls?: Record<string, { creditsPerMinute: number }>;
  }>;
  quote(request: MediaRequest): Promise<MediaQuote>;
  balance(orgId: string, withLedger?: boolean): Promise<{ balance: number; ledger?: MediaLedgerRow[] }>;
  uploadRef(orgId: string, bytes: Uint8Array, contentType: string): Promise<MediaRef>;
  generate(
    orgId: string,
    input: { idempotencyKey: string; actor: MediaActor; request: MediaRequest },
  ): Promise<{ generation: MediaGeneration; balance: number }>;
  generation(orgId: string, id: string): Promise<MediaGeneration>;
  generations(orgId: string, options?: { limit?: number; actorId?: string }): Promise<MediaGeneration[]>;
  /** The finished file's bytes, streamed through this server. */
  file(orgId: string, id: string): Promise<{ bytes: Uint8Array; contentType: string }>;
  topup(
    orgId: string,
    input: { pack: string; returnUrl: string; payer?: { email?: string; name?: string }; requestedBy: MediaActor },
  ): Promise<{ topup: MediaTopup; checkoutUrl: string }>;
  topupStatus(orgId: string, id: string): Promise<{ topup: MediaTopup; balance: number }>;
  topups(orgId: string): Promise<MediaTopup[]>;
  /**
   * A call on a house voice that ended, charged by the second from the same wallet: a phone call (`qwen`,
   * docs/adr/doug-0035-phone-calls.md) or one inside the apps (`qwen-live`, docs/adr/doug-0036-house-voice.md). The same
   * key charges once; the balance never goes below zero (`unpaid` is what was left).
   */
  chargeCall(
    orgId: string,
    input: { idempotencyKey: string; engine: "qwen" | "qwen-live"; seconds: number },
  ): Promise<{ credits: number; unpaid: number; balance: number; repeated: boolean }>;
}

/** What the service said no with: `status` is its HTTP status (402 is "not enough credits", with `needed`/`balance`). */
export class ZimMediaError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly code?: string,
    readonly needed?: number,
    readonly balance?: number,
  ) {
    super(message);
    this.name = "ZimMediaError";
  }
}

const CLIENT = "dougbot";

/** The service's request signature (its `src/auth.ts`): HMAC-SHA256 over time, method, path and the body's hash. */
export function zimMediaAuthorization(
  secret: string,
  method: string,
  path: string,
  body: Uint8Array | string,
  now = Date.now(),
): string {
  const ts = Math.floor(now / 1000);
  const digest = createHash("sha256").update(body).digest("hex");
  const sig = createHmac("sha256", secret).update(`${ts}\n${method.toUpperCase()}\n${path}\n${digest}`).digest("hex");
  return `ZimMidia client=${CLIENT},ts=${ts},sig=${sig}`;
}

export function createZimMedia(options: { url: string; secret: string; fetch?: typeof fetch }): ZimMedia {
  const base = new URL(options.url.replace(/\/$/, ""));
  const doFetch = options.fetch ?? fetch;

  async function raw(
    method: string,
    path: string,
    body?: Uint8Array | string,
    contentType?: string,
    timeoutMs = 30_000,
  ) {
    const full = `${base.pathname.replace(/\/$/, "")}${path}`;
    const payload = body ?? "";
    let res: Response;
    try {
      res = await doFetch(new URL(full, base.origin), {
        method,
        headers: {
          authorization: zimMediaAuthorization(options.secret, method, full, payload),
          ...(body !== undefined ? { "content-type": contentType ?? "application/json" } : {}),
        },
        ...(body !== undefined ? { body: payload } : {}),
        signal: AbortSignal.timeout(timeoutMs),
      });
    } catch {
      throw new ZimMediaError("O serviço de mídia não respondeu.", 502);
    }
    if (!res.ok) {
      const json = (await res.json().catch(() => ({}))) as {
        error?: string;
        code?: string;
        needed?: number;
        balance?: number;
      };
      throw new ZimMediaError(
        json.error ?? `O serviço de mídia recusou (HTTP ${res.status}).`,
        res.status,
        json.code,
        json.needed,
        json.balance,
      );
    }
    return res;
  }
  const json = async <T>(method: string, path: string, body?: unknown, timeoutMs?: number): Promise<T> =>
    (await (
      await raw(method, path, body === undefined ? undefined : JSON.stringify(body), undefined, timeoutMs)
    ).json()) as T;
  const org = (orgId: string) => `/v1/wallets/${encodeURIComponent(orgId)}`;

  return {
    catalog: () => json("GET", "/v1/catalog"),
    quote: (request) => json("POST", "/v1/quote", request),
    balance: (orgId, withLedger) => json("GET", `${org(orgId)}/balance${withLedger ? "?ledger=1" : ""}`),
    async uploadRef(orgId, bytes, contentType) {
      // A video of up to 50 MB goes through two networks before the service measures it.
      const timeout = contentType.startsWith("video/") ? 300_000 : contentType.startsWith("audio/") ? 120_000 : 60_000;
      const res = await raw("POST", `${org(orgId)}/refs`, bytes, contentType, timeout);
      const body = (await res.json()) as Partial<MediaRef>;
      if (typeof body.ref !== "string") throw new ZimMediaError("O serviço de mídia não devolveu a referência.", 502);
      const kind: MediaRefKind =
        body.kind === "video" || body.kind === "audio" || body.kind === "image"
          ? body.kind
          : contentType.startsWith("video/")
            ? "video"
            : contentType.startsWith("audio/")
              ? "audio"
              : "image";
      return { ref: body.ref, kind, ...(typeof body.seconds === "number" ? { seconds: body.seconds } : {}) };
    },
    // The image providers answer within the call (up to two tries of two minutes).
    generate: (orgId, input) => json("POST", `${org(orgId)}/generations`, input, 300_000),
    generation: async (orgId, id) =>
      (
        await json<{ generation: MediaGeneration }>(
          "GET",
          `${org(orgId)}/generations/${encodeURIComponent(id)}`,
          undefined,
          60_000,
        )
      ).generation,
    generations: async (orgId, opts = {}) => {
      const q = new URLSearchParams({
        limit: String(opts.limit ?? 50),
        ...(opts.actorId ? { actor: opts.actorId } : {}),
      });
      return (await json<{ generations: MediaGeneration[] }>("GET", `${org(orgId)}/generations?${q}`)).generations;
    },
    async file(orgId, id) {
      const res = await raw(
        "GET",
        `${org(orgId)}/generations/${encodeURIComponent(id)}/file`,
        undefined,
        undefined,
        180_000,
      );
      return {
        bytes: new Uint8Array(await res.arrayBuffer()),
        contentType: res.headers.get("content-type")?.split(";")[0] ?? "application/octet-stream",
      };
    },
    topup: (orgId, input) => json("POST", `${org(orgId)}/topups`, input),
    topupStatus: (orgId, id) => json("GET", `${org(orgId)}/topups/${encodeURIComponent(id)}`),
    topups: async (orgId) => (await json<{ topups: MediaTopup[] }>("GET", `${org(orgId)}/topups`)).topups,
    chargeCall: (orgId, input) => json("POST", `${org(orgId)}/calls`, input),
  };
}
