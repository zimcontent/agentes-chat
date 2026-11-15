import { useChannelLiveRoom, useLiveVoice } from "@agenteschat/client";
import { useTranslation } from "react-i18next";
import { Alert } from "react-native";
import { IconButton } from "@/ui";
import { router } from "@/ui/navigation";
import { useOrgId } from "../shared/hooks";
import { useCalls } from "./CallProvider";

/**
 * The phone in a conversation's header (docs/adr/doug-0006-live-voice.md, the phone app): an agent's DM calls that
 * agent; elsewhere it opens "Chamada de voz" (agents, topic, people); with a call live here that this phone isn't on,
 * it joins it.
 */
export function CallButton({
  channelId,
  title,
  dmAgentId,
}: {
  channelId: string;
  title: string;
  dmAgentId?: string | null;
}) {
  const { t } = useTranslation();
  const orgId = useOrgId();
  const calls = useCalls();
  const status = useLiveVoice(orgId);
  const room = useChannelLiveRoom(orgId, channelId, Boolean(calls));
  if (!calls) return null;
  const current = calls.current;
  const inThisCall = current?.channelId === channelId;
  const live = room.data;
  if (inThisCall)
    return <IconButton icon="handset" label={t("liveVoice.room.open")} onPress={() => router.push("/call")} />;
  if (live)
    return (
      <IconButton
        icon="handset"
        label={t("liveVoice.call.join", { count: live.people.length })}
        onPress={() => calls.startRoom(channelId, title, [])}
      />
    );
  const available = status.data?.state === "ok";
  return (
    <IconButton
      icon="handset"
      label={dmAgentId ? t("liveVoice.call.callAgent", { name: title }) : t("liveVoice.call.start")}
      onPress={() => {
        if (dmAgentId && !available)
          Alert.alert(t("liveVoice.call.needsKeyTitle", { name: title }), t("liveVoice.call.keyWhere"));
        else if (dmAgentId) calls.callAgent(dmAgentId, channelId, title);
        else router.push({ pathname: "/call-start", params: { channelId, title } });
      }}
    />
  );
}
