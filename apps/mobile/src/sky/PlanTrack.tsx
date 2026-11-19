import type { AgentColorName } from "@dougbot/ui/agent/engine";
import { type StyleProp, View, type ViewStyle } from "react-native";
import { useTheme } from "@/ui/theme";
import { Animated, usePulse } from "./Dither";
import { MAX_PLAN_ITEMS, type PlanState } from "./math";

export interface PlanTrackProps {
  /** The agent (kept for the callers; the track is neutral). */
  color: AgentColorName;
  /** One segment per plan item (the first 48). */
  items: PlanState[];
  /** The box's height (default 10); the segments are a thin line centered in it. */
  height?: number;
  style?: StyleProp<ViewStyle>;
}

/** The segments' thickness and the gap between two. */
const LINE = 4;
const GAP = 2;

/**
 * A mission's plan as a segmented line: done segments in neutral ink, the running one pulsing lightly, the rest in
 * the rail's tone. Decorative: the screen says the plan in words.
 */
export function PlanTrack({ items, height = 10, style }: PlanTrackProps) {
  const { colors } = useTheme();
  const list = items.slice(0, MAX_PLAN_ITEMS);
  const pulse = usePulse(list.includes("run"));
  const thickness = Math.min(LINE, height);
  return (
    <View
      style={[{ height, alignSelf: "stretch", flexDirection: "row", alignItems: "center", gap: GAP }, style]}
      pointerEvents="none"
      accessibilityElementsHidden
      importantForAccessibility="no-hide-descendants"
    >
      {list.map((state, i) => {
        const seg = {
          flex: 1,
          minWidth: 1,
          height: thickness,
          borderRadius: thickness / 2,
          backgroundColor: state === "todo" ? colors.line : colors.ink2,
        };
        return state === "run" ? (
          // biome-ignore lint/suspicious/noArrayIndexKey: the plan's order is its identity
          <Animated.View key={i} style={[seg, pulse]} />
        ) : (
          // biome-ignore lint/suspicious/noArrayIndexKey: the plan's order is its identity
          <View key={i} style={seg} />
        );
      })}
    </View>
  );
}
