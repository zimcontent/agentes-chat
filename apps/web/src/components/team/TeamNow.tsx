import type { AgentStatus, Team } from "@dougbot/client";
import { useAgentStatuses, useAiStatus, useChannels, useWaitingOnMe } from "@dougbot/client";
import { agentWork, WORK_TICK_MS, workLine } from "@dougbot/client/lib/agent-work";
import { agentFaceOf, agentFaceWord, agentStatusText } from "@dougbot/client/lib/presence";
import { isRightHand } from "@dougbot/client/lib/right-hand";
import { Button, Card } from "@dougbot/ui";
import { Link } from "@tanstack/react-router";
import { useTranslation } from "react-i18next";
import { AgentAvatar } from "@/components/AgentAvatar";
import { AgentWorkLine } from "@/components/AgentWorkLine";
import { useOrg } from "@/components/org-context";
import { useDirectory } from "@/hooks/useDirectory";
import { useNow } from "@/hooks/useNow";
import "./team-now.css";

/** The order rows read in: what waits on you, who works, who is free, who is off. */
const RANK = { you: 0, working: 1, other: 2, free: 3, off: 4 } as const;

/**
 * "Seu time agora" (docs/adr/doug-0017-agents-lean.md): the team's front. The right hand on top, coordinating, with
 * how many work and wait on you; then each agent with what it does now (its own line, else its face's word) and its
 * work's line ("esperando você" in amber, where and for how long). A row opens the agent's page. The other views of
 * the team (list, chart, map, setores, usage) stay a choice away.
 */
export function TeamNow({ team }: { team: Team }) {
  const { t, i18n } = useTranslation();
  const locale = i18n.language;
  const { org } = useOrg();
  const dir = useDirectory(org.id);
  const statuses = useAgentStatuses(org.id).data ?? [];
  const ai = useAiStatus(org.id).data;
  const channels = useChannels(org.id).data ?? [];
  const waitingOnMe = useWaitingOnMe(org.id).data;
  const clock = useNow(WORK_TICK_MS);
  const byId = new Map<string, AgentStatus>(statuses.map((s) => [s.agentId, s]));
  const rightHand = dir.agents.find(isRightHand);
  const names = {
    agentName: (id: string) => dir.agentById.get(id)?.name,
    channelName: (id: string) => channels.find((c) => c.id === id)?.name,
  };

  const rows = team.agents
    .filter((a) => !isRightHand(dir.agentById.get(a.id)))
    .map((a) => {
      const status = byId.get(a.id);
      const aiState = ai?.agents.find((x) => x.agentId === a.id)?.state ?? null;
      const { presence, noAi } = agentFaceOf(status, aiState, a.busy);
      const work = agentWork(status ?? null);
      const line = workLine(t, locale, work, names, clock);
      const said = !noAi && status?.status ? agentStatusText(t, status.status, locale)?.text : null;
      const rank =
        line?.tone === "you"
          ? RANK.you
          : line?.tone === "working" || presence === "working"
            ? RANK.working
            : presence === "out" || presence === "offline"
              ? RANK.off
              : line
                ? RANK.other
                : RANK.free;
      // One line under the name, so the face never sits beside more: what waits on you first, then what it does in
      // its own words, its work's line (where and for how long), else its face's word.
      const own = said && said.toLocaleLowerCase(locale) !== line?.text.toLocaleLowerCase(locale) ? said : null;
      const shown = line?.tone === "you" ? line : own ? null : line;
      const now = shown ? null : (own ?? (noAi ? t("noAi.chip") : agentFaceWord(t, presence)));
      return { agent: a, line: shown, now, rank, presence };
    })
    .sort((x, y) => x.rank - y.rank || x.agent.name.localeCompare(y.agent.name, locale));

  const working = rows.filter((r) => r.rank === RANK.working).length;
  const waiting = rows.filter((r) => r.rank === RANK.you).length;
  const waitsTotal = waitingOnMe?.count ?? 0;

  return (
    <div className="team-now">
      <Card className="team-now__lead ac-actline">
        <span className="team-now__boss">
          {rightHand && <AgentAvatar agentId={rightHand.id} size="md" name={rightHand.name} />}
          <span className="team-now__boss-text">
            <b className="ac-captop">
              {rightHand
                ? t("teamNow.coordinates", { name: rightHand.name, count: rows.length })
                : t("team.agents", { count: rows.length })}
            </b>
            <span className="muted">
              {[t("teamNow.working", { count: working }), waiting > 0 ? t("teamNow.waiting", { count: waiting }) : null]
                .filter(Boolean)
                .join(" · ")}
            </span>
          </span>
        </span>
        {waitsTotal > 0 && (
          <Button asChild size="sm" icon="question">
            <Link to="/org/$orgId/waiting" params={{ orgId: org.id }}>
              {t("teamNow.waitingButton", { count: waitsTotal })}
            </Link>
          </Button>
        )}
      </Card>
      <Card className="team-now__list">
        <ul>
          {rows.map(({ agent: a, line, now, presence }) => (
            <li key={a.id}>
              <Link
                to="/org/$orgId/agents/$agentId"
                params={{ orgId: org.id, agentId: a.id }}
                className="team-now__row"
                data-presence={presence}
              >
                <AgentAvatar agentId={a.id} size="md" name={a.name} />
                <span className="team-now__text">
                  <span className="team-now__name ac-captop">
                    <b>{a.name}</b>
                    {a.role && <span className="muted"> · {a.role}</span>}
                  </span>
                  {line ? (
                    <AgentWorkLine line={line} className="team-now__work" />
                  ) : (
                    <span className="team-now__now">{now}</span>
                  )}
                </span>
              </Link>
            </li>
          ))}
        </ul>
      </Card>
    </div>
  );
}
