import { useLocalSearchParams } from "expo-router";
import { AgentSettingsScreen } from "@/features/agents/AgentSettingsScreen";

/** An agent's light settings, from "Ajustes" on its profile. */
export default function AgentSettingsRoute() {
  const { id } = useLocalSearchParams<{ id: string }>();
  return <AgentSettingsScreen key={id} id={id ?? ""} />;
}
