import { useLiveVoice, useMe } from "@agenteschat/client";
import { canTalk } from "@agenteschat/client/lib/audience";
import { can } from "@agenteschat/client/lib/permissions";
import { rightHandOf } from "@agenteschat/client/lib/right-hand";
import { dayPart } from "@agenteschat/client/lib/welcome";
import { useTranslation } from "react-i18next";
import { Alert } from "react-native";
import { useOrg } from "@/providers/org";
import { router } from "@/ui/navigation";
import { useCalls } from "../call/CallProvider";
import { chatHref } from "../links/logic";
import { useOpenDm } from "../new/useOpenDm";
import { useDirectory, useMeId, useOrgId } from "../shared/hooks";
import { useWorkingNow } from "../shared/queries";
import { agentTasksHref } from "../task-manager/logic";
import { DougIcon, DougPinnedCard, useDougWords } from "./DougPinnedCard";
import type { ConversationRow } from "./logic";
import { dougCardLine, dougGreetingFits } from "./logic";

/**
 * Doug pinned on Início (docs/adr/doug-0016-doug-pinned.md): the right hand above the tools, in the site's chosen
 * card (the lime's wash and hairline), his face with the agents he coordinates now around it, one line of what
 * waits on you (Pendentes' own count) and three buttons: Ligar, Conversar and Ver as decisões. Its row leaves
 * Agentes' list while it is here.
 */
export function DougPinned({ rows, waiting }: { rows: ConversationRow[]; waiting: number }) {
  const { t } = useTranslation();
  const w = useDougWords();
  const dir = useDirectory();
  const meId = useMeId();
  const openDm = useOpenDm();
  const calls = useCalls();
  const { org } = useOrg();
  const voice = useLiveVoice(useOrgId());
  const work = useWorkingNow();
  const myName = useMe().data?.user.name ?? "";
  const doug = rightHandOf(dir.agents);
  if (!doug || !canTalk(doug)) return null;
  const dm = rows.find((r) => r.kind === "dm" && r.with.type === "agent" && r.with.id === doug.id);
  const channelId = dm?.channelId ?? null;
  const working = new Set(work.filter((x) => x.agentId !== doug.id).map((x) => x.agentId)).size;
  const line = dougCardLine({ waiting, working });
  const status = line.waiting > 0 ? w.waiting(line.waiting) : w.nothingWaiting;
  // "Boa noite, Gabriel." before the line, only while both fit on it: the first name, as the rest of the app greets.
  const first = myName.trim().split(/\s+/)[0] ?? "";
  const part = dayPart(new Date().getHours());
  const hello = first ? `${t(`mobile.home.greeting.${part}`, { name: first })}.` : "";
  // His conversation already in the list opens straight, as its row would (no server call that could fail without a
  // word); only before the first one does the server open it.
  const open = () => (channelId ? router.push(chatHref(channelId)) : void openDm({ agentId: doug.id }));
  const call = () => {
    if (!calls || !channelId) return open();
    if (voice.data?.state !== "ok")
      return Alert.alert(t("liveVoice.call.needsKeyTitle", { name: doug.name }), t("liveVoice.call.keyWhere"));
    calls.callAgent(doug.id, channelId, doug.name);
  };
  // What he decided and did without asking: the audit narrowed to him (his tool calls, the ones that never asked
  // marked), for whoever reads the audit; anyone else gets his tasks, what he is doing and finished today.
  const decisions = () =>
    can(org, "view_audit")
      ? router.navigate(`/settings/audit?agent=${doug.id}`)
      : router.navigate(agentTasksHref(doug.id, null));
  return (
    <DougPinnedCard
      face={<DougIcon />}
      name={doug.name}
      status={status}
      greeting={dougGreetingFits(hello, status) ? hello : ""}
      working={working}
      words={w}
      onTalk={open}
      // A call needs the conversation it happens in: before the first one, "Ligar" opens it.
      onCall={meId ? call : open}
      onDecisions={decisions}
      // What waits is listed in Pendentes, with the same count.
      onStatus={line.waiting > 0 ? () => router.navigate("/activity") : undefined}
    />
  );
}
