import { createFileRoute, redirect } from "@tanstack/react-router";
import { legalPage } from "@/app/guards";
import { NoLegalPage } from "@/pages/CloudLegalPage";
import { LegalPage } from "@/pages/LegalPage";

/**
 * The Portuguese address of the Privacy Policy: DougBot's own document (`docs/legal/privacidade.pt-BR.md`) on a server that serves it, a
 * server's own address when its setting names one elsewhere, and agentes.chat Cloud's English page (`/privacy`) on the Cloud.
 */
export const Route = createFileRoute("/privacidade")({
  loader: async ({ context }) => {
    const page = await legalPage(context, "privacy");
    if (page === "cloud") throw redirect({ to: "/privacy", replace: true });
    return page;
  },
  component: function PrivacyPt() {
    return Route.useLoaderData() === "own" ? <LegalPage kind="privacy" lang="pt-BR" /> : <NoLegalPage kind="privacy" />;
  },
});
