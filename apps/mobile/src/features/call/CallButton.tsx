import { useChannelLiveRoom, useLiveVoice } from "@dougbot/client";
import { useTranslation } from "react-i18next";
import { Alert } from "react-native";
import { IconButton } from "@/ui";
import { router } from "@/ui/navigation";
import { useOrgId } from "../shared/hooks";
import { useCalls } from "./CallProvider";
import { callPress } from "./logic";

/**
 * What calling from a conversation does (docs/adr/doug-0006-live-voice.md, the phone app): an agent's DM calls that
 * agent; elsewhere it opens "Chamada de voz" (agents, topic, people); with a call live here that this phone isn't on,
 * it joins it. With no voice key, an agent's DM says what is missing (`callPress`). The header's button and the "…"
 * sheet's Ligar both go through it.
 */
export function useCallAction(channelId: string, title: string, dmAgentId?: string | null) {
  const { t } = useTranslation();
  const orgId = useOrgId();
  const calls = useCalls();
  const status = useLiveVoice(orgId);
  const room = useChannelLiveRoom(orgId, channelId, Boolean(calls));
  const live = room.data;
  const press = callPress({
    inThisCall: calls?.current?.channelId === channelId,
    live: Boolean(live),
    dmAgent: Boolean(dmAgentId),
    keyOk: status.data ? status.data.state === "ok" : null,
  });
  const label =
    press === "open"
      ? t("liveVoice.room.open")
      : press === "join"
        ? t("liveVoice.call.join", { count: live?.people.length ?? 0 })
        : dmAgentId
          ? t("liveVoice.call.callAgent", { name: title })
          : t("liveVoice.call.start");
  const run = () => {
    if (press === "open") router.push("/call");
    else if (press === "join") calls?.startRoom(channelId, title, []);
    else if (press === "needs-key")
      Alert.alert(t("liveVoice.call.needsKeyTitle", { name: title }), t("liveVoice.call.keyWhere"));
    else if (press === "call-agent" && dmAgentId && calls) calls.callAgent(dmAgentId, channelId, title);
    else router.push({ pathname: "/call-start", params: { channelId, title } });
  };
  return { label, run };
}

/** The phone in a conversation's header: always there where calls are offered, never hidden for a missing key. */
export function CallButton({
  channelId,
  title,
  dmAgentId,
}: {
  channelId: string;
  title: string;
  dmAgentId?: string | null;
}) {
  const { label, run } = useCallAction(channelId, title, dmAgentId);
  return <IconButton icon="handset" label={label} onPress={run} />;
}
