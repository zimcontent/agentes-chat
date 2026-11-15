import {
  type MediaActor,
  type MediaGeneration,
  type MediaModel,
  type MediaPack,
  type MediaRequest,
  type ZimMedia,
  ZimMediaError,
} from "@agenteschat/adapters";
import { and, type Database, eq, gte, isNull, lt, ne, or, schema, sql } from "@agenteschat/db";
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
 * least 10). Null when the request doesn't fit the model: the service refuses it anyway, before any charge.
 */
export function estimateCredits(models: MediaModel[], request: Partial<MediaRequest>): number | null {
  const model = models.find((m) => m.id === request.model);
  if (!model) return null;
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

function debit(value: number): number {
  const floor = Math.floor(value);
  const half = Math.abs(value - floor - 0.5) < 1e-8;
  return Math.max(10, half ? (floor % 2 === 0 ? floor : floor + 1) : Math.round(value));
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

/** Files from the Drive become references the service can hand its provider (they expire there in a day). */
async function uploadRefs(deps: MediaDeps, zim: ZimMedia, orgId: string, actor: ArtifactActor, artifactIds: string[]) {
  const tokens: string[] = [];
  for (const id of artifactIds) {
    const stored = await storedFileOfArtifact(deps.artifacts, actor, orgId, id);
    const object = await (await deps.artifacts.blobs.forConfig(orgId, stored.storageConfigId)).get(stored.blobKey);
    if (!object) throw new ValidationError(`The stored file of ${id} is missing`);
    const type = imageType(stored.name, object.body);
    if (!type) throw new ValidationError(`"${stored.name}" isn't a JPEG, PNG or WebP picture`);
    tokens.push(await zim.uploadRef(orgId, object.body, type));
  }
  return tokens;
}

/** The picture's type from its first bytes (the name can lie). */
export function imageType(name: string, bytes: Uint8Array): string | null {
  if (bytes[0] === 0xff && bytes[1] === 0xd8) return "image/jpeg";
  if (bytes[0] === 0x89 && bytes[1] === 0x50 && bytes[2] === 0x4e && bytes[3] === 0x47) return "image/png";
  if (bytes[0] === 0x52 && bytes[1] === 0x49 && bytes[8] === 0x57 && bytes[9] === 0x45) return "image/webp";
  void name;
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

/**
 * Asks the service for a generation and keeps the row; `media.poll` follows it to the Drive. `refs` and
 * `firstFrame` are Drive file ids the requester may read.
 */
export async function startGeneration(
  deps: MediaDeps,
  orgId: string,
  who: MediaRequester,
  input: {
    request: Omit<MediaRequest, "refs" | "firstFrame">;
    /** Drive files the requester may read. */
    refs?: string[];
    firstFrame?: string;
    /** Pictures already sent to the service (`uploadMediaRef`), from a person's own computer. */
    refTokens?: string[];
    firstFrameToken?: string;
    idempotencyKey: string;
  },
): Promise<{ row: MediaRow; generation: MediaGeneration; balance: number }> {
  const zim = deps.zimMedia;
  if (!zim) throw new NotFoundError("Media generation isn't set up on this server");
  const actor = artifactActorOf(who);
  const fromDrive = input.refs?.length ? await uploadRefs(deps, zim, orgId, actor, input.refs) : [];
  const refs = [...fromDrive, ...(input.refTokens ?? [])];
  const [firstFrame] = input.firstFrame
    ? await uploadRefs(deps, zim, orgId, actor, [input.firstFrame])
    : input.firstFrameToken
      ? [input.firstFrameToken]
      : [];
  const { generation, balance } = await zim.generate(orgId, {
    idempotencyKey: input.idempotencyKey,
    actor: serviceActorOf(who),
    request: { ...input.request, ...(refs.length ? { refs } : {}), ...(firstFrame ? { firstFrame } : {}) },
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
      const extra =
        kind === "image"
          ? `up to ${m.maxRefs ?? 0} reference images`
          : `${m.durations?.fixed ? `${m.durations.fixed.join("/")} s` : `${m.durations?.min}-${m.durations?.max} s`}, sound ${m.audio}${m.firstFrame ? ", opening image" : ""}`;
      return `- ${m.id} (${m.label}): ${m.description} Credits: ${prices}. Aspects ${m.aspects.join(" ")}; ${extra}.`;
    })
    .join("\n");
}

function mediaTool(
  deps: MediaDeps,
  kind: "image" | "video",
  models: MediaModel[],
  limits: { askAbove: number | null; monthly: number },
): ToolDefinition {
  const ofKind = models.filter((m) => m.kind === kind);
  const name = kind === "image" ? GENERATE_IMAGE_TOOL : GENERATE_VIDEO_TOOL;
  const estimate = (input: Record<string, unknown>) =>
    estimateCredits(models, {
      model: str(input.model),
      quality: str(input.quality) || undefined,
      seconds: typeof input.seconds === "number" ? input.seconds : undefined,
      audio: typeof input.audio === "boolean" ? input.audio : undefined,
    });
  return {
    name,
    description:
      kind === "image"
        ? `Generate an image with AI and save it to the Drive; it comes attached to your reply. Paid in credits from the workspace's media wallet (1,000 credits = US$ 1), within your monthly allowance of ${limits.monthly}. Write the prompt in English, detailed (subject, setting, light, framing, style). To edit or keep a person or product the same, pass Drive pictures in \`reference_ids\`. Models:\n${modelLines(models, "image")}`
        : `Generate a video with AI and save it to the Drive. It takes one to five minutes: the call returns at once and the video is posted in this conversation when it's ready (tell the person it's on its way). Paid in credits per second from the workspace's media wallet (1,000 credits = US$ 1), within your monthly allowance of ${limits.monthly}${limits.askAbove !== null ? `; above ${limits.askAbove} credits a person approves it first` : ""}. Write the prompt in English, describing motion and camera. Pass a Drive picture as \`opening_image_id\` to start the video from it. Models:\n${modelLines(models, "video")}`,
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
          description: "Aspect ratio such as 16:9, 9:16 or 1:1; the model's first when left out.",
        },
        ...(kind === "image"
          ? {
              reference_ids: {
                type: "array",
                items: { type: "string" },
                maxItems: 14,
                description: "Drive pictures (JPEG, PNG, WebP) to edit or keep consistent.",
              },
            }
          : {
              seconds: { type: "integer", minimum: 1, maximum: 30 },
              audio: { type: "boolean", description: "With sound (default) or silent, where the model offers both." },
              opening_image_id: { type: "string", description: "A Drive picture the video starts from." },
            }),
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
        credits !== null ? `${credits.toLocaleString("pt-BR")} créditos` : null,
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
        const credits = estimate(input);
        const spent = await agentMonthSpent(ctx.db, ctx.orgId, ctx.agentId);
        if (credits !== null && spent + credits > limits.monthly) {
          return {
            content: `This would pass your monthly media allowance: ${spent} of ${limits.monthly} credits used, and this costs ${credits}. Tell the person; an admin can raise it in your settings.`,
            isError: true,
          };
        }
        const threadId = replyThreadOf(ctx);
        const agent = await getAgentCached(ctx.db, ctx.orgId, ctx.agentId);
        const { row, generation } = await startGeneration(
          deps,
          ctx.orgId,
          {
            type: "agent",
            agentId: ctx.agentId,
            runId: ctx.runId,
            channelId: ctx.channelId,
            threadId,
            name: agent?.name,
          },
          {
            idempotencyKey: `run:${ctx.runId}:${ctx.toolUseId ?? crypto.randomUUID()}`,
            request: {
              model: str(input.model),
              prompt: str(input.prompt),
              ...(str(input.quality) ? { quality: str(input.quality) } : {}),
              ...(str(input.aspect) ? { aspect: str(input.aspect) } : {}),
              ...(typeof input.seconds === "number" ? { seconds: input.seconds } : {}),
              ...(typeof input.audio === "boolean" ? { audio: input.audio } : {}),
            },
            refs: ids(input.reference_ids),
            firstFrame: str(input.opening_image_id) || undefined,
          },
        );
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

/** A picture from a person's computer, sent to the service as a reference (it keeps it for a day). */
export async function uploadMediaRef(deps: MediaDeps, orgId: string, bytes: Uint8Array): Promise<string> {
  const zim = await requireMediaWallet(deps);
  const type = imageType("", bytes);
  if (!type) throw new ValidationError("Send a JPEG, PNG or WebP picture");
  return zim.uploadRef(orgId, bytes, type);
}

export async function requireMediaWallet(deps: MediaDeps): Promise<ZimMedia> {
  if (!deps.zimMedia) throw new NotFoundError("Media generation isn't set up on this server");
  return deps.zimMedia;
}
