import { createFileRoute } from "@tanstack/react-router";
import { Main } from "@/components/Main";
import { MediaPage } from "@/pages/MediaPage";

/** Mídia (ADR doug-0010): images and videos from the workspace's credits; `?topup=<id>` is a top-up coming back. */
export const Route = createFileRoute("/org/$orgId/media")({
  validateSearch: (search: Record<string, unknown>): { topup?: string } =>
    typeof search.topup === "string" && /^tp_[a-f0-9]{16}$/.test(search.topup) ? { topup: search.topup } : {},
  component: () => (
    <Main>
      <MediaPage />
    </Main>
  ),
});
