import { useMachines } from "@dougbot/client";
import { computerKind } from "@dougbot/client/lib/machines";
import { memo, useId } from "react";
import { View } from "react-native";
import Svg, { Defs, LinearGradient, Rect, Stop } from "react-native-svg";
import { Icon } from "@/ui/Icon";
import type { AppColors } from "@/ui/palette";
import { useTheme } from "@/ui/theme";
import type { ComputerKind, ComputerState, PortraitKind } from "./cells";

/** The drawing's grid (the old portrait's 48), scaled to the size asked. */
const GRID = 48;
/** The glass's corner, in points at any size (DougBot's small radius). */
const RADIUS = 8;

export interface ComputerPortraitProps {
  /** A computer, or a phone it reaches (`android`, `iphone`). */
  kind: PortraitKind;
  state: ComputerState;
  /** 48 (rows, default) or 96 points. */
  size?: 48 | 96;
  /** Kept for the callers: the drawing is still. */
  live?: boolean;
  /** For screen readers; without it the portrait is decorative (the text next to it names the computer). */
  label?: string;
}

interface Box {
  x: number;
  y: number;
  w: number;
  h: number;
}

/** The glass body, its screen and what it stands on, on the 48 grid. */
function shapeOf(kind: PortraitKind): { body: Box; inset: number; feet: Box[] } {
  if (kind === "android" || kind === "iphone") return { body: { x: 14, y: 4, w: 20, h: 40 }, inset: 2, feet: [] };
  if (kind === "mac") return { body: { x: 7, y: 9, w: 34, h: 25 }, inset: 2.5, feet: [{ x: 3, y: 35, w: 42, h: 3.5 }] };
  // Windows and Linux: a monitor on a stand.
  return {
    body: { x: 4, y: 7, w: 40, h: 28 },
    inset: 3,
    feet: [
      { x: 21, y: 35, w: 6, h: 5 },
      { x: 14, y: 40, w: 20, h: 3 },
    ],
  };
}

/** What the screen shows: lit with two lines (online), dimmed with a pause sign (paused), dark (offline). */
function Screen({ box, r, state, colors }: { box: Box; r: number; state: ComputerState; colors: AppColors }) {
  const lit = state !== "offline";
  const cx = box.x + box.w / 2;
  const cy = box.y + box.h / 2;
  return (
    <>
      <Rect x={box.x} y={box.y} width={box.w} height={box.h} rx={r} fill={lit ? colors.raised2 : colors.bg} />
      {state === "online" ? (
        <>
          <Rect x={box.x + 3} y={box.y + 3.5} width={box.w * 0.5} height={1.6} rx={0.8} fill={colors.muted} />
          <Rect x={box.x + 3} y={box.y + 7} width={box.w * 0.32} height={1.6} rx={0.8} fill={colors.faint} />
        </>
      ) : null}
      {state === "paused" ? (
        <>
          <Rect x={cx - 3} y={cy - 3.5} width={2} height={7} rx={1} fill={colors.muted} />
          <Rect x={cx + 1} y={cy - 3.5} width={2} height={7} rx={1} fill={colors.muted} />
        </>
      ) : null}
    </>
  );
}

function ComputerPortraitView({ kind, state, size = 48, label }: ComputerPortraitProps) {
  const { colors } = useTheme();
  const glassId = `glass${useId().replace(/:/g, "")}`;
  const unit = GRID / size;
  const r = RADIUS * unit;
  const edge = unit;
  const { body, inset, feet } = shapeOf(kind);
  const screen = { x: body.x + inset, y: body.y + inset, w: body.w - 2 * inset, h: body.h - 2 * inset };
  const [top, bottom] = colors.glassCard;
  return (
    <View
      accessible={Boolean(label)}
      accessibilityRole={label ? "image" : undefined}
      accessibilityLabel={label}
      importantForAccessibility={label ? "yes" : "no-hide-descendants"}
      style={{ width: size, height: size }}
    >
      <Svg width={size} height={size} viewBox={`0 0 ${GRID} ${GRID}`}>
        <Defs>
          <LinearGradient id={glassId} x1="0" y1="0" x2="0" y2="1">
            <Stop offset="0" stopColor={top} />
            <Stop offset="1" stopColor={bottom} />
          </LinearGradient>
        </Defs>
        {feet.map((f) => (
          <Rect
            key={`${f.x}-${f.y}`}
            x={f.x}
            y={f.y}
            width={f.w}
            height={f.h}
            rx={Math.min(f.h / 2, r)}
            fill={colors.raised}
            stroke={colors.glassEdge}
            strokeWidth={edge}
          />
        ))}
        <Rect x={body.x} y={body.y} width={body.w} height={body.h} rx={r} fill={colors.raised} />
        <Rect
          x={body.x}
          y={body.y}
          width={body.w}
          height={body.h}
          rx={r}
          fill={`url(#${glassId})`}
          stroke={colors.glassEdge}
          strokeWidth={edge}
        />
        <Screen box={screen} r={Math.max(unit, r - inset)} state={state} colors={colors} />
      </Svg>
    </View>
  );
}

/**
 * A computer's portrait, drawn as clean vectors in glass (DougBot: no pixel art): a Mac laptop, a monitor on a
 * stand for Windows and Linux, or a phone, with a corner of 8 points, its screen lit, dimmed (paused) or dark
 * (offline). It sits directly on the surface, no tile, and holds still. Below 48 points use `ComputerIcon`.
 */
export const ComputerPortrait = memo(ComputerPortraitView);

const ICONS = {
  mac: "computerMac",
  windows: "computerWindows",
  linux: "computerLinux",
} as const;

/** A computer's line icon next to text (chips, small rows). */
export function ComputerIcon({ kind, size = 16, color }: { kind: ComputerKind; size?: number; color?: string }) {
  return <Icon name={ICONS[kind]} size={size} color={color} />;
}

/**
 * Which portrait a machine gets, from the org's computers (the lists that name a machine carry only its
 * id, name and whether it's online). Linux, the server, until the list arrives.
 */
export function useComputerKind(orgId: string, machineId: string | null | undefined): ComputerKind {
  const machines = useMachines(orgId, Boolean(machineId));
  const os = machineId ? machines.data?.find((m) => m.id === machineId)?.os : undefined;
  return computerKind(os);
}
