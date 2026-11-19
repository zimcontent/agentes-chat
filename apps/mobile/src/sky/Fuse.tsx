import type { AgentColorName } from "@dougbot/ui/agent/engine";
import type { StyleProp, ViewStyle } from "react-native";
import { useTheme } from "@/ui/theme";
import { LineBar } from "./Dither";

export interface FuseProps {
  /** The asking agent (kept for the callers; the bar is never in a bot's color). */
  color: AgentColorName;
  /** Time left, 0..1. */
  remaining: number;
  style?: StyleProp<ViewStyle>;
}

/**
 * A request's time left to its expiry: a plain bar in amber, the one color for what waits on you and what expires
 * (DougBot "Atenção"); red in its last tenth, when it is about to lapse.
 */
export function Fuse({ remaining, style }: FuseProps) {
  const { colors } = useTheme();
  const left = Math.max(0, Math.min(1, remaining));
  return (
    <LineBar
      value={left}
      fill={left <= 0.1 ? colors.danger : colors.amber}
      style={[{ height: 6, flex: 1, minWidth: 0 }, style]}
    />
  );
}
