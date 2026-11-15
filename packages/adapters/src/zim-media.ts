import { createHash, createHmac } from "node:crypto";

/**
 * The Zim Mídia service (ADR doug-0011): image and video generation through the Zim's provider accounts, paid from
 * a credit wallet per workspace. The provider keys and the wallet live in that service; this server only signs its
 * calls (`ZIM_MEDIA_URL`, `ZIM_MEDIA_SECRET`) and never hands an address of the service to a browser.
 */

export interface MediaModel {
  id: string;
  kind: "image" | "video";
  label: string;
  description: string;
  qualities: string[];
  defaultQuality: string;
  aspects: string[];
  /** Images: credits per image by quality. */
  maxRefs?: number;
  /** Videos. */
  durations?: { min: number; max: number; fixed?: number[]; default: number };
  audio?: "optional" | "always" | "none";
  firstFrame?: boolean;
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
  /** Tokens from `uploadRef`. */
  refs?: string[];
  firstFrame?: string;
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
  kind: "topup" | "reserve" | "release" | "adjust";
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
  catalog(): Promise<{ models: MediaModel[]; packs: MediaPack[] }>;
  quote(request: MediaRequest): Promise<MediaQuote>;
  balance(orgId: string, withLedger?: boolean): Promise<{ balance: number; ledger?: MediaLedgerRow[] }>;
  uploadRef(orgId: string, bytes: Uint8Array, contentType: string): Promise<string>;
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
      const res = await raw("POST", `${org(orgId)}/refs`, bytes, contentType, 60_000);
      return ((await res.json()) as { ref: string }).ref;
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
  };
}
