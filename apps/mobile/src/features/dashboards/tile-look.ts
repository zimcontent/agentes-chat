import type { WidgetSpec } from "@agenteschat/client";

/*
 * The phone's widget tiles (ADR 0135), without React: their colors, sizes and the small reads each kind's drawing
 * makes of its spec. Pure, for the tests.
 */

/** A tile's background: a diagonal gradient from `top` (its top left) to `bottom` (its bottom right). */
export interface TileHue {
  key: string;
  top: string;
  bottom: string;
}

/**
 * The tiles' colors. A spec carries no color of its own, so a tile's comes from its widget's id (`tileHue`): stable
 * through renames, refreshes, a new agent or another place on the board, and different between neighbours more often
 * than not. Red and orange are left out on purpose: on a dashboard they read as an alert, and a widget's color says
 * nothing about its data. White text stays readable on every one (the test holds each lower half at 4.5:1).
 */
export const TILE_HUES: readonly TileHue[] = [
  { key: "blue", top: "#3A86FF", bottom: "#1A47C4" },
  { key: "green", top: "#27B05C", bottom: "#08552F" },
  { key: "violet", top: "#9C66FF", bottom: "#5626C0" },
  { key: "graphite", top: "#2C2C30", bottom: "#161618" },
  { key: "teal", top: "#1FAE9F", bottom: "#075457" },
  { key: "indigo", top: "#6670FF", bottom: "#2F33B8" },
  { key: "magenta", top: "#EE5AA6", bottom: "#A01E66" },
];

/** FNV-1a over the id's characters: the same number for the same id on every phone and every run. */
export function idHash(id: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < id.length; i++) {
    h ^= id.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h >>> 0;
}

/** A widget's color: one of `TILE_HUES`, picked by its id. */
export const tileHue = (id: string): TileHue => TILE_HUES[idHash(id) % TILE_HUES.length] as TileHue;

/** S (half a row), M (the whole row) or L (the whole row, twice as tall), from a widget's width and height. */
export type TileSize = "s" | "m" | "l";
export const tileSize = (w: number, h: number): TileSize => (w >= 2 ? (h >= 2 ? "l" : "m") : "s");

/** Each size's height on the phone, as the iPhone's own widgets: a large one is two rows and the gap between. */
export const TILE_GAP = 14;
export const TILE_HEIGHT: Record<TileSize, number> = { s: 166, m: 160, l: 166 * 2 + TILE_GAP };

/**
 * How a change reads: "+12%" → an up arrow and "12%", "-2 min" (or "−2 min") → a down arrow and "2 min". The arrow
 * says only which way the number went; whether that is good is the agent's word (`delta.up`), never drawn as an alarm.
 * Text without a sign up front stays as it is, with no arrow.
 */
export function signedArrow(text: string): { arrow: "↑" | "↓" | null; text: string } {
  const t = text.trim();
  const m = /^([+\-−–▲▼↑↓])\s*(?=[\d.,R$€£]|US\$)/.exec(t);
  if (!m) return { arrow: null, text: t };
  const up = m[1] === "+" || m[1] === "▲" || m[1] === "↑";
  return { arrow: up ? "↑" : "↓", text: t.slice(m[0].length) };
}

/** The bar a chart calls out: the one the alert is about, else the tallest (the last of equals). */
export function focusBar(values: readonly number[], alertIndex?: number): number {
  if (alertIndex !== undefined && alertIndex >= 0 && alertIndex < values.length) return alertIndex;
  let at = -1;
  values.forEach((v, i) => {
    if (at < 0 || v >= (values[at] ?? Number.NEGATIVE_INFINITY)) at = i;
  });
  return at;
}

/** Columns on an M tile: 12 wide and 6 apart as the iPhone's own, up to `max` across (more get narrower). */
export const barsWidth = (n: number, max = 152): number => Math.min(max, n * 12 + Math.max(0, n - 1) * 6);

/** About how wide a bar's label is in the tiles' 9.5-point type (a character is about 5.4 points). */
export const labelWidth = (label: string): number => Math.ceil(label.length * 5.4);

/**
 * Whether every bar's label fits: in a row `gap` apart within `room` (M: under and beside the columns), or, with
 * `slot`, each in its column's own width (L: under its column). Otherwise only the first and the last show.
 */
export function labelsFit(
  labels: readonly string[],
  room: number,
  { gap = 5, slot }: { gap?: number; slot?: number } = {},
) {
  if (slot !== undefined) return labels.every((l) => labelWidth(l) <= slot);
  const total = labels.reduce((sum, l) => sum + labelWidth(l), 0) + gap * Math.max(0, labels.length - 1);
  return total <= room;
}

/**
 * The big number's size: `base` while it fits `room` points across (on a 390-point phone), smaller for a long one
 * ("R$ 18.420" on S), never under `min`. A character of the tiles' Manrope 800 is about 0.6 of its size wide. On the
 * phone the text also shrinks to fit by itself; this keeps the line's height in step with it.
 */
export function fitSize(text: string, base: number, room: number, min = 22): number {
  const wide = text.length * 0.6;
  if (wide === 0) return base;
  return Math.max(min, Math.min(base, Math.floor(room / wide)));
}

/** Room across for the big number in each place on a 390-point phone: S's inside, M's left column, L's inside. */
export const BIG_ROOM = { s: 142, m: 166, l: 328 } as const;

/** An M tile's trend beside its number: 150 across, less on a narrow phone (two fifths of the inside at most). */
export const trendWidth = (inner: number): number => (inner > 0 ? Math.min(150, Math.round(inner * 0.4)) : 150);

/**
 * The big number's room, from the tile's measured inside (`inner`, 0 before it is measured: `BIG_ROOM`): all of it,
 * or on M what the trend or the columns (at most 152 and the 12 between) leave.
 */
export function bigRoom(place: "s" | "m" | "l", inner: number): number {
  if (inner <= 0) return BIG_ROOM[place];
  return place === "m" ? inner - 12 - Math.max(trendWidth(inner), 152) : inner;
}

/** A short unit goes with the number ("%", "R$", "min"); a longer one ("runs per day") is said under it. */
export const unitJoins = (unit: string | undefined): boolean => Boolean(unit && unit.trim().length <= 4);

/** The points of a trend in a `width` × `height` box, `edge` points in from every side, oldest on the left. */
export function trendPoints(values: readonly number[], width: number, height: number, edge = 5): [number, number][] {
  if (values.length < 2 || width <= 0 || height <= 0) return [];
  const min = Math.min(...values);
  const max = Math.max(...values);
  const span = max - min || 1;
  const w = Math.max(0, width - edge * 2);
  const h = Math.max(0, height - edge * 2);
  return values.map((v, i) => [
    round1(edge + (i / (values.length - 1)) * w),
    round1(edge + (max === min ? h / 2 : (1 - (v - min) / span) * h)),
  ]);
}

/** A trend as an SVG path through its points (straight segments, as the iPhone's own stock lines). */
export const trendPath = (points: readonly [number, number][]): string =>
  points.map(([x, y], i) => `${i === 0 ? "M" : "L"}${x} ${y}`).join(" ");

const round1 = (n: number) => Math.round(n * 10) / 10;

/** The series a tile draws as its trend: a number's spark, a line's values; nothing for the other kinds. */
export function trendOf(spec: WidgetSpec | null): number[] | null {
  if (spec?.kind === "kpi") return spec.spark && spec.spark.length > 1 ? spec.spark : null;
  if (spec?.kind === "line") return spec.values.length > 1 ? spec.values : null;
  return null;
}

/** Rows a list tile shows in each size (the rest are "more N"). */
export const LIST_ROWS: Record<TileSize, number> = { s: 3, m: 3, l: 8 };

/** The rows a list tile shows and how many it leaves out: one row's room goes to "more N" when any are left out. */
export function listShown<T>(rows: readonly T[], size: TileSize): { shown: T[]; hidden: number } {
  const room = LIST_ROWS[size];
  if (rows.length <= room) return { shown: [...rows], hidden: 0 };
  const shown = rows.slice(0, room - 1);
  return { shown, hidden: rows.length - shown.length };
}

/** The pages a board's dots stand for: never more than `max`, the shown one kept inside (the iPhone's own cap). */
export function dotWindow(count: number, at: number, max = 9): { first: number; count: number } {
  if (count <= max) return { first: 0, count };
  const first = Math.max(0, Math.min(count - max, at - Math.floor(max / 2)));
  return { first, count: max };
}
