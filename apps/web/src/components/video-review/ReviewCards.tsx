import { type Message, reviewLinksIn, useVideoReviews, type VideoReviewSummary } from "@dougbot/client";
import { Chip, type ChipTone, Icon } from "@dougbot/ui";
import { Link } from "@tanstack/react-router";
import { useApi } from "@/api/context";
import { useOrg } from "@/components/org-context";
import { type ReviewWords, useReviewWords } from "./words";
import "./review-cards.css";

/*
 * A video in review where it was talked about (docs/adr/doug-0007-video-review.md): under a message that links to a
 * review (the agent posts the link `send_for_review` answers) or that decided one (`meta.videoReview`), a card with
 * the video's first frame, its version and state, and "Revisar", which opens the Revisor in the app.
 */

const TONE: Record<VideoReviewSummary["status"], ChipTone> = {
  in_review: "waiting",
  changes: "neutral",
  approved: "done",
};
const ICON = { in_review: "eye", changes: "edit", approved: "check" } as const;

/** The reviews a message points at, each once. */
export function reviewIdsOf(message: Pick<Message, "body" | "meta">, orgId: string): string[] {
  const ids = reviewLinksIn(message.body ?? "")
    .filter((r) => r.orgId === orgId)
    .map((r) => r.reviewId);
  const decided = (message.meta as { videoReview?: { id?: unknown } } | null | undefined)?.videoReview?.id;
  if (typeof decided === "string" && !ids.includes(decided)) ids.push(decided);
  return ids;
}

export function ReviewCards({ message }: { message: Pick<Message, "body" | "meta"> }) {
  const { org } = useOrg();
  const ids = reviewIdsOf(message, org.id);
  // One read for every card on the page: the list, shared with the dock's count.
  const reviews = useVideoReviews(ids.length > 0 ? org.id : "");
  const w = useReviewWords();
  const found = ids.flatMap((id) => reviews.data?.find((r) => r.id === id) ?? []);
  if (found.length === 0) return null;
  return (
    <div className="vr-cards">
      {found.map((r) => (
        <ReviewCard key={r.id} review={r} w={w} />
      ))}
    </div>
  );
}

function ReviewCard({ review, w }: { review: VideoReviewSummary; w: ReviewWords }) {
  const api = useApi();
  const { org } = useOrg();
  const meta = [review.client, w.version(review.version), review.openNotes > 0 ? w.notesOpen(review.openNotes) : ""]
    .filter(Boolean)
    .join(" · ");
  const design = review.medium === "design";
  return (
    <Link
      to="/org/$orgId/review/$reviewId"
      params={{ orgId: org.id, reviewId: review.id }}
      className="vr-card"
      aria-label={`${design ? w.design.open : w.openVideo}: ${review.title}`}
      data-medium={review.medium}
    >
      <span className="vr-card__poster" aria-hidden="true">
        {design ? (
          review.cover ? (
            <img src={api.artifacts.fileUrl(org.id, review.cover)} alt="" loading="lazy" draggable={false} />
          ) : null
        ) : review.artifactId ? (
          <video
            src={`${api.artifacts.fileUrl(org.id, review.artifactId)}#t=0.5`}
            preload="metadata"
            muted
            playsInline
          />
        ) : null}
        <span className="vr-card__play">
          <Icon name={design ? "edit" : "play"} size={16} />
        </span>
      </span>
      <span className="vr-card__words">
        <span className="vr-card__kicker">{design ? w.design.card : w.card}</span>
        <span className="vr-card__title">{review.title}</span>
        {meta && <span className="vr-card__meta">{meta}</span>}
        <span className="vr-card__foot">
          <Chip tone={TONE[review.status]} icon={ICON[review.status]}>
            {w.status[review.status]}
          </Chip>
          <span className="vr-card__open">
            {design ? w.design.open : w.open}
            <Icon name="chevronRight" size={16} />
          </span>
        </span>
      </span>
    </Link>
  );
}
