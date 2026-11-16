import { join } from "node:path";
import {
  type ApprovalPortal,
  backupName,
  PORTAL_FILE_BYTES,
  type PortalCard,
  type PortalItem,
  type PortalJob,
  type PortalType,
} from "@agenteschat/adapters";
import { and, asc, type Database, desc, eq, inArray, isNull, schema, sql } from "@agenteschat/db";
import { portalColumnOf } from "./approval-portal";
import { storedFileOfArtifact } from "./artifacts";
import { afterApproveOf, type DesignDelivery } from "./design-delivery";
import { ConflictError, ValidationError } from "./errors";
import { publishMessageCreated } from "./events";
import { postKey } from "./file-reader";
import { openTaskConversation } from "./issues";
import { insertMessage, messageView } from "./messages";
import { notifyMessage } from "./notification-producers";
import { requirePermission } from "./organizations";
import { enqueue } from "./outbox";
import { answerRounds, openRound } from "./review-rounds";
import { rightHandId } from "./right-hand";
import {
  cleanReviewText,
  clientStageOf,
  onDisk,
  putFromDisk,
  queueReviewLight,
  type ReviewDecision,
  requireVideoReview,
  reviewSummaries,
  reviewVersionFile,
  reviewWhere,
  type VideoReviewDeps,
  type VideoReviewSummary,
} from "./video-reviews";

const {
  artifacts,
  issues,
  organizationMembers,
  organizations,
  users,
  videoReviewNotes,
  videoReviews,
  videoReviewVersions,
} = schema;
type ReviewRow = typeof videoReviews.$inferSelect;

/*
 * An editor's delivery (docs/adr/doug-0012-editor-delivery.md): a person of the team edits a post's video by hand and
 * sends it from the post's task. It goes to the same review as an agent's video (the Revisor), in the task's
 * conversation, where the team approves it or asks for changes, and the decision comes back to that person. Once the
 * video is approved, the post's cover and caption are approved on the task too, and one click sends it to the client's
 * approval at the portal, or straight to scheduling for a client whose approval is the team's (`after_approve`). The
 * team and the client watch light copies; the post gets a copy made for it; the editor's original is the final, kept
 * in the workspace's storage and copied to the installation's backup once the client approves. Every step is code: no
 * model is asked anything.
 */

export const EDITOR_SEND_JOB = "editor_delivery.send";
export const EDITOR_FINAL_JOB = "editor_delivery.final";
/** A video file an editor exports: what ffmpeg reads and a phone's light copy is made from. */
const EDITOR_VIDEO = /\.(mp4|m4v|mov|webm|mkv)$/i;
/** A cover: a picture. */
const PICTURE = /\.(jpe?g|png|webp)$/i;
/** The most a caption says (Instagram's own limit). */
export const POST_CAPTION_CHARS = 2200;
/** `YYYY-MM-DDTHH:MM`: a day and an hour, what the portal schedules at. */
const WHEN = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}/;
/** The stages after the client's approval (ADR 9001 §2): the final is kept from the first of them on. */
const CLIENT_APPROVED = ["approved", "scheduled", "posted"];

type Deps = VideoReviewDeps;

export type EditorFinal = {
  state: "queued" | "kept" | "backed_up" | "failed";
  version?: number;
  artifactId?: string;
  backup?: { name: string; link: string | null } | null;
  error?: string;
  at: string;
};

const now = () => new Date().toISOString();

// ---------- lines in the task's conversation ----------

/** `@handle ` of a person, so a line reaches them wherever they are; "" when they have none. */
async function mention(db: Database, orgId: string, userId: string | null) {
  if (!userId) return "";
  const [m] = await db
    .select({ handle: organizationMembers.handle })
    .from(organizationMembers)
    .where(and(eq(organizationMembers.orgId, orgId), eq(organizationMembers.userId, userId)));
  return m?.handle ? `@${m.handle} ` : "";
}

/**
 * A line in the review's conversation, written here (never by a model) and starting no agent's run: as a person (their
 * send, their decision) or as the workspace's assistant (what the server did). Whoever it names is notified.
 */
export async function line(
  deps: Pick<Deps, "db" | "pubsub">,
  review: Pick<ReviewRow, "id" | "orgId" | "channelId" | "threadId" | "version">,
  author: { userId: string } | "assistant",
  body: string,
  decision: string,
) {
  if (!deps.pubsub) return;
  const agentId = author === "assistant" ? await rightHandId(deps.db, review.orgId) : null;
  if (author === "assistant" && !agentId) return;
  const message = await insertMessage(deps.db, {
    orgId: review.orgId,
    channelId: review.channelId,
    threadId: review.threadId,
    author:
      author === "assistant"
        ? { type: "agent", agentId: agentId as string, runId: null, hop: 1, stretchId: null }
        : { type: "person", userId: author.userId },
    body,
    meta: { videoReview: { id: review.id, version: review.version, decision } },
  });
  await publishMessageCreated(deps.pubsub, messageView(message));
  await notifyMessage({ db: deps.db, pubsub: deps.pubsub }, review.orgId, message.id).catch(() => {});
}

// ---------- the editor sends ----------

/** The task's video review, if one was sent from it: the newest. */
export async function taskReviewOf(db: Database, orgId: string, issueId: string) {
  const [row] = await db
    .select()
    .from(videoReviews)
    .where(and(eq(videoReviews.orgId, orgId), eq(videoReviews.taskId, issueId), eq(videoReviews.medium, "video")))
    .orderBy(desc(videoReviews.createdAt))
    .limit(1);
  return row ?? null;
}

/** A task's video reviews, one per video it asked for (doug-0012 §13), in their order: the first sent first. */
export async function taskReviewsOf(db: Database, orgId: string, issueId: string) {
  return db
    .select()
    .from(videoReviews)
    .where(and(eq(videoReviews.orgId, orgId), eq(videoReviews.taskId, issueId), eq(videoReviews.medium, "video")))
    .orderBy(sql`coalesce(${videoReviews.taskPart}, 1)`, asc(videoReviews.createdAt));
}

/** What the task's panel reads: the reviews sent from it, one per video, in their order. */
export async function taskDelivery(deps: Pick<Deps, "db">, userId: string, orgId: string, issueId: string) {
  // Opening it checks that this person sees the task (and makes its conversation, where the review lives).
  await openTaskConversation(deps.db, { type: "person", userId }, orgId, issueId);
  const reviews = await taskReviewsOf(deps.db, orgId, issueId);
  return { reviewId: reviews[0]?.id ?? null, reviewIds: reviews.map((r) => r.id) };
}

/** The title of one of a task's videos once it has more than one. */
const partTitle = (task: string, part: number) => `${task.slice(0, 180)} · Vídeo ${part}`;

/** The portal's tick: each editor's post at the portal keeps where it stands there, read from the post itself. */
export async function syncEditorStages(db: Database, orgId: string, items: PortalItem[]) {
  const rows = await db
    .select({ id: videoReviews.id, client: videoReviews.portalClient, delivery: videoReviews.delivery })
    .from(videoReviews)
    .where(
      and(
        eq(videoReviews.orgId, orgId),
        sql`${videoReviews.senderUserId} is not null`,
        sql`${videoReviews.delivery}->>'item' is not null`,
      ),
    );
  let changed = 0;
  for (const row of rows) {
    const delivery = (row.delivery ?? {}) as DesignDelivery & { stage?: string };
    const item = items.find((i) => i.id === delivery.item && i.client === row.client);
    if (!item) continue;
    const stage = portalColumnOf(item);
    if (stage === delivery.stage) continue;
    await db
      .update(videoReviews)
      .set({ delivery: { ...delivery, stage } })
      .where(eq(videoReviews.id, row.id));
    changed++;
  }
  return changed;
}

/**
 * A person sends a video they edited for a task: a file they uploaded to the task's conversation. A task may ask for
 * several videos (doug-0012 §13): a file sent to the task is a new video of it, with its own review (in the task's
 * conversation, so whoever sees the task reviews it); a file sent to one of its reviews (`reviewId`) is that video's
 * next version. When the client asked for a change at the portal, the new version goes straight to them (ADR 9001
 * §17): no review in between.
 */
export async function submitEditorVideo(
  deps: Deps,
  userId: string,
  orgId: string,
  issueId: string,
  input: { artifactId: string; note?: string; reviewId?: string },
): Promise<{ review: VideoReviewSummary; toClient: boolean }> {
  const conversation = await openTaskConversation(deps.db, { type: "person", userId }, orgId, issueId);
  const file = await storedFileOfArtifact(deps.artifacts, { type: "person", userId }, orgId, input.artifactId);
  const [placed] = await deps.db
    .select({ channelId: artifacts.channelId })
    .from(artifacts)
    .where(and(eq(artifacts.orgId, orgId), eq(artifacts.id, input.artifactId), isNull(artifacts.deletedAt)));
  if (placed?.channelId !== conversation.channelId) {
    throw new ValidationError("Upload the video to this task's conversation first", "editor_delivery.bad_file");
  }
  if (!EDITOR_VIDEO.test(file.name)) {
    throw new ValidationError(
      `${file.name} is not a video (.mp4, .mov, .m4v, .webm or .mkv)`,
      "video_review.not_video",
    );
  }
  const [issue] = await deps.db.select().from(issues).where(eq(issues.id, issueId));
  if (!issue) throw new ValidationError("No such task", "editor_delivery.bad_file");
  const source = (issue.source ?? {}) as { type?: string; client?: string; cardId?: string };
  const portalTask = source.type === "portal" && source.client;
  const note = cleanReviewText(input.note ?? "");
  const siblings = await taskReviewsOf(deps.db, orgId, issueId);
  const existing = input.reviewId ? (siblings.find((r) => r.id === input.reviewId) ?? null) : null;
  if (input.reviewId && !existing) {
    throw new ValidationError("That video is not one of this task's", "editor_delivery.bad_review");
  }
  const delivery = (existing?.delivery ?? null) as DesignDelivery | null;
  const atClient = Boolean(delivery?.item) && delivery?.state !== "failed";
  // The client asked for a change on the post it has: the new version is theirs at once.
  const toClient = Boolean(existing && atClient && clientStageOf(existing, issue.source) === "adjusting");
  if (existing && atClient && !toClient) {
    throw new ConflictError(
      "This video is with the client: a new version goes once they ask for a change",
      "editor_delivery.with_client",
    );
  }
  const stamp = new Date();
  let versionId: string | null = null;
  const reviewId = await deps.db.transaction(async (tx) => {
    if (existing) {
      const [review] = await tx.select().from(videoReviews).where(eq(videoReviews.id, existing.id)).for("update");
      if (!review) throw new ValidationError("No such review", "editor_delivery.bad_file");
      const version = review.version + 1;
      const [added] = await tx
        .insert(videoReviewVersions)
        .values({ orgId, reviewId: review.id, version, artifactId: input.artifactId, note, editedBy: userId })
        .returning({ id: videoReviewVersions.id });
      versionId = added?.id ?? null;
      await tx
        .update(videoReviews)
        .set({
          version,
          senderUserId: review.senderUserId ?? userId,
          ...(toClient
            ? { status: "approved" as const, decidedBy: userId, decidedAt: stamp }
            : { status: "in_review" as const, decidedBy: null, decidedAt: null }),
          updatedAt: stamp,
        })
        .where(eq(videoReviews.id, review.id));
      return review.id;
    }
    // A new video of the task, numbered after the others. The first keeps the task's card; the next get their own when
    // they go to the client (`runEditorSend`).
    const part = siblings.reduce((most, r) => Math.max(most, r.taskPart ?? 1), 0) + 1;
    if (part === 2) {
      // The task has more than one video now: the first is named as one of them.
      await tx
        .update(videoReviews)
        .set({ title: partTitle(issue.title, 1), taskPart: 1 })
        .where(
          and(
            eq(videoReviews.orgId, orgId),
            eq(videoReviews.taskId, issue.id),
            sql`coalesce(${videoReviews.taskPart}, 1) = 1`,
          ),
        );
    }
    const [row] = await tx
      .insert(videoReviews)
      .values({
        orgId,
        agentId: null,
        senderUserId: userId,
        taskId: issue.id,
        taskPart: part,
        channelId: conversation.channelId,
        threadId: conversation.rootId,
        title: part === 1 ? issue.title.slice(0, 200) : partTitle(issue.title, part),
        client: portalTask ? String(source.client) : "",
        portalClient: portalTask ? String(source.client) : null,
        portalCard: portalTask && source.cardId && part === 1 ? String(source.cardId) : null,
      })
      .returning({ id: videoReviews.id });
    if (!row) throw new Error("video review not inserted");
    const [added] = await tx
      .insert(videoReviewVersions)
      .values({ orgId, reviewId: row.id, version: 1, artifactId: input.artifactId, note, editedBy: userId })
      .returning({ id: videoReviewVersions.id });
    versionId = added?.id ?? null;
    return row.id;
  });
  if (versionId) await queueReviewLight(deps, orgId, versionId);
  const [review] = await deps.db.select().from(videoReviews).where(eq(videoReviews.id, reviewId));
  // The changes asked of them are answered by this version: the round's log says when.
  if (existing && review) await answerRounds(deps.db, reviewId, review.version);
  if (review) {
    if (toClient) {
      await enqueue(deps.db, {
        orgId,
        kind: EDITOR_SEND_JOB,
        payload: { reviewId, version: review.version, kind: "version" },
        maxAttempts: 4,
      });
      await line(
        deps,
        review,
        { userId },
        `Enviei a V${review.version} de «${review.title}» com o ajuste que o cliente pediu: ela vai direto para ele no portal.${note ? `\n\n${note}` : ""}`,
        "sent",
      );
    } else {
      await line(
        deps,
        review,
        { userId },
        `Enviei a V${review.version} de «${review.title}» para revisão.${note ? `\n\n${note}` : ""}`,
        "sent",
      );
    }
  }
  const [summary] = await reviewSummaries(deps.db, orgId, [reviewId]);
  if (!summary) throw new Error("review not found after send");
  return { review: summary, toClient };
}

// ---------- the team decides ----------

/**
 * Approves a person's video or asks them for changes (doug-0012): the notes of that version go to them in one message
 * from whoever decided, in the task's conversation, naming them so they are told. No agent is started.
 */
export async function decidePersonVideo(
  deps: Pick<Deps, "db" | "pubsub">,
  userId: string,
  review: ReviewRow,
  input: { decision: ReviewDecision; message?: string },
): Promise<VideoReviewSummary> {
  const notes = await deps.db
    .select({
      id: videoReviewNotes.id,
      atMs: videoReviewNotes.atMs,
      endMs: videoReviewNotes.endMs,
      page: videoReviewNotes.page,
      kind: videoReviewNotes.kind,
      body: videoReviewNotes.body,
      attachments: videoReviewNotes.attachments,
      author: users.name,
    })
    .from(videoReviewNotes)
    .leftJoin(users, eq(users.id, videoReviewNotes.authorUserId))
    .where(
      and(
        eq(videoReviewNotes.reviewId, review.id),
        eq(videoReviewNotes.version, review.version),
        isNull(videoReviewNotes.sentAt),
      ),
    )
    .orderBy(
      sql`${videoReviewNotes.page} asc nulls first`,
      sql`${videoReviewNotes.atMs} asc nulls first`,
      asc(videoReviewNotes.createdAt),
    );
  const message = cleanReviewText(input.message ?? "");
  if (input.decision === "changes" && notes.length === 0 && !message) {
    throw new ValidationError("Say what to change: add a note first", "video_review.nothing_to_change");
  }
  const delivery = (review.delivery ?? null) as DesignDelivery | null;
  if (delivery && delivery.state !== "failed") {
    throw new ConflictError("This video is with the client already", "editor_delivery.with_client");
  }
  const stamp = new Date();
  await deps.db
    .update(videoReviews)
    .set({
      status: input.decision === "approve" ? "approved" : "changes",
      decidedBy: userId,
      decidedAt: stamp,
      updatedAt: stamp,
    })
    .where(eq(videoReviews.id, review.id));
  if (notes.length > 0) {
    await deps.db
      .update(videoReviewNotes)
      .set({ sentAt: stamp })
      .where(
        inArray(
          videoReviewNotes.id,
          notes.map((n) => n.id),
        ),
      );
  }
  const who = await mention(deps.db, review.orgId, review.senderUserId);
  const lines: string[] = [];
  const v = review.version;
  const design = review.medium === "design";
  if (input.decision === "approve") {
    const post = review.post ?? {};
    const missing = [post.coverOk ? "" : "a capa", post.captionOk ? "" : "a legenda"].filter(Boolean);
    lines.push(`${who}${design ? "Peça aprovada" : "Vídeo aprovado"}: «${review.title}» V${v}.`);
    if (review.portalClient && !design) {
      lines.push(
        missing.length
          ? `Agora falta${missing.length > 1 ? "m" : ""} ${missing.join(" e ")}, na tarefa. Depois é só enviar ao cliente.`
          : "Capa e legenda já estão aprovadas: na tarefa, é só enviar ao cliente.",
      );
    }
  } else {
    // A task's video comes back by the task's steps; anything else sent from Revisão, from its page (doug-0015).
    const where = review.taskId && !design ? "na tarefa, em Enviar vídeo" : "na Revisão, em Mandar nova versão";
    lines.push(`${who}Ajustes em «${review.title}» V${v}. Quando terminar, mande a V${v + 1} ${where}.`);
  }
  if (message) lines.push("", message);
  if (notes.length > 0) {
    lines.push("", "Notas:");
    for (const n of notes) {
      const at = design && n.page === null ? "peça toda" : reviewWhere(n.atMs, n.endMs, n.page);
      const files = (n.attachments ?? []).map((a) => (a.type === "file" ? a.name : a.url));
      lines.push(
        `- [${at}] ${n.body.replace(/\n+/g, " ").trim() || "(veja o anexo)"}${files.length ? ` (anexo: ${files.join(", ")})` : ""}${n.author ? ` (${n.author})` : ""}`,
      );
    }
  }
  await line(deps, review, { userId }, lines.join("\n"), input.decision);
  if (input.decision === "changes") {
    const [decider] = await deps.db.select({ name: users.name }).from(users).where(eq(users.id, userId));
    await openRound(deps.db, review, {
      askedByUserId: userId,
      askedByName: decider?.name ?? "",
      fromClient: false,
      notes: notes.length + (message ? 1 : 0),
    });
  }
  const [summary] = await reviewSummaries(deps.db, review.orgId, [review.id]);
  if (!summary) throw new Error("review not found after decision");
  return summary;
}

// ---------- the post's cover and caption ----------

export interface PostPatch {
  caption?: string;
  captionOk?: boolean;
  /** A picture file of the review's conversation; null: take it back. */
  cover?: string | null;
  noCover?: boolean;
  coverOk?: boolean;
}

/**
 * Sets the post's cover and caption, and approves each. Changing one takes its approval back. Fixed once the post went
 * to the client: the portal has it from then on.
 */
export async function setReviewPost(
  deps: Pick<Deps, "db">,
  userId: string,
  orgId: string,
  reviewId: string,
  patch: PostPatch,
) {
  const review = await requireVideoReview(deps.db, userId, orgId, reviewId);
  if (review.medium !== "video") throw new ValidationError("Only a video has a post here", "editor_delivery.not_video");
  const delivery = (review.delivery ?? null) as DesignDelivery | null;
  if (delivery && delivery.state !== "failed") {
    throw new ConflictError("The post already went to the portal", "editor_delivery.with_client");
  }
  const post = { ...(review.post ?? {}) };
  if (patch.caption !== undefined) {
    const caption = patch.caption.replace(/\r\n?/g, "\n").trim().slice(0, POST_CAPTION_CHARS);
    if (caption !== (post.caption ?? "")) post.captionOk = false;
    post.caption = caption;
  }
  if (patch.cover !== undefined) {
    if (patch.cover !== null) {
      const [file] = await deps.db
        .select({ id: artifacts.id, title: artifacts.title, channelId: artifacts.channelId, kind: artifacts.kind })
        .from(artifacts)
        .where(and(eq(artifacts.orgId, orgId), eq(artifacts.id, patch.cover), isNull(artifacts.deletedAt)));
      if (file?.kind !== "file" || file.channelId !== review.channelId || !PICTURE.test(file.title)) {
        throw new ValidationError("The cover is a picture uploaded to this task", "editor_delivery.bad_cover");
      }
    }
    if (patch.cover !== (post.cover ?? null)) post.coverOk = false;
    post.cover = patch.cover;
    if (patch.cover) post.noCover = false;
  }
  if (patch.noCover !== undefined) {
    if (patch.noCover !== Boolean(post.noCover)) post.coverOk = false;
    post.noCover = patch.noCover;
    if (patch.noCover) post.cover = null;
  }
  if (patch.captionOk !== undefined) {
    if (patch.captionOk && !post.caption) {
      throw new ValidationError("Write the caption first", "editor_delivery.no_caption");
    }
    post.captionOk = patch.captionOk;
  }
  if (patch.coverOk !== undefined) {
    if (patch.coverOk && !post.cover && !post.noCover) {
      throw new ValidationError("Choose the cover first", "editor_delivery.no_cover");
    }
    post.coverOk = patch.coverOk;
  }
  await deps.db.update(videoReviews).set({ post, updatedAt: new Date() }).where(eq(videoReviews.id, review.id));
  return post;
}

/**
 * The post goes to the client: the approved video, its cover and caption, all approved. Done by a job (a post copy is
 * made first), keyed by review and version so a retried one never sends twice. Whoever may give agents work sends,
 * as at the portal (ADR 9001 §7).
 */
export async function sendPostToClient(
  deps: Pick<Deps, "db" | "portal">,
  userId: string,
  orgId: string,
  reviewId: string,
) {
  const review = await requireVideoReview(deps.db, userId, orgId, reviewId);
  await requirePermission(deps.db, userId, orgId, "assign_work");
  if (!deps.portal || !review.portalClient) {
    throw new ValidationError("This video's task is not a post of the portal", "editor_delivery.no_portal");
  }
  if (review.status !== "approved")
    throw new ValidationError("Approve the video first", "editor_delivery.not_approved");
  const post = review.post ?? {};
  if (!post.captionOk) throw new ValidationError("Approve the caption first", "editor_delivery.no_caption");
  if (!post.coverOk) throw new ValidationError("Approve the cover first", "editor_delivery.no_cover");
  const delivery = (review.delivery ?? null) as DesignDelivery | null;
  if (delivery && delivery.state !== "failed") {
    throw new ConflictError("The post already went to the portal", "editor_delivery.with_client");
  }
  const sending: DesignDelivery = { state: "sending", at: now() };
  await deps.db
    .update(videoReviews)
    .set({ delivery: sending, updatedAt: new Date() })
    .where(eq(videoReviews.id, review.id));
  await enqueue(deps.db, {
    orgId,
    kind: EDITOR_SEND_JOB,
    payload: { reviewId, version: review.version, kind: "post", by: userId },
    maxAttempts: 4,
  });
  return { delivery: sending, afterApprove: await afterApproveOf(deps.db, orgId, review.portalClient) };
}

// ---------- the send, by code ----------

/** The version's post copy, made once and kept beside its bytes; without ffmpeg, the original when it fits. */
async function postCopy(deps: Deps, review: ReviewRow, version: number): Promise<Uint8Array> {
  const [v] = await deps.db
    .select()
    .from(videoReviewVersions)
    .where(and(eq(videoReviewVersions.reviewId, review.id), eq(videoReviewVersions.version, version)));
  if (!v) throw new Error(`version ${version} of review ${review.id} is missing`);
  const file = await reviewVersionFile(deps, review.orgId, v.artifactId);
  if (!file) throw new Error(`the video of version ${version} was removed`);
  const key = postKey(file.blobKey);
  if (v.postState === "ready") {
    const kept = await file.store.get(key).catch(() => null);
    if (kept) return kept.body;
  }
  const copies = deps.videoCopies;
  if (copies) {
    await onDisk(file.store, file.blobKey, async (input, dir) => {
      const output = join(dir, "post.mp4");
      await copies("post", input, output);
      await putFromDisk(file.store, key, output);
    });
    await deps.db.update(videoReviewVersions).set({ postState: "ready" }).where(eq(videoReviewVersions.id, v.id));
    const made = await file.store.get(key);
    if (made) return made.body;
  }
  if (file.size > PORTAL_FILE_BYTES)
    throw new Error("the original is larger than the portal takes, and no copy can be made");
  const original = await file.store.get(file.blobKey);
  if (!original) throw new Error("the stored video is missing");
  return original.body;
}

async function setDelivery(db: Database, reviewId: string, delivery: DesignDelivery) {
  await db.update(videoReviews).set({ delivery, updatedAt: new Date() }).where(eq(videoReviews.id, reviewId));
}

const day = (when: string) => {
  const [date, time] = when.split("T");
  const [y, m, d] = (date ?? "").split("-");
  return `${d}/${m}${y ? `/${y}` : ""}${time ? ` às ${time.slice(0, 5)}` : ""}`;
};

/** A name for the file at the portal and in the backup: the post's title, in letters it keeps. */
const fileName = (title: string, ext: string) =>
  `${
    title
      .normalize("NFD")
      .replace(/\p{M}+/gu, "")
      .replace(/[^A-Za-z0-9 _-]+/g, " ")
      .trim()
      .replace(/\s+/g, "-")
      .slice(0, 80) || "video"
  }.${ext}`;

async function waitFor(portal: ApprovalPortal, job: PortalJob) {
  for (let i = 0; i < 40 && job.state === "sending"; i++) {
    await new Promise((r) => setTimeout(r, 3000));
    job = (await portal.job(job.id)) ?? job;
  }
  return job;
}

/**
 * Job `editor_delivery.send`. `post`: the approved video goes to the client's approval with its cover and caption, or,
 * for a client whose approval is the team's, straight to approved and scheduled for its card's day. `version`: the new
 * version of a post the client sent back goes to them at once.
 */
export async function runEditorSend(
  deps: Deps,
  payload: { reviewId: string; version: number; kind: "post" | "version"; by?: string },
): Promise<void> {
  const [review] = await deps.db.select().from(videoReviews).where(eq(videoReviews.id, payload.reviewId));
  if (!review?.portalClient || !deps.portal) return;
  if (review.version !== payload.version || review.status !== "approved") return;
  const portal = deps.portal;
  const client = review.portalClient;
  const done = (review.delivery ?? null) as DesignDelivery | null;
  const [by] = payload.by
    ? await deps.db.select({ name: users.name }).from(users).where(eq(users.id, payload.by))
    : review.decidedBy
      ? await deps.db.select({ name: users.name }).from(users).where(eq(users.id, review.decidedBy))
      : [];
  const video = async () => portal.upload(fileName(review.title, "mp4"), await postCopy(deps, review, payload.version));

  if (payload.kind === "version") {
    if (!done?.item) return;
    let job = await portal.newVersion(client, done.item, {
      files: [await video()],
      key: `editor:${review.id}:v${payload.version}`,
      by: by?.name ?? undefined,
    });
    job = await waitFor(portal, job);
    if (job.state === "sending") throw new Error("the portal is still sending");
    if (job.state === "failed") {
      await line(
        deps,
        review,
        "assistant",
        `A V${payload.version} de «${review.title}» não subiu ao portal: ${job.error ?? "o portal recusou"}.`,
        "delivered",
      );
      return;
    }
    const link = job.link ? ` ${job.link}` : "";
    // The portal's next version is this one.
    const known = Object.keys(review.portalVersions ?? {}).map(Number);
    const next = (known.length ? Math.max(...known) : 1) + 1;
    await deps.db
      .update(videoReviews)
      .set({ portalVersions: { ...(review.portalVersions ?? {}), [String(next)]: payload.version } })
      .where(eq(videoReviews.id, review.id));
    await line(
      deps,
      review,
      "assistant",
      `A V${payload.version} de «${review.title}» está no portal, com o cliente.${link}`,
      "delivered",
    );
    return;
  }

  if (done && done.state !== "sending" && done.state !== "failed") return;
  const mode = await afterApproveOf(deps.db, review.orgId, client);
  const cards: PortalCard[] = await portal.cards(client).catch(() => []);
  if (!review.portalCard && review.taskId) {
    // Another video of a task whose card is the first's (doug-0012 §13): a card of its own, beside the task's, tied to
    // the same task so the portal's sync makes no new task of it.
    const [task] = await deps.db.select({ source: issues.source }).from(issues).where(eq(issues.id, review.taskId));
    const taskCard = cards.find((c) => c.id === (task?.source as { cardId?: string } | null)?.cardId);
    const made = await portal.createCard(
      client,
      {
        title: review.title.slice(0, 120),
        type: taskCard?.type === "story" ? "story" : "reel",
        ...(taskCard?.date ? { date: taskCard.date } : {}),
        ...(taskCard?.list ? { list: taskCard.list } : {}),
        task: review.taskId,
      },
      by?.name ?? undefined,
    );
    await deps.db.update(videoReviews).set({ portalCard: made.id }).where(eq(videoReviews.id, review.id));
    review.portalCard = made.id;
    cards.push(made);
  }
  const card = review.portalCard ? cards.find((c) => c.id === review.portalCard) : undefined;
  let job: PortalJob | null = done?.job ? await portal.job(done.job).catch(() => null) : null;
  if (!job || job.state === "failed") {
    const post = review.post ?? {};
    let cover: string | undefined;
    if (post.cover && !post.noCover) {
      const file = await reviewVersionFile(deps, review.orgId, post.cover);
      const bytes = file ? await file.store.get(file.blobKey) : null;
      if (!bytes) throw new Error("the cover's file is missing");
      cover = await portal.upload(fileName(`${review.title} capa`, "jpg"), bytes.body);
    }
    const type: PortalType = card?.type === "story" ? "story" : "reel";
    job = await portal.send({
      client,
      type,
      files: [await video()],
      ...(cover ? { cover } : {}),
      title: review.title,
      ...(post.caption ? { caption: post.caption } : {}),
      card: review.portalCard ?? undefined,
      key: `editor:${review.id}:v${payload.version}`,
      by: by?.name ?? undefined,
    });
    await setDelivery(deps.db, review.id, { state: "sending", job: job.id, at: now() });
  }
  job = await waitFor(portal, job);
  if (job.state === "sending") throw new Error("the portal is still sending");
  if (job.state === "failed" || !job.item) {
    const error = job.error ?? (job.missing.length ? `faltou: ${job.missing.join(", ")}` : "o portal recusou");
    await setDelivery(deps.db, review.id, { state: "failed", job: job.id, error, at: now() });
    await line(
      deps,
      review,
      "assistant",
      `«${review.title}» não subiu ao portal: ${error}. Dá para tentar de novo na tarefa.`,
      "delivered",
    );
    return;
  }
  const link = job.link ? ` ${job.link}` : "";
  // The portal's first version is this one: the client's notes on it land on it (doug-0012 §12).
  await deps.db
    .update(videoReviews)
    .set({ portalVersions: { "1": payload.version } })
    .where(eq(videoReviews.id, review.id));
  if (mode === "portal") {
    await setDelivery(deps.db, review.id, { state: "sent", job: job.id, item: job.item, link: job.link, at: now() });
    await line(
      deps,
      review,
      "assistant",
      `«${review.title}» foi para a aprovação do cliente no portal.${link}`,
      "delivered",
    );
    return;
  }
  // Direct: the team's approval is the last one, so the post is approved, scheduled for its card's day, and final.
  await portal.editItem(client, job.item, { status: "approved" }, by?.name ?? undefined);
  const when = card?.date && WHEN.test(card.date) ? card.date.slice(0, 16) : null;
  if (when && new Date(when) > new Date()) {
    await portal.scheduleItem(client, job.item, when, by?.name ?? undefined);
    await setDelivery(deps.db, review.id, {
      state: "scheduled",
      job: job.id,
      item: job.item,
      link: job.link,
      when,
      at: now(),
    });
    await line(
      deps,
      review,
      "assistant",
      `«${review.title}» aprovado e agendado para ${day(when)}.${link}`,
      "delivered",
    );
  } else {
    await setDelivery(deps.db, review.id, {
      state: "approved",
      job: job.id,
      item: job.item,
      link: job.link,
      when: null,
      at: now(),
    });
    await line(
      deps,
      review,
      "assistant",
      `«${review.title}» aprovado e pronto no portal, mas falta quando sai (${card?.date ? `o cartão diz ${day(card.date)}, sem uma hora no futuro` : "o cartão não tem data"}). Agende no Portal.${link}`,
      "delivered",
    );
  }
  await queueFinal(deps.db, review.orgId, review.id);
}

// ---------- the final ----------

/** Asks for the final once: the row says it is queued before the job exists, so two passes never queue two. */
async function queueFinal(db: Database, orgId: string, reviewId: string) {
  const queued: EditorFinal = { state: "queued", at: now() };
  const [claimed] = await db
    .update(videoReviews)
    .set({ final: queued })
    .where(and(eq(videoReviews.id, reviewId), isNull(videoReviews.final)))
    .returning({ id: videoReviews.id });
  if (claimed) await enqueue(db, { orgId, kind: EDITOR_FINAL_JOB, payload: { reviewId }, maxAttempts: 6 });
}

/**
 * The posts the client approved since the last pass (the portal tick, ADR 9001 §11): an editor's video sent to the
 * client's approval whose card is now approved, scheduled or posted gets its final kept.
 */
export async function queueEditorFinals(db: Database, orgId: string) {
  const rows = await db
    .select({
      id: videoReviews.id,
      source: issues.source,
      delivery: videoReviews.delivery,
      portalCard: videoReviews.portalCard,
    })
    .from(videoReviews)
    .innerJoin(issues, eq(issues.id, videoReviews.taskId))
    .where(
      and(
        eq(videoReviews.orgId, orgId),
        sql`${videoReviews.senderUserId} is not null`,
        isNull(videoReviews.final),
        sql`${videoReviews.delivery}->>'state' = 'sent'`,
      ),
    );
  let queued = 0;
  for (const row of rows) {
    if (!CLIENT_APPROVED.includes(clientStageOf(row, row.source) ?? "")) continue;
    await queueFinal(db, orgId, row.id);
    queued++;
  }
  return queued;
}

/**
 * Job `editor_delivery.final`: the approved version's original is the final. It already lives in the workspace's own
 * storage (the storage server when the workspace has it on, doug-0010): it is marked, and a copy goes to the backup
 * in a folder of the workspace and the client, read as it is uploaded. Said in the task's conversation.
 */
export async function runEditorFinal(
  deps: Deps,
  payload: { reviewId: string },
  options: { finalAttempt: boolean },
): Promise<void> {
  const [review] = await deps.db.select().from(videoReviews).where(eq(videoReviews.id, payload.reviewId));
  if (!review) return;
  const final = (review.final ?? null) as EditorFinal | null;
  if (final && (final.state === "kept" || final.state === "backed_up")) return;
  const [v] = await deps.db
    .select()
    .from(videoReviewVersions)
    .where(and(eq(videoReviewVersions.reviewId, review.id), eq(videoReviewVersions.version, review.version)));
  const file = v ? await reviewVersionFile(deps, review.orgId, v.artifactId) : null;
  const settle = (value: EditorFinal) =>
    deps.db.update(videoReviews).set({ final: value, updatedAt: new Date() }).where(eq(videoReviews.id, review.id));
  if (!v || !file) {
    await settle({ state: "failed", error: "o arquivo original foi apagado", at: now() });
    return;
  }
  if (!deps.backup) {
    await settle({ state: "kept", version: v.version, artifactId: v.artifactId, backup: null, at: now() });
    await line(
      deps,
      review,
      "assistant",
      `Final de «${review.title}» (V${v.version}, original em alta) guardado no Drive do DougBot.`,
      "final",
    );
    return;
  }
  try {
    const [org] = await deps.db
      .select({ name: organizations.name })
      .from(organizations)
      .where(eq(organizations.id, review.orgId));
    const [stored] = await deps.db
      .select({ title: artifacts.title })
      .from(artifacts)
      .where(eq(artifacts.id, v.artifactId));
    const ext = /\.([A-Za-z0-9]{2,4})$/.exec(stored?.title ?? "")?.[1]?.toLowerCase() ?? "mp4";
    const date = new Date().toISOString().slice(0, 10);
    const body = file.store.stream ? await file.store.stream(file.blobKey) : (await file.store.get(file.blobKey))?.body;
    if (!body) throw new Error("the stored original is missing");
    const saved = await deps.backup.save({
      folders: [org?.name ?? "DougBot", review.client || "Sem cliente"],
      name: `${date} - ${backupName(review.title)}.${ext}`,
      size: file.size,
      contentType: ext === "mov" ? "video/quicktime" : "video/mp4",
      body,
    });
    await settle({
      state: "backed_up",
      version: v.version,
      artifactId: v.artifactId,
      backup: { name: deps.backup.name, link: saved.link },
      at: now(),
    });
    await line(
      deps,
      review,
      "assistant",
      `Final de «${review.title}» (V${v.version}, original em alta) guardado no Drive do DougBot, com cópia no ${deps.backup.name}.${saved.link ? ` ${saved.link}` : ""}`,
      "final",
    );
  } catch (error) {
    if (options.finalAttempt) {
      await settle({
        state: "failed",
        version: v.version,
        artifactId: v.artifactId,
        error: error instanceof Error ? error.message.slice(0, 300) : String(error),
        at: now(),
      });
      await line(
        deps,
        review,
        "assistant",
        `O final de «${review.title}» está no Drive do DougBot, mas a cópia no ${deps.backup.name} falhou. Tente de novo na tarefa.`,
        "final",
      );
    }
    throw error;
  }
}

/** "Try again" on a final whose backup failed. */
export async function retryEditorFinal(deps: Pick<Deps, "db">, userId: string, orgId: string, reviewId: string) {
  const review = await requireVideoReview(deps.db, userId, orgId, reviewId);
  const final = (review.final ?? null) as EditorFinal | null;
  if (final?.state !== "failed") throw new ConflictError("Nothing to try again", "editor_delivery.nothing_to_retry");
  await deps.db.update(videoReviews).set({ final: null }).where(eq(videoReviews.id, review.id));
  await queueFinal(deps.db, orgId, review.id);
}
