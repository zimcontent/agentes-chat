import { View } from "react-native";
import { AgentAvatar } from "@/agent/AgentAvatar";
import { Text } from "@/ui/Text";
import { useTheme } from "@/ui/theme";

export default function Index() {
  const { colors } = useTheme();
  return (
    <View style={{ flex: 1, backgroundColor: colors.bg, padding: 24, gap: 12 }}>
      <Text variant="display">DougBot</Text>
      <View style={{ flexDirection: "row", gap: 12 }}>
        <AgentAvatar agent={{ color: "sky", eyes: "round", name: "Doug BOSS" }} size={96} />
        <AgentAvatar agent={{ color: "sky", eyes: "round", name: "ROSA" }} size={96} />
        <AgentAvatar agent={{ color: "sky", eyes: "round", name: "SONY" }} size={44} mode="run" />
        <AgentAvatar agent={{ color: "sky", eyes: "round", name: "Doug" }} size={44} />
      </View>
    </View>
  );
}
