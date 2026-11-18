import { mkdtemp, readFile, rm, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  type ApprovalPortal,
  type BlobStore,
  type FileBackup,
  firstWords,
  type LightCopy,
  type PubSub,
  type SpeechEngine,
  type VideoCopies,
} from "@agenteschat/adapters";
import { and, asc, type Database, desc, eq, inArray, isNull, schema, sql } from "@agenteschat/db";
import { type ArtifactActor, type ArtifactDeps, storedFileOfArtifact } from "./artifacts";
import { requireChannelAccess } from "./channels";
import { afterApproveOf, cardCaptionOf, queueDesignDelivery } from "./design-delivery";
import { decidePersonVideo, POST_CAPTION_CHARS } from "./editor-delivery";
import { ConflictError, NotFoundError, ValidationError } from "./errors";
import { lightKey } from "./file-reader";
import { postPersonMessage } from "./messages";
import { getMembership, requireActiveMembership } from "./organizations";
import { enqueue } from "./outbox";
import { approvedOnCard } from "./review-gate";
import { latestRounds, type ReviewRoundView, roundsOf, seeRounds } from "./review-rounds";
import { replyThreadOf } from "./runs";
import { readRefusal } from "./standing";
import type { ToolContext, ToolDefinition, ToolOutput, ToolSource } from "./tools/types";
import type { WhatsAppDeps } from "./whatsapp/accounts";

const {
  agents,
  artifacts,
  artifactVersions,
  channelMembers,
  channels,
  users,
  videoReviewNotes,
  videoReviews,
  videoReviewVersions,
} = schema;
type VideoReviewStatus = schema.VideoReviewStatus;

/**
 * Video review (docs/adr/doug-0007-video-review.md): an agent sends a video it made for the team's review with
 * `send_for_review`; people play it, pin notes to a second of a version (typed or said), then approve it or ask for
 * changes. The decision goes back to the agent as a message from the person who decided, in the conversation the video
 * came from, with every note of that version: the agent makes the next version and sends it with the same review.
 * The apps read a review again every few seconds while it is open: no realtime event of its own.
 */

export const SEND_FOR_REVIEW_TOOL = "send_for_review";
export const SET_REVIEW_BRIEF_TOOL = "set_review_brief";
/** The design piece's tool (`design-reviews.ts`), named here for the decision's words. */
export const DESIGN_TOOL_NAME = "send_design_for_review";
/** The most a brief says. */
export const REVIEW_BRIEF_CHARS = 6000;
/** The most links a review shows. */
export const REVIEW_LINKS = 8;

/** A video file, by the name it was stored with: what a phone's browser plays. */
const VIDEO_NAME = /\.(mp4|m4v|mov|webm)$/i;
/** The most a note says, typed or transcribed. */
export const REVIEW_NOTE_CHARS = 4000;
/** The longest voice note: a few sentences about one moment. */
export const REVIEW_VOICE_BYTES = 25 * 1024 * 1024;
/** The most files and links one note carries. */
export const REVIEW_NOTE_ATTACHMENTS = 8;
/** The most slides a design piece has: a carousel holds 20, a sales deck (doug-0010) runs to 40 or more. */
export const DESIGN_PAGES = 60;

export interface VideoReviewDeps {
  db: Database;
  pubsub: PubSub;
  artifacts: ArtifactDeps;
  /** Speech-to-text engines (ADR 0100), for voice notes; none: voice notes are refused. */
  engines: () => SpeechEngine[];
  /** The app's address, for the review's link the agent posts. */
  publicUrl: string;
  /** Makes a version's light copy for phones (ffmpeg on the server); absent: the apps play the original. */
  lightCopy?: LightCopy | null;
  /** The approval portal, where an approved design piece goes (doug-0010 §8); absent: the agent delivers it. */
  portal?: ApprovalPortal | null;
  /** Copies made from a file on disk (a master of up to 2 GB): the light one and the post's (doug-0012). */
  videoCopies?: VideoCopies | null;
  /** Where an editor's approved final gets its second copy (doug-0012); absent: the workspace's storage only. */
  backup?: FileBackup | null;
  /** The workspace's WhatsApp numbers, where a person is told of the changes asked of them (doug-0012 §11). */
  whatsapp?: Pick<WhatsAppDeps, "db" | "gateway" | "keyWrappers"> | null;
}

/** The job that makes a version's light copy, in the background after it arrives. */
export const REVIEW_LIGHT_JOB = "video_review.light";
/** The largest original a light copy is made from (read whole into memory). */
const LIGHT_SOURCE_BYTES = 600 * 1024 * 1024;

export interface VideoReviewVersionView {
  version: number;
  artifactId: string;
  note: string;
  /** Its light copy is ready: the apps play it unless the person asks for the original (HD). */
  light: boolean;
  /** A design version's slides (picture files), in order; [] for a video or a page edited by hand. */
  pages: string[];
  /** A design version has an editable page (`…/versions/{version}/source`). */
  source: boolean;
  /** Who made this version in the editor; null: the agent sent it. */
  editedBy: { id: string; name: string } | null;
  createdAt: string;
}

/** What a note is about, as the reviewer tagged it: a video's kinds, then a design piece's (`layout`, `image`, `type`). */
export const REVIEW_NOTE_KINDS = [
  "cut",
  "text",
  "motion",
  "sound",
  "color",
  "broll",
  "other",
  "layout",
  "image",
  "type",
] as const;
export type ReviewNoteKind = (typeof REVIEW_NOTE_KINDS)[number];
const KIND_WORDS: Record<ReviewNoteKind, string> = {
  cut: "Corte/ritmo",
  text: "Texto/legenda",
  motion: "Movimento",
  sound: "Som/trilha",
  color: "Cor",
  broll: "Cards/B-roll",
  other: "Outro",
  layout: "Layout",
  image: "Imagem",
  type: "Tipografia",
};

export interface VideoReviewNoteView {
  id: string;
  version: number;
  atMs: number | null;
  endMs: number | null;
  /** The slide of a design piece, from 1; null: a video, or the whole piece. */
  page: number | null;
  kind: ReviewNoteKind | null;
  x: number | null;
  y: number | null;
  body: string;
  attachments: schema.VideoReviewAttachment[];
  voice: boolean;
  author: { id: string; name: string } | null;
  /** The client wrote it at the approval portal (doug-0012 §12): `author` is their name, with no id. */
  fromClient: boolean;
  sent: boolean;
  createdAt: string;
}

export interface VideoReviewSummary {
  id: string;
  /** A `video`, or a `design` piece (docs/adr/doug-0010-design-review.md). */
  medium: schema.ReviewMedium;
  title: string;
  client: string;
  status: VideoReviewStatus;
  version: number;
  artifactId: string | null;
  /** A design piece's first slide, from its newest version that has pictures: what lists and cards show. */
  cover: string | null;
  agent: { id: string; name: string; handle: string } | null;
  /** A person of the team who sent it from a task (docs/adr/doug-0012-editor-delivery.md); null: an agent did. */
  sender: { id: string; name: string } | null;
  /** The task it delivers, when sent from one. */
  taskId: string | null;
  /** That task's number and title, and this video's number among its videos (doug-0012 §13). */
  taskNumber: number | null;
  taskTitle: string | null;
  taskPart: number | null;
  /** A person's review: the newest round of changes asked of them, with when they saw and answered it. */
  round: ReviewRoundView | null;
  channelId: string;
  threadId: string | null;
  openNotes: number;
  updatedAt: string;
  createdAt: string;
}

export interface VideoReviewView extends VideoReviewSummary {
  /**
   * A design piece's client at the approval portal, and what an approval means for it (doug-0010 §8). `caption`: what
   * goes up with the post, the one confirmed on approval or else its card's; known only before it went up.
   */
  portal: { client: string; afterApprove: "portal" | "direct"; caption?: string } | null;
  /** What happened at the portal after the approval; null: nothing yet. */
  delivery: Record<string, unknown> | null;
  /** A person's video: its post's cover and caption, each approved or not (doug-0012). */
  post: schema.ReviewPost;
  /** The approved original kept as the final, and its backup; null: not yet. */
  final: Record<string, unknown> | null;
  /** The task it delivers, and where its post stands at the portal (the card's stage); null: not from a task. */
  task: { id: string; number: number; title: string; stage: string | null } | null;
  /** Every round of changes asked of the person who sent it: the log (doug-0012 §10). */
  rounds: ReviewRoundView[];
  brief: string;
  links: schema.VideoReviewLink[];
  versions: VideoReviewVersionView[];
  notes: VideoReviewNoteView[];
  decidedBy: { id: string; name: string } | null;
  decidedAt: string | null;
}

export const reviewPath = (orgId: string, reviewId: string) => `/org/${orgId}/review/${reviewId}`;

/** Where a portal task's post stands, as the last pass saw its card (ADR 9001 §11); null: not a portal task. */
export function portalStageOfTask(source: unknown): string | null {
  const s = (source ?? {}) as { type?: string; synced?: { card?: { stage?: unknown } } };
  return s.type === "portal" && typeof s.synced?.card?.stage === "string" ? s.synced.card.stage : null;
}

/**
 * Where a person's video stands with the client: its own post's column, kept by the portal's tick
 * (`syncEditorStages`); until the first read, the task's card's, when that card is this video's (a task may have
 * several videos, each its own post: doug-0012 §13).
 */
export function clientStageOf(
  review: { delivery: Record<string, unknown> | null; portalCard: string | null },
  taskSource: unknown,
): string | null {
  const stage = review.delivery?.stage;
  if (typeof stage === "string") return stage;
  const card = (taskSource as { cardId?: unknown } | null)?.cardId;
  return review.portalCard && review.portalCard === card ? portalStageOfTask(taskSource) : null;
}

/** `83.4 s` → `1:23`; a note about the whole video has no time. */
export function timecode(ms: number | null): string {
  if (ms === null) return "geral";
  const s = Math.max(0, Math.floor(ms / 1000));
  const m = Math.floor(s / 60);
  const h = Math.floor(m / 60);
  const two = (n: number) => String(n).padStart(2, "0");
  // Tenths too: an editor lands a fix within a frame or two of where the reviewer paused.
  const tenth = Math.floor((Math.max(0, ms) % 1000) / 100);
  return h > 0 ? `${h}:${two(m % 60)}:${two(s % 60)}.${tenth}` : `${m}:${two(s % 60)}.${tenth}`;
}

/** Where on the picture, as the agent reads it: ` [na tela: 62% da largura, 30% da altura]`. */
function spot(x: number | null, y: number | null, on = "na tela"): string {
  if (x === null || y === null) return "";
  return ` [${on}: ${Math.round(x * 100)}% da largura, ${Math.round(y * 100)}% da altura]`;
}

/** `0:06.4` or `0:06.4–0:09.1`, as the agent reads where a note is; on a design piece `lâmina 2`. */
function where(atMs: number | null, endMs: number | null, page: number | null = null): string {
  if (page !== null) return `lâmina ${page}`;
  return endMs !== null && atMs !== null ? `${timecode(atMs)}–${timecode(endMs)}` : timecode(atMs);
}

const cleanText = (text: string) => text.replace(/\r\n?/g, "\n").trim().slice(0, REVIEW_NOTE_CHARS);

/** Links a reviewer can open: http(s) only, a short label each, at most `REVIEW_LINKS`. */
export function cleanLinks(links: unknown): schema.VideoReviewLink[] {
  if (!Array.isArray(links)) return [];
  const out: schema.VideoReviewLink[] = [];
  for (const link of links) {
    if (!link || typeof link !== "object") continue;
    const { label, url } = link as Record<string, unknown>;
    if (typeof url !== "string") continue;
    let parsed: URL;
    try {
      parsed = new URL(url.trim());
    } catch {
      continue;
    }
    if (parsed.protocol !== "https:" && parsed.protocol !== "http:") continue;
    const name = typeof label === "string" && label.trim() ? label.trim().slice(0, 60) : parsed.hostname;
    out.push({ label: name, url: parsed.toString() });
    if (out.length >= REVIEW_LINKS) break;
  }
  return out;
}

/** What a file is, by its name: the agent reads "imagem" or "vídeo", the page draws a thumbnail. */
function mediaOf(name: string): "image" | "video" | "audio" | "other" {
  if (/\.(jpe?g|png|webp|gif|heic|heif|avif|bmp|tiff?)$/i.test(name)) return "image";
  if (/\.(mp4|m4v|mov|webm|mkv|avi)$/i.test(name)) return "video";
  if (/\.(mp3|wav|m4a|aac|ogg|flac)$/i.test(name)) return "audio";
  return "other";
}

/**
 * A note's attachments as stored: files must be files of the review's conversation (the page uploads them there, so
 * the agent reaches them with `import_file`), links http(s) only.
 */
async function cleanAttachments(
  db: Database,
  orgId: string,
  channelId: string,
  raw: unknown,
): Promise<schema.VideoReviewAttachment[]> {
  if (raw === undefined || raw === null) return [];
  if (!Array.isArray(raw)) throw new ValidationError("attachments must be a list", "video_review.bad_attachment");
  if (raw.length > REVIEW_NOTE_ATTACHMENTS) {
    throw new ValidationError(`At most ${REVIEW_NOTE_ATTACHMENTS} attachments a note`, "video_review.bad_attachment");
  }
  const ids = raw
    .map((a) => (a && typeof a === "object" ? (a as Record<string, unknown>).artifactId : undefined))
    .filter((id): id is string => typeof id === "string");
  const found = ids.length
    ? await db
        .select({ id: artifacts.id, title: artifacts.title, channelId: artifacts.channelId, kind: artifacts.kind })
        .from(artifacts)
        .where(and(eq(artifacts.orgId, orgId), inArray(artifacts.id, ids), isNull(artifacts.deletedAt)))
    : [];
  const out: schema.VideoReviewAttachment[] = [];
  for (const item of raw) {
    if (!item || typeof item !== "object") continue;
    const a = item as Record<string, unknown>;
    if (typeof a.artifactId === "string") {
      const file = found.find((f) => f.id === a.artifactId);
      if (!file || file.channelId !== channelId || file.kind !== "file") {
        throw new ValidationError("That file is not in this video's conversation", "video_review.bad_attachment");
      }
      if (out.some((o) => o.type === "file" && o.artifactId === file.id)) continue;
      const name = (typeof a.name === "string" && a.name.trim() ? a.name.trim() : file.title).slice(0, 200);
      out.push({ type: "file", artifactId: file.id, name, media: mediaOf(name) });
    } else if (typeof a.url === "string") {
      const [link] = cleanLinks([{ url: a.url, label: typeof a.label === "string" ? a.label : "" }]);
      if (!link) throw new ValidationError("A link must start with http:// or https://", "video_review.bad_attachment");
      if (out.some((o) => o.type === "link" && o.url === link.url)) continue;
      out.push({ type: "link", url: link.url, label: link.label.slice(0, 120) });
    }
  }
  return out;
}

const cleanBrief = (text: string) => text.replace(/\r\n?/g, "\n").trim().slice(0, REVIEW_BRIEF_CHARS);

// ---------- the agent's side ----------

export interface SendForReviewInput {
  artifactId: string;
  title?: string;
  client?: string;
  note?: string;
  /** A review it sent before: this is its next version. */
  reviewId?: string;
  /** What was asked, and whether there was direction; kept when a next version leaves it out. */
  brief?: string;
  links?: unknown;
  /** The group the review lives in, by name; absent: this conversation (`reviewPlace`). */
  channel?: string;
}

/**
 * The agent sends a video for review, or the next version of one it sent. The file must be a video the agent sees
 * from this conversation (a file it uploaded here, or one of the Drive).
 */
export async function sendForReview(
  deps: VideoReviewDeps,
  ctx: Pick<ToolContext, "orgId" | "agentId" | "runId" | "channelId" | "threadRootId" | "triggerMessageId">,
  input: SendForReviewInput,
): Promise<{ review: VideoReviewSummary; link: string; created: boolean }> {
  const actor: ArtifactActor = {
    type: "agent",
    agentId: ctx.agentId,
    channelId: ctx.channelId,
    threadId: replyThreadOf(ctx),
    runId: ctx.runId,
  };
  const file = await storedFileOfArtifact(deps.artifacts, actor, ctx.orgId, input.artifactId);
  if (!VIDEO_NAME.test(file.name)) {
    throw new ValidationError(`${file.name} is not a video (.mp4, .mov, .m4v or .webm)`, "video_review.not_video");
  }
  const note = cleanText(input.note ?? "");
  const now = new Date();
  const created = !input.reviewId;
  let versionId: string | null = null;
  const reviewId = await deps.db.transaction(async (tx) => {
    if (input.reviewId) {
      const [review] = await tx
        .select()
        .from(videoReviews)
        .where(and(eq(videoReviews.orgId, ctx.orgId), eq(videoReviews.id, input.reviewId)))
        .for("update");
      if (!review) throw new NotFoundError("No such review");
      if (review.agentId !== ctx.agentId) {
        throw new ValidationError("This review is another agent's video", "video_review.not_yours");
      }
      const version = review.version + 1;
      const [added] = await tx
        .insert(videoReviewVersions)
        .values({ orgId: ctx.orgId, reviewId: review.id, version, artifactId: input.artifactId, note })
        .returning({ id: videoReviewVersions.id });
      versionId = added?.id ?? null;
      await tx
        .update(videoReviews)
        .set({
          version,
          status: "in_review",
          decidedBy: null,
          decidedAt: null,
          updatedAt: now,
          ...(input.title?.trim() ? { title: input.title.trim().slice(0, 200) } : {}),
          ...(input.brief?.trim() ? { brief: cleanBrief(input.brief) } : {}),
          ...(input.links !== undefined && cleanLinks(input.links).length > 0
            ? { links: cleanLinks(input.links) }
            : {}),
        })
        .where(eq(videoReviews.id, review.id));
      return review.id;
    }
    const title = input.title?.trim().slice(0, 200) || file.name;
    const place = await reviewPlace(tx as unknown as Database, ctx, input.channel);
    const [row] = await tx
      .insert(videoReviews)
      .values({
        orgId: ctx.orgId,
        agentId: ctx.agentId,
        ...place,
        title,
        client: input.client?.trim().slice(0, 80) ?? "",
        brief: cleanBrief(input.brief ?? ""),
        links: cleanLinks(input.links),
      })
      .returning({ id: videoReviews.id });
    if (!row) throw new Error("video review not inserted");
    const [added] = await tx
      .insert(videoReviewVersions)
      .values({ orgId: ctx.orgId, reviewId: row.id, version: 1, artifactId: input.artifactId, note })
      .returning({ id: videoReviewVersions.id });
    versionId = added?.id ?? null;
    return row.id;
  });
  if (versionId) await queueLight(deps, ctx.orgId, versionId);
  const [review] = await summaries(deps.db, ctx.orgId, [reviewId]);
  if (!review) throw new Error("video review not found after send");
  return { review, link: deps.publicUrl.replace(/\/+$/, "") + reviewPath(ctx.orgId, review.id), created };
}

const toolText = (value: unknown) => (typeof value === "string" ? value : "");

/**
 * Where a new review lives: who reads that conversation reviews it (§2). The run's own conversation by default; a
 * group the agent names (`channel`, e.g. the client's), at its top level. A conversation no person is in (two agents
 * talking) would hide the review from everyone: refused, saying to name the group.
 */
export async function reviewPlace(
  db: Database,
  ctx: Pick<ToolContext, "orgId" | "agentId" | "channelId" | "threadRootId" | "triggerMessageId">,
  channelName: string | undefined,
): Promise<{ channelId: string; threadId: string | null }> {
  const name = channelName?.trim().replace(/^#/, "").toLowerCase();
  if (name) {
    const [found] = await db
      .select({ id: channels.id, visibility: channels.visibility })
      .from(channels)
      .where(
        and(
          eq(channels.orgId, ctx.orgId),
          eq(channels.name, name),
          eq(channels.kind, "channel"),
          isNull(channels.archivedAt),
        ),
      );
    const member = found
      ? await db
          .select({ id: channelMembers.channelId })
          .from(channelMembers)
          .where(and(eq(channelMembers.channelId, found.id), eq(channelMembers.agentId, ctx.agentId)))
      : [];
    // Never reveal a private group the agent isn't in.
    if (!found || (found.visibility !== "public" && member.length === 0)) {
      throw new ValidationError(`No group #${name} you are in`, "video_review.no_channel");
    }
    return { channelId: found.id, threadId: found.id === ctx.channelId ? replyThreadOf(ctx) : null };
  }
  const [here] = await db
    .select({ kind: channels.kind, visibility: channels.visibility })
    .from(channels)
    .where(and(eq(channels.orgId, ctx.orgId), eq(channels.id, ctx.channelId)));
  const people = await db
    .select({ userId: channelMembers.userId })
    .from(channelMembers)
    .where(and(eq(channelMembers.channelId, ctx.channelId), sql`${channelMembers.userId} is not null`))
    .limit(1);
  const seen = (here?.kind === "channel" && here.visibility === "public") || people.length > 0;
  if (!seen) {
    throw new ValidationError(
      "No person is in this conversation, so nobody would see the review: pass `channel`, the group where the team reviews it (the client's group, e.g. lexeer-hq)",
      "video_review.nobody_here",
    );
  }
  return { channelId: ctx.channelId, threadId: replyThreadOf(ctx) };
}

/** The `channel` field both review tools take. */
export const REVIEW_CHANNEL_SCHEMA = {
  type: "string",
  maxLength: 100,
  description:
    "The group where the team reviews it, by name (e.g. `lexeer-hq`, the client's group): the review, its card and the decision live there. Leave it out to keep it in this conversation. Required when you work in a conversation with no person in it (with another agent).",
} as const;

function sendTool(deps: VideoReviewDeps): ToolDefinition {
  return {
    name: SEND_FOR_REVIEW_TOOL,
    description:
      "Send a video you edited for the team's review: they play it, pin notes to seconds of it and approve it or ask for changes; the answer comes back to this conversation as a message with every note and its timecode. `artifact_id` is the video uploaded to this conversation or the Drive (a file on your computer goes up first with `upload_file`; keep the review copy under 50 MB: H.264, 1080 wide or less, the bitrate that fits). For the next version of a video already in review (after changes were asked), pass its `review_id`: never open a second review for the same video. `note` says in one or two lines what it is or what changed. Then post the link this answers with to the people who review, in your reply.",
    scope: "",
    inputSchema: {
      type: "object",
      properties: {
        artifact_id: { type: "string", minLength: 36, maxLength: 36 },
        title: { type: "string", maxLength: 200, description: "What the video is, as the team would call it." },
        client: { type: "string", maxLength: 80, description: "The client it is for (e.g. Alliance)." },
        note: { type: "string", maxLength: 2000 },
        review_id: { type: "string", minLength: 36, maxLength: 36 },
        brief: BRIEF_SCHEMA,
        links: LINKS_SCHEMA,
        channel: REVIEW_CHANNEL_SCHEMA,
      },
      required: ["artifact_id"],
      additionalProperties: false,
    },
    describe: (input) => ({ title: `Send "${toolText(input.title) || "a video"}" for review` }),
    async execute(input, ctx): Promise<ToolOutput> {
      try {
        const sent = await sendForReview(deps, ctx, {
          artifactId: toolText(input.artifact_id),
          title: toolText(input.title) || undefined,
          client: toolText(input.client) || undefined,
          note: toolText(input.note) || undefined,
          reviewId: toolText(input.review_id) || undefined,
          brief: toolText(input.brief) || undefined,
          links: input.links,
          channel: toolText(input.channel) || undefined,
        });
        return {
          content:
            `${sent.created ? "In review" : `Version ${sent.review.version} in review`}: "${sent.review.title}" ` +
            `(review_id ${sent.review.id}). Link: ${sent.link}`,
          data: { reviewId: sent.review.id, version: sent.review.version },
        };
      } catch (error) {
        if (error instanceof ValidationError || error instanceof NotFoundError) {
          return { content: `Not sent for review: ${error.message}`, isError: true };
        }
        throw error;
      }
    },
  };
}

/** The agent sets or corrects the brief and links of a video it sent, without a new version. */
export async function setReviewBrief(
  deps: Pick<VideoReviewDeps, "db">,
  ctx: Pick<ToolContext, "orgId" | "agentId">,
  input: { reviewId: string; brief?: string; links?: unknown },
): Promise<VideoReviewSummary> {
  const [review] = await deps.db
    .select()
    .from(videoReviews)
    .where(and(eq(videoReviews.orgId, ctx.orgId), eq(videoReviews.id, input.reviewId)));
  if (!review) throw new NotFoundError("No such review");
  if (review.agentId !== ctx.agentId) {
    throw new ValidationError("This review is another agent's video", "video_review.not_yours");
  }
  await deps.db
    .update(videoReviews)
    .set({
      ...(input.brief !== undefined ? { brief: cleanBrief(input.brief) } : {}),
      ...(input.links !== undefined ? { links: cleanLinks(input.links) } : {}),
    })
    .where(eq(videoReviews.id, review.id));
  const [summary] = await summaries(deps.db, ctx.orgId, [review.id]);
  if (!summary) throw new NotFoundError("No such review");
  return summary;
}

const BRIEF_SCHEMA = {
  type: "string",
  maxLength: REVIEW_BRIEF_CHARS,
  description:
    "What was asked of you, shown to the reviewer under the video: the request in the asker's words (who asked, where), the direction given (style, length, format, references) or, when there was none, say so and what you decided from (e.g. 'No direction: same look as the approved reel 1').",
} as const;
const LINKS_SCHEMA = {
  type: "array",
  maxItems: REVIEW_LINKS,
  description:
    "Where the work comes from and goes, as buttons under the video: the task (Asana), the footage (Frame.io), the delivery folder once it exists.",
  items: {
    type: "object",
    properties: {
      label: { type: "string", maxLength: 60, description: "e.g. 'Asana task', 'Footage (Frame.io)'." },
      url: { type: "string", maxLength: 2000 },
    },
    required: ["url"],
    additionalProperties: false,
  },
} as const;

function briefTool(deps: VideoReviewDeps): ToolDefinition {
  return {
    name: SET_REVIEW_BRIEF_TOOL,
    description:
      "Set or correct what the reviewer reads under a video you sent for review: the brief (what was asked and whether there was direction) and the links (task, footage, delivery). Each field you pass replaces the old one; leave one out to keep it.",
    scope: "",
    inputSchema: {
      type: "object",
      properties: {
        review_id: { type: "string", minLength: 36, maxLength: 36 },
        brief: BRIEF_SCHEMA,
        links: LINKS_SCHEMA,
      },
      required: ["review_id"],
      additionalProperties: false,
    },
    describe: () => ({ title: "Update a review's brief" }),
    async execute(input, ctx): Promise<ToolOutput> {
      try {
        const review = await setReviewBrief(deps, ctx, {
          reviewId: toolText(input.review_id),
          brief: typeof input.brief === "string" ? input.brief : undefined,
          links: input.links,
        });
        return { content: `Brief updated on "${review.title}" (review_id ${review.id}).` };
      } catch (error) {
        if (error instanceof ValidationError || error instanceof NotFoundError) {
          return { content: `Not updated: ${error.message}`, isError: true };
        }
        throw error;
      }
    },
  };
}

/** `send_for_review` and `set_review_brief`, for agents in a run (a routine's background run sends nothing). */
export function createVideoReviewToolSource(deps: VideoReviewDeps | null): ToolSource {
  return {
    name: "video-review",
    async tools(ctx) {
      if (!deps || !ctx.runId || ctx.background) return [];
      return [sendTool(deps), briefTool(deps)];
    },
  };
}

// ---------- reading ----------

async function summaries(db: Database, orgId: string, ids?: string[]): Promise<VideoReviewSummary[]> {
  const rows = await db
    .select({
      review: videoReviews,
      agentName: agents.name,
      agentHandle: agents.handle,
      senderName: users.name,
      taskNumber: schema.issues.number,
      taskTitle: schema.issues.title,
    })
    .from(videoReviews)
    .leftJoin(agents, eq(agents.id, videoReviews.agentId))
    .leftJoin(users, eq(users.id, videoReviews.senderUserId))
    .leftJoin(schema.issues, eq(schema.issues.id, videoReviews.taskId))
    .where(and(eq(videoReviews.orgId, orgId), ids ? inArray(videoReviews.id, ids) : undefined))
    .orderBy(desc(videoReviews.updatedAt))
    .limit(ids ? ids.length : 200);
  if (rows.length === 0) return [];
  const reviewIds = rows.map((r) => r.review.id);
  const versions = await db
    .select({
      reviewId: videoReviewVersions.reviewId,
      version: videoReviewVersions.version,
      artifactId: videoReviewVersions.artifactId,
      pages: videoReviewVersions.pages,
    })
    .from(videoReviewVersions)
    .where(inArray(videoReviewVersions.reviewId, reviewIds));
  const coverOf = (reviewId: string) =>
    versions
      .filter((v) => v.reviewId === reviewId && (v.pages ?? []).length > 0)
      .sort((a, b) => b.version - a.version)[0]?.pages?.[0]?.artifactId ?? null;
  const open = await db
    .select({ reviewId: videoReviewNotes.reviewId, version: videoReviewNotes.version })
    .from(videoReviewNotes)
    .where(and(inArray(videoReviewNotes.reviewId, reviewIds), isNull(videoReviewNotes.sentAt)));
  const rounds = await latestRounds(
    db,
    rows.filter((r) => r.review.senderUserId).map((r) => r.review.id),
  );
  return rows.map(({ review, agentName, agentHandle, senderName, taskNumber, taskTitle }) => ({
    id: review.id,
    medium: review.medium === "design" ? "design" : "video",
    title: review.title,
    client: review.client,
    status: review.status,
    version: review.version,
    artifactId: versions.find((v) => v.reviewId === review.id && v.version === review.version)?.artifactId ?? null,
    cover: review.medium === "design" ? coverOf(review.id) : null,
    agent: review.agentId && agentName ? { id: review.agentId, name: agentName, handle: agentHandle ?? "" } : null,
    sender: review.senderUserId ? { id: review.senderUserId, name: senderName ?? "" } : null,
    taskId: review.taskId,
    taskNumber: review.taskId ? (taskNumber ?? null) : null,
    taskTitle: review.taskId ? (taskTitle ?? null) : null,
    taskPart: review.taskId ? (review.taskPart ?? 1) : null,
    round: rounds.get(review.id) ?? null,
    channelId: review.channelId,
    threadId: review.threadId,
    openNotes: open.filter((n) => n.reviewId === review.id && n.version === review.version).length,
    updatedAt: review.updatedAt.toISOString(),
    createdAt: review.createdAt.toISOString(),
  }));
}

/**
 * Whether this person sees the workspace's reviews: every member does, whatever conversation a piece came from, a DM
 * included (docs/adr/doug-0014-review-for-everyone.md). A blocked account or a suspended workspace sees none.
 */
async function sees(db: Database, userId: string, orgId: string) {
  const membership = await getMembership(db, userId, orgId);
  return membership !== null && readRefusal(membership.standing) === null;
}

/** The reviews this person may see (every one of the workspace, for a member), newest first. */
export async function listVideoReviews(
  deps: Pick<VideoReviewDeps, "db">,
  userId: string,
  orgId: string,
): Promise<VideoReviewSummary[]> {
  if (!(await sees(deps.db, userId, orgId))) return [];
  return summaries(deps.db, orgId);
}

async function requireReview(db: Database, userId: string, orgId: string, reviewId: string) {
  const [review] = await db
    .select()
    .from(videoReviews)
    .where(and(eq(videoReviews.orgId, orgId), eq(videoReviews.id, reviewId)));
  if (!review || !(await sees(db, userId, orgId))) throw new NotFoundError("No such review");
  return review;
}

/**
 * Where this person's decision is said: the review's conversation, as them. One who doesn't read it (a DM between a
 * teammate and the agent, a private channel) still decides there, since the agent's work and files live there: the
 * workspace membership stands in for the conversation's (doug-0014).
 */
async function decisionPlace(db: Database, userId: string, orgId: string, channelId: string) {
  try {
    await requireChannelAccess(db, userId, orgId, channelId);
    return undefined;
  } catch (error) {
    if (!(error instanceof NotFoundError) && (error as { name?: string }).name !== "ForbiddenError") throw error;
  }
  const membership = await requireActiveMembership(db, userId, orgId);
  const [channel] = await db
    .select()
    .from(channels)
    .where(and(eq(channels.orgId, orgId), eq(channels.id, channelId)));
  if (!channel || channel.archivedAt) {
    throw new ValidationError("The conversation this piece came from was archived", "video_review.no_conversation");
  }
  return { channel, membership, workspace: membership };
}

export async function getVideoReview(
  deps: Pick<VideoReviewDeps, "db" | "lightCopy" | "portal">,
  userId: string,
  orgId: string,
  reviewId: string,
): Promise<VideoReviewView> {
  const review = await requireReview(deps.db, userId, orgId, reviewId);
  // The person the changes are for opened them: the log keeps the first time (doug-0012 §10).
  if (review.senderUserId === userId) await seeRounds(deps.db, review.id, userId);
  const [summary] = await summaries(deps.db, orgId, [review.id]);
  if (!summary) throw new NotFoundError("No such review");
  const versions = await deps.db
    .select()
    .from(videoReviewVersions)
    .where(eq(videoReviewVersions.reviewId, review.id))
    .orderBy(asc(videoReviewVersions.version));
  // A version sent before light copies existed gets one the first time it's opened.
  if (review.medium !== "design") {
    for (const v of versions) if (v.lightState === "") await queueLight(deps, orgId, v.id);
  }
  const editorIds = [...new Set(versions.flatMap((v) => (v.editedBy ? [v.editedBy] : [])))];
  const editors = editorIds.length
    ? await deps.db.select({ id: users.id, name: users.name }).from(users).where(inArray(users.id, editorIds))
    : [];
  const notes = await deps.db
    .select({ note: videoReviewNotes, authorName: users.name })
    .from(videoReviewNotes)
    .leftJoin(users, eq(users.id, videoReviewNotes.authorUserId))
    .where(eq(videoReviewNotes.reviewId, review.id))
    .orderBy(
      asc(videoReviewNotes.version),
      sql`${videoReviewNotes.page} asc nulls first`,
      sql`${videoReviewNotes.atMs} asc nulls first`,
      asc(videoReviewNotes.createdAt),
    );
  const [decider] = review.decidedBy
    ? await deps.db.select({ id: users.id, name: users.name }).from(users).where(eq(users.id, review.decidedBy))
    : [];
  const portalSetting = review.portalClient
    ? await deps.db
        .select({ afterApprove: schema.portalClientSettings.afterApprove })
        .from(schema.portalClientSettings)
        .where(
          and(
            eq(schema.portalClientSettings.orgId, orgId),
            eq(schema.portalClientSettings.client, review.portalClient),
          ),
        )
    : [];
  const [task] = review.taskId
    ? await deps.db
        .select({
          id: schema.issues.id,
          number: schema.issues.number,
          title: schema.issues.title,
          source: schema.issues.source,
        })
        .from(schema.issues)
        .where(and(eq(schema.issues.orgId, orgId), eq(schema.issues.id, review.taskId)))
    : [];
  return {
    ...summary,
    post: review.post ?? {},
    final: review.final ?? null,
    task: task
      ? {
          id: task.id,
          number: task.number,
          title: task.title,
          stage: clientStageOf(review, task.source),
        }
      : null,
    rounds: review.senderUserId ? await roundsOf(deps.db, review.id) : [],
    portal: review.portalClient
      ? {
          client: review.portalClient,
          afterApprove: portalSetting[0]?.afterApprove === "direct" ? "direct" : "portal",
          // The caption that goes up with it, while it can still be changed: read from the card only then.
          ...(review.status !== "approved" || !review.delivery
            ? { caption: review.post?.caption || (await cardCaptionOf(deps.db, deps.portal, review)) }
            : {}),
        }
      : null,
    delivery: review.delivery ?? null,
    brief: review.brief,
    links: review.links ?? [],
    versions: versions.map((v) => ({
      version: v.version,
      artifactId: v.artifactId,
      note: v.note,
      light: v.lightState === "ready",
      pages: (v.pages ?? []).map((p) => p.artifactId),
      source: v.sourceArtifactId !== null,
      editedBy: v.editedBy ? (editors.find((e) => e.id === v.editedBy) ?? { id: v.editedBy, name: "" }) : null,
      createdAt: v.createdAt.toISOString(),
    })),
    notes: notes.map(({ note, authorName }) => ({
      id: note.id,
      version: note.version,
      atMs: note.atMs,
      endMs: note.endMs,
      page: note.page,
      kind: (note.kind as ReviewNoteKind | null) ?? null,
      x: note.x,
      y: note.y,
      body: note.body,
      attachments: note.attachments ?? [],
      voice: note.voice,
      author: note.authorUserId
        ? { id: note.authorUserId, name: authorName ?? "" }
        : note.authorName
          ? { id: "", name: note.authorName }
          : null,
      fromClient: note.fromClient,
      sent: note.sentAt !== null,
      createdAt: note.createdAt.toISOString(),
    })),
    decidedBy: decider ?? null,
    decidedAt: review.decidedAt?.toISOString() ?? null,
  };
}

// ---------- notes ----------

export interface ReviewNoteInput {
  version: number;
  atMs: number | null;
  /** Where the stretch ends; only with `atMs`, and after it. */
  endMs?: number | null;
  /** A design piece's slide, from 1; null or absent: the whole piece. Only on a design piece. */
  page?: number | null;
  kind?: ReviewNoteKind | null;
  /** Where on the picture, as fractions (0–1) of its width and height. */
  x?: number | null;
  y?: number | null;
  /** Files of the review's conversation (`{ artifactId, name }`) and links (`{ url, label }`). */
  attachments?: unknown;
  body: string;
}

async function writeNote(
  deps: Pick<VideoReviewDeps, "db" | "pubsub">,
  userId: string,
  orgId: string,
  reviewId: string,
  input: ReviewNoteInput & { voice: boolean },
): Promise<VideoReviewNoteView> {
  const review = await requireReview(deps.db, userId, orgId, reviewId);
  const attachments = await cleanAttachments(deps.db, orgId, review.channelId, input.attachments);
  const body = cleanText(input.body);
  // A dropped photo or a B-roll link says enough on its own.
  if (!body && attachments.length === 0) throw new ValidationError("The note is empty", "video_review.empty_note");
  if (!Number.isInteger(input.version) || input.version < 1 || input.version > review.version) {
    throw new ValidationError("No such version", "video_review.bad_version");
  }
  const design = review.medium === "design";
  const page = design && typeof input.page === "number" ? input.page : null;
  if (page !== null) {
    const [v] = await deps.db
      .select({ pages: videoReviewVersions.pages })
      .from(videoReviewVersions)
      .where(and(eq(videoReviewVersions.reviewId, review.id), eq(videoReviewVersions.version, input.version)));
    // A page edited by hand has no pictures: the apps count its slides, up to the most a piece has.
    const most = (v?.pages ?? []).length || DESIGN_PAGES;
    if (!Number.isInteger(page) || page < 1 || page > most) {
      throw new ValidationError("No such slide", "video_review.bad_page");
    }
  }
  // A design piece has no time: a note is on a slide, or about the whole piece.
  const atMs = design || input.atMs === null ? null : Math.max(0, Math.round(input.atMs));
  const end = input.endMs === null || input.endMs === undefined ? null : Math.round(input.endMs);
  if (end !== null && (atMs === null || end <= atMs)) {
    throw new ValidationError("A stretch ends after it starts", "video_review.bad_range");
  }
  const kind = input.kind ?? null;
  const frac = (v: number | null | undefined) =>
    typeof v === "number" && Number.isFinite(v) ? Math.min(1, Math.max(0, v)) : null;
  const x = frac(input.x);
  const y = x === null ? null : frac(input.y);
  if (kind !== null && !REVIEW_NOTE_KINDS.includes(kind)) {
    throw new ValidationError("No such kind of note", "video_review.bad_kind");
  }
  const [row] = await deps.db
    .insert(videoReviewNotes)
    .values({
      orgId,
      reviewId: review.id,
      version: input.version,
      atMs,
      endMs: design ? null : end,
      page,
      kind,
      x: y === null ? null : x,
      y,
      body,
      attachments,
      voice: input.voice,
      authorUserId: userId,
    })
    .returning();
  if (!row) throw new Error("note not inserted");
  await deps.db.update(videoReviews).set({ updatedAt: new Date() }).where(eq(videoReviews.id, review.id));
  const [author] = await deps.db.select({ id: users.id, name: users.name }).from(users).where(eq(users.id, userId));
  return {
    id: row.id,
    version: row.version,
    atMs: row.atMs,
    endMs: row.endMs,
    page: row.page,
    kind: (row.kind as ReviewNoteKind | null) ?? null,
    x: row.x,
    y: row.y,
    body: row.body,
    attachments: row.attachments ?? [],
    voice: row.voice,
    author: author ?? null,
    fromClient: false,
    sent: false,
    createdAt: row.createdAt.toISOString(),
  };
}

export const addReviewNote = (
  deps: Pick<VideoReviewDeps, "db" | "pubsub">,
  userId: string,
  orgId: string,
  reviewId: string,
  input: ReviewNoteInput,
) => writeNote(deps, userId, orgId, reviewId, { ...input, voice: false });

/** A note said aloud: transcribed now, kept as its words (the recording itself is not kept). */
export async function addVoiceReviewNote(
  deps: Pick<VideoReviewDeps, "db" | "pubsub" | "engines">,
  userId: string,
  orgId: string,
  reviewId: string,
  input: {
    version: number;
    atMs: number | null;
    endMs?: number | null;
    page?: number | null;
    kind?: ReviewNoteKind | null;
    x?: number | null;
    y?: number | null;
    attachments?: unknown;
    audio: Uint8Array;
    contentType: string;
    language: string | null;
  },
): Promise<VideoReviewNoteView> {
  await requireReview(deps.db, userId, orgId, reviewId);
  const engines = deps.engines();
  if (engines.length === 0) {
    throw new ValidationError("This server has no speech-to-text set up: type the note", "video_review.no_speech");
  }
  if (input.audio.byteLength === 0) throw new ValidationError("The recording is empty", "video_review.empty_note");
  if (input.audio.byteLength > REVIEW_VOICE_BYTES) {
    throw new ValidationError("The recording is too long for one note", "video_review.too_large");
  }
  const words = await firstWords(
    engines,
    {
      audio: input.audio,
      contentType: input.contentType.replace(/^video\//, "audio/") || "audio/mp4",
      language: input.language,
      terms: [],
      orgId,
    },
    20_000,
  );
  const text = words?.text?.trim();
  if (!text) throw new ValidationError("Nothing could be made out in the recording", "video_review.no_words");
  return writeNote(deps, userId, orgId, reviewId, {
    version: input.version,
    atMs: input.atMs,
    endMs: input.endMs ?? null,
    page: input.page ?? null,
    kind: input.kind ?? null,
    x: input.x ?? null,
    y: input.y ?? null,
    attachments: input.attachments,
    body: text,
    voice: true,
  });
}

/** Its author takes back a note not yet sent. */
export async function deleteReviewNote(
  deps: Pick<VideoReviewDeps, "db" | "pubsub">,
  userId: string,
  orgId: string,
  reviewId: string,
  noteId: string,
): Promise<void> {
  const review = await requireReview(deps.db, userId, orgId, reviewId);
  const [note] = await deps.db
    .select()
    .from(videoReviewNotes)
    .where(and(eq(videoReviewNotes.reviewId, review.id), eq(videoReviewNotes.id, noteId)));
  if (!note) throw new NotFoundError("No such note");
  if (note.authorUserId !== userId)
    throw new ValidationError("Only who wrote a note removes it", "video_review.not_author");
  if (note.sentAt) throw new ConflictError("This note was already sent to the agent", "video_review.sent");
  await deps.db.delete(videoReviewNotes).where(eq(videoReviewNotes.id, note.id));
}

// ---------- the decision ----------

export type ReviewDecision = "approve" | "changes";

const MEDIA_WORDS = { image: "imagem", video: "vídeo", audio: "áudio", other: "arquivo" } as const;

/** A design version as the agent reads it in a decision: its editable page, and who edited it by hand. */
export interface DesignDecisionFacts {
  /** The version's editable page (an HTML file of the conversation); null: pictures only. */
  sourceArtifactId: string | null;
  /** A person made this version in the editor: the agent renders its slides from the page before delivering. */
  editedBy: string | null;
  /**
   * The portal's client and what an approval means for it, when known: the server sends the slides itself
   * (`delivered`), or the agent does, when the version has no pictures (made by hand).
   */
  portal?: { client: string; afterApprove: "portal" | "direct"; delivered: boolean } | null;
}

/** What the agent reads: the decision and every note of the version, by time (on a design piece, by slide). */
export function decisionMessage(input: {
  handle: string;
  title: string;
  version: number;
  reviewId: string;
  decision: ReviewDecision;
  /** A design piece's facts; absent: a video. */
  design?: DesignDecisionFacts;
  notes: {
    atMs: number | null;
    endMs?: number | null;
    page?: number | null;
    kind?: string | null;
    x?: number | null;
    y?: number | null;
    body: string;
    attachments?: schema.VideoReviewAttachment[];
    author: string;
  }[];
  message: string;
}): string {
  const lines: string[] = [];
  const head = `@${input.handle}`;
  const design = input.design;
  const tool = design ? DESIGN_TOOL_NAME : SEND_FOR_REVIEW_TOOL;
  if (input.decision === "approve") {
    lines.push(`${head} Aprovado: «${input.title}» V${input.version} (review_id ${input.reviewId}).`);
  } else {
    lines.push(
      `${head} Ajustes em «${input.title}» V${input.version} (review_id ${input.reviewId}). Faça a V${input.version + 1} e mande com ${tool} e esse review_id.`,
    );
  }
  const portal = design?.portal;
  if (input.decision === "approve" && portal) {
    const where =
      portal.afterApprove === "direct"
        ? `aprovado direto (sem aprovação do cliente), sem data: quem agenda é a equipe`
        : `para a aprovação do cliente`;
    lines.push(
      "",
      portal.delivered
        ? `O DougBot já está subindo esta versão ao portal (${portal.client}), ${where}. Não suba você nem agende (agendar é só da equipe, no Portal): o resultado aparece nesta conversa.`
        : `Esta versão não tem as lâminas em imagem: exporte os PNGs do HTML e suba ao portal (${portal.client}) com send_for_approval e review_id ${input.reviewId}, ${where}${
            portal.afterApprove === "direct" ? " (sem data; agendar é só da equipe, no Portal)" : ""
          }.`,
    );
  }
  if (design?.editedBy) {
    // A person moved, rewrote or swapped things by hand: that page is now the piece, not the agent's last one.
    lines.push(
      "",
      `${design.editedBy} editou a V${input.version} à mão no editor. Ela é a base daqui em diante: traga o HTML com import_file artifact_id ${design.sourceArtifactId}, ${
        input.decision === "approve"
          ? "exporte as lâminas dele e entregue a partir delas."
          : "faça os ajustes em cima dele, sem desfazer o que foi mexido."
      }`,
    );
  } else if (design?.sourceArtifactId) {
    lines.push("", `HTML desta versão: artifact_id ${design.sourceArtifactId}.`);
  }
  if (input.message.trim()) lines.push("", input.message.trim());
  // Every review teaches: the agent writes down what holds beyond this piece before it moves on.
  const piece = design ? "nesta peça" : "neste vídeo";
  const next = design ? "para as próximas peças" : "para os próximos vídeos";
  lines.push(
    "",
    input.decision === "approve"
      ? `Antes de entregar: rode a skill self-improve-skill (se você tiver) e grave na sua skill e na sua memória o que funcionou ${piece}.`
      : `Antes da próxima versão: rode a skill self-improve-skill (se você tiver) e grave na sua skill e na sua memória o que destas notas vale ${next}.`,
  );
  if (input.notes.length > 0) {
    lines.push("", "Notas:");
    for (const note of input.notes) {
      const body = note.body.replace(/\n+/g, " ").trim() || "(sem texto: veja o anexo)";
      lines.push(
        `- [${where(note.atMs, note.endMs ?? null, design ? (note.page ?? null) : null)}]${
          note.kind && note.kind in KIND_WORDS ? ` ${KIND_WORDS[note.kind as ReviewNoteKind]}:` : ""
        } ${body}${spot(note.x ?? null, note.y ?? null, design ? "na lâmina" : "na tela")}${note.author ? ` (${note.author})` : ""}`,
      );
      for (const a of note.attachments ?? []) {
        lines.push(
          a.type === "file"
            ? `  - Anexo (${MEDIA_WORDS[a.media]}): ${a.name} — traga com import_file artifact_id ${a.artifactId} e use neste ponto como a nota pede`
            : `  - Link: ${a.label && a.label !== a.url ? `${a.label} — ` : ""}${a.url} — baixe e use neste ponto como a nota pede`,
        );
      }
    }
  }
  return lines.join("\n");
}

/**
 * Approves the newest version or asks for changes to it: the notes not yet sent go to the agent in one message from
 * this person, in the conversation the video came from, which starts the agent's work on it.
 */
export async function decideVideoReview(
  deps: Pick<VideoReviewDeps, "db" | "pubsub" | "portal">,
  userId: string,
  orgId: string,
  reviewId: string,
  input: { decision: ReviewDecision; message?: string; caption?: string },
): Promise<VideoReviewSummary> {
  const review = await requireReview(deps.db, userId, orgId, reviewId);
  if (review.status === "approved" && input.decision === "approve") {
    throw new ConflictError("This version is already approved", "video_review.decided");
  }
  // A video a person of the team sent from a task: the decision goes back to them, no agent (doug-0012).
  if (review.senderUserId) {
    const decided = await decidePersonVideo(deps, userId, review, input);
    if (input.decision === "approve") await putApprovedOnCard(deps, orgId, review.id, userId);
    return decided;
  }
  if (!review.agentId) throw new ValidationError("The agent that made this video was removed", "video_review.no_agent");
  const [agent] = await deps.db
    .select({ handle: agents.handle, archivedAt: agents.archivedAt })
    .from(agents)
    .where(and(eq(agents.orgId, orgId), eq(agents.id, review.agentId)));
  if (!agent || agent.archivedAt) {
    throw new ValidationError("The agent that made this video was removed", "video_review.no_agent");
  }
  const notes = await deps.db
    .select({
      id: videoReviewNotes.id,
      atMs: videoReviewNotes.atMs,
      endMs: videoReviewNotes.endMs,
      page: videoReviewNotes.page,
      kind: videoReviewNotes.kind,
      x: videoReviewNotes.x,
      y: videoReviewNotes.y,
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
  const message = cleanText(input.message ?? "");
  let design: DesignDecisionFacts | undefined;
  if (review.medium === "design") {
    const [v] = await deps.db
      .select({ source: videoReviewVersions.sourceArtifactId, editedBy: users.name })
      .from(videoReviewVersions)
      .leftJoin(users, eq(users.id, videoReviewVersions.editedBy))
      .where(and(eq(videoReviewVersions.reviewId, review.id), eq(videoReviewVersions.version, review.version)));
    const [pics] = await deps.db
      .select({ pages: videoReviewVersions.pages })
      .from(videoReviewVersions)
      .where(and(eq(videoReviewVersions.reviewId, review.id), eq(videoReviewVersions.version, review.version)));
    const afterApprove = review.portalClient ? await afterApproveOf(deps.db, orgId, review.portalClient) : null;
    design = {
      sourceArtifactId: v?.source ?? null,
      editedBy: v?.source ? (v.editedBy ?? null) : null,
      portal:
        // No portal on this server: the agent delivers as it always did, nothing said about it here.
        review.portalClient && afterApprove && deps.portal
          ? { client: review.portalClient, afterApprove, delivered: (pics?.pages ?? []).length > 0 }
          : null,
    };
  }
  if (input.decision === "changes" && notes.length === 0 && !message) {
    throw new ValidationError("Say what to change: add a note first", "video_review.nothing_to_change");
  }
  // Before anything changes: a conversation gone refuses the decision with the review as it was.
  const place = await decisionPlace(deps.db, userId, orgId, review.channelId);
  const now = new Date();
  await deps.db
    .update(videoReviews)
    .set({
      status: input.decision === "approve" ? "approved" : "changes",
      decidedBy: userId,
      decidedAt: now,
      updatedAt: now,
    })
    .where(eq(videoReviews.id, review.id));
  if (notes.length > 0) {
    await deps.db
      .update(videoReviewNotes)
      .set({ sentAt: now })
      .where(
        inArray(
          videoReviewNotes.id,
          notes.map((n) => n.id),
        ),
      );
  }
  await postPersonMessage(
    deps,
    userId,
    orgId,
    review.channelId,
    {
      body: decisionMessage({
        handle: agent.handle,
        title: review.title,
        version: review.version,
        reviewId: review.id,
        decision: input.decision,
        design,
        notes: notes.map((n) => ({
          atMs: n.atMs,
          endMs: n.endMs,
          page: n.page,
          kind: n.kind,
          x: n.x,
          y: n.y,
          body: n.body,
          attachments: n.attachments ?? [],
          author: n.author ?? "",
        })),
        message,
      }),
      threadId: review.threadId,
      meta: { videoReview: { id: review.id, version: review.version, decision: input.decision } },
    },
    { place },
  );
  // An approved design piece goes to its client's portal by code (doug-0010 §8), after the message above.
  if (input.decision === "approve" && design?.portal?.delivered) {
    // The caption the person confirmed beside "Aprovar" goes up with the slides (an empty one: the card's).
    const caption = (input.caption ?? "").replace(/\r\n?/g, "\n").trim().slice(0, POST_CAPTION_CHARS);
    await deps.db
      .update(videoReviews)
      .set({ delivery: null, post: { ...(review.post ?? {}), caption: caption || undefined } })
      .where(eq(videoReviews.id, review.id));
    await queueDesignDelivery(deps.db, orgId, review.id, review.version);
  }
  if (input.decision === "approve") await putApprovedOnCard(deps, orgId, review.id, userId);
  const [summary] = await summaries(deps.db, orgId, [review.id]);
  if (!summary) throw new NotFoundError("No such review");
  return summary;
}

/** The approved version goes on its post's card at the portal (doug-0019); a failure there never undoes the approval. */
async function putApprovedOnCard(
  deps: Pick<VideoReviewDeps, "db" | "portal">,
  orgId: string,
  reviewId: string,
  userId: string,
) {
  await approvedOnCard(deps.db, deps.portal, orgId, reviewId, userId).catch(() => {});
}

// ---------- the light copy for phones ----------

/** Asks for a version's light copy, once: only where this server can make one. */
async function queueLight(
  deps: Pick<VideoReviewDeps, "db" | "lightCopy" | "videoCopies">,
  orgId: string,
  versionId: string,
) {
  if (!deps.lightCopy && !deps.videoCopies) return;
  const [asked] = await deps.db
    .update(videoReviewVersions)
    .set({ lightState: "pending" })
    .where(and(eq(videoReviewVersions.id, versionId), eq(videoReviewVersions.lightState, "")))
    .returning({ id: videoReviewVersions.id });
  if (asked) await enqueue(deps.db, { orgId, kind: REVIEW_LIGHT_JOB, payload: { versionId }, maxAttempts: 3 });
}

/** The stored bytes of a version's video file (its newest file version). */
async function versionFile(deps: Pick<VideoReviewDeps, "db" | "artifacts">, orgId: string, artifactId: string) {
  const [row] = await deps.db
    .select({
      blobKey: artifactVersions.blobKey,
      storageConfigId: artifactVersions.storageConfigId,
      size: artifactVersions.size,
    })
    .from(artifacts)
    .innerJoin(
      artifactVersions,
      and(eq(artifactVersions.artifactId, artifacts.id), eq(artifactVersions.version, artifacts.currentVersion)),
    )
    .where(and(eq(artifacts.orgId, orgId), eq(artifacts.id, artifactId), isNull(artifacts.deletedAt)));
  if (!row) return null;
  const store = await deps.artifacts.blobs.forConfig(orgId, row.storageConfigId);
  return { ...row, store };
}

/**
 * Job `video_review.light`: the version's light copy, kept beside its bytes. One that comes out no smaller than the
 * original isn't kept (`none`): the apps play the original.
 */
export async function makeLightCopy(
  deps: Pick<VideoReviewDeps, "db" | "artifacts" | "lightCopy" | "videoCopies">,
  versionId: string,
  options: { finalAttempt: boolean },
): Promise<void> {
  const [v] = await deps.db.select().from(videoReviewVersions).where(eq(videoReviewVersions.id, versionId));
  if (!v || v.lightState === "ready" || v.lightState === "none") return;
  const settle = (lightState: string) =>
    deps.db.update(videoReviewVersions).set({ lightState }).where(eq(videoReviewVersions.id, versionId));
  const file = await versionFile(deps, v.orgId, v.artifactId);
  // An editor's master (up to 2 GB) is copied from disk, never whole in memory (doug-0012).
  const copies = deps.videoCopies;
  if (file && copies && (file.size > LIGHT_SOURCE_BYTES || !deps.lightCopy)) {
    try {
      await onDisk(file.store, file.blobKey, async (input, dir) => {
        const output = join(dir, "light.mp4");
        await copies("light", input, output);
        await putFromDisk(file.store, lightKey(file.blobKey), output);
      });
      await settle("ready");
    } catch (error) {
      if (options.finalAttempt) await settle("failed");
      throw error;
    }
    return;
  }
  if (!file || !deps.lightCopy || file.size > LIGHT_SOURCE_BYTES) {
    await settle("none");
    return;
  }
  try {
    const object = await file.store.get(file.blobKey);
    if (!object) {
      await settle("none");
      return;
    }
    const light = await deps.lightCopy(object.body);
    if (light.byteLength === 0 || light.byteLength >= object.body.byteLength * 0.9) {
      await settle("none");
      return;
    }
    await file.store.put(lightKey(file.blobKey), light, { contentType: "video/mp4" });
    await settle("ready");
  } catch (error) {
    // Asked again by the job's next attempt; the last one leaves the original to be played.
    if (options.finalAttempt) await settle("failed");
    throw error;
  }
}

/**
 * A version's video for the player, after the same check as the review itself: its light copy when there is one
 * (unless `original`), else the file. A light copy that went missing (the files moved) is made again.
 */
export async function reviewVideo(
  deps: Pick<VideoReviewDeps, "db" | "artifacts" | "lightCopy" | "videoCopies">,
  userId: string,
  orgId: string,
  reviewId: string,
  version: number,
  options: { original?: boolean } = {},
): Promise<{ body: Uint8Array; contentType: string; light: boolean } | { redirect: string }> {
  const review = await requireReview(deps.db, userId, orgId, reviewId);
  const [v] = await deps.db
    .select()
    .from(videoReviewVersions)
    .where(and(eq(videoReviewVersions.reviewId, review.id), eq(videoReviewVersions.version, version)));
  if (!v) throw new NotFoundError("No such version");
  const file = await versionFile(deps, orgId, v.artifactId);
  if (!file) throw new NotFoundError("The video of this version was removed");
  if (!options.original && v.lightState === "ready") {
    const light = await file.store.get(lightKey(file.blobKey)).catch(() => null);
    if (light) return { body: light.body, contentType: "video/mp4", light: true };
    await deps.db.update(videoReviewVersions).set({ lightState: "" }).where(eq(videoReviewVersions.id, v.id));
    await queueLight(deps, orgId, v.id);
  }
  // An editor's master is too large to hold here: the light copy plays once it is ready, and the original is the
  // file's own download, which streams.
  if (file.size > LIGHT_SOURCE_BYTES) {
    if (options.original || v.lightState === "none" || v.lightState === "failed") {
      return { redirect: `/api/app/organizations/${orgId}/artifacts/${v.artifactId}/file` };
    }
    throw new ConflictError("Its light copy is still being made", "video_review.preparing");
  }
  const object = await file.store.get(file.blobKey);
  if (!object) throw new NotFoundError("The stored file is missing");
  return { body: object.body, contentType: object.contentType || "video/mp4", light: false };
}

// ---------- files on disk ----------

/**
 * Runs `fn` with the object `key` written to a file of its own on this server's disk, as it is read (never whole in
 * memory where the store streams), then removes it.
 */
export async function onDisk<T>(store: BlobStore, key: string, fn: (path: string, dir: string) => Promise<T>) {
  const dir = await mkdtemp(join(tmpdir(), "review-"));
  try {
    const input = join(dir, "in");
    const stream = store.stream ? await store.stream(key) : null;
    if (stream) await Bun.write(input, new Response(stream));
    else {
      const object = await store.get(key);
      if (!object) throw new NotFoundError("The stored file is missing");
      await Bun.write(input, object.body);
    }
    return await fn(input, dir);
  } finally {
    await rm(dir, { recursive: true, force: true }).catch(() => undefined);
  }
}

/** Stores a file of this server's disk under `key`: as it is read where the store can, else whole. */
export async function putFromDisk(store: BlobStore, key: string, path: string) {
  if (store.putFile) {
    const hasher = new Bun.CryptoHasher("sha256");
    for await (const chunk of Bun.file(path).stream()) hasher.update(chunk);
    const size = (await stat(path)).size;
    await store.putFile(key, path, { contentType: "video/mp4", size, sha256: hasher.digest("hex") });
    return;
  }
  await store.put(key, new Uint8Array(await readFile(path)), { contentType: "video/mp4" });
}

// ---------- shared with the design piece (`design-reviews.ts`) ----------

export {
  BRIEF_SCHEMA as REVIEW_BRIEF_SCHEMA,
  cleanBrief as cleanReviewBrief,
  cleanText as cleanReviewText,
  LINKS_SCHEMA as REVIEW_LINKS_SCHEMA,
  queueLight as queueReviewLight,
  requireReview as requireVideoReview,
  summaries as reviewSummaries,
  versionFile as reviewVersionFile,
  where as reviewWhere,
};
