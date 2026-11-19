import { MEDIA_MODES, ZimMediaError } from "@agenteschat/adapters";
import {
  can,
  driveMediaRef,
  listMediaGenerations,
  MEDIA_REF_LIMITS,
  type MediaDeps,
  mediaCatalog,
  mediaRefType,
  mediaRowView,
  quoteCredits,
  refreshPersonGeneration,
  requirePermission,
  startGeneration,
  uploadMediaRef,
  ValidationError,
} from "@agenteschat/engine";
import { createRoute, z } from "@hono/zod-openapi";
import type { Context } from "hono";
import { apiError, errorResponse } from "../../http/errors";
import { type AppDeps, body, createAppRouter, errors, json, OrgParams, requireSession, security } from "./context";

/**
 * The Mídia page (ADR doug-0011): the workspace's credit wallet, its top-ups through Mercado Pago and the images and
 * videos people generate. Everything goes through the Zim Mídia service; no address of it reaches a browser.
 */
const tags = ["Media"];

/** A reference file's largest size, a video's: what the service takes (each kind's own in `MEDIA_REF_LIMITS`). */
export const MEDIA_REF_BYTES = MEDIA_REF_LIMITS.video;
/** Generations one person may start: a batch fits, a loop doesn't. */
export const MEDIA_STARTS_PER_PERSON = { limit: 30, windowMs: 60_000 };

const off = errorResponse("This server has no media generation");
const TOO_LARGE = {
  image: "A imagem passa de 12 MB.",
  video: "O vídeo passa de 50 MB.",
  audio: "O áudio passa de 15 MB.",
} as const;
const WRONG_TYPE =
  "Envie uma imagem (JPEG, PNG, WebP), um vídeo (MP4, MOV, WebM) ou um áudio (MP3, WAV, M4A, AAC, OGG).";
const unavailable = errorResponse("The media service didn't answer");
const noCredits = errorResponse("Not enough credits (`media.no_credits`)");

const Price = z.union([
  z.number(),
  z.object({ perSecond: z.boolean(), credits: z.number(), silentCredits: z.number() }),
]);
const Model = z.object({
  id: z.string(),
  kind: z.enum(["image", "video"]),
  label: z.string(),
  description: z.string(),
  qualities: z.array(z.string()),
  defaultQuality: z.string(),
  aspects: z.array(z.string()),
  maxRefs: z.number().int().optional(),
  durations: z
    .object({ min: z.number(), max: z.number(), fixed: z.array(z.number()).optional(), default: z.number() })
    .optional(),
  audio: z.enum(["optional", "always", "none"]).optional(),
  firstFrame: z.boolean().optional(),
  aspectsByQuality: z.record(z.string(), z.array(z.string())).optional(),
  inputs: z
    .object({
      images: z.number().int(),
      videos: z.number().int(),
      audios: z.number().int(),
      firstFrame: z.boolean(),
      lastFrame: z.boolean(),
      imagesByQuality: z.record(z.string(), z.number().int()).optional(),
      framesOrRefs: z.boolean().optional(),
      firstFrameOnly: z.boolean().optional(),
    })
    .optional(),
  modesByQuality: z.record(z.string(), z.array(z.string())).optional(),
  prices: z.record(z.string(), Price),
});
const RefToken = z.string().regex(/^ref_[a-f0-9]{48}$/);
/** What a generation asks for, the same for its price (`…/media/quote`) and the generation itself. */
const MediaAsk = z.object({
  model: z.string().min(1).max(64),
  prompt: z.string().trim().min(1).max(4000),
  quality: z.string().max(16).optional(),
  aspect: z.string().max(8).optional(),
  seconds: z.number().int().min(1).max(30).optional(),
  audio: z.boolean().optional(),
  refs: z.array(RefToken).max(14).optional(),
  firstFrame: RefToken.optional(),
  lastFrame: RefToken.optional(),
  videoRefs: z.array(RefToken).max(10).optional(),
  audioRefs: z.array(RefToken).max(10).optional(),
  /** The page's mode: an edit or an extension of the one reference video; left out, the service works it out. */
  mode: z.enum(MEDIA_MODES).optional(),
});
const Pack = z.object({ id: z.string(), brl: z.number(), credits: z.number(), highlight: z.boolean().optional() });
const Generation = z.object({
  id: z.string(),
  kind: z.enum(["image", "video"]),
  model: z.string(),
  prompt: z.string(),
  options: z.object({ quality: z.string(), aspect: z.string(), seconds: z.number(), audio: z.boolean() }).partial(),
  credits: z.number().int(),
  status: z.enum(["running", "succeeded", "failed"]),
  error: z.string().nullable(),
  userId: z.string().nullable(),
  agentId: z.string().nullable(),
  artifactId: z.string().nullable(),
  createdAt: z.string(),
  finishedAt: z.string().nullable(),
});
const Topup = z.object({
  id: z.string(),
  pack: z.string(),
  amountBrl: z.number(),
  credits: z.number(),
  status: z.enum(["pending", "approved", "rejected"]),
  createdAt: z.string(),
  approvedAt: z.string().nullable(),
});
const LedgerRow = z.object({
  id: z.number(),
  kind: z.enum(["topup", "reserve", "release", "adjust", "call"]),
  credits: z.number(),
  balanceAfter: z.number(),
  generationId: z.string().nullable(),
  note: z.string().nullable(),
  createdAt: z.string(),
});
const GenerationParams = OrgParams.extend({ id: z.uuid().openapi({ param: { name: "id", in: "path" } }) });
const TopupParams = OrgParams.extend({
  id: z
    .string()
    .regex(/^tp_[a-f0-9]{16}$/)
    .openapi({ param: { name: "id", in: "path" } }),
});

export function mediaRoutes(deps: AppDeps) {
  const { db, adapters } = deps;
  const app = createAppRouter(deps);
  app.use("/organizations/*", requireSession(deps.auth));

  const mediaDeps = (): MediaDeps | null =>
    adapters.zimMedia && deps.extras?.artifacts
      ? { db, zimMedia: adapters.zimMedia, artifacts: deps.extras.artifacts }
      : null;
  const mediaOff = <C extends Context>(c: C) => apiError(c, 404, "media.off", "This server has no media generation");
  /** The service's own refusal as an answer: its words when it said no, 502 when it didn't answer. */
  const refused = <C extends Context>(c: C, error: unknown) => {
    if (!(error instanceof ZimMediaError)) throw error;
    if (error.status === 402) {
      return apiError(c, 402, "media.no_credits", error.message);
    }
    if (error.status >= 400 && error.status < 500 && error.status !== 401)
      return apiError(c, 400, "media.refused", error.message);
    deps.log?.warn("media service call failed", { status: error.status, error: error.message });
    return apiError(c, 502, "media.unavailable", "O serviço de mídia não está respondendo agora. Tente em instantes.");
  };

  app.openapi(
    createRoute({
      method: "get",
      path: "/organizations/{orgId}/media",
      tags,
      security,
      summary: "The models, their prices in credits, the top-up packs and the wallet's balance (members)",
      request: { params: OrgParams },
      responses: {
        200: json(
          z.object({
            balance: z.number().int(),
            models: z.array(Model),
            packs: z.array(Pack),
            canTopUp: z.boolean(),
          }),
        ),
        402: noCredits,
        502: unavailable,
        ...errors,
        404: off,
      },
    }),
    async (c) => {
      const { orgId } = c.req.valid("param");
      const membership = await requirePermission(db, c.get("user").id, orgId, "read");
      const media = mediaDeps();
      if (!media?.zimMedia) return mediaOff(c);
      try {
        const [catalog, wallet] = await Promise.all([mediaCatalog(media.zimMedia), media.zimMedia.balance(orgId)]);
        return c.json(
          {
            balance: wallet.balance,
            models: catalog.models,
            packs: catalog.packs,
            canTopUp: can(membership, "manage_billing") && catalog.packs.length > 0,
          },
          200,
        );
      } catch (error) {
        return refused(c, error);
      }
    },
  );

  app.openapi(
    createRoute({
      method: "get",
      path: "/organizations/{orgId}/media/wallet",
      tags,
      security,
      summary: "The wallet's history and its top-ups (who manages billing)",
      request: { params: OrgParams },
      responses: {
        200: json(z.object({ balance: z.number().int(), ledger: z.array(LedgerRow), topups: z.array(Topup) })),
        402: noCredits,
        502: unavailable,
        ...errors,
        404: off,
      },
    }),
    async (c) => {
      const { orgId } = c.req.valid("param");
      await requirePermission(db, c.get("user").id, orgId, "manage_billing");
      const zim = adapters.zimMedia;
      if (!zim) return mediaOff(c);
      try {
        const [wallet, topups] = await Promise.all([zim.balance(orgId, true), zim.topups(orgId)]);
        return c.json(
          {
            balance: wallet.balance,
            ledger: (wallet.ledger ?? []).map((l) => ({
              id: l.id,
              kind: l.kind,
              credits: l.credits,
              balanceAfter: l.balance_after,
              generationId: l.generation_id,
              note: l.note,
              createdAt: new Date(l.created_at).toISOString(),
            })),
            topups: topups.map((t) => ({
              ...t,
              createdAt: new Date(t.createdAt).toISOString(),
              approvedAt: t.approvedAt ? new Date(t.approvedAt).toISOString() : null,
            })),
          },
          200,
        );
      } catch (error) {
        return refused(c, error);
      }
    },
  );

  app.openapi(
    createRoute({
      method: "get",
      path: "/organizations/{orgId}/media/generations",
      tags,
      security,
      summary: "The workspace's latest generations, people's and agents' (members)",
      request: { params: OrgParams, query: z.object({ mine: z.enum(["1"]).optional() }) },
      responses: { 200: json(z.object({ generations: z.array(Generation) })), ...errors, 404: off },
    }),
    async (c) => {
      const { orgId } = c.req.valid("param");
      const userId = c.get("user").id;
      await requirePermission(db, userId, orgId, "read");
      if (!adapters.zimMedia) return mediaOff(c);
      const mine = c.req.valid("query").mine === "1";
      return c.json({ generations: await listMediaGenerations(db, orgId, mine ? { userId } : {}) }, 200);
    },
  );

  app.openapi(
    createRoute({
      method: "get",
      path: "/organizations/{orgId}/media/generations/{id}",
      tags,
      security,
      summary: "One generation, checked with the service while it runs (its file goes to the Drive when done)",
      request: { params: GenerationParams },
      responses: {
        200: json(z.object({ generation: Generation })),
        402: noCredits,
        502: unavailable,
        ...errors,
        404: off,
      },
    }),
    async (c) => {
      const { orgId, id } = c.req.valid("param");
      const userId = c.get("user").id;
      await requirePermission(db, userId, orgId, "read");
      const media = mediaDeps();
      if (!media) return mediaOff(c);
      try {
        return c.json({ generation: await refreshPersonGeneration(media, orgId, userId, id) }, 200);
      } catch (error) {
        return refused(c, error);
      }
    },
  );

  app.openapi(
    createRoute({
      method: "post",
      path: "/organizations/{orgId}/media/refs",
      tags,
      security,
      summary:
        "Send a reference file for a generation, kept for a day: a picture (JPEG, PNG, WebP, up to 12 MB), a video (MP4, MOV, WebM, up to 50 MB) or an audio (MP3, WAV, M4A, AAC, OGG, up to 15 MB)",
      request: {
        params: OrgParams,
        body: {
          content: {
            "multipart/form-data": {
              schema: z.object({ file: z.any().openapi({ type: "string", format: "binary" }) }),
            },
          },
        },
      },
      responses: {
        200: json(
          z.object({ ref: z.string(), kind: z.enum(["image", "video", "audio"]), seconds: z.number().optional() }),
        ),
        413: errorResponse("The file is too large for its kind (`media.ref_too_large`)"),
        402: noCredits,
        502: unavailable,
        ...errors,
        404: off,
      },
    }),
    async (c) => {
      const { orgId } = c.req.valid("param");
      await requirePermission(db, c.get("user").id, orgId, "read");
      const media = mediaDeps();
      if (!media) return mediaOff(c);
      const file: unknown = c.req.valid("form").file;
      if (!(file instanceof File)) throw new ValidationError("Send the file in the field file", "media.ref_file");
      if (file.size > MEDIA_REF_BYTES) return apiError(c, 413, "media.ref_too_large", TOO_LARGE.video);
      const bytes = new Uint8Array(await file.arrayBuffer());
      // The kind comes from the bytes: a renamed file or a wrong type from the browser doesn't get through.
      const type = mediaRefType(bytes, file.type);
      if (!type) return apiError(c, 400, "media.ref_type", WRONG_TYPE);
      if (bytes.byteLength > MEDIA_REF_LIMITS[type.kind])
        return apiError(c, 413, "media.ref_too_large", TOO_LARGE[type.kind]);
      try {
        const ref = await uploadMediaRef(media, orgId, bytes, file.type);
        return c.json(
          { ref: ref.ref, kind: ref.kind, ...(ref.seconds !== undefined ? { seconds: ref.seconds } : {}) },
          200,
        );
      } catch (error) {
        return refused(c, error);
      }
    },
  );

  app.openapi(
    createRoute({
      method: "post",
      path: "/organizations/{orgId}/media/refs/drive",
      tags,
      security,
      summary:
        "Send a Drive file the person may read (a generation of the workspace) as a reference for a generation, without downloading it first",
      request: { params: OrgParams, body: body(z.object({ artifactId: z.string().min(1).max(64) })) },
      responses: {
        200: json(
          z.object({
            ref: z.string(),
            kind: z.enum(["image", "video", "audio"]),
            seconds: z.number().optional(),
            name: z.string(),
          }),
        ),
        402: noCredits,
        502: unavailable,
        ...errors,
        404: off,
      },
    }),
    async (c) => {
      const { orgId } = c.req.valid("param");
      const userId = c.get("user").id;
      await requirePermission(db, userId, orgId, "read");
      const media = mediaDeps();
      if (!media) return mediaOff(c);
      try {
        // The Drive reads it as this person: a file they can't open answers as the Drive answers it.
        const ref = await driveMediaRef(media, orgId, userId, c.req.valid("json").artifactId);
        return c.json(
          {
            ref: ref.ref,
            kind: ref.kind,
            name: ref.name,
            ...(ref.seconds !== undefined ? { seconds: ref.seconds } : {}),
          },
          200,
        );
      } catch (error) {
        return refused(c, error);
      }
    },
  );

  app.openapi(
    createRoute({
      method: "post",
      path: "/organizations/{orgId}/media/quote",
      tags,
      security,
      summary: "A generation's price before it runs, the service's own when a reference video is in it (members)",
      request: { params: OrgParams, body: body(MediaAsk.extend({ prompt: z.string().max(4000).optional() })) },
      responses: {
        200: json(z.object({ credits: z.number().int().nullable() })),
        402: noCredits,
        502: unavailable,
        ...errors,
        404: off,
      },
    }),
    async (c) => {
      const { orgId } = c.req.valid("param");
      await requirePermission(db, c.get("user").id, orgId, "read");
      const zim = adapters.zimMedia;
      if (!zim) return mediaOff(c);
      const ask = c.req.valid("json");
      try {
        const { models } = await mediaCatalog(zim);
        // The price doesn't depend on the words: a form without them yet still shows it.
        return c.json({ credits: await quoteCredits(zim, models, { ...ask, prompt: ask.prompt || "-" }) }, 200);
      } catch (error) {
        return refused(c, error);
      }
    },
  );

  app.openapi(
    createRoute({
      method: "post",
      path: "/organizations/{orgId}/media/generations",
      tags,
      security,
      summary: "Generate an image or a video, paid from the workspace's wallet (members)",
      request: {
        params: OrgParams,
        body: body(
          MediaAsk.extend({
            /** The page's id for this click: a retried request doesn't pay twice. */
            clientId: z.string().min(8).max(64),
          }),
        ),
      },
      responses: {
        200: json(z.object({ generation: Generation, balance: z.number().int() })),
        429: errorResponse("Too many generations at once"),
        402: noCredits,
        502: unavailable,
        ...errors,
        404: off,
      },
    }),
    async (c) => {
      const { orgId } = c.req.valid("param");
      const user = c.get("user");
      await requirePermission(db, user.id, orgId, "read");
      const media = mediaDeps();
      if (!media) return mediaOff(c);
      const limit = await adapters.rateLimiter.consume(`media-start:${user.id}`, MEDIA_STARTS_PER_PERSON);
      if (!limit.allowed) return apiError(c, 429, "rate_limited", "Muitas gerações de uma vez. Espere um minuto.");
      const { clientId, refs, firstFrame, lastFrame, videoRefs, audioRefs, ...request } = c.req.valid("json");
      try {
        const started = await startGeneration(
          media,
          orgId,
          { type: "person", userId: user.id, name: user.name },
          {
            idempotencyKey: `person:${user.id}:${clientId}`,
            request,
            tokens: { refs, firstFrame, lastFrame, videoRefs, audioRefs },
          },
        );
        deps.wakeWorkers?.();
        return c.json({ generation: mediaRowView(started.row), balance: started.balance }, 200);
      } catch (error) {
        return refused(c, error);
      }
    },
  );

  app.openapi(
    createRoute({
      method: "post",
      path: "/organizations/{orgId}/media/topups",
      tags,
      security,
      summary: "Start a credit top-up: the address of Mercado Pago's checkout (who manages billing)",
      request: { params: OrgParams, body: body(z.object({ pack: z.string().max(40) })) },
      responses: {
        200: json(z.object({ topup: Topup, checkoutUrl: z.string() })),
        402: noCredits,
        502: unavailable,
        ...errors,
        404: off,
      },
    }),
    async (c) => {
      const { orgId } = c.req.valid("param");
      const user = c.get("user");
      await requirePermission(db, user.id, orgId, "manage_billing");
      const zim = adapters.zimMedia;
      if (!zim) return mediaOff(c);
      try {
        const { topup, checkoutUrl } = await zim.topup(orgId, {
          pack: c.req.valid("json").pack,
          returnUrl: `${deps.config.PUBLIC_URL.replace(/\/$/, "")}/org/${orgId}/media`,
          payer: { email: user.email, name: user.name },
          requestedBy: { type: "user", id: user.id, name: user.name },
        });
        return c.json(
          { topup: { ...topup, createdAt: new Date(topup.createdAt).toISOString(), approvedAt: null }, checkoutUrl },
          200,
        );
      } catch (error) {
        return refused(c, error);
      }
    },
  );

  app.openapi(
    createRoute({
      method: "get",
      path: "/organizations/{orgId}/media/topups/{id}",
      tags,
      security,
      summary: "A top-up's state, checked with Mercado Pago while it's pending (members)",
      request: { params: TopupParams },
      responses: {
        200: json(z.object({ topup: Topup, balance: z.number().int() })),
        402: noCredits,
        502: unavailable,
        ...errors,
        404: off,
      },
    }),
    async (c) => {
      const { orgId, id } = c.req.valid("param");
      await requirePermission(db, c.get("user").id, orgId, "read");
      const zim = adapters.zimMedia;
      if (!zim) return mediaOff(c);
      try {
        const { topup, balance } = await zim.topupStatus(orgId, id);
        return c.json(
          {
            topup: {
              ...topup,
              createdAt: new Date(topup.createdAt).toISOString(),
              approvedAt: topup.approvedAt ? new Date(topup.approvedAt).toISOString() : null,
            },
            balance,
          },
          200,
        );
      } catch (error) {
        return refused(c, error);
      }
    },
  );

  return app;
}
