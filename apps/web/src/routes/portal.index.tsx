import { createFileRoute, redirect } from "@tanstack/react-router";

/**
 * `/portal` with no token opens nothing: the client's page is always its own link (`/portal/<token>`, docs/adr/
 * doug-0020-embedded-approval-portal.md). The address that names no site goes home.
 */
export const Route = createFileRoute("/portal/")({
  beforeLoad: () => {
    throw redirect({ to: "/", replace: true });
  },
});
