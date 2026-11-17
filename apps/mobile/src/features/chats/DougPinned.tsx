import { useLiveVoice, useMe } from "@agenteschat/client";
import { canTalk } from "@agenteschat/client/lib/audience";
import { rightHandOf } from "@agenteschat/client/lib/right-hand";
import { dayPart } from "@agenteschat/client/lib/welcome";
import { useTranslation } from "react-i18next";
import { Alert } from "react-native";
import { useCalls } from "../call/CallProvider";
import { useOpenDm } from "../new/useOpenDm";
import { AgentFace } from "../shared/Face";
import { useDirectory, useMeId, useOrgId } from "../shared/hooks";
import { DougPinnedCard, useDougWords } from "./DougPinnedCard";
import type { ConversationRow } from "./logic";
import { dougCardLine } from "./logic";

/**
 * Doug pinned on Início (docs/adr/doug-0016-doug-pinned.md): the right hand above the tools, in the site's chosen
 * card (the lime's wash, hairline and glow), with what it is doing, one line of what waits on you, and two actions:
 * its conversation (on the decisions when some wait) and a call. Its row leaves Agentes' list while it is here.
 */
export function DougPinned({ rows, working, waiting }: { rows: ConversationRow[]; working: number; waiting: number }) {
  const { t } = useTranslation();
  const w = useDougWords();
  const dir = useDirectory();
  const meId = useMeId();
  const openDm = useOpenDm();
  const calls = useCalls();
  const voice = useLiveVoice(useOrgId());
  const myName = useMe().data?.user.name ?? "";
  const doug = rightHandOf(dir.agents);
  if (!doug || !canTalk(doug)) return null;
  const dm = rows.find((r) => r.kind === "dm" && r.with.type === "agent" && r.with.id === doug.id);
  const channelId = dm?.channelId ?? null;
  const line = dougCardLine({ waiting, working });
  const open = () => void openDm({ agentId: doug.id });
  // "Boa noite, Gabriel." before what waits: the first name, as the rest of the app greets.
  const greeting = (full: string) => {
    const first = full.trim().split(/\s+/)[0] ?? "";
    const part = dayPart(new Date().getHours());
    return first ? `${t(`mobile.home.greeting.${part}`, { name: first })}.` : `${t(`mobile.home.hello.${part}`)}.`;
  };
  const call = () => {
    if (!calls || !channelId) return open();
    if (voice.data?.state !== "ok")
      return Alert.alert(t("liveVoice.call.needsKeyTitle", { name: doug.name }), t("liveVoice.call.keyWhere"));
    calls.callAgent(doug.id, channelId, doug.name);
  };
  return (
    <DougPinnedCard
      face={<AgentFace agentId={doug.id} size={50} mode={working > 0 ? "run" : "idle"} />}
      name={doug.name}
      status={line.working > 0 ? w.coordinating(line.working) : w.ready}
      message={`${greeting(myName)} ${line.waiting > 0 ? w.decisions(line.waiting) : w.calm}`}
      primary={line.waiting > 0 ? w.seeDecisions : w.talk}
      words={w}
      live={line.working > 0}
      onOpen={open}
      // A call needs the conversation it happens in: before the first one, "Ligar" opens it.
      onCall={meId ? call : open}
    />
  );
}
