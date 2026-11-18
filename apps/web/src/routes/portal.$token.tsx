import { createFileRoute } from "@tanstack/react-router";
import { ClientPortalPage } from "@/pages/ClientPortalPage";
import "@/pages/portal-client.css";

/**
 * The client's own page of the installation's approval portal (docs/adr/doug-0020-embedded-approval-portal.md): no
 * account, the link's token the whole of the access (`/portal/<token>`). It reads its data from `/portal/api/<token>`
 * and never touches the app's signed-in API.
 */
export const Route = createFileRoute("/portal/$token")({
  // A link that names another site, or one that isn't a token, opens nothing: the page says so, and no request leaves.
  component: function Portal() {
    return <ClientPortalPage token={Route.useParams().token} />;
  },
});
