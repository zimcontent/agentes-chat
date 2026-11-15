import type { VideoReview, VideoReviewNote, VideoReviewStatus } from "@agenteschat/client";

/*
 * The phone's Revisor (docs/adr/doug-0007-video-review.md): the rules its screens share, with no React in them.
 */

/** Until the video says otherwise: what the agents render shorts at (the web's default too). */
export const REVIEW_FPS = 25;
/** How long a note's ring stays on the picture around its point. */
export const RING_MS = 900;

/** A version's notes, the whole video's last, the rest by time. */
export function notesOf(notes: VideoReviewNote[], version: number): VideoReviewNote[] {
  return notes
    .filter((n) => n.version === version)
    .sort((a, b) => (a.atMs ?? Number.POSITIVE_INFINITY) - (b.atMs ?? Number.POSITIVE_INFINITY));
}

/** The file of one version (the newest when it isn't listed). */
export function versionFile(review: Pick<VideoReview, "versions" | "artifactId">, version: number): string | null {
  return review.versions.find((v) => v.version === version)?.artifactId ?? review.artifactId;
}

/** Whether the shown version may still take notes and a decision: the newest, while it is in review. */
export const reviewOpen = (review: Pick<VideoReview, "status" | "version">, shown: number) =>
  review.status === "in_review" && shown === review.version;

/** The notes not yet sent on the newest version: "Pedir ajustes" needs one, or a word. */
export const unsentOf = (review: Pick<VideoReview, "notes" | "version">) =>
  review.notes.filter((n) => n.version === review.version && !n.sent).length;

/** The rings to draw now: notes with a point whose time (or stretch) is around `ms`. */
export function ringsAt(notes: VideoReviewNote[], ms: number): VideoReviewNote[] {
  return notes.filter((n) => {
    if (n.atMs === null || n.x === null || n.y === null) return false;
    const end = n.endMs ?? n.atMs;
    return ms >= n.atMs - RING_MS / 2 && ms <= end + RING_MS;
  });
}

/** A fraction kept on the picture. */
export const fraction = (v: number) => Math.max(0, Math.min(1, v));

/** The picture's box in the room it has: the video's own shape, as wide as it can be and no taller than `maxHeight`. */
export function pictureBox(aspect: number, width: number, maxHeight: number): { width: number; height: number } {
  const a = aspect > 0 && Number.isFinite(aspect) ? aspect : 9 / 16;
  const h = Math.min(width / a, maxHeight);
  return { width: Math.round(h * a), height: Math.round(h) };
}

/** The status chip's look: what waits on the reviewer is amber. */
export const statusTone = (status: VideoReviewStatus): "wait" | "neutral" =>
  status === "in_review" ? "wait" : "neutral";
export const statusIcon = (status: VideoReviewStatus) =>
  status === "in_review" ? "eye" : status === "approved" ? "check" : "pen";

/** The reviews a message points at: links in its words, and the decision a person sent (`meta.videoReview`). */
export function reviewIdsOf(links: { orgId: string; reviewId: string }[], orgId: string, meta: unknown): string[] {
  const ids = links.filter((l) => l.orgId === orgId).map((l) => l.reviewId);
  const decided =
    meta && typeof meta === "object" ? (meta as { videoReview?: { id?: unknown } }).videoReview?.id : undefined;
  if (typeof decided === "string" && !ids.includes(decided)) ids.push(decided);
  return ids;
}
