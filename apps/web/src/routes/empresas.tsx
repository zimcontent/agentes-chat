import { createFileRoute } from "@tanstack/react-router";
import { CompaniesPage } from "@/pages/CompaniesPage";

/** The public form ("Quero o DougBot na minha empresa"): a company asks for DougBot, with a consent and the bot check. */
export const Route = createFileRoute("/empresas")({
  component: CompaniesPage,
});
