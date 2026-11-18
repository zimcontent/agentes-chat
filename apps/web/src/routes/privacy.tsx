import { createFileRoute } from "@tanstack/react-router";
import { legalPage } from "@/app/guards";
import { CloudLegalPage, NoLegalPage } from "@/pages/CloudLegalPage";
import { LegalPage } from "@/pages/LegalPage";

/**
 * The Privacy Policy in English, public: agentes.chat Cloud's on the Cloud, DougBot's own on a server that serves it, a
 * server's own address when `PRIVACY_URL` names one elsewhere (`legalPage`), else none.
 */
export const Route = createFileRoute("/privacy")({
  loader: ({ context }) => legalPage(context, "privacy"),
  component: function Privacy() {
    const page = Route.useLoaderData();
    if (page === "cloud") return <CloudLegalPage kind="privacy" />;
    return page === "own" ? <LegalPage kind="privacy" lang="en" /> : <NoLegalPage kind="privacy" />;
  },
});
