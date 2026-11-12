import type { ReactNode } from "react";
import { PixelRatio, StyleSheet, View } from "react-native";
import Svg, { Circle } from "react-native-svg";
import type { AppColors } from "./palette";
import { type BadgePresence, badgeCell, badgeOverhang } from "./presence-badge";
import { useTheme } from "./theme";

export interface PresenceBadgeProps {
  presence: BadgePresence;
  /** Points per cell of the old grid (`badgeCell` for an avatar's size): the dot is 9 cells wide, 11 with the ring. */
  cell?: number;
  /** The surface behind it, drawn as a ring one cell wide (default the page's color); null: no ring. */
  ring?: string | null;
}

/**
 * Turquoise is the identity's free bot color (`--db-turquesa`), so "available" never borrows the Doug's green
 * (green is only the Doug and the screen's main action).
 */
const AVAILABLE = "#2DD4BF";

/**
 * How each presence is drawn (DougBot):
 * - online (available, active): a turquoise dot;
 * - busy: a red dot (`colors.danger`);
 * - away: an amber dot (`colors.amber`);
 * - out (out of office): a gray dot (`colors.muted`);
 * - offline: an empty ring in the faint tone (`colors.faint`);
 * - hidden: the same ring, dashed.
 */
function look(presence: BadgePresence, colors: AppColors): { fill?: string; stroke?: string; dashed?: boolean } {
  switch (presence) {
    case "online":
      return { fill: AVAILABLE };
    case "busy":
      return { fill: colors.danger };
    case "away":
      return { fill: colors.amber };
    case "out":
      return { fill: colors.muted };
    case "offline":
      return { stroke: colors.faint };
    case "hidden":
      return { stroke: colors.faint, dashed: true };
  }
}

/**
 * Presence as a round dot (ADR 0084, redrawn for DougBot: a dot is round by nature), ringed in the surface behind
 * it so it cuts cleanly into the avatar's edge. Same outer size as the old pixel badge. Decorative: the row or the
 * face around it says the presence in words.
 */
export function PresenceBadge({ presence, cell = 1.1, ring }: PresenceBadgeProps) {
  const { colors } = useTheme();
  const ringColor = ring === undefined ? colors.bg : ring;
  const k = PixelRatio.roundToNearestPixel(cell);
  const side = k * (ringColor !== null ? 11 : 9);
  const c = side / 2;
  const dot = k * 4.5;
  const { fill, stroke, dashed } = look(presence, colors);
  const width = Math.max(1.25, k * 1.4);
  return (
    <Svg width={side} height={side} accessibilityElementsHidden importantForAccessibility="no-hide-descendants">
      {ringColor !== null ? <Circle cx={c} cy={c} r={c} fill={ringColor} /> : null}
      {fill ? (
        <Circle cx={c} cy={c} r={dot} fill={fill} />
      ) : (
        <Circle
          cx={c}
          cy={c}
          r={dot - width / 2}
          fill="none"
          stroke={stroke}
          strokeWidth={width}
          strokeDasharray={dashed ? `${width * 1.2} ${width * 1.3}` : undefined}
        />
      )}
    </Svg>
  );
}

/**
 * An avatar of `size` points with its presence on the bottom right corner, hanging a little past it (the ring
 * cuts into the avatar's edge). No presence: the avatar alone.
 */
export function WithPresence({
  size,
  presence,
  ring,
  cell,
  inset = 0,
  children,
}: {
  size: number;
  presence: BadgePresence | null | undefined;
  ring?: string | null;
  /** Default by the avatar's size (`badgeCell`). */
  cell?: number;
  /** Points between the box's right edge and the avatar's (an agent standing on its own, narrower than its box). */
  inset?: number;
  children: ReactNode;
}) {
  if (!presence) return <>{children}</>;
  const c = cell ?? badgeCell(size);
  const off = -badgeOverhang(c);
  return (
    <View style={{ width: size, height: size }}>
      {children}
      <View style={[styles.corner, { right: off + inset, bottom: off }]} pointerEvents="none">
        <PresenceBadge presence={presence} cell={c} {...(ring !== undefined ? { ring } : {})} />
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  corner: { position: "absolute" },
});
