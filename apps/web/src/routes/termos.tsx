import { createFileRoute, redirect } from "@tanstack/react-router";
import { legalPage } from "@/app/guards";
import { NoLegalPage } from "@/pages/CloudLegalPage";
import { LegalPage } from "@/pages/LegalPage";

/**
 * The Portuguese address of the Terms of Use: DougBot's own document (`docs/legal/termos.pt-BR.md`) on a server that serves it, a
 * server's own address when its setting names one elsewhere, and agentes.chat Cloud's English page (`/terms`) on the Cloud.
 */
export const Route = createFileRoute("/termos")({
  loader: async ({ context }) => {
    const page = await legalPage(context, "terms");
    if (page === "cloud") throw redirect({ to: "/terms", replace: true });
    return page;
  },
  component: function TermsPt() {
    return Route.useLoaderData() === "own" ? <LegalPage kind="terms" lang="pt-BR" /> : <NoLegalPage kind="terms" />;
  },
});
