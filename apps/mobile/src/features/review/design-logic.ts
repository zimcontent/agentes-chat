import type { VideoReview, VideoReviewNote } from "@dougbot/client";

/*
 * A design piece in review on the phone (docs/adr/doug-0010-design-review.md): the rules its screens share, with no
 * React in them. Notes sit on a slide and a point of it; the ones on a slide are numbered pins, in the server's order.
 */

/** A version's notes: by slide, the whole piece's last. */
export function designNotesOf(notes: VideoReviewNote[], version: number): VideoReviewNote[] {
  return notes
    .filter((n) => n.version === version)
    .sort((a, b) => (a.page ?? Number.POSITIVE_INFINITY) - (b.page ?? Number.POSITIVE_INFINITY));
}

/** Each pinned note's number (1, 2…), as the pins and the list show it: notes on a slide, in order. */
export function pinNumbers(notes: VideoReviewNote[]): Map<string, number> {
  const out = new Map<string, number>();
  let n = 0;
  for (const note of notes) if (note.page !== null) out.set(note.id, ++n);
  return out;
}

/** The pins on one slide: notes there with a point. */
export const pinsOn = (notes: VideoReviewNote[], page: number) =>
  notes.filter((n) => n.page === page && n.x !== null && n.y !== null);

/** Notes not yet sent on one slide: the strip's count. */
export const openOn = (notes: VideoReviewNote[], page: number) =>
  notes.filter((n) => n.page === page && !n.sent).length;

/** One version of the piece, the newest when it isn't listed. */
export const designVersion = (review: Pick<VideoReview, "versions">, version: number) =>
  review.versions.find((v) => v.version === version) ?? review.versions.at(-1);

/** Whether a version can be opened in the editor: it has its page, it is the newest, and it is in review. */
export const editable = (review: Pick<VideoReview, "versions" | "status" | "version">, version: number) =>
  Boolean(designVersion(review, version)?.source) && review.status === "in_review" && version === review.version;

/** A version's page, from one of its slides' address (`…/versions/{v}/pages/{n}` → `…/versions/{v}/source`). */
export const sourceUrlOf = (pageUrl: string) => pageUrl.replace(/\/pages\/\d+$/, "/source");

/** A number kept between two ends, for the editor's steppers. */
export const clampStep = (v: number, step: number, min: number, max: number) =>
  Math.max(min, Math.min(max, Math.round(v + step)));
