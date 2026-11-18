import { createFileRoute } from "@tanstack/react-router";
import { ClientPortalPage } from "@/pages/ClientPortalPage";
import "@/pages/portal-client.css";

/**
 * The client's own page of the installation's approval portal (docs/adr/doug-0031-embedded-approval-portal.md): no
 * account, the link's token the whole of the access (`/p/<token>`). It reads its data from `/p/api/<token>` and never
 * touches the app's signed-in API. `/p/` rather than `/portal/`: a server behind a proxy that sends `/portal` to an
 * outside portal keeps working, and the client's page has an address of its own.
 */
export const Route = createFileRoute("/p/$token")({
  // A link that names another site, or one that isn't a token, opens nothing: the page says so, and no request leaves.
  component: function Portal() {
    return <ClientPortalPage token={Route.useParams().token} />;
  },
});
