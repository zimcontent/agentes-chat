import type { Agent } from "@agenteschat/client";
import { useAiStatus } from "@agenteschat/client";
import { listsAgent } from "@agenteschat/client/lib/audience";
import { mayPickModel } from "@agenteschat/client/lib/brain-picker";
import { agentGrammar } from "@agenteschat/client/lib/grammar";
import { can } from "@agenteschat/client/lib/permissions";
import { isRightHand } from "@agenteschat/client/lib/right-hand";
import { Button, Card, EmptyState, GroupHeading, PageHeader } from "@agenteschat/ui";
import { Link } from "@tanstack/react-router";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { AgentAvatar } from "@/components/AgentAvatar";
import { ChangeAiDialog } from "@/components/ai/ChangeAiDialog";
import { ModelPickerButton } from "@/components/ai/ModelPicker";
import { StandInOrderCard } from "@/components/ai/StandInOrder";
import { LoadingList } from "@/components/Loading";
import { useOrg } from "@/components/org-context";
import { PlanUsageCards } from "@/components/PlanUsage";
import { useDirectory } from "@/hooks/useDirectory";
import "./ai-panel.css";

/**
 * Painel de IA (docs/adr/doug-0017-agents-lean.md): the place to change an agent's AI on purpose and to look after the
 * AI accounts. "Quem usa o quê": each agent with what it thinks with (the full picker on its chip) and "Trocar a IA"
 * by intent; then the accounts, as Configurações › IA e uso lists them, and the backup order. `agent` opens that
 * agent's change at once (its page's IA row, Ctrl+K).
 */
export function AiPanelPage({ agentId, onDone }: { agentId?: string | undefined; onDone: () => void }) {
  const { t } = useTranslation();
  const { org, me } = useOrg();
  const dir = useDirectory(org.id);
  // Asked with the page, so every chip says at once whether its agent has an AI.
  useAiStatus(org.id);
  const manages = can(org, "manage_agents");
  const agents = dir.agents.filter((a) => listsAgent(org, a));
  // The right hand thinks with each person's own AI, set on its own page: it stays on top, without "Trocar".
  const ordered = [...agents.filter(isRightHand), ...agents.filter((a) => !isRightHand(a))];
  const [changing, setChanging] = useState<Agent | null>(null);
  const asked = agentId ? dir.agentById.get(agentId) : undefined;
  const open = changing ?? asked ?? null;
  return (
    <div className="page aip">
      <PageHeader
        title={t("aiPanel.title")}
        actions={
          <Button asChild>
            <Link to="/org/$orgId/settings/$section" params={{ orgId: org.id, section: "usage" }}>
              {t("aiPanel.usage")}
            </Link>
          </Button>
        }
      />
      <section className="aip-group" aria-labelledby="aip-uses">
        <GroupHeading id="aip-uses" title={t("aiPanel.uses")} count={dir.loading ? undefined : ordered.length} />
        <Card className="aip-list">
          {dir.loading ? (
            <LoadingList count={4} />
          ) : ordered.length === 0 ? (
            <EmptyState icon="agent">{t("aiPanel.noAgents")}</EmptyState>
          ) : (
            ordered.map((a) => {
              const picks = !isRightHand(a) && mayPickModel(a, me.user.id, manages);
              return (
                <div key={a.id} className="aip-row">
                  <Link to="/org/$orgId/agents/$agentId" params={{ orgId: org.id, agentId: a.id }} className="aip-who">
                    <AgentAvatar agentId={a.id} size="sm" name={a.name} />
                    <b className="aip-who__text">{a.name}</b>
                  </Link>
                  {a.role && <span className="aip-role muted">{a.role}</span>}
                  <span className="aip-model">
                    <ModelPickerButton agent={a} size="row" />
                  </span>
                  {picks && (
                    <Button
                      size="sm"
                      aria-label={t("aiPanel.dialog.title", agentGrammar(a.name))}
                      onClick={() => setChanging(a)}
                    >
                      {t("aiPanel.change")}
                    </Button>
                  )}
                </div>
              );
            })
          )}
        </Card>
      </section>
      <section className="aip-group" aria-labelledby="aip-accounts">
        <GroupHeading id="aip-accounts" title={t("aiPanel.accounts")} />
        <PlanUsageCards />
        <StandInOrderCard />
      </section>
      {open && (
        <ChangeAiDialog
          key={open.id}
          agent={open}
          onClose={() => {
            setChanging(null);
            if (asked) onDone();
          }}
        />
      )}
    </div>
  );
}
