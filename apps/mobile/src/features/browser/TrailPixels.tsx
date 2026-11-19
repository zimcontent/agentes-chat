import type { BrowserTrailKind } from "@dougbot/client";
import type { AgentColorName } from "@dougbot/ui/agent/engine";
import { Canvas, createPicture, PaintStyle, Picture, Skia, type SkPaint } from "@shopify/react-native-skia";
import { memo, useMemo } from "react";
import { View } from "react-native";
import type { AppColors } from "@/ui/palette";
import { useTheme } from "@/ui/theme";
import { type CellRun, MARK_W, SKY_CELL, STRIP_ROWS, stripWidth, TRAIL_CELL } from "./trail-pixels";

/**
 * The card's marks after a run in the agent's browser or desktop, drawn as clean vectors (DougBot: no pixel art):
 * each step a small bar with rounded corners, as tall as the step weighs. Decorative: the card's words say what they
 * show, so screen readers skip them. The sizes are the old pixel drawings' (./trail-pixels.ts), so nothing moves.
 */

const paints = new Map<string, SkPaint>();
function dotPaint(color: string): SkPaint {
  let p = paints.get(color);
  if (!p) {
    p = Skia.Paint();
    p.setAntiAlias(true);
    p.setStyle(PaintStyle.Fill);
    p.setColor(Skia.Color(color));
    paints.set(color, p);
  }
  return p;
}

const hidden = { accessibilityElementsHidden: true, importantForAccessibility: "no-hide-descendants" as const };

/**
 * Cell runs drawn at `cx` × `cy` points per cell in a `width` × `height` box, each cell a round dot (a dotted line
 * reads as dots, not pixels). Kept for the routines' "agora" line.
 */
export function CellCanvas({
  runs,
  width,
  height,
  cx,
  cy = cx,
}: {
  runs: CellRun[];
  width: number;
  height: number;
  cx: number;
  cy?: number;
}) {
  const picture = useMemo(
    () =>
      createPicture(
        (canvas) => {
          const r = Math.min(cx, cy) / 2;
          for (const run of runs) {
            const paint = dotPaint(run.color);
            for (let i = 0; i + 1 < run.cells.length; i += 2) {
              const x = run.cells[i] ?? 0;
              const y = run.cells[i + 1] ?? 0;
              canvas.drawRRect(Skia.RRectXY(Skia.XYWHRect(x * cx, y * cy, cx, cy), r, r), paint);
            }
          }
        },
        { width, height },
      ),
    [runs, width, height, cx, cy],
  );
  return (
    <Canvas style={{ width, height }}>
      <Picture picture={picture} />
    </Canvas>
  );
}

/** A step's bar: its height share and its tone (an open the whole bar, a read most, an action a stub, a print a dot). */
const SHARE: Record<BrowserTrailKind, number> = { open: 1, read: 0.7, act: 0.42, shot: 0, failed: 1 };
const BAR_W = 3 * TRAIL_CELL;
const BAR_GAP = TRAIL_CELL;
const STRIP_H = STRIP_ROWS * TRAIL_CELL;

function toneOf(kind: BrowserTrailKind, c: AppColors): string {
  if (kind === "failed") return c.danger;
  if (kind === "shot") return c.faint;
  return kind === "open" ? c.ink2 : c.muted;
}

function StepBar({ kind, colors }: { kind: BrowserTrailKind; colors: AppColors }) {
  const h = kind === "shot" ? 4 : Math.max(6, Math.round(SHARE[kind] * STRIP_H));
  return <View style={{ width: BAR_W, height: h, borderRadius: 2, backgroundColor: toneOf(kind, colors) }} />;
}

/** The steps as bars, oldest left (the card's summary line). */
export const TrailStrip = memo(function TrailStrip({ kinds }: { kinds: BrowserTrailKind[]; color: AgentColorName }) {
  const { colors } = useTheme();
  const w = stripWidth(kinds.length) * TRAIL_CELL;
  return (
    <View style={{ width: w, height: STRIP_H, flexDirection: "row", alignItems: "flex-end", gap: BAR_GAP }} {...hidden}>
      {kinds.map((k, i) => (
        // biome-ignore lint/suspicious/noArrayIndexKey: the steps' order is their identity
        <StepBar key={i} kind={k} colors={colors} />
      ))}
    </View>
  );
});

/** One step's bar, marking its line in the list. */
export const TrailMark = memo(function TrailMark({ kind }: { kind: BrowserTrailKind; color: AgentColorName }) {
  const { colors } = useTheme();
  return (
    <View style={{ width: MARK_W * TRAIL_CELL, height: STRIP_H, justifyContent: "flex-end" }} {...hidden}>
      <StepBar kind={kind} colors={colors} />
    </View>
  );
});

/** Where the agent's sky edge ran along the top of the card: DougBot has no decorative sky, so an empty strip. */
export function TrailSky(_props: { color: AgentColorName }) {
  return <View style={{ height: 2 * SKY_CELL }} {...hidden} />;
}

/** The blocks of a generic page, as fractions of the picture (a bar, a search field, cards, lines). */
const PAGE_BLOCKS: [number, number, number, number][] = [
  [0.05, 0.08, 0.22, 0.16],
  [0.7, 0.08, 0.95, 0.16],
  [0.25, 0.26, 0.75, 0.38],
  [0.05, 0.5, 0.3, 0.7],
  [0.36, 0.5, 0.64, 0.7],
  [0.7, 0.5, 0.95, 0.7],
  [0.05, 0.76, 0.3, 0.82],
  [0.36, 0.76, 0.6, 0.82],
  [0.7, 0.76, 0.9, 0.82],
];

/** The drawn page in the thumbnail: the shape of a page in flat blocks, never the real one. */
export const TrailPage = memo(function TrailPage({
  width,
  height,
}: {
  color: AgentColorName;
  width: number;
  height: number;
}) {
  const { colors } = useTheme();
  return (
    <View style={{ width, height, backgroundColor: colors.raised2 }} {...hidden}>
      {PAGE_BLOCKS.map(([x0, y0, x1, y1]) => (
        <View
          key={`${x0}-${y0}`}
          style={{
            position: "absolute",
            left: x0 * width,
            top: y0 * height,
            width: (x1 - x0) * width,
            height: (y1 - y0) * height,
            borderRadius: 2,
            backgroundColor: colors.line2,
          }}
        />
      ))}
    </View>
  );
});
