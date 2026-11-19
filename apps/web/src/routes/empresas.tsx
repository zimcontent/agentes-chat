import { createFileRoute, notFound } from "@tanstack/react-router";
import { showsCompanyRequests } from "@/app/guards";
import { CompaniesPage } from "@/pages/CompaniesPage";

/**
 * The public form ("Quero o DougBot na minha empresa"): a company asks for DougBot, with a consent and the bot check.
 * `?confirm=<token>` is the link its confirmation email opens, and `?delete=<token>` the one it erases the request by.
 * DougBot's own servers serve neither the route nor the page: there it is not found (ADR doug-0033).
 */
export const Route = createFileRoute("/empresas")({
  loader: async ({ context }) => {
    if (!(await showsCompanyRequests(context))) throw notFound();
    return null;
  },
  validateSearch: (search: Record<string, unknown>): { confirm?: string; delete?: string } => ({
    ...(typeof search.confirm === "string" ? { confirm: search.confirm } : {}),
    ...(typeof search.delete === "string" ? { delete: search.delete } : {}),
  }),
  component: CompaniesPage,
});
