import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { Main } from "@/components/Main";
import { boardSearch } from "@/lib/open-param";
import { IssuesPage } from "@/pages/IssuesPage";
import { MissionsView } from "@/pages/MissionsView";

/**
 * Issues: board and list. `?project=<id>` is that project's board (`none`: the tasks with no project). `?open=131`
 * opens an issue's details, `&m=<message>` its conversation at that message. `?view=missions` is the missions, which
 * live with the tasks (ADR doug-0018). The page scrolls in the main column like every non-chat page (the chat layout
 * clips its overflow: a tall column could not be reached).
 */
export const Route = createFileRoute("/org/$orgId/issues/")({
  validateSearch: (search: Record<string, unknown>): ReturnType<typeof boardSearch> & { view?: "missions" } => ({
    ...boardSearch(search),
    ...(search.view === "missions" ? { view: "missions" as const } : {}),
  }),
  component: function Issues() {
    const { view } = Route.useSearch();
    const navigate = useNavigate();
    return (
      <Main>
        {view === "missions" ? (
          <MissionsView onBack={() => void navigate({ to: ".", search: {} as never })} />
        ) : (
          <IssuesPage />
        )}
      </Main>
    );
  },
});
