import type { AgentColorName } from "@agenteschat/ui/agent/engine";
import { useState } from "react";
import { type LayoutChangeEvent, View } from "react-native";
import Svg, { Circle, Rect } from "react-native-svg";
import { useTheme } from "@/ui/theme";
import { MONTH_CELL, MONTH_ROWS, type MonthDay, monthNow } from "./month-pixels";

/** The tallest bar leaves room for a failure's cap over it. */
const CAP = 2;
const CAP_GAP = 2;

/**
 * The agent's month under "Fez" on its profile, drawn as clean vectors (DougBot: no pixel art): a thin bar per day
 * with rounded corners, as tall as that day's runs over the busiest day's, in neutral ink; a day with a failure wears
 * a short red cap; a day without runs, and every day to come, is a small dot on the line. `label` says what it shows:
 * a screen reader hears it as one image. `color` is kept for the callers.
 */
export function MonthPixels({ perDay, label }: { perDay: readonly MonthDay[]; color: AgentColorName; label: string }) {
  const { colors } = useTheme();
  const [width, setWidth] = useState(0);
  const { days, today } = monthNow(new Date());
  const height = MONTH_ROWS * MONTH_CELL;
  const onLayout = (e: LayoutChangeEvent) => setWidth(Math.round(e.nativeEvent.layout.width));
  const byDay = new Map(perDay.map((d) => [d.day, d]));
  const max = Math.max(1, ...perDay.map((d) => d.runs));
  const slot = width / days;
  const barW = Math.max(2, Math.min(6, slot * 0.6));
  const base = height - 1;
  const room = height - 1 - CAP - CAP_GAP;
  return (
    <View style={{ height }} onLayout={onLayout} accessible accessibilityRole="image" accessibilityLabel={label}>
      {width ? (
        <Svg width={width} height={height}>
          {Array.from({ length: days }, (_, i) => {
            const d = i + 1;
            const mid = (i + 0.5) * slot;
            const day = byDay.get(d);
            if (d > today || !day || day.runs === 0)
              return <Circle key={d} cx={mid} cy={base - 1} r={1} fill={colors.faint} />;
            const h = Math.max(3, Math.round((day.runs / max) * room));
            return (
              <Rect
                key={d}
                x={mid - barW / 2}
                y={base - h}
                width={barW}
                height={h}
                rx={Math.min(2, barW / 2)}
                fill={colors.muted}
              />
            );
          })}
          {Array.from({ length: days }, (_, i) => {
            const d = i + 1;
            const day = byDay.get(d);
            if (d > today || !day || day.runs === 0 || day.failed <= 0) return null;
            const h = Math.max(3, Math.round((day.runs / max) * room));
            return (
              <Rect
                key={`f${d}`}
                x={(i + 0.5) * slot - barW / 2}
                y={base - h - CAP_GAP - CAP}
                width={barW}
                height={CAP}
                rx={1}
                fill={colors.danger}
              />
            );
          })}
        </Svg>
      ) : null}
    </View>
  );
}
