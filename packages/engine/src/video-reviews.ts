import { firstWords, type PubSub, type SpeechEngine } from "@agenteschat/adapters";
import { and, asc, type Database, desc, eq, inArray, isNull, schema, sql } from "@agenteschat/db";
import { type ArtifactActor, type ArtifactDeps, storedFileOfArtifact } from "./artifacts";
import { requireChannelAccess } from "./channels";
import { ConflictError, NotFoundError, ValidationError } from "./errors";
import { postPersonMessage } from "./messages";
import { replyThreadOf } from "./runs";
import type { ToolContext, ToolDefinition, ToolOutput, ToolSource } from "./tools/types";

const { agents, users, videoReviewNotes, videoReviews, videoReviewVersions } = schema;
type VideoReviewStatus = schema.VideoReviewStatus;

/**
 * Video review (docs/adr/doug-0007-video-review.md): an agent sends a video it made for the team's review with
 * `send_for_review`; people play it, pin notes to a second of a version (typed or said), then approve it or ask for
 * changes. The decision goes back to the agent as a message from the person who decided, in the conversation the video
 * came from, with every note of that version: the agent makes the next version and sends it with the same review.
 * The apps read a review again every few seconds while it is open: no realtime event of its own.
 */

export const SEND_FOR_REVIEW_TOOL = "send_for_review";

/** A video file, by the name it was stored with: what a phone's browser plays. */
const VIDEO_NAME = /\.(mp4|m4v|mov|webm)$/i;
/** The most a note says, typed or transcribed. */
export const REVIEW_NOTE_CHARS = 4000;
/** The longest voice note: a few sentences about one moment. */
export const REVIEW_VOICE_BYTES = 25 * 1024 * 1024;

export interface VideoReviewDeps {
  db: Database;
  pubsub: PubSub;
  artifacts: ArtifactDeps;
  /** Speech-to-text engines (ADR 0100), for voice notes; none: voice notes are refused. */
  engines: () => SpeechEngine[];
  /** The app's address, for the review's link the agent posts. */
  publicUrl: string;
}

export interface VideoReviewVersionView {
  version: number;
  artifactId: string;
  note: string;
  createdAt: string;
}

/** What a note is about, as the reviewer tagged it. */
export const REVIEW_NOTE_KINDS = ["cut", "text", "motion", "sound", "color", "broll", "other"] as const;
export type ReviewNoteKind = (typeof REVIEW_NOTE_KINDS)[number];
const KIND_WORDS: Record<ReviewNoteKind, string> = {
  cut: "Corte/ritmo",
  text: "Texto/legenda",
  motion: "Movimento",
  sound: "Som/trilha",
  color: "Cor",
  broll: "Cards/B-roll",
  other: "Outro",
};

export interface VideoReviewNoteView {
  id: string;
  version: number;
  atMs: number | null;
  endMs: number | null;
  kind: ReviewNoteKind | null;
  body: string;
  voice: boolean;
  author: { id: string; name: string } | null;
  sent: boolean;
  createdAt: string;
}

export interface VideoReviewSummary {
  id: string;
  title: string;
  client: string;
  status: VideoReviewStatus;
  version: number;
  artifactId: string | null;
  agent: { id: string; name: string; handle: string } | null;
  channelId: string;
  threadId: string | null;
  openNotes: number;
  updatedAt: string;
  createdAt: string;
}

export interface VideoReviewView extends VideoReviewSummary {
  versions: VideoReviewVersionView[];
  notes: VideoReviewNoteView[];
  decidedBy: { id: string; name: string } | null;
  decidedAt: string | null;
}

export const reviewPath = (orgId: string, reviewId: string) => `/org/${orgId}/review/${reviewId}`;

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

/** `0:06.4` or `0:06.4–0:09.1`, as the agent reads where a note is. */
function where(atMs: number | null, endMs: number | null): string {
  return endMs !== null && atMs !== null ? `${timecode(atMs)}–${timecode(endMs)}` : timecode(atMs);
}

const cleanText = (text: string) => text.replace(/\r\n?/g, "\n").trim().slice(0, REVIEW_NOTE_CHARS);

// ---------- the agent's side ----------

export interface SendForReviewInput {
  artifactId: string;
  title?: string;
  client?: string;
  note?: string;
  /** A review it sent before: this is its next version. */
  reviewId?: string;
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
      await tx.insert(videoReviewVersions).values({
        orgId: ctx.orgId,
        reviewId: review.id,
        version,
        artifactId: input.artifactId,
        note,
      });
      await tx
        .update(videoReviews)
        .set({
          version,
          status: "in_review",
          decidedBy: null,
          decidedAt: null,
          updatedAt: now,
          ...(input.title?.trim() ? { title: input.title.trim().slice(0, 200) } : {}),
        })
        .where(eq(videoReviews.id, review.id));
      return review.id;
    }
    const title = input.title?.trim().slice(0, 200) || file.name;
    const [row] = await tx
      .insert(videoReviews)
      .values({
        orgId: ctx.orgId,
        agentId: ctx.agentId,
        channelId: ctx.channelId,
        threadId: replyThreadOf(ctx),
        title,
        client: input.client?.trim().slice(0, 80) ?? "",
      })
      .returning({ id: videoReviews.id });
    if (!row) throw new Error("video review not inserted");
    await tx
      .insert(videoReviewVersions)
      .values({ orgId: ctx.orgId, reviewId: row.id, version: 1, artifactId: input.artifactId, note });
    return row.id;
  });
  const [review] = await summaries(deps.db, ctx.orgId, [reviewId]);
  if (!review) throw new Error("video review not found after send");
  return { review, link: deps.publicUrl.replace(/\/+$/, "") + reviewPath(ctx.orgId, review.id), created };
}

const toolText = (value: unknown) => (typeof value === "string" ? value : "");

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

/** `send_for_review`, for agents in a run (a routine's background run sends nothing for review). */
export function createVideoReviewToolSource(deps: VideoReviewDeps | null): ToolSource {
  return {
    name: "video-review",
    async tools(ctx) {
      if (!deps || !ctx.runId || ctx.background) return [];
      return [sendTool(deps)];
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
    })
    .from(videoReviews)
    .leftJoin(agents, eq(agents.id, videoReviews.agentId))
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
    })
    .from(videoReviewVersions)
    .where(inArray(videoReviewVersions.reviewId, reviewIds));
  const open = await db
    .select({ reviewId: videoReviewNotes.reviewId, version: videoReviewNotes.version })
    .from(videoReviewNotes)
    .where(and(inArray(videoReviewNotes.reviewId, reviewIds), isNull(videoReviewNotes.sentAt)));
  return rows.map(({ review, agentName, agentHandle }) => ({
    id: review.id,
    title: review.title,
    client: review.client,
    status: review.status,
    version: review.version,
    artifactId: versions.find((v) => v.reviewId === review.id && v.version === review.version)?.artifactId ?? null,
    agent: review.agentId && agentName ? { id: review.agentId, name: agentName, handle: agentHandle ?? "" } : null,
    channelId: review.channelId,
    threadId: review.threadId,
    openNotes: open.filter((n) => n.reviewId === review.id && n.version === review.version).length,
    updatedAt: review.updatedAt.toISOString(),
    createdAt: review.createdAt.toISOString(),
  }));
}

/** Whether this person reads the conversation the video came from: who does reviews it. */
async function sees(db: Database, userId: string, orgId: string, channelId: string) {
  try {
    await requireChannelAccess(db, userId, orgId, channelId);
    return true;
  } catch (error) {
    if (error instanceof NotFoundError || (error as { name?: string }).name === "ForbiddenError") return false;
    throw error;
  }
}

/** The reviews this person may see, newest first. */
export async function listVideoReviews(
  deps: Pick<VideoReviewDeps, "db">,
  userId: string,
  orgId: string,
): Promise<VideoReviewSummary[]> {
  const all = await summaries(deps.db, orgId);
  const seen = new Map<string, boolean>();
  const out: VideoReviewSummary[] = [];
  for (const review of all) {
    let ok = seen.get(review.channelId);
    if (ok === undefined) {
      ok = await sees(deps.db, userId, orgId, review.channelId);
      seen.set(review.channelId, ok);
    }
    if (ok) out.push(review);
  }
  return out;
}

async function requireReview(db: Database, userId: string, orgId: string, reviewId: string) {
  const [review] = await db
    .select()
    .from(videoReviews)
    .where(and(eq(videoReviews.orgId, orgId), eq(videoReviews.id, reviewId)));
  if (!review || !(await sees(db, userId, orgId, review.channelId))) throw new NotFoundError("No such review");
  return review;
}

export async function getVideoReview(
  deps: Pick<VideoReviewDeps, "db">,
  userId: string,
  orgId: string,
  reviewId: string,
): Promise<VideoReviewView> {
  const review = await requireReview(deps.db, userId, orgId, reviewId);
  const [summary] = await summaries(deps.db, orgId, [review.id]);
  if (!summary) throw new NotFoundError("No such review");
  const versions = await deps.db
    .select()
    .from(videoReviewVersions)
    .where(eq(videoReviewVersions.reviewId, review.id))
    .orderBy(asc(videoReviewVersions.version));
  const notes = await deps.db
    .select({ note: videoReviewNotes, authorName: users.name })
    .from(videoReviewNotes)
    .leftJoin(users, eq(users.id, videoReviewNotes.authorUserId))
    .where(eq(videoReviewNotes.reviewId, review.id))
    .orderBy(
      asc(videoReviewNotes.version),
      sql`${videoReviewNotes.atMs} asc nulls first`,
      asc(videoReviewNotes.createdAt),
    );
  const [decider] = review.decidedBy
    ? await deps.db.select({ id: users.id, name: users.name }).from(users).where(eq(users.id, review.decidedBy))
    : [];
  return {
    ...summary,
    versions: versions.map((v) => ({
      version: v.version,
      artifactId: v.artifactId,
      note: v.note,
      createdAt: v.createdAt.toISOString(),
    })),
    notes: notes.map(({ note, authorName }) => ({
      id: note.id,
      version: note.version,
      atMs: note.atMs,
      endMs: note.endMs,
      kind: (note.kind as ReviewNoteKind | null) ?? null,
      body: note.body,
      voice: note.voice,
      author: note.authorUserId ? { id: note.authorUserId, name: authorName ?? "" } : null,
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
  kind?: ReviewNoteKind | null;
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
  const body = cleanText(input.body);
  if (!body) throw new ValidationError("The note is empty", "video_review.empty_note");
  if (!Number.isInteger(input.version) || input.version < 1 || input.version > review.version) {
    throw new ValidationError("No such version", "video_review.bad_version");
  }
  const atMs = input.atMs === null ? null : Math.max(0, Math.round(input.atMs));
  const end = input.endMs === null || input.endMs === undefined ? null : Math.round(input.endMs);
  if (end !== null && (atMs === null || end <= atMs)) {
    throw new ValidationError("A stretch ends after it starts", "video_review.bad_range");
  }
  const kind = input.kind ?? null;
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
      endMs: end,
      kind,
      body,
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
    kind: (row.kind as ReviewNoteKind | null) ?? null,
    body: row.body,
    voice: row.voice,
    author: author ?? null,
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
    kind?: ReviewNoteKind | null;
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
    kind: input.kind ?? null,
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

/** What the agent reads: the decision and every note of the version, by time. */
export function decisionMessage(input: {
  handle: string;
  title: string;
  version: number;
  reviewId: string;
  decision: ReviewDecision;
  notes: { atMs: number | null; endMs?: number | null; kind?: string | null; body: string; author: string }[];
  message: string;
}): string {
  const lines: string[] = [];
  const head = `@${input.handle}`;
  if (input.decision === "approve") {
    lines.push(`${head} Aprovado: «${input.title}» V${input.version} (review_id ${input.reviewId}).`);
  } else {
    lines.push(
      `${head} Ajustes em «${input.title}» V${input.version} (review_id ${input.reviewId}). Faça a V${input.version + 1} e mande com send_for_review e esse review_id.`,
    );
  }
  if (input.message.trim()) lines.push("", input.message.trim());
  if (input.notes.length > 0) {
    lines.push("", "Notas:");
    for (const note of input.notes) {
      lines.push(
        `- [${where(note.atMs, note.endMs ?? null)}]${
          note.kind && note.kind in KIND_WORDS ? ` ${KIND_WORDS[note.kind as ReviewNoteKind]}:` : ""
        } ${note.body.replace(/\n+/g, " ")}${note.author ? ` (${note.author})` : ""}`,
      );
    }
  }
  return lines.join("\n");
}

/**
 * Approves the newest version or asks for changes to it: the notes not yet sent go to the agent in one message from
 * this person, in the conversation the video came from, which starts the agent's work on it.
 */
export async function decideVideoReview(
  deps: Pick<VideoReviewDeps, "db" | "pubsub">,
  userId: string,
  orgId: string,
  reviewId: string,
  input: { decision: ReviewDecision; message?: string },
): Promise<VideoReviewSummary> {
  const review = await requireReview(deps.db, userId, orgId, reviewId);
  if (review.status === "approved" && input.decision === "approve") {
    throw new ConflictError("This version is already approved", "video_review.decided");
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
      kind: videoReviewNotes.kind,
      body: videoReviewNotes.body,
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
    .orderBy(sql`${videoReviewNotes.atMs} asc nulls first`, asc(videoReviewNotes.createdAt));
  const message = cleanText(input.message ?? "");
  if (input.decision === "changes" && notes.length === 0 && !message) {
    throw new ValidationError("Say what to change: add a note first", "video_review.nothing_to_change");
  }
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
  await postPersonMessage(deps, userId, orgId, review.channelId, {
    body: decisionMessage({
      handle: agent.handle,
      title: review.title,
      version: review.version,
      reviewId: review.id,
      decision: input.decision,
      notes: notes.map((n) => ({ atMs: n.atMs, endMs: n.endMs, kind: n.kind, body: n.body, author: n.author ?? "" })),
      message,
    }),
    threadId: review.threadId,
    meta: { videoReview: { id: review.id, version: review.version, decision: input.decision } },
  });
  const [summary] = await summaries(deps.db, orgId, [review.id]);
  if (!summary) throw new NotFoundError("No such review");
  return summary;
}
