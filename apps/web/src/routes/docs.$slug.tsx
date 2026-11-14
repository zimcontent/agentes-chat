import { createFileRoute, redirect } from "@tanstack/react-router";
import { docSlug } from "@/docs/doug-docs";
import { DocsPage } from "@/pages/DocsPage";

/** A page of DougBot's docs, public. An address that names no page goes to the list. */
export const Route = createFileRoute("/docs/$slug")({
  loader: ({ params }) => {
    const slug = docSlug(params.slug);
    if (!slug) throw redirect({ to: "/docs", replace: true });
    if (slug !== params.slug) throw redirect({ to: "/docs/$slug", params: { slug }, replace: true });
    return slug;
  },
  component: function Doc() {
    return <DocsPage slug={Route.useLoaderData()} />;
  },
});
