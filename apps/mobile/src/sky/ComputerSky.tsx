import type { AgentColorName } from "@dougbot/ui/agent/engine";
import { type StyleProp, View, type ViewStyle } from "react-native";

/**
 * Where the agent's sky stood behind its computer while the screen opens. DougBot has no decorative sky: an empty
 * box with the caller's style, so the stage stays the plain ground.
 */
export function ComputerSky({ style }: { color?: AgentColorName; style?: StyleProp<ViewStyle> }) {
  return (
    <View
      style={style}
      pointerEvents="none"
      accessibilityElementsHidden
      importantForAccessibility="no-hide-descendants"
    />
  );
}
