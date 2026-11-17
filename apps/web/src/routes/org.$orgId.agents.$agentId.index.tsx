import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { Main } from "@/components/Main";
import { agentSearch } from "@/lib/agent-edit";
import { AgentPage } from "@/pages/AgentPage";

/**
 * The agent's page (docs/adr/doug-0017-agents-lean.md): with no `?tab=` it opens lean (who it is, how it is now, its
 * day); `?tab=` and `?sec=` (a section of Configurações) open Ajustes at that part, and `&brain=` a screen of "Quem
 * pensa". A `?sec=` alone, as older links have it, opens Configurações at that section.
 */
export const Route = createFileRoute("/org/$orgId/agents/$agentId/")({
  validateSearch: agentSearch,
  component: function Agent() {
    const { agentId } = Route.useParams();
    const { tab, sec, brain } = Route.useSearch();
    const navigate = useNavigate({ from: Route.fullPath });
    const shown = tab ?? (sec ? "settings" : undefined);
    return (
      <Main>
        <AgentPage
          agentId={agentId}
          tab={shown}
          section={sec}
          brainAt={brain}
          onNavigate={(next, section) =>
            void navigate({
              search: { tab: next, sec: section },
              // Between Ajustes' tabs the address changes in place; into Ajustes and back out is a step of its own.
              replace: shown !== undefined && next !== undefined,
              resetScroll: next === undefined || shown === undefined,
            })
          }
        />
      </Main>
    );
  },
});
