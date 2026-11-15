import { createFileRoute } from "@tanstack/react-router";
import { Main } from "@/components/Main";
import { VideoReviewsPage } from "@/pages/VideoReviewPage";

/** Videos agents sent for the team's review (docs/adr/doug-0007-video-review.md). */
export const Route = createFileRoute("/org/$orgId/review/")({
  component: function VideoReviews() {
    return (
      <Main>
        <VideoReviewsPage />
      </Main>
    );
  },
});
