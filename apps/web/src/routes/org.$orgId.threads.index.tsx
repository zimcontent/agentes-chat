import { createFileRoute, redirect } from "@tanstack/react-router";
import { Main } from "@/components/Main";
import { openSearch } from "@/lib/open-param";
import { ThreadsPage } from "@/pages/ThreadsPage";
import { THREAD_TABS, type ThreadsTab } from "@/pages/thread-tabs";

/**
 * A channel's threads (`?channel=`, from its header's "Threads (N)"), `?tab=archived` and `?open=` (one beside the
 * list). Work lives in Tarefas, missions included (ADR doug-0018): with no channel, and from an older link to the
 * missions (`?tab=missions`, a notification), the address goes there.
 */
export const Route = createFileRoute("/org/$orgId/threads/")({
  validateSearch: (
    search: Record<string, unknown>,
  ): { tab?: ThreadsTab | "missions"; channel?: string; open?: string | number } => ({
    ...openSearch(search),
    ...(THREAD_TABS.includes(search.tab as ThreadsTab) || search.tab === "missions"
      ? { tab: search.tab as ThreadsTab | "missions" }
      : {}),
    ...(typeof search.channel === "string" && search.channel ? { channel: search.channel } : {}),
  }),
  beforeLoad: ({ search, params }) => {
    if (search.tab === "missions" || !search.channel)
      throw redirect({
        to: "/org/$orgId/issues",
        params,
        search: (search.tab === "missions" ? { view: "missions" } : {}) as never,
        replace: true,
      });
  },
  component: function Threads() {
    const { tab, channel } = Route.useSearch();
    return (
      <Main>
        <ThreadsPage
          key={`${tab ?? ""}:${channel ?? ""}`}
          initialTab={tab === "missions" ? undefined : tab}
          initialChannel={channel}
        />
      </Main>
    );
  },
});
