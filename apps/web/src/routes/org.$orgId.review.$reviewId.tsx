import { createFileRoute } from "@tanstack/react-router";
import { Main } from "@/components/Main";
import { VideoReviewDetailPage } from "@/pages/VideoReviewPage";

/** One video in review: the player, notes on its seconds and the decision (docs/adr/doug-0007-video-review.md). */
export const Route = createFileRoute("/org/$orgId/review/$reviewId")({
  component: function VideoReview() {
    return (
      <Main>
        <VideoReviewDetailPage reviewId={Route.useParams().reviewId} />
      </Main>
    );
  },
});
