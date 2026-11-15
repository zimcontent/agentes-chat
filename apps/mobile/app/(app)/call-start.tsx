import { useLocalSearchParams } from "expo-router";
import { StartCallSheet } from "@/features/call/CallSheets";
import { isSafeId } from "@/features/shared/logic";

/** "Chamada de voz" from a conversation (`?channelId=&title=`): agents, a topic and people to call. */
export default function CallStartRoute() {
  const { channelId, title } = useLocalSearchParams<{ channelId?: string; title?: string }>();
  if (!isSafeId(channelId)) return null;
  return <StartCallSheet channelId={channelId} title={title ?? ""} />;
}
