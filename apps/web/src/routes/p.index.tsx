import { createFileRoute, redirect } from "@tanstack/react-router";

/**
 * `/p` with no token opens nothing: the client's page is always its own link (`/p/<token>`, docs/adr/
 * doug-0020-embedded-approval-portal.md). The address that names no site goes home.
 */
export const Route = createFileRoute("/p/")({
  beforeLoad: () => {
    throw redirect({ to: "/", replace: true });
  },
});
