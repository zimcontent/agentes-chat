import { lowerFirst } from "@dougbot/client/lib/format";
import { isRightHand } from "@dougbot/client/lib/right-hand";
import { useMemo } from "react";
import { useTranslation } from "react-i18next";
import { router } from "@/ui/navigation";
import { useWaitingItems } from "../chats/useWaitingItems";
import { useDirectory, useNow } from "../shared/hooks";
import { agentLook, genderOf } from "../shared/logic";
import { PushedHeader } from "../shared/parts";
import { useActiveWork, useHiddenAgents } from "../shared/queries";
import { usePresenceOf } from "../status/hooks";
import { TEAM_ORDER, type TeamNow, teamNowOf } from "./lite";
import { agoOf } from "./logic";
import { type TeamNowRow, TeamNowView } from "./TeamNowView";
import { agoText, workTitle } from "./work";

/**
 * "Seu time agora" (Início's Agentes): the right hand and how many agents it coordinates, then every agent the person
 * sees with what it is on now, waiting on them first. A row opens the agent's profile.
 */
export function TeamNowScreen() {
  const { t, i18n } = useTranslation();
  const dir = useDirectory();
  const { hidden } = useHiddenAgents();
  const work = useActiveWork();
  const waiting = useWaitingItems().items;
  const presenceOf = usePresenceOf();
  const now = useNow();
  const doug = dir.agents.find(isRightHand);
  const team = useMemo(() => dir.agents.filter((a) => !isRightHand(a) && !hidden.has(a.id)), [dir.agents, hidden]);

  const rows = useMemo(() => {
    const out: (TeamNowRow & { order: number })[] = team.map((a, i) => {
      const shown = presenceOf.agent(a.id);
      const state: TeamNow = teamNowOf({
        presence: shown?.presence ?? null,
        work: work.filter((w) => w.agentId === a.id),
        waiting: waiting.filter((w) => w.agentId === a.id),
      });
      const g = genderOf(a.name);
      const base = {
        key: a.id,
        look: agentLook(a),
        name: a.name,
        trade: a.role?.trim() ? lowerFirst(a.role.trim(), i18n.language) : null,
        onPress: () => router.push(`/agent/${a.id}`),
      };
      const order = TEAM_ORDER[state.kind] * 1000 + i;
      switch (state.kind) {
        case "working":
          return {
            ...base,
            order,
            mode: "run" as const,
            line: workTitle(t, state.work),
            sub: t("mobile.teamNow.since", { ago: agoText(t, agoOf(state.work.since, now)) }),
            waiting: false,
            progress: state.progress,
          };
        case "waiting":
          return {
            ...base,
            order,
            mode: "think" as const,
            line: state.what ?? t("mobile.teamNow.asks"),
            sub: t("mobile.teamNow.waitsYou"),
            waiting: true,
            progress: null,
          };
        case "stopped":
          return {
            ...base,
            order,
            mode: "sleep" as const,
            line: t(`mobile.teamNow.stopped${g}`),
            sub: shown?.line?.text ?? t(`presence.agentWhy.${shown?.noAi ? "noAi" : state.why}`),
            waiting: false,
            progress: null,
          };
        default:
          return {
            ...base,
            order,
            mode: "idle" as const,
            line: t(`mobile.teamNow.free${g}`),
            sub: shown?.line?.text ?? null,
            waiting: false,
            progress: null,
          };
      }
    });
    return out.sort((a, b) => a.order - b.order);
  }, [team, presenceOf, work, waiting, now, t, i18n.language]);

  const working = rows.filter((r) => r.mode === "run").length;
  const asking = rows.filter((r) => r.waiting).length;
  const sub = [
    working > 0 ? t("mobile.teamNow.working", { count: working }) : null,
    asking > 0 ? t("mobile.teamNow.asking", { count: asking }) : null,
  ]
    .filter(Boolean)
    .join(" · ");
  return (
    <>
      <PushedHeader title={t("mobile.teamNow.title")} solid={false} />
      <TeamNowView
        lead={
          doug
            ? {
                look: agentLook(doug),
                title: t("mobile.teamNow.lead", { name: doug.name, count: rows.length }),
                sub: sub || t("mobile.teamNow.quiet"),
                onPress: () => router.push(`/agent/${doug.id}`),
              }
            : null
        }
        rows={rows}
        empty={t("mobile.teamNow.empty")}
      />
    </>
  );
}
