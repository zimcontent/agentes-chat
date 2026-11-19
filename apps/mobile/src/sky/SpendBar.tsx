import type { AgentColorName } from "@dougbot/ui/agent/engine";
import type { StyleProp, ViewStyle } from "react-native";
import { useTheme } from "@/ui/theme";
import { LineBar } from "./Dither";

export interface SpendBarProps {
  /** The agent (kept for the callers; the bar is neutral). */
  color: AgentColorName;
  /** Share of the budget used, 0..1. */
  value: number;
  style?: StyleProp<ViewStyle>;
}

/** Share of the budget from which the bar warns. */
const WARN_AT = 0.8;

/**
 * An agent's spend against its budget: a plain 6-point bar in the same 10-point box as before, neutral ink while
 * there is room, amber from 80% and red once the budget is spent.
 */
export function SpendBar({ value, style }: SpendBarProps) {
  const { colors } = useTheme();
  const v = Math.max(0, Math.min(1, value));
  const fill = v >= 1 ? colors.danger : v >= WARN_AT ? colors.warn : colors.ink2;
  return <LineBar value={v} fill={fill} thickness={6} style={[{ height: 10, alignSelf: "stretch" }, style]} />;
}
