import {
  MEDIA_MODES,
  type MediaActor,
  type MediaGeneration,
  type MediaModel,
  type MediaPack,
  type MediaRef,
  type MediaRefKind,
  type MediaRequest,
  type MediaRequestMode,
  type ZimMedia,
  ZimMediaError,
} from "@dougbot/adapters";
import { and, type Database, eq, gte, isNull, lt, ne, or, schema, sql } from "@dougbot/db";
import { getAgentCached } from "./agents";
import { type ArtifactActor, type ArtifactDeps, createFileArtifact, storedFileOfArtifact } from "./artifacts";
import { ConflictError, NotFoundError, ValidationError } from "./errors";
import { publishMessageCreated } from "./events";
import { insertMessage, messageView } from "./messages";
import { enqueue, type JobHandler, PermanentJobError } from "./outbox";
import { replyThreadOf } from "./runs";
import type { ToolContext, ToolDefinition, ToolOutput, ToolSource } from "./tools/types";
import { monthStartUtc } from "./usage";

/**
 * Images and videos generated from the workspace's credit wallet (ADR doug-0011).
 *
 * The Zim Mídia service holds the provider keys, the price list and the wallet; this file keeps who asked, saves the
 * finished file in the Drive and gives agents `generate_image` and `generate_video`. A generation is created once
 * per tool call (`run:<run>:<tool call>` is the service's idempotency key), so a retried call never pays twice. An
 * agent spends at most its `media_monthly_credits` a month, and a generation priced above its `media_ask_above`
 * becomes an approval request in the chat before anything is spent.
 */

const { mediaGenerations, agentRuns } = schema;

export const GENERATE_IMAGE_TOOL = "generate_image";
export const GENERATE_VIDEO_TOOL = "generate_video";
export const MEDIA_POLL_JOB = "media.poll";

/** How long `generate_image` waits for the picture inside the call before it hands the rest to `media.poll`. */
const IMAGE_WAIT_MS = 150_000;
const POLL_EVERY_MS = 4_000;
/** The job's rhythm while the service says a generation is running, and when it stops asking. */
const JOB_EVERY_MS = 10_000;
const JOB_GIVE_UP_MS = 60 * 60_000;

export interface MediaDeps {
  db: Database;
  zimMedia: ZimMedia | null;
  artifacts: ArtifactDeps;
}

export type MediaRow = typeof mediaGenerations.$inferSelect;

// ---------- the catalog, cached ----------

let catalogCache: { at: number; value: { models: MediaModel[]; packs: MediaPack[] } } | null = null;
const CATALOG_TTL_MS = 10 * 60_000;

export async function mediaCatalog(zim: ZimMedia): Promise<{ models: MediaModel[]; packs: MediaPack[] }> {
  if (catalogCache && Date.now() - catalogCache.at < CATALOG_TTL_MS) return catalogCache.value;
  const value = await zim.catalog();
  catalogCache = { at: Date.now(), value };
  return value;
}

/** Tests start from an empty cache. */
export function forgetMediaCatalog() {
  catalogCache = null;
}

/**
 * The price of a request from the cached catalog, the same arithmetic as the service (`debit`: half to even, at
 * least 10). Null when the request doesn't fit the model (the service refuses it anyway, before any charge) and when
 * it carries a reference video, whose own seconds can count too: only the service's quote knows (`quoteCredits`).
 */
export function estimateCredits(models: MediaModel[], request: Partial<MediaRequest>): number | null {
  const model = models.find((m) => m.id === request.model);
  if (!model || request.videoRefs?.length) return null;
  const quality = request.quality ?? model.defaultQuality;
  const price = model.prices[quality];
  if (price === undefined) return null;
  if (typeof price === "number") return price;
  const silent = model.audio === "none" || (model.audio === "optional" && request.audio === false);
  const perUnit = silent ? price.silentCredits : price.credits;
  const d = model.durations;
  const asked = Math.round(request.seconds ?? d?.default ?? 5);
  const seconds = d?.fixed?.length ? (d.fixed.find((s) => s >= asked) ?? Math.max(...d.fixed)) : asked;
  return debit(price.perSecond ? perUnit * seconds : perUnit);
}

/**
 * The price of a request ready to send: the catalog's arithmetic, or the service's quote when a reference video is in
 * it (the Studio's rule for a reference video, such as Seedance 2.5 also charging the input's seconds, lives there).
 */
export async function quoteCredits(zim: ZimMedia, models: MediaModel[], request: MediaRequest): Promise<number | null> {
  if (!request.videoRefs?.length) return estimateCredits(models, request);
  return (await zim.quote(request)).credits;
}

function debit(value: number): number {
  const floor = Math.floor(value);
  const half = Math.abs(value - floor - 0.5) < 1e-8;
  return Math.max(10, half ? (floor % 2 === 0 ? floor : floor + 1) : Math.round(value));
}

// ---------- what a model takes ----------

/** What one model takes at one quality, from `inputs`, the older fields and `modesByQuality`. */
export interface ModelInputs {
  images: number;
  videos: number;
  audios: number;
  firstFrame: boolean;
  lastFrame: boolean;
  /** References or frames, never both. */
  framesOrRefs: boolean;
}

/**
 * Reads the catalog's description of a model's inputs at a quality. An image model takes `maxRefs` pictures. A video
 * model takes what `inputs` says, narrowed by the quality's modes when the catalog lists them: reference images need
 * `multi_reference`, audios `multi_reference` or `video_reference`, videos a reference, edit or extend mode, frames
 * `first_n_last_frames`. A model that takes only a first frame (`firstFrameOnly`) takes no reference image or last
 * frame. The web page reads the same rules (`packages/client/src/media/inputs.ts`).
 */
export function modelInputs(model: MediaModel, quality?: string): ModelInputs {
  const none = { images: 0, videos: 0, audios: 0, firstFrame: false, lastFrame: false, framesOrRefs: false };
  if (model.kind === "image") return { ...none, images: model.maxRefs ?? model.inputs?.images ?? 0 };
  const q = quality ?? model.defaultQuality;
  const i = model.inputs;
  const firstFrame = i?.firstFrame ?? model.firstFrame ?? false;
  const out: ModelInputs = {
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
export function modelAspects(model: MediaModel, quality?: string): string[] {
  return model.aspectsByQuality?.[quality ?? model.defaultQuality] ?? model.aspects;
}

/** The Studio's modes a model lists at a quality; null when the catalog lists none for it. */
export function modelModes(model: MediaModel, quality?: string): string[] | null {
  return model.modesByQuality?.[quality ?? model.defaultQuality] ?? null;
}

/** Why a request's files don't fit the model, in words for an agent; null when they do. */
export function inputsRefusal(
  model: MediaModel,
  quality: string | undefined,
  given: { images: number; videos: number; audios: number; firstFrame: boolean; lastFrame: boolean },
  mode?: MediaRequestMode,
): string | null {
  const can = modelInputs(model, quality);
  const at = `${model.label} at ${quality ?? model.defaultQuality}`;
  if (mode) {
    const modes = modelModes(model, quality);
    if (modes && !modes.includes(mode)) return `${at} has no ${mode} mode (it has ${modes.join(", ")}).`;
    // Edit and extend work on one clip: the one in video_reference_ids.
    if ((mode === "edit" || mode === "extend") && given.videos !== 1)
      return `The ${mode} mode takes exactly one video in video_reference_ids.`;
    if ((mode === "edit" || mode === "extend" || mode === "multi_reference") && (given.firstFrame || given.lastFrame))
      return `The ${mode} mode takes no opening or closing image.`;
    if (mode === "text_to_video" && (given.images + given.videos + given.audios > 0 || given.firstFrame))
      return "The text_to_video mode takes no files.";
  }
  if (given.lastFrame && !given.firstFrame) return "A last frame needs a first frame too.";
  if (given.firstFrame && !can.firstFrame) return `${at} takes no first frame.`;
  if (given.lastFrame && !can.lastFrame) return `${at} takes no last frame.`;
  const counts: [number, number, string][] = [
    [given.images, can.images, "reference image"],
    [given.videos, can.videos, "reference video"],
    [given.audios, can.audios, "reference audio"],
  ];
  for (const [n, max, what] of counts) {
    if (n > max) return max === 0 ? `${at} takes no ${what}.` : `${at} takes at most ${max} ${what}s.`;
  }
  if (given.firstFrame && given.images + given.videos + given.audios > 0)
    return `${model.label} takes references or frames, never both.`;
  return null;
}

// ---------- what an agent may spend ----------

/** Credits an agent's generations took this UTC month (failed ones gave theirs back). */
export async function agentMonthSpent(db: Database, orgId: string, agentId: string, now = new Date()): Promise<number> {
  const [row] = await db
    .select({ total: sql<number>`coalesce(sum(${mediaGenerations.credits}), 0)::int` })
    .from(mediaGenerations)
    .where(
      and(
        eq(mediaGenerations.orgId, orgId),
        eq(mediaGenerations.agentId, agentId),
        ne(mediaGenerations.status, "failed"),
        gte(mediaGenerations.createdAt, monthStartUtc(now)),
      ),
    );
  return row?.total ?? 0;
}

// ---------- starting, following and saving ----------

export type MediaRequester =
  | { type: "person"; userId: string; name?: string }
  | { type: "agent"; agentId: string; runId: string; channelId: string; threadId: string | null; name?: string };

const MIB = 1024 * 1024;

/** The largest reference file of each kind: what the service takes. */
export const MEDIA_REF_LIMITS: Record<MediaRefKind, number> = { image: 12 * MIB, video: 50 * MIB, audio: 15 * MIB };

const KIND_WORDS: Record<MediaRefKind, string> = {
  image: "a JPEG, PNG or WebP picture",
  video: "an MP4, MOV or WebM video",
  audio: "an MP3, WAV, M4A, AAC or OGG audio",
};

/** Files from the Drive become references the service can hand its provider (they expire there in a day). */
async function uploadRefs(
  deps: MediaDeps,
  zim: ZimMedia,
  orgId: string,
  actor: ArtifactActor,
  artifactIds: string[],
  kind: MediaRefKind,
) {
  const tokens: string[] = [];
  for (const id of artifactIds) tokens.push((await driveFileRef(deps, zim, orgId, actor, id, kind)).ref);
  return tokens;
}

/**
 * One Drive file sent to the service as a reference, read as `actor` (who can't read it gets the Drive's own
 * refusal): its kind from its bytes, `kind` when the caller needs one, and each kind's own size limit.
 */
async function driveFileRef(
  deps: MediaDeps,
  zim: ZimMedia,
  orgId: string,
  actor: ArtifactActor,
  artifactId: string,
  kind?: MediaRefKind,
): Promise<MediaRef & { name: string }> {
  const stored = await storedFileOfArtifact(deps.artifacts, actor, orgId, artifactId);
  const object = await (await deps.artifacts.blobs.forConfig(orgId, stored.storageConfigId)).get(stored.blobKey);
  if (!object) throw new ValidationError(`The stored file of ${artifactId} is missing`);
  // An MP4 is an audio only by its brand, or here by its name when the caller asked for an audio.
  const audioName = /\.(m4a|aac|mp3|wav|ogg)$/i.test(stored.name);
  const type = mediaRefType(object.body, kind === "audio" || audioName ? "audio/" : undefined);
  if (!type || (kind && type.kind !== kind))
    throw new ValidationError(
      `"${stored.name}" isn't ${kind ? KIND_WORDS[kind] : "a picture, a video or an audio the models take"}`,
      "media.ref_type",
    );
  if (object.body.byteLength > MEDIA_REF_LIMITS[type.kind])
    throw new ValidationError(
      `"${stored.name}" is larger than ${MEDIA_REF_LIMITS[type.kind] / MIB} MB`,
      "media.ref_too_large",
    );
  const ref = await zim.uploadRef(orgId, object.body, type.contentType);
  return { ...ref, name: stored.name };
}

/**
 * A Drive file a person picked on the Mídia page (a generation of the workspace, a picture they keep there), sent to
 * the service as a reference without coming down to the browser and up again. The Drive decides whether they may
 * read it.
 */
export async function driveMediaRef(
  deps: MediaDeps,
  orgId: string,
  userId: string,
  artifactId: string,
): Promise<MediaRef & { name: string }> {
  const zim = await requireMediaWallet(deps);
  return driveFileRef(deps, zim, orgId, { type: "person", userId }, artifactId);
}

/** The picture's type from its first bytes (the name can lie). */
export function imageType(name: string, bytes: Uint8Array): string | null {
  void name;
  const type = mediaRefType(bytes);
  return type?.kind === "image" ? type.contentType : null;
}

const ascii = (bytes: Uint8Array, from: number, to: number) => String.fromCharCode(...bytes.subarray(from, to));

/**
 * A reference file's kind and type from its first bytes, never from its name. An MP4 container holds a video or an
 * audio: its brand says which, or else `declared` (the browser's type) when it starts with `audio/`.
 */
export function mediaRefType(bytes: Uint8Array, declared?: string): { kind: MediaRefKind; contentType: string } | null {
  const b = bytes;
  if (b.length < 12) return null;
  if (b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff) return { kind: "image", contentType: "image/jpeg" };
  if (b[0] === 0x89 && ascii(b, 1, 4) === "PNG") return { kind: "image", contentType: "image/png" };
  if (ascii(b, 0, 4) === "RIFF" && ascii(b, 8, 12) === "WEBP") return { kind: "image", contentType: "image/webp" };
  if (ascii(b, 0, 4) === "RIFF" && ascii(b, 8, 12) === "WAVE") return { kind: "audio", contentType: "audio/wav" };
  if (ascii(b, 0, 4) === "OggS") return { kind: "audio", contentType: "audio/ogg" };
  if (ascii(b, 0, 3) === "ID3") return { kind: "audio", contentType: "audio/mpeg" };
  if (b[0] === 0x1a && b[1] === 0x45 && b[2] === 0xdf && b[3] === 0xa3)
    return { kind: "video", contentType: "video/webm" };
  if (ascii(b, 4, 8) === "ftyp") {
    const brand = ascii(b, 8, 12);
    if (brand === "qt  ") return { kind: "video", contentType: "video/quicktime" };
    if (brand === "M4A " || brand === "M4B " || declared?.startsWith("audio/"))
      return { kind: "audio", contentType: "audio/mp4" };
    return { kind: "video", contentType: "video/mp4" };
  }
  // A bare frame header: ADTS AAC when the layer bits are 00, an MPEG audio frame (MP3) otherwise.
  if (b[0] === 0xff && ((b[1] ?? 0) & 0xe0) === 0xe0) {
    return ((b[1] ?? 0) & 0x06) === 0
      ? { kind: "audio", contentType: "audio/aac" }
      : { kind: "audio", contentType: "audio/mpeg" };
  }
  return null;
}

const artifactActorOf = (who: MediaRequester): ArtifactActor =>
  who.type === "person"
    ? { type: "person", userId: who.userId }
    : { type: "agent", agentId: who.agentId, channelId: who.channelId, threadId: who.threadId, runId: who.runId };

const serviceActorOf = (who: MediaRequester): MediaActor =>
  who.type === "person"
    ? { type: "user", id: who.userId, ...(who.name ? { name: who.name } : {}) }
    : { type: "agent", id: who.agentId, ...(who.name ? { name: who.name } : {}) };

/** A request's files: reference images, first and last frames, reference videos and audios. */
export interface MediaFiles {
  refs?: string[];
  firstFrame?: string;
  lastFrame?: string;
  videoRefs?: string[];
  audioRefs?: string[];
}

export type MediaBaseRequest = Omit<MediaRequest, keyof MediaFiles>;

/**
 * The request ready for the service: `drive` holds Drive file ids the requester may read, sent to the service here,
 * and `tokens` files already sent to it (a person's own, through `uploadMediaRef`).
 */
export async function mediaRequestWithFiles(
  deps: MediaDeps,
  orgId: string,
  who: MediaRequester,
  request: MediaBaseRequest,
  drive: MediaFiles = {},
  tokens: MediaFiles = {},
): Promise<MediaRequest> {
  const zim = deps.zimMedia;
  if (!zim) throw new NotFoundError("Media generation isn't set up on this server");
  const actor = artifactActorOf(who);
  const send = async (ids: string[] | undefined, kind: MediaRefKind) =>
    ids?.length ? uploadRefs(deps, zim, orgId, actor, ids, kind) : [];
  const many = async (ids: string[] | undefined, own: string[] | undefined, kind: MediaRefKind) => [
    ...(await send(ids, kind)),
    ...(own ?? []),
  ];
  const one = async (id: string | undefined, own: string | undefined) => (id ? (await send([id], "image"))[0] : own);
  const refs = await many(drive.refs, tokens.refs, "image");
  const firstFrame = await one(drive.firstFrame, tokens.firstFrame);
  const lastFrame = await one(drive.lastFrame, tokens.lastFrame);
  const videoRefs = await many(drive.videoRefs, tokens.videoRefs, "video");
  const audioRefs = await many(drive.audioRefs, tokens.audioRefs, "audio");
  return {
    ...request,
    ...(refs.length ? { refs } : {}),
    ...(firstFrame ? { firstFrame } : {}),
    ...(lastFrame ? { lastFrame } : {}),
    ...(videoRefs.length ? { videoRefs } : {}),
    ...(audioRefs.length ? { audioRefs } : {}),
  };
}

/**
 * Asks the service for a generation and keeps the row; `media.poll` follows it to the Drive. `drive` holds Drive
 * file ids the requester may read, `tokens` files already sent to the service.
 */
export async function startGeneration(
  deps: MediaDeps,
  orgId: string,
  who: MediaRequester,
  input: {
    request: MediaBaseRequest;
    drive?: MediaFiles;
    tokens?: MediaFiles;
    idempotencyKey: string;
  },
): Promise<{ row: MediaRow; generation: MediaGeneration; balance: number }> {
  const zim = deps.zimMedia;
  if (!zim) throw new NotFoundError("Media generation isn't set up on this server");
  const request = await mediaRequestWithFiles(deps, orgId, who, input.request, input.drive, input.tokens);
  const { generation, balance } = await zim.generate(orgId, {
    idempotencyKey: input.idempotencyKey,
    actor: serviceActorOf(who),
    request,
  });
  const [inserted] = await deps.db
    .insert(mediaGenerations)
    .values({
      id: generation.id,
      orgId,
      kind: generation.kind,
      model: generation.model,
      prompt: generation.prompt,
      options: generation.options,
      credits: generation.credits,
      status: generation.status === "failed" ? "failed" : "running",
      error: generation.error?.message ?? null,
      userId: who.type === "person" ? who.userId : null,
      agentId: who.type === "agent" ? who.agentId : null,
      runId: who.type === "agent" ? who.runId : null,
      channelId: who.type === "agent" ? who.channelId : null,
      threadId: who.type === "agent" ? who.threadId : null,
      finishedAt: generation.status === "failed" ? new Date() : null,
    })
    .onConflictDoNothing()
    .returning();
  const row = inserted ?? (await rowOf(deps.db, orgId, generation.id));
  if (!row) throw new ConflictError("The generation was started but couldn't be recorded");
  if (row.status === "running") {
    await enqueue(deps.db, {
      orgId,
      kind: MEDIA_POLL_JOB,
      payload: { generationId: row.id },
      dedupeKey: `media.poll:${row.id}`,
      runAt: new Date(Date.now() + 5000),
      maxAttempts: 20,
    });
  }
  return { row, generation, balance };
}

async function rowOf(db: Database, orgId: string, id: string): Promise<MediaRow | null> {
  const [row] = await db
    .select()
    .from(mediaGenerations)
    .where(and(eq(mediaGenerations.orgId, orgId), eq(mediaGenerations.id, id)));
  return row ?? null;
}

const EXT: Record<string, string> = {
  "image/png": "png",
  "image/jpeg": "jpg",
  "image/webp": "webp",
  "video/mp4": "mp4",
};

/** A short file name from the prompt: what the Drive lists. */
export function fileTitle(kind: "image" | "video", prompt: string): string {
  const words = prompt.replace(/\s+/g, " ").trim().split(" ").slice(0, 8).join(" ");
  const base = words.length > 60 ? `${words.slice(0, 60).trimEnd()}…` : words;
  return `${kind === "image" ? "Imagem" : "Vídeo"}: ${base || "sem título"}`;
}

/**
 * Brings a finished generation's file into the Drive once (the row's `artifact_id` is the guard) and, for an
 * agent's, posts it where the agent was talking when the call couldn't wait for it.
 */
export async function settleGeneration(
  deps: MediaDeps,
  row: MediaRow,
  generation: MediaGeneration,
  options: { post: boolean },
): Promise<MediaRow> {
  const zim = deps.zimMedia;
  if (!zim || row.status !== "running") return row;
  if (generation.status === "running") return row;
  if (generation.status === "failed") {
    const [failed] = await deps.db
      .update(mediaGenerations)
      .set({ status: "failed", error: generation.error?.message ?? "A geração falhou.", finishedAt: new Date() })
      .where(and(eq(mediaGenerations.id, row.id), eq(mediaGenerations.status, "running")))
      .returning();
    if (failed && options.post)
      await postFromAgent(
        deps,
        failed,
        `Não consegui gerar ${failed.kind === "image" ? "a imagem" : "o vídeo"}: ${failed.error} Os créditos voltaram para a carteira.`,
      );
    return failed ?? row;
  }
  // Claim it: two workers finishing the same generation save one file. `finished_at` on a running row is the claim,
  // and one older than five minutes is a save that died halfway.
  const [fresh] = await deps.db
    .update(mediaGenerations)
    .set({ finishedAt: new Date() })
    .where(
      and(
        eq(mediaGenerations.id, row.id),
        eq(mediaGenerations.status, "running"),
        or(isNull(mediaGenerations.finishedAt), lt(mediaGenerations.finishedAt, new Date(Date.now() - 5 * 60_000))),
      ),
    )
    .returning();
  if (!fresh) return (await rowOf(deps.db, row.orgId, row.id)) ?? row;
  try {
    return await saveFile(deps, zim, fresh, options);
  } catch (error) {
    await deps.db.update(mediaGenerations).set({ finishedAt: null }).where(eq(mediaGenerations.id, row.id));
    throw error;
  }
}

async function saveFile(deps: MediaDeps, zim: ZimMedia, row: MediaRow, options: { post: boolean }): Promise<MediaRow> {
  const file = await zim.file(row.orgId, row.id);
  const ext = EXT[file.contentType] ?? (row.kind === "video" ? "mp4" : "png");
  const actor: ArtifactActor | null =
    row.agentId && row.channelId
      ? { type: "agent", agentId: row.agentId, channelId: row.channelId, threadId: row.threadId, runId: row.runId }
      : row.userId
        ? { type: "person", userId: row.userId }
        : null;
  // Who asked is gone (a person removed, an agent deleted): nobody to save the file for.
  if (!actor) throw new PermanentJobError("the generation's requester is gone");
  const title = fileTitle(row.kind, row.prompt);
  const artifact = await createFileArtifact(deps.artifacts, actor, row.orgId, {
    title,
    name: `${
      title
        .replace(/[^\p{L}\p{N} _-]+/gu, "")
        .trim()
        .slice(0, 60) || "midia"
    }.${ext}`,
    contentType: file.contentType,
    bytes: file.bytes,
    note: `${row.model} · ${row.credits} créditos`,
  });
  const [done] = await deps.db
    .update(mediaGenerations)
    .set({ status: "succeeded", artifactId: artifact.id, finishedAt: new Date() })
    .where(and(eq(mediaGenerations.id, row.id), eq(mediaGenerations.status, "running")))
    .returning();
  if (done && options.post) {
    await postFromAgent(
      deps,
      done,
      `${done.kind === "image" ? "Imagem pronta" : "Vídeo pronto"}: ${row.prompt.slice(0, 200)}`,
      {
        id: artifact.id,
        version: artifact.version,
        title: artifact.title,
      },
    );
  }
  return done ?? row;
}

/** The agent's message with its file (or why there's none), in the conversation it asked from. */
async function postFromAgent(
  deps: MediaDeps,
  row: MediaRow,
  body: string,
  artifact?: { id: string; version: number; title: string },
) {
  if (!row.agentId || !row.channelId) return;
  const [run] = row.runId
    ? await deps.db.select({ hop: agentRuns.hop }).from(agentRuns).where(eq(agentRuns.id, row.runId))
    : [];
  const message = await insertMessage(deps.db, {
    orgId: row.orgId,
    channelId: row.channelId,
    threadId: row.threadId,
    author: { type: "agent", agentId: row.agentId, runId: null, hop: run?.hop ?? 1, stretchId: null },
    body,
    meta: artifact ? { artifacts: [artifact] } : {},
  });
  if (deps.artifacts.pubsub) await publishMessageCreated(deps.artifacts.pubsub, messageView(message));
}

/** `media.poll`: asks the service until the generation ends, then saves it (and posts it, for an agent's). */
export function mediaPollHandler(deps: MediaDeps): JobHandler {
  return async (job) => {
    const id = String(job.payload.generationId ?? "");
    const orgId = job.orgId ?? "";
    const row = await rowOf(deps.db, orgId, id);
    if (!row || row.status !== "running" || !deps.zimMedia) return;
    let generation: MediaGeneration;
    try {
      generation = await deps.zimMedia.generation(orgId, id);
    } catch (error) {
      if (error instanceof ZimMediaError && error.status === 404)
        throw new PermanentJobError("generation unknown to the service");
      throw error;
    }
    if (generation.status === "running") {
      if (Date.now() - row.createdAt.getTime() > JOB_GIVE_UP_MS)
        throw new PermanentJobError("generation still running after an hour");
      await enqueue(deps.db, {
        orgId,
        kind: MEDIA_POLL_JOB,
        payload: { generationId: id },
        dedupeKey: `media.poll:${id}:${Math.floor(Date.now() / JOB_EVERY_MS)}`,
        runAt: new Date(Date.now() + JOB_EVERY_MS),
        maxAttempts: 20,
      });
      return;
    }
    // An agent's: the call already returned, so the file goes to its conversation now.
    await settleGeneration(deps, row, generation, { post: Boolean(row.agentId) });
  };
}

// ---------- what people see ----------

export function mediaRowView(row: MediaRow) {
  return {
    id: row.id,
    kind: row.kind,
    model: row.model,
    prompt: row.prompt,
    options: row.options,
    credits: row.credits,
    status: row.status,
    error: row.error,
    userId: row.userId,
    agentId: row.agentId,
    artifactId: row.artifactId,
    createdAt: row.createdAt.toISOString(),
    finishedAt: row.status === "running" ? null : (row.finishedAt?.toISOString() ?? null),
  };
}

export async function listMediaGenerations(
  db: Database,
  orgId: string,
  options: { userId?: string; limit?: number } = {},
) {
  const rows = await db
    .select()
    .from(mediaGenerations)
    .where(
      and(eq(mediaGenerations.orgId, orgId), options.userId ? eq(mediaGenerations.userId, options.userId) : undefined),
    )
    .orderBy(sql`${mediaGenerations.createdAt} desc`)
    .limit(Math.min(100, options.limit ?? 60));
  return rows.map(mediaRowView);
}

/** A person's own generation, checked with the service right away (the page asks while it runs). */
export async function refreshPersonGeneration(deps: MediaDeps, orgId: string, userId: string, id: string) {
  const row = await rowOf(deps.db, orgId, id);
  // Any member may follow one: what it became is a Drive file, and the Drive decides who opens it.
  if (!row) throw new NotFoundError("Generation not found");
  void userId;
  if (row.status !== "running" || !deps.zimMedia) return mediaRowView(row);
  const generation = await deps.zimMedia.generation(orgId, id);
  return mediaRowView(await settleGeneration(deps, row, generation, { post: Boolean(row.agentId) }));
}

// ---------- the agents' tools ----------

const str = (v: unknown) => (typeof v === "string" ? v : "");
const ids = (v: unknown) => (Array.isArray(v) ? v.filter((x): x is string => typeof x === "string") : []);

const failed = (error: unknown): ToolOutput => {
  if (error instanceof ZimMediaError && error.status === 402) {
    return {
      content: `The workspace's media wallet doesn't have enough credits: this costs ${error.needed ?? "?"} and there are ${error.balance ?? 0}. Tell the person; an admin tops it up on the Mídia page.`,
      isError: true,
    };
  }
  return { content: `Failed: ${error instanceof Error ? error.message : String(error)}`, isError: true };
};

function modelLines(models: MediaModel[], kind: "image" | "video"): string {
  return models
    .filter((m) => m.kind === kind)
    .map((m) => {
      const prices = Object.entries(m.prices)
        .map(([q, p]) =>
          typeof p === "number"
            ? `${q} ${p}`
            : `${q} ${p.credits}${p.perSecond ? "/s" : ""}${p.silentCredits !== p.credits ? ` (${p.silentCredits}${p.perSecond ? "/s" : ""} silent)` : ""}`,
        )
        .join(", ");
      const aspects = m.aspectsByQuality
        ? m.qualities.map((q) => `${q}: ${modelAspects(m, q).join(" ")}`).join(", ")
        : m.aspects.join(" ");
      const extra =
        kind === "image"
          ? `up to ${m.maxRefs ?? 0} reference images`
          : `${m.durations?.fixed ? `${m.durations.fixed.join("/")} s` : `${m.durations?.min}-${m.durations?.max} s`}, sound ${m.audio}. Takes: ${videoInputsLine(m)}`;
      return `- ${m.id} (${m.label}): ${m.description} Credits: ${prices}. Aspects ${aspects}; ${extra}.`;
    })
    .join("\n");
}

/** What a video model takes, per quality when that changes it, in the agent's words and the tool's field names. */
function videoInputsLine(m: MediaModel): string {
  const say = (i: ModelInputs) => {
    const parts = [
      i.firstFrame ? (i.lastFrame ? "opening_image_id and closing_image_id" : "opening_image_id only") : null,
      i.images ? `up to ${i.images} reference_ids` : null,
      i.videos ? `up to ${i.videos} video_reference_ids` : null,
      i.audios ? `up to ${i.audios} audio_reference_ids` : null,
    ].filter(Boolean);
    if (!parts.length) return "the prompt alone";
    return `${parts.join(", ")}${i.framesOrRefs && i.firstFrame && parts.length > 1 ? " (frames or references, never both)" : ""}`;
  };
  const withModes = (q: string) => {
    // Edit and extend name themselves: the same one video would otherwise read as a reference.
    const own = (modelModes(m, q) ?? []).filter((mode) => mode === "edit" || mode === "extend");
    const line = say(modelInputs(m, q));
    return own.length ? `${line}; mode ${own.join(" or ")} with one video_reference_ids` : line;
  };
  const byQuality = m.qualities.map((q) => [q, withModes(q)] as const);
  if (byQuality.every(([, line]) => line === byQuality[0]?.[1])) return byQuality[0]?.[1] ?? "the prompt alone";
  return byQuality.map(([q, line]) => `at ${q} ${line}`).join("; ");
}

function mediaTool(
  deps: MediaDeps,
  kind: "image" | "video",
  models: MediaModel[],
  limits: { askAbove: number | null; monthly: number },
): ToolDefinition {
  const ofKind = models.filter((m) => m.kind === kind);
  const name = kind === "image" ? GENERATE_IMAGE_TOOL : GENERATE_VIDEO_TOOL;
  const most = (key: "images" | "videos" | "audios") =>
    Math.max(1, ...ofKind.flatMap((m) => m.qualities.map((q) => modelInputs(m, q)[key])));
  const estimate = (input: Record<string, unknown>) =>
    estimateCredits(models, {
      model: str(input.model),
      quality: str(input.quality) || undefined,
      seconds: typeof input.seconds === "number" ? input.seconds : undefined,
      audio: typeof input.audio === "boolean" ? input.audio : undefined,
      videoRefs: ids(input.video_reference_ids),
    });
  return {
    name,
    description:
      kind === "image"
        ? `Generate an image with AI and save it to the Drive; it comes attached to your reply. Paid in credits from the workspace's media wallet (1,000 credits = US$ 1), within your monthly allowance of ${limits.monthly}. Write the prompt in English, detailed (subject, setting, light, framing, style). To edit or keep a person or product the same, pass Drive pictures in \`reference_ids\`. Models:\n${modelLines(models, "image")}`
        : `Generate a video with AI and save it to the Drive. It takes one to five minutes: the call returns at once and the video is posted in this conversation when it's ready (tell the person it's on its way). Paid in credits per second from the workspace's media wallet (1,000 credits = US$ 1), within your monthly allowance of ${limits.monthly}${limits.askAbove !== null ? `; above ${limits.askAbove} credits a person approves it first, and always when a reference video is in it (its price comes from the service)` : ""}. Write the prompt in English, describing motion and camera. Files are Drive or attachment ids: \`opening_image_id\` starts the video from a picture and \`closing_image_id\` ends it on another (only with an opening one), \`reference_ids\` keep people or products consistent, \`video_reference_ids\` give motion, camera or a clip to edit, \`audio_reference_ids\` a voice, music or sound to follow. Pick a model that takes the files you have. Models:\n${modelLines(models, "video")}`,
    scope: "",
    // A generation above the agent's threshold waits for a person's yes; under it, nobody is asked.
    sensitive: limits.askAbove !== null,
    asksNobody: (input) => {
      const credits = estimate(input);
      return limits.askAbove === null || (credits !== null && credits <= limits.askAbove);
    },
    inputSchema: {
      type: "object",
      properties: {
        model: { type: "string", enum: ofKind.map((m) => m.id) },
        prompt: { type: "string", minLength: 1, maxLength: 4000 },
        quality: { type: "string", description: "One of the model's qualities; its default when left out." },
        aspect: {
          type: "string",
          description:
            kind === "image"
              ? "Aspect ratio such as 1:1, 16:9 or 9:16; 1:1 when left out."
              : "Aspect ratio such as 16:9, 9:16 or 1:1; 16:9 when left out.",
        },
        reference_ids: {
          type: "array",
          items: { type: "string" },
          maxItems: kind === "image" ? 14 : most("images"),
          description:
            kind === "image"
              ? "Drive pictures (JPEG, PNG, WebP) to edit or keep consistent."
              : "Drive pictures (JPEG, PNG, WebP) of people, products or places to keep in the video.",
        },
        ...(kind === "video"
          ? {
              seconds: { type: "integer", minimum: 1, maximum: 30 },
              audio: { type: "boolean", description: "With sound (default) or silent, where the model offers both." },
              opening_image_id: { type: "string", description: "A Drive picture the video starts from." },
              closing_image_id: {
                type: "string",
                description: "A Drive picture the video ends on, only with opening_image_id.",
              },
              video_reference_ids: {
                type: "array",
                items: { type: "string" },
                maxItems: most("videos"),
                description: "Drive videos (MP4, MOV, WebM, up to 50 MB) to follow or edit.",
              },
              audio_reference_ids: {
                type: "array",
                items: { type: "string" },
                maxItems: most("audios"),
                description: "Drive audios (MP3, WAV, M4A, AAC, OGG, up to 15 MB) to follow.",
              },
              mode: {
                type: "string",
                enum: [...MEDIA_MODES],
                description:
                  "Leave it out unless you edit or continue a clip: the files say what to do. `edit` changes the one video in video_reference_ids as the prompt says (the output follows its length), `extend` continues it from its end. Only where the model lists the mode.",
              },
            }
          : {}),
        why: { type: "string", maxLength: 300, description: "When it needs approval: what this is for, in one line." },
      },
      required: ["model", "prompt"],
      additionalProperties: false,
    },
    describe: (input) => {
      const model = models.find((m) => m.id === str(input.model));
      const credits = estimate(input);
      const bits = [
        model?.label ?? str(input.model),
        str(input.quality) || model?.defaultQuality,
        kind === "video"
          ? `${typeof input.seconds === "number" ? input.seconds : (model?.durations?.default ?? 5)} s`
          : null,
        credits !== null
          ? `${credits.toLocaleString("pt-BR")} créditos`
          : ids(input.video_reference_ids).length
            ? "com vídeo de referência"
            : null,
      ].filter(Boolean);
      return {
        title: `${kind === "image" ? "Gerar imagem" : "Gerar vídeo"} · ${bits.join(" · ")}`,
        detail: str(input.prompt).slice(0, 400),
      };
    },
    async execute(input, ctx: ToolContext) {
      try {
        const zim = deps.zimMedia;
        if (!zim) return { content: "Media generation isn't available.", isError: true };
        const model = ofKind.find((m) => m.id === str(input.model));
        if (!model) return { content: `Unknown model "${str(input.model)}".`, isError: true };
        const mode = MEDIA_MODES.find((m) => m === input.mode);
        const drive = {
          refs: ids(input.reference_ids),
          firstFrame: str(input.opening_image_id) || undefined,
          lastFrame: str(input.closing_image_id) || undefined,
          videoRefs: ids(input.video_reference_ids),
          audioRefs: ids(input.audio_reference_ids),
        };
        const refusal = inputsRefusal(
          model,
          str(input.quality) || undefined,
          {
            images: drive.refs.length,
            videos: drive.videoRefs.length,
            audios: drive.audioRefs.length,
            firstFrame: Boolean(drive.firstFrame),
            lastFrame: Boolean(drive.lastFrame),
          },
          mode,
        );
        if (refusal) return { content: `${refusal} Pick another model or other files.`, isError: true };
        const spent = await agentMonthSpent(ctx.db, ctx.orgId, ctx.agentId);
        const overAllowance = (credits: number | null): ToolOutput | null =>
          credits !== null && spent + credits > limits.monthly
            ? {
                content: `This would pass your monthly media allowance: ${spent} of ${limits.monthly} credits used, and this costs ${credits}. Tell the person; an admin can raise it in your settings.`,
                isError: true,
              }
            : null;
        const early = overAllowance(estimate(input));
        if (early) return early;
        const threadId = replyThreadOf(ctx);
        const agent = await getAgentCached(ctx.db, ctx.orgId, ctx.agentId);
        const who: MediaRequester = {
          type: "agent",
          agentId: ctx.agentId,
          runId: ctx.runId,
          channelId: ctx.channelId,
          threadId,
          name: agent?.name,
        };
        // The files go to the service first: a reference video's price is the service's quote, known only then.
        const { refs, firstFrame, lastFrame, videoRefs, audioRefs, ...request } = await mediaRequestWithFiles(
          deps,
          ctx.orgId,
          who,
          {
            model: model.id,
            prompt: str(input.prompt),
            ...(str(input.quality) ? { quality: str(input.quality) } : {}),
            ...(str(input.aspect) ? { aspect: str(input.aspect) } : {}),
            ...(typeof input.seconds === "number" ? { seconds: input.seconds } : {}),
            ...(typeof input.audio === "boolean" ? { audio: input.audio } : {}),
            ...(mode ? { mode } : {}),
          },
          drive,
        );
        const tokens = { refs, firstFrame, lastFrame, videoRefs, audioRefs };
        if (videoRefs?.length) {
          const quoted = overAllowance(await quoteCredits(zim, models, { ...request, ...tokens }));
          if (quoted) return quoted;
        }
        const { row, generation } = await startGeneration(deps, ctx.orgId, who, {
          idempotencyKey: `run:${ctx.runId}:${ctx.toolUseId ?? crypto.randomUUID()}`,
          request,
          tokens,
        });
        if (generation.status === "failed") {
          return {
            content: `The generation failed: ${generation.error?.message ?? "no reason given"} No credits were spent.`,
            isError: true,
          };
        }
        if (kind === "video") {
          return {
            content: `The video is being generated (${row.credits} credits). It will be posted in this conversation when it's ready, usually in one to five minutes. Don't call this again for the same video.`,
          };
        }
        // An image: wait for it here, so it comes with the reply.
        const until = Date.now() + IMAGE_WAIT_MS;
        let current = generation;
        while (current.status === "running" && Date.now() < until && !ctx.signal?.aborted) {
          await Bun.sleep(POLL_EVERY_MS);
          current = await zim.generation(ctx.orgId, row.id);
        }
        if (current.status === "running") {
          return {
            content: `The image is taking longer than usual (${row.credits} credits). It will be posted in this conversation when it's ready.`,
          };
        }
        const done = await settleGeneration(deps, row, current, { post: false });
        if (done.status === "failed")
          return {
            content: `The image failed: ${done.error ?? "no reason given"} The credits went back.`,
            isError: true,
          };
        // Settled here, the job that follows it finds it done and posts nothing.
        return {
          content: `Image generated and saved to the Drive (${done.credits} credits); it's attached to your reply. Drive file id: ${done.artifactId}.`,
          data: { artifact: { id: done.artifactId, version: 1, title: fileTitle("image", done.prompt) } },
        };
      } catch (error) {
        return failed(error);
      }
    },
  };
}

/**
 * `generate_image` and `generate_video`, for agents whose monthly allowance isn't 0, on a server with the Zim Mídia
 * service. The catalog in their description is the service's, cached for ten minutes.
 */
export function createMediaGenerationToolSource(deps: MediaDeps): ToolSource {
  return {
    name: "media-generation",
    async tools(ctx) {
      if (!deps.zimMedia || !ctx.runId) return [];
      const agent = await getAgentCached(ctx.db, ctx.orgId, ctx.agentId);
      if (!agent || agent.archivedAt || agent.mediaMonthlyCredits <= 0) return [];
      const models = await mediaCatalog(deps.zimMedia)
        .then((c) => c.models)
        .catch(() => null);
      if (!models?.length) return [];
      const limits = { askAbove: agent.mediaAskAbove ?? null, monthly: agent.mediaMonthlyCredits };
      return [mediaTool(deps, "image", models, limits), mediaTool(deps, "video", models, limits)];
    },
  };
}

// ---------- wallet and top-ups, for the routes ----------

/**
 * A picture, video or audio from a person's computer, sent to the service as a reference (it keeps it for a day).
 * Its kind is read from its bytes; `declared` (the browser's type) only tells an MP4 audio from an MP4 video.
 */
export async function uploadMediaRef(
  deps: MediaDeps,
  orgId: string,
  bytes: Uint8Array,
  declared?: string,
): Promise<MediaRef> {
  const zim = await requireMediaWallet(deps);
  const type = mediaRefType(bytes, declared);
  if (!type) throw new ValidationError("Send a picture, a video or an audio the models take", "media.ref_type");
  if (bytes.byteLength > MEDIA_REF_LIMITS[type.kind])
    throw new ValidationError(`The file is larger than ${MEDIA_REF_LIMITS[type.kind] / MIB} MB`, "media.ref_too_large");
  return zim.uploadRef(orgId, bytes, type.contentType);
}

export async function requireMediaWallet(deps: MediaDeps): Promise<ZimMedia> {
  if (!deps.zimMedia) throw new NotFoundError("Media generation isn't set up on this server");
  return deps.zimMedia;
}
