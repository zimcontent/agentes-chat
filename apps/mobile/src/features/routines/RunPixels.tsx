import { type AgentColorName, mixHex } from "@dougbot/ui/agent/engine";
import { memo, useMemo } from "react";
import { StyleSheet, View } from "react-native";
import { Animated, usePulse } from "@/sky/Dither";
import type { AppColors } from "@/ui/palette";
import { useTheme } from "@/ui/theme";
import { RUN_SLOTS } from "./logic";
import {
  LANE_BASE,
  LANE_ROWS,
  laneWidth,
  laneX,
  RUN_CELL,
  type RunPixel,
  type RunTones,
  STRIP_ROWS,
  spriteX,
  stripWidth,
} from "./run-pixels";

/**
 * A routine's runs drawn as clean vectors (DougBot: no pixel art): each run a small bar with rounded corners, as tall
 * as its cost, neutral when it went well, red when it failed, amber when it was skipped, a stub when it found nothing
 * new. The boxes keep the old pixel drawings' sizes (./run-pixels.ts), so nothing moves.
 */

/** The old pixel tones from the theme (kept for whoever still reads them). */
export function useRunTones(): RunTones {
  const { colors } = useTheme();
  return useMemo(
    () => ({
      raised: colors.raised,
      danger: colors.danger,
      warn: colors.warn,
      dot: mixHex(colors.raised, colors.faint, 0.45),
    }),
    [colors.raised, colors.danger, colors.warn, colors.faint],
  );
}

const COLUMN_W = 3 * RUN_CELL;
const COLUMN_GAP = RUN_CELL;
const STRIP_H = STRIP_ROWS * RUN_CELL;

/** A run's bar height (`full` the tallest) and tone. */
function runBar(run: RunPixel, full: number, c: AppColors): { h: number; color: string } {
  const min = Math.ceil(full * 0.4);
  if (run.status === "ok") return { h: Math.round(min + (run.weight ?? 1) * (full - min)), color: c.muted };
  if (run.status === "silent") return { h: 3, color: c.faint };
  if (run.status === "failed") return { h: full, color: c.danger };
  return { h: min, color: c.warn };
}

/**
 * The last runs as a row of bars, oldest left; empty slots are a dot on the line; a run at work pulses in the newest
 * slot. `label` says them: a screen reader hears the strip as one image. `dim`: a paused or finished routine's.
 */
export const RunStrip = memo(function RunStrip({
  runs,
  label,
  running = false,
  dim = false,
}: {
  /** Newest first (`runPixels`). */
  runs: readonly RunPixel[];
  color: AgentColorName;
  label: string;
  running?: boolean;
  dim?: boolean;
}) {
  const { colors } = useTheme();
  const pulse = usePulse(running);
  const shown = runs.slice(0, RUN_SLOTS - (running ? 1 : 0)).reverse();
  const pad = Math.max(0, RUN_SLOTS - shown.length - (running ? 1 : 0));
  const w = stripWidth(RUN_SLOTS) * RUN_CELL;
  return (
    <View
      style={[styles.strip, { width: w, height: STRIP_H }, dim ? styles.dim : null]}
      accessible
      accessibilityRole="image"
      accessibilityLabel={label}
    >
      {Array.from({ length: pad }, (_, i) => (
        // biome-ignore lint/suspicious/noArrayIndexKey: empty slots have no identity
        <View key={`p${i}`} style={styles.slot}>
          <View style={[styles.dot, { backgroundColor: colors.faint }]} />
        </View>
      ))}
      {shown.map((run, i) => {
        const { h, color } = runBar(run, STRIP_H, colors);
        return (
          // biome-ignore lint/suspicious/noArrayIndexKey: the runs' order is their identity
          <View key={`r${i}`} style={styles.slot}>
            <View style={[styles.bar, { height: h, backgroundColor: color }]} />
          </View>
        );
      })}
      {running ? (
        <View style={styles.slot}>
          <Animated.View style={[styles.bar, { height: STRIP_H * 0.7, backgroundColor: colors.ink2 }, pulse]} />
        </View>
      ) : null}
    </View>
  );
});

/** A lane's height and where its line runs, in points. */
const LANE_H = LANE_ROWS * RUN_CELL;
const LINE_Y = (LANE_BASE + 1) * RUN_CELL;
/** A past run's tallest bar on a lane, and the marker's side. */
const LANE_BAR = 8 * RUN_CELL;
const MARK = 8;

/**
 * One routine's lane on the horizon, `width` points wide: a hairline, its past runs as small bars, its coming ones
 * as dots, and a ring on its next run (a pulsing dot at "now" while it runs). Decorative: the lane's words are its
 * button's. `look` is kept for the callers.
 */
export const LaneTrack = memo(function LaneTrack({
  width,
  from,
  to,
  now,
  past,
  future,
  running,
}: {
  width: number;
  /** The window and "now", in milliseconds. */
  from: number;
  to: number;
  now: number;
  past: readonly RunPixel[];
  future: readonly string[];
  look: { color: AgentColorName; eyes: string };
  running: boolean;
}) {
  const { colors } = useTheme();
  const pulse = usePulse(running);
  const w = laneWidth(width);
  const cx = width / w;
  const start = new Date(from);
  const end = new Date(to);
  const x = spriteX(w, start, end, new Date(now), future, running);
  const next = running ? undefined : future[0];
  return (
    <View style={{ width, height: LANE_H }} accessibilityElementsHidden importantForAccessibility="no-hide-descendants">
      <View style={[styles.line, { top: LINE_Y, backgroundColor: colors.line }]} />
      {past.map((run, i) => {
        const { h, color } = runBar(run, LANE_BAR, colors);
        return (
          <View
            // biome-ignore lint/suspicious/noArrayIndexKey: the runs' order is their identity
            key={i}
            style={[
              styles.laneBar,
              { left: laneX(run.at, start, end, w) * cx - 2, top: LINE_Y - h, height: h, backgroundColor: color },
            ]}
          />
        );
      })}
      {future.map((d) =>
        d === next ? null : (
          <View
            key={d}
            style={[
              styles.laneDot,
              { left: laneX(d, start, end, w) * cx - 1.5, top: LINE_Y - 1.5, backgroundColor: colors.muted },
            ]}
          />
        ),
      )}
      {x === null ? null : running ? (
        <Animated.View
          style={[
            styles.mark,
            { left: x * cx - MARK / 2, top: LINE_Y - MARK / 2, backgroundColor: colors.ink2 },
            pulse,
          ]}
        />
      ) : (
        <View
          style={[
            styles.mark,
            { left: x * cx - MARK / 2, top: LINE_Y - MARK / 2, borderWidth: 1.5, borderColor: colors.ink2 },
            { backgroundColor: colors.bg },
          ]}
        />
      )}
    </View>
  );
});

const styles = StyleSheet.create({
  dim: { opacity: 0.5 },
  strip: { flexDirection: "row", alignItems: "flex-end", gap: COLUMN_GAP },
  slot: { width: COLUMN_W, alignItems: "center", justifyContent: "flex-end" },
  bar: { width: COLUMN_W, borderRadius: 2 },
  dot: { width: 2, height: 2, borderRadius: 1 },
  line: { position: "absolute", left: 0, right: 0, height: StyleSheet.hairlineWidth },
  laneBar: { position: "absolute", width: 4, borderRadius: 2 },
  laneDot: { position: "absolute", width: 3, height: 3, borderRadius: 1.5 },
  mark: { position: "absolute", width: MARK, height: MARK, borderRadius: MARK / 2 },
});
