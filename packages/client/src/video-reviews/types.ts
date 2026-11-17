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
  /** A person of the team who sent it from a task (docs/adr/doug-0012-editor-delivery.md); null: an agent did. */
  sender?: { id: string; name: string } | null;
  /** The task it delivers, when sent from one. */
  taskId?: string | null;
  /** That task's number and title, and this video's number among its videos (a task may ask for several). */
  taskNumber?: number | null;
  taskTitle?: string | null;
  taskPart?: number | null;
  /** A person's review: the newest round of changes asked of them (doug-0012 §10). */
  round?: ReviewRound | null;
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
  /** The client wrote it at the approval portal: `author` is their name. */
  fromClient?: boolean;
  /** Already went to the agent with a decision: read only. */
  sent: boolean;
  createdAt: string;
}

export interface VideoReview extends VideoReviewSummary {
  /** A design piece's client at the approval portal and what an approval does there (doug-0010 §8). */
  portal?: { client: string; afterApprove: "portal" | "direct" } | null;
  /** What happened at the portal after the approval. */
  delivery?: {
    state?: "sending" | "sent" | "scheduled" | "approved" | "failed";
    link?: string | null;
    when?: string | null;
    error?: string;
  } | null;
  /** A person's video: its post's cover and caption, each approved or not (doug-0012). */
  post?: ReviewPost;
  /** The approved original kept as the final, and its backup. */
  final?: EditorFinal | null;
  /** The task it delivers and where its post stands at the portal (`approval`, `adjusting`, `approved`…). */
  task?: { id: string; number: number; title: string; stage: string | null } | null;
  /** Every round of changes asked of the person who sent it: the log. */
  rounds?: ReviewRound[];
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

/** One round of changes asked of the person who sent the work: asked, told, seen, answered. */
export interface ReviewRound {
  id: string;
  version: number;
  askedBy: string;
  fromClient: boolean;
  notes: number;
  askedAt: string;
  notified: { whatsapp?: { at: string; chat: string }; error?: string; none?: boolean } | null;
  seenAt: string | null;
  answeredAt: string | null;
  answeredVersion: number | null;
}

/** Where a person is told of the changes asked of them: a conversation of one of the workspace's numbers. */
export interface ReviewWhatsAppTarget {
  userId: string;
  accountId: string;
  accountLabel: string;
  chatId: string;
  chatName: string;
}

/** The parts of a post besides its video: a cover (a picture of the task) or none, and the caption. */
export interface ReviewPost {
  cover?: string | null;
  noCover?: boolean;
  coverOk?: boolean;
  caption?: string;
  captionOk?: boolean;
}

export type ReviewPostPatch = Partial<ReviewPost>;

/** The final of an editor's post: kept in the workspace's storage, and its backup. */
export interface EditorFinal {
  state: "queued" | "kept" | "backed_up" | "failed";
  version?: number;
  artifactId?: string;
  backup?: { name: string; link: string | null } | null;
  error?: string;
  at: string;
}

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

/**
 * Work a person made, sent for review from Revisão (docs/adr/doug-0015-team-work-review.md): a video or a design
 * piece's slides, uploaded first to the conversation it goes to (the task's, or a group's; a next version, its review's).
 */
export interface PersonWorkInput {
  medium: "video" | "design";
  files: string[];
  title?: string;
  note?: string;
  reviewId?: string;
  taskId?: string;
  channelId?: string;
}
