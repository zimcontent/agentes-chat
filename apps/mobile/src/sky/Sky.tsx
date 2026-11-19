import type { AgentColorName } from "@dougbot/ui/agent/engine";
import { type StyleProp, View, type ViewStyle } from "react-native";

export interface SkyProps {
  color?: AgentColorName;
  /** Kept for the callers. */
  depth?: number;
  fade?: number;
  surface?: "bg" | "raised" | "grouped";
  style?: StyleProp<ViewStyle>;
}

const hidden = { accessibilityElementsHidden: true, importantForAccessibility: "no-hide-descendants" as const };

/**
 * Where the pixel sky was (home greeting, agent cover, auth). DougBot has no decorative sky: the stage is the plain
 * dark ground, so this is an empty box with the caller's style (no layout moves).
 */
export function Sky({ style }: SkyProps) {
  return <View style={style} pointerEvents="none" {...hidden} />;
}

/** Where the workspace's sky was, behind Conversas' title: an empty box with the caller's style. */
export function WorkspaceSky({
  style,
}: {
  fade?: number;
  fadeTop?: number;
  host?: string;
  style?: StyleProp<ViewStyle>;
}) {
  return <View style={style} pointerEvents="none" {...hidden} />;
}
