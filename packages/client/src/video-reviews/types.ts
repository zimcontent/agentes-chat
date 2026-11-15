/** Video review (docs/adr/doug-0007-video-review.md): what the server answers. */

export type VideoReviewStatus = "in_review" | "changes" | "approved";
/** A video, or a design piece: slides as pictures and the page they were drawn from (docs/adr/doug-0010-design-review.md). */
export type ReviewMedium = "video" | "design";

export interface VideoReviewSummary {
  id: string;
  medium: ReviewMedium;
  title: string;
  client: string;
  status: VideoReviewStatus;
  version: number;
  /** The newest version's video file. */
  artifactId: string | null;
  /** A design piece's first slide (a picture file), from its newest version with pictures. */
  cover: string | null;
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
  /** A design piece's slide, from 1; null: a video, or the whole piece. */
  page: number | null;
  kind: VideoReviewNoteKind | null;
  /** Where on the picture the reviewer pointed (fractions of width and height); null: nowhere in particular. */
  x: number | null;
  y: number | null;
  body: string;
  /** Files of the review's conversation and links the reviewer handed over with the note. */
  attachments: VideoReviewAttachment[];
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
  /** `light`: its light copy for phones is ready (`videoUrl` plays it unless `original`). */
  versions: VideoReviewVersion[];
  notes: VideoReviewNote[];
  decidedBy: { id: string; name: string } | null;
  decidedAt: string | null;
}

export interface VideoReviewVersion {
  version: number;
  artifactId: string;
  note: string;
  light: boolean;
  /** A design version's slides (picture files), in order; [] for a video or a page edited by hand. */
  pages: string[];
  /** A design version has an editable page. */
  source: boolean;
  /** Who made this version in the editor; null: the agent. */
  editedBy: { id: string; name: string } | null;
  createdAt: string;
}

export type VideoReviewDecision = "approve" | "changes";

export type VideoReviewAttachment =
  | { type: "file"; artifactId: string; name: string; media: "image" | "video" | "audio" | "other" }
  | { type: "link"; url: string; label: string };

/** What a note hands over: a file uploaded to the review's conversation, or a link. */
export type VideoReviewAttachmentInput = { artifactId: string; name?: string } | { url: string; label?: string };

/** What a note is about, as the reviewer tagged it (the engine's `REVIEW_NOTE_KINDS`). */
export const VIDEO_REVIEW_NOTE_KINDS = ["cut", "text", "motion", "sound", "color", "broll", "other"] as const;
/** A design piece's kinds, in the order the note box shows them. */
export const DESIGN_REVIEW_NOTE_KINDS = ["text", "type", "color", "image", "layout", "other"] as const;
export type VideoReviewNoteKind = (typeof VIDEO_REVIEW_NOTE_KINDS)[number] | (typeof DESIGN_REVIEW_NOTE_KINDS)[number];

export interface VideoReviewNoteInput {
  version: number;
  atMs: number | null;
  endMs?: number | null;
  page?: number | null;
  kind?: VideoReviewNoteKind | null;
  x?: number | null;
  y?: number | null;
  attachments?: VideoReviewAttachmentInput[];
  body: string;
}

export interface VideoReviewVoiceInput {
  file: Blob;
  fileName: string;
  version: number;
  atMs: number | null;
  endMs?: number | null;
  page?: number | null;
  kind?: VideoReviewNoteKind | null;
  x?: number | null;
  y?: number | null;
  attachments?: VideoReviewAttachmentInput[];
  language?: string;
}

/** A design piece edited by hand, saved as its next version. */
export interface DesignEditInput {
  /** The version the editor opened: a newer one arriving meanwhile refuses the save. */
  baseVersion: number;
  html: string;
  note?: string;
}
