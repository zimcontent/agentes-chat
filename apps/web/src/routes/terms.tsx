import { createFileRoute } from "@tanstack/react-router";
import { LegalPage } from "@/pages/LegalPage";

/** The Terms of Use in English, at the address the project has always used for them. */
export const Route = createFileRoute("/terms")({
  component: () => <LegalPage kind="terms" lang="en" />,
});
