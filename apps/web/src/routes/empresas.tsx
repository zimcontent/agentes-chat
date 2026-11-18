import { createFileRoute } from "@tanstack/react-router";
import { CompaniesPage } from "@/pages/CompaniesPage";

/**
 * The public form ("Quero o DougBot na minha empresa"): a company asks for DougBot, with a consent and the bot check.
 * `?confirm=<token>` is the link its confirmation email opens.
 */
export const Route = createFileRoute("/empresas")({
  validateSearch: (search: Record<string, unknown>): { confirm?: string } => ({
    ...(typeof search.confirm === "string" ? { confirm: search.confirm } : {}),
  }),
  component: CompaniesPage,
});
