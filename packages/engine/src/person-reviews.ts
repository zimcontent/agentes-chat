import { and, type Database, eq, isNull, schema } from "@agenteschat/db";
import { storedFileOfArtifact } from "./artifacts";
import { requireChannelAccess } from "./channels";
import { line, submitEditorVideo } from "./editor-delivery";
import { NotFoundError, ValidationError } from "./errors";
import { openTaskConversation } from "./issues";
import { answerRounds } from "./review-rounds";
import {
  cleanReviewText,
  DESIGN_PAGES,
  queueReviewLight,
  reviewSummaries,
  type VideoReviewDeps,
  type VideoReviewSummary,
} from "./video-reviews";

const { artifacts, issues, videoReviews, videoReviewVersions } = schema;

/*
 * A person's work sent for review from Revisão itself (docs/adr/doug-0015-team-work-review.md): a video or a design
 * piece (its slides as pictures) a member of the team made by hand, for any workspace. It is the same review as an
 * agent's (`video_reviews`, `sender_user_id` the person), so the list, the player, the notes, the rounds and the
 * decision that comes back to them (`decidePersonVideo`) are the ones already there. A video sent for a task keeps the
 * task's own path (doug-0012: the post, the client, the final); everything else lives in the conversation the person
 * names: the task's, or a group's.
 */

/** A video file a person exports (what the light copy is made from). */
const VIDEO = /\.(mp4|m4v|mov|webm|mkv)$/i;
/** A slide of a design piece. */
const PICTURE = /\.(png|jpe?g|webp|avif|gif)$/i;

export type PersonWorkMedium = "video" | "design";

export interface PersonWorkInput {
  medium: PersonWorkMedium;
  /** The files, uploaded to the conversation it goes to first: one video, or a piece's slides in order. */
  files: string[];
  title?: string;
  note?: string;
  /** One of this person's reviews: the files are its next version. */
  reviewId?: string;
  /** The task it is for: it lives in the task's conversation (a video, as doug-0012's delivery). */
  taskId?: string;
  /** Otherwise the conversation it lives in (a group the person reads). */
  channelId?: string;
}

/** Where a new review lives: the task's conversation, or a conversation the person reads, at its top level. */
async function placeOf(
  db: Database,
  userId: string,
  orgId: string,
  input: Pick<PersonWorkInput, "taskId" | "channelId">,
): Promise<{ channelId: string; threadId: string | null; taskId: string | null; taskTitle: string | null }> {
  if (input.taskId) {
    const conversation = await openTaskConversation(db, { type: "person", userId }, orgId, input.taskId);
    const [issue] = await db.select({ title: issues.title }).from(issues).where(eq(issues.id, input.taskId));
    return {
      channelId: conversation.channelId,
      threadId: conversation.rootId,
      taskId: input.taskId,
      taskTitle: issue?.title ?? null,
    };
  }
  if (!input.channelId) {
    throw new ValidationError("Pick the group or the task this work is for", "video_review.no_place");
  }
  await requireChannelAccess(db, userId, orgId, input.channelId);
  return { channelId: input.channelId, threadId: null, taskId: null, taskTitle: null };
}

/** Every file is a person's upload to this conversation, of the medium's kind. */
async function checkFiles(
  deps: VideoReviewDeps,
  userId: string,
  orgId: string,
  channelId: string,
  medium: PersonWorkMedium,
  files: string[],
) {
  if (files.length === 0) throw new ValidationError("Send a file", "video_review.no_pages");
  if (medium === "video" && files.length > 1) {
    throw new ValidationError("One video at a time", "video_review.one_video");
  }
  if (files.length > DESIGN_PAGES) {
    throw new ValidationError(`At most ${DESIGN_PAGES} slides a piece`, "video_review.too_many_pages");
  }
  for (const id of files) {
    const file = await storedFileOfArtifact(deps.artifacts, { type: "person", userId }, orgId, id);
    const [placed] = await deps.db
      .select({ channelId: artifacts.channelId })
      .from(artifacts)
      .where(and(eq(artifacts.orgId, orgId), eq(artifacts.id, id), isNull(artifacts.deletedAt)));
    if (placed?.channelId !== channelId) {
      throw new ValidationError("Upload the file to the conversation it goes to first", "editor_delivery.bad_file");
    }
    if (medium === "video" && !VIDEO.test(file.name)) {
      throw new ValidationError(
        `${file.name} is not a video (.mp4, .mov, .m4v, .webm or .mkv)`,
        "video_review.not_video",
      );
    }
    if (medium === "design" && !PICTURE.test(file.name)) {
      throw new ValidationError(`${file.name} is not a picture (.png, .jpg, .webp)`, "video_review.not_picture");
    }
  }
}

/**
 * Sends a person's work for review, or the next version of one they sent. A video for a task goes the task's way
 * (`submitEditorVideo`); the rest opens (or adds a version to) a review in the conversation named, and says so there
 * as the person. The team decides it like any review; the decision comes back to them.
 */
export async function sendPersonWork(
  deps: VideoReviewDeps,
  userId: string,
  orgId: string,
  input: PersonWorkInput,
): Promise<{ review: VideoReviewSummary; toClient: boolean }> {
  const files = [...new Set(input.files)];
  const existing = input.reviewId
    ? ((
        await deps.db
          .select()
          .from(videoReviews)
          .where(and(eq(videoReviews.orgId, orgId), eq(videoReviews.id, input.reviewId)))
      )[0] ?? null)
    : null;
  if (input.reviewId && !existing) throw new NotFoundError("No such review");
  if (existing && existing.senderUserId !== userId) {
    throw new ValidationError("Only who sent this work sends its next version", "video_review.not_yours");
  }
  const medium = existing ? (existing.medium as PersonWorkMedium) : input.medium;
  if (existing && medium !== input.medium) {
    throw new ValidationError("A next version is the same kind of work", "video_review.wrong_medium");
  }
  // A task's video: the post, the client and the final follow it (doug-0012).
  const taskVideo = medium === "video" && (existing ? existing.taskId : input.taskId);
  if (taskVideo) {
    const [artifactId] = files;
    if (!artifactId || files.length > 1) throw new ValidationError("One video at a time", "video_review.one_video");
    return submitEditorVideo(deps, userId, orgId, taskVideo, {
      artifactId,
      ...(input.note ? { note: input.note } : {}),
      ...(existing ? { reviewId: existing.id } : {}),
    });
  }
  const place = existing
    ? { channelId: existing.channelId, threadId: existing.threadId, taskId: existing.taskId, taskTitle: null }
    : await placeOf(deps.db, userId, orgId, input);
  await checkFiles(deps, userId, orgId, place.channelId, medium, files);
  const title = (input.title?.trim() || place.taskTitle || "").slice(0, 200);
  if (!existing && !title) throw new ValidationError("Give the work a title", "video_review.no_title");
  const note = cleanReviewText(input.note ?? "");
  const version = {
    artifactId: files[0] as string,
    note,
    pages: medium === "design" ? files.map((artifactId) => ({ artifactId })) : [],
    editedBy: userId,
  };
  const stamp = new Date();
  let versionId: string | null = null;
  const reviewId = await deps.db.transaction(async (tx) => {
    if (existing) {
      const [review] = await tx.select().from(videoReviews).where(eq(videoReviews.id, existing.id)).for("update");
      if (!review) throw new NotFoundError("No such review");
      const next = review.version + 1;
      const [added] = await tx
        .insert(videoReviewVersions)
        .values({ orgId, reviewId: review.id, version: next, ...version })
        .returning({ id: videoReviewVersions.id });
      versionId = added?.id ?? null;
      await tx
        .update(videoReviews)
        .set({
          version: next,
          status: "in_review",
          decidedBy: null,
          decidedAt: null,
          updatedAt: stamp,
          ...(input.title?.trim() ? { title } : {}),
        })
        .where(eq(videoReviews.id, review.id));
      return review.id;
    }
    const [row] = await tx
      .insert(videoReviews)
      .values({
        orgId,
        agentId: null,
        senderUserId: userId,
        medium,
        taskId: place.taskId,
        channelId: place.channelId,
        threadId: place.threadId,
        title,
      })
      .returning({ id: videoReviews.id });
    if (!row) throw new Error("review not inserted");
    const [added] = await tx
      .insert(videoReviewVersions)
      .values({ orgId, reviewId: row.id, version: 1, ...version })
      .returning({ id: videoReviewVersions.id });
    versionId = added?.id ?? null;
    return row.id;
  });
  if (versionId && medium === "video") await queueReviewLight(deps, orgId, versionId);
  const [review] = await deps.db.select().from(videoReviews).where(eq(videoReviews.id, reviewId));
  if (review) {
    // The changes asked of them are answered by this version: the round's log says when.
    if (existing) await answerRounds(deps.db, reviewId, review.version);
    const what = medium === "design" ? "a peça" : "o vídeo";
    const body = `Enviei a V${review.version} de «${review.title}» (${what}) para revisão.${note ? `\n\n${note}` : ""}`;
    await line(deps, review, { userId }, body, "sent");
  }
  const [summary] = await reviewSummaries(deps.db, orgId, [reviewId]);
  if (!summary) throw new Error("review not found after send");
  return { review: summary, toClient: false };
}
