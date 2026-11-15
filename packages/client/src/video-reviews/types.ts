/** Video review (docs/adr/doug-0007-video-review.md): what the server answers. */

export type VideoReviewStatus = "in_review" | "changes" | "approved";

export interface VideoReviewSummary {
  id: string;
  title: string;
  client: string;
  status: VideoReviewStatus;
  version: number;
  /** The newest version's video file. */
  artifactId: string | null;
  agent: { id: string; name: string; handle: string } | null;
  channelId: string;
  threadId: string | null;
  /** Notes on the newest version not yet sent to the agent. */
  openNotes: number;
  updatedAt: string;
  createdAt: string;
}

export interface VideoReviewNote {
  id: string;
  version: number;
  /** Milliseconds into the video; null: about the whole video. */
  atMs: number | null;
  /** Where a stretch ends; null: one point. */
  endMs: number | null;
  kind: VideoReviewNoteKind | null;
  /** Where on the picture the reviewer pointed (fractions of width and height); null: nowhere in particular. */
  x: number | null;
  y: number | null;
  body: string;
  /** Said aloud and transcribed. */
  voice: boolean;
  author: { id: string; name: string } | null;
  /** Already went to the agent with a decision: read only. */
  sent: boolean;
  createdAt: string;
}

export interface VideoReview extends VideoReviewSummary {
  /** What was asked of the editor and whether there was direction; "" when the agent didn't say. */
  brief: string;
  /** The task, the footage, the delivery. */
  links: { label: string; url: string }[];
  versions: { version: number; artifactId: string; note: string; createdAt: string }[];
  notes: VideoReviewNote[];
  decidedBy: { id: string; name: string } | null;
  decidedAt: string | null;
}

export type VideoReviewDecision = "approve" | "changes";

/** What a note is about, as the reviewer tagged it (the engine's `REVIEW_NOTE_KINDS`). */
export const VIDEO_REVIEW_NOTE_KINDS = ["cut", "text", "motion", "sound", "color", "broll", "other"] as const;
export type VideoReviewNoteKind = (typeof VIDEO_REVIEW_NOTE_KINDS)[number];

export interface VideoReviewNoteInput {
  version: number;
  atMs: number | null;
  endMs?: number | null;
  kind?: VideoReviewNoteKind | null;
  x?: number | null;
  y?: number | null;
  body: string;
}

export interface VideoReviewVoiceInput {
  file: Blob;
  fileName: string;
  version: number;
  atMs: number | null;
  endMs?: number | null;
  kind?: VideoReviewNoteKind | null;
  x?: number | null;
  y?: number | null;
  language?: string;
}
