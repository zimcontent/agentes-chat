import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { Main } from "@/components/Main";
import { AiPanelPage } from "@/pages/AiPanelPage";

/** Painel de IA (docs/adr/doug-0017-agents-lean.md); `?agent=` opens "Trocar a IA" for that agent. */
export const Route = createFileRoute("/org/$orgId/ai")({
  validateSearch: (search: Record<string, unknown>): { agent?: string } => ({
    agent: typeof search.agent === "string" && search.agent ? search.agent : undefined,
  }),
  component: function AiPanel() {
    const { agent } = Route.useSearch();
    const navigate = useNavigate({ from: Route.fullPath });
    return (
      <Main>
        <AiPanelPage agentId={agent} onDone={() => void navigate({ search: {}, replace: true })} />
      </Main>
    );
  },
});
