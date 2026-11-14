import { createFileRoute } from "@tanstack/react-router";
import { Main } from "@/components/Main";
import { portalSearch } from "@/components/portal/search";
import { PortalPage } from "@/pages/PortalPage";

/**
 * The approval portal (ADR 9001): every client at a glance, `?client=<id>` that client's board, `&tab=posted` what
 * was published for it.
 */
export const Route = createFileRoute("/org/$orgId/portal")({
  validateSearch: portalSearch,
  component: () => (
    <Main>
      <PortalPage />
    </Main>
  ),
});
