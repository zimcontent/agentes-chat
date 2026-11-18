import { createFileRoute } from "@tanstack/react-router";
import { LegalPage } from "@/pages/LegalPage";

/** The Privacy Policy in English, at the address the project has always used for it. */
export const Route = createFileRoute("/privacy")({
  component: () => <LegalPage kind="privacy" lang="en" />,
});
