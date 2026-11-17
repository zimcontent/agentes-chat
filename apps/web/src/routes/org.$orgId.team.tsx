import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { Main } from "@/components/Main";
import { isTeamView, TeamPage, type TeamView } from "@/pages/TeamPage";

/**
 * Equipe: "Seu time agora" (docs/adr/doug-0017-agents-lean.md), and `?view=` the team's other views (list, chart,
 * map, setores, usage).
 */
export const Route = createFileRoute("/org/$orgId/team")({
  validateSearch: (search: Record<string, unknown>): { view?: Exclude<TeamView, "now"> } =>
    isTeamView(search.view) && search.view !== "now" ? { view: search.view } : {},
  component: function Team() {
    const { view } = Route.useSearch();
    const navigate = useNavigate({ from: Route.fullPath });
    return (
      <Main>
        <TeamPage
          view={view ?? "now"}
          onView={(next) => void navigate({ search: next === "now" ? {} : { view: next }, replace: true })}
        />
      </Main>
    );
  },
});
