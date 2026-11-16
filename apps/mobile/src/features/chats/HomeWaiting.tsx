import { useAgentStatuses } from "@agenteschat/client";
import { workTime } from "@agenteschat/client/lib/agent-work";
import { canTalk } from "@agenteschat/client/lib/audience";
import { useTranslation } from "react-i18next";
import { LIST_AVATAR, ListRow } from "@/ui";
import { router } from "@/ui/navigation";
import { chatHref } from "../links/logic";
import { useOpenDm } from "../new/useOpenDm";
import { AgentFace } from "../shared/Face";
import { useDirectory, useNow, useOrgId } from "../shared/hooks";
import { useHiddenAgents } from "../shared/queries";
import { CollapsibleSection, SeeAllRow } from "./HomeSection";
import { type WaitingAgent, waitingAgents } from "./waiting";

/** This fork's own words, beside it in Portuguese and English (any other language reads English). */
const WORDS = {
  pt: {
    title: "Esperando sua resposta",
    answer: (name: string) => `${name} espera sua resposta`,
    approval: (name: string) => `${name} espera sua aprovação`,
    more: (n: number) => (n === 1 ? "Mais 1 esperando" : `Mais ${n} esperando`),
  },
  en: {
    title: "Waiting for your reply",
    answer: (name: string) => `${name} is waiting for your reply`,
    approval: (name: string) => `${name} is waiting for your approval`,
    more: (n: number) => `${n} more waiting`,
  },
} as const;

/** At most this many agents in sight; the rest are one row that opens Pendentes. */
const SHOWN = 3;

/**
 * Início's agents that wait on your reply, above the lists: "Rosa espera sua resposta", how long, a tap opens where
 * it waits (its conversation, else the DM). Nothing waits: nothing shows. More than three: the rest under one row
 * that opens Pendentes, where every request and question waits.
 */
export function HomeWaiting({ collapsed, onToggle }: { collapsed: boolean; onToggle: () => void }) {
  const { i18n } = useTranslation();
  const w = WORDS[i18n.language?.startsWith("pt") ? "pt" : "en"];
  const orgId = useOrgId();
  const dir = useDirectory();
  const { hidden } = useHiddenAgents();
  const statuses = useAgentStatuses(orgId).data ?? [];
  const openDm = useOpenDm();
  const now = useNow(60_000);
  const waiting = waitingAgents(statuses, (id) => {
    const agent = dir.agentById.get(id);
    return agent !== undefined && canTalk(agent) && !hidden.has(id);
  });
  if (waiting.length === 0) return null;
  const shown = waiting.slice(0, SHOWN);
  const rest = waiting.length - shown.length;
  const open = ({ agentId, work }: WaitingAgent) =>
    work.channelId ? router.push(chatHref(work.channelId, work.threadId)) : void openDm({ agentId });
  return (
    <CollapsibleSection title={w.title} count={waiting.length} collapsed={collapsed} onToggle={onToggle}>
      {shown.map((item, i) => {
        const name = dir.agentById.get(item.agentId)?.name ?? "";
        const text = item.work.ask === "approval" ? w.approval(name) : w.answer(name);
        const time = workTime(i18n.language, item.work.since, now);
        return (
          <ListRow
            key={item.agentId}
            leading={<AgentFace agentId={item.agentId} size={LIST_AVATAR - 2} presence />}
            title={text}
            // A long name still leaves the verb in sight: the line may take two.
            titleLines={2}
            time={time}
            divider={i > 0}
            chevron
            accessibilityRole="button"
            accessibilityLabel={time ? `${text}, ${time}` : text}
            onPress={() => open(item)}
          />
        );
      })}
      {rest > 0 ? <SeeAllRow label={w.more(rest)} onPress={() => router.navigate("/activity")} /> : null}
    </CollapsibleSection>
  );
}
