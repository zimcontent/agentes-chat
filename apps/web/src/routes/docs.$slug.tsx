import { createFileRoute, redirect } from "@tanstack/react-router";
import { DocsPage } from "@/pages/DocsPage";

/** A page of DougBot's docs, public. An address that names no page goes to the list. */
export const Route = createFileRoute("/docs/$slug")({
  // The docs' text is this page's alone: read as the page opens, so the app doesn't carry it on every start.
  loader: async ({ params }) => {
    const { docSlug } = await import("@/docs/doug-docs");
    const slug = docSlug(params.slug);
    if (!slug) throw redirect({ to: "/docs", replace: true });
    if (slug !== params.slug) throw redirect({ to: "/docs/$slug", params: { slug }, replace: true });
    return slug;
  },
  component: function Doc() {
    return <DocsPage slug={Route.useLoaderData()} />;
  },
});
