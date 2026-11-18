import { createFileRoute } from "@tanstack/react-router";
import { LegalPage } from "@/pages/LegalPage";

/**
 * The Privacy Policy, public. DougBot's own document (`docs/legal/privacidade.pt-BR.md`), with the Data Processing
 * Addendum as an annex. The controller/processor split it describes is that of each customer's installation.
 */
export const Route = createFileRoute("/privacidade")({
  component: () => <LegalPage kind="privacy" lang="pt-BR" />,
});
