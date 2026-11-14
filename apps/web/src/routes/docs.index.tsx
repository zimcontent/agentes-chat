import { createFileRoute } from "@tanstack/react-router";
import { DocsPage } from "@/pages/DocsPage";

/** DougBot's docs, public: the list of every page (`@/docs/doug-docs`). */
export const Route = createFileRoute("/docs/")({
  component: () => <DocsPage />,
});
