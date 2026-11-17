import { useLocalSearchParams } from "expo-router";
import { ChangeAiSheet } from "@/features/ai/ChangeAiSheet";
import { goBack } from "@/features/shared/parts";

/**
 * "Trocar a IA" of one agent, as a native form sheet over whatever is on screen (presentation set in `_layout`; from
 * the Painel de IA, the agent's page and the chat's "Trocar modelo").
 */
export default function AgentSwitchRoute() {
  const { id } = useLocalSearchParams<{ id: string }>();
  return <ChangeAiSheet agentId={id ?? ""} onClose={() => goBack()} />;
}
