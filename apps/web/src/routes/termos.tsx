import { createFileRoute } from "@tanstack/react-router";
import { LegalPage } from "@/pages/LegalPage";

/**
 * The Terms of Use, public. DougBot's own document (`docs/legal/termos.pt-BR.md`), not the project's Cloud one: this
 * instance runs each customer's installation, so the terms it serves are the ones the company that runs the server
 * wrote and had reviewed.
 */
export const Route = createFileRoute("/termos")({
  component: () => <LegalPage kind="terms" lang="pt-BR" />,
});
