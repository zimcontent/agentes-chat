import { createFileRoute } from "@tanstack/react-router";
import { legalPage } from "@/app/guards";
import { CloudLegalPage, NoLegalPage } from "@/pages/CloudLegalPage";
import { LegalPage } from "@/pages/LegalPage";

/**
 * The Terms of Use in English, public: agentes.chat Cloud's on the Cloud, DougBot's own on a server that serves it, a
 * server's own address when `TERMS_URL` names one elsewhere (`legalPage`), else none.
 */
export const Route = createFileRoute("/terms")({
  loader: ({ context }) => legalPage(context, "terms"),
  component: function Terms() {
    const page = Route.useLoaderData();
    if (page === "cloud") return <CloudLegalPage kind="terms" />;
    return page === "own" ? <LegalPage kind="terms" lang="en" /> : <NoLegalPage kind="terms" />;
  },
});
