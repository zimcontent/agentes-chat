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
  body: string;
  /** Said aloud and transcribed. */
  voice: boolean;
  author: { id: string; name: string } | null;
  /** Already went to the agent with a decision: read only. */
  sent: boolean;
  createdAt: string;
}

export interface VideoReview extends VideoReviewSummary {
  versions: { version: number; artifactId: string; note: string; createdAt: string }[];
  notes: VideoReviewNote[];
  decidedBy: { id: string; name: string } | null;
  decidedAt: string | null;
}

export type VideoReviewDecision = "approve" | "changes";

export interface VideoReviewVoiceInput {
  file: Blob;
  fileName: string;
  version: number;
  atMs: number | null;
  language?: string;
}
