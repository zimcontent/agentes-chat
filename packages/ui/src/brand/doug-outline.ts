import DougBot from "./dougbot-avatar.js";

/**
 * The Doug's head as a line: the identity's own path (`CABECA`, the head with its curl) flattened to points, so a
 * mark can draw only its contour and light a stretch of it. Our working indicator and the "waiting for you" mark
 * are this outline instead of a generic square or ring.
 */
export type OutlinePoint = readonly [number, number];

/** The head's box in the identity's 120 × 120 frame. */
export const DOUG_OUTLINE_BOX = { x: 24, y: 21, w: 72, h: 81 } as const;

/** The head's path, as the identity draws it (closed). */
export const DOUG_OUTLINE_PATH: string = DougBot.CABECA;

/** Segments per curve: the curl's tight turns stay round at 32 px. */
const STEPS = 10;

/** The path's absolute `M`, `C`, `H`, `V` and `Z` commands as a closed polyline. */
export function flattenPath(d: string): OutlinePoint[] {
  const pts: [number, number][] = [];
  let x = 0;
  let y = 0;
  for (const [, cmd = "", args = ""] of d.matchAll(/([MCHVZ])([^MCHVZ]*)/g)) {
    const n = (args.match(/-?\d*\.?\d+/g) ?? []).map(Number);
    if (cmd === "M") {
      x = n[0] ?? 0;
      y = n[1] ?? 0;
      pts.push([x, y]);
    } else if (cmd === "H") {
      x = n[0] ?? x;
      pts.push([x, y]);
    } else if (cmd === "V") {
      y = n[0] ?? y;
      pts.push([x, y]);
    } else if (cmd === "C") {
      for (let i = 0; i + 5 < n.length; i += 6) {
        const [x1 = 0, y1 = 0, x2 = 0, y2 = 0, x3 = 0, y3 = 0] = n.slice(i, i + 6);
        for (let s = 1; s <= STEPS; s++) {
          const t = s / STEPS;
          const u = 1 - t;
          pts.push([
            u * u * u * x + 3 * u * u * t * x1 + 3 * u * t * t * x2 + t * t * t * x3,
            u * u * u * y + 3 * u * u * t * y1 + 3 * u * t * t * y2 + t * t * t * y3,
          ]);
        }
        x = x3;
        y = y3;
      }
    }
  }
  return pts;
}

export interface Outline {
  /** The closed line, clockwise on screen; the last point joins the first. */
  points: OutlinePoint[];
  /** Each point's distance along the line, 0–1 (one more than `points`: the last is 1, back at the start). */
  at: number[];
}

let cached: Outline | null = null;

/** The head's contour, clockwise, with each point's place along it. */
export function dougOutline(): Outline {
  if (cached) return cached;
  // The identity draws it counter-clockwise: turned around, the light runs the way a clock does.
  const points = flattenPath(DOUG_OUTLINE_PATH).reverse();
  const at = [0];
  let total = 0;
  for (let i = 0; i < points.length; i++) {
    const a = points[i] as OutlinePoint;
    const b = points[(i + 1) % points.length] as OutlinePoint;
    total += Math.hypot(b[0] - a[0], b[1] - a[1]);
    at.push(total);
  }
  cached = { points, at: at.map((v) => v / total) };
  return cached;
}

const wrap = (v: number) => ((v % 1) + 1) % 1;

/** The point at `t` (0–1, wrapping) along the contour. */
export function outlinePoint(t: number, outline = dougOutline()): OutlinePoint {
  const { points, at } = outline;
  const v = wrap(t);
  let i = 0;
  while (i < points.length - 1 && (at[i + 1] ?? 1) < v) i++;
  const a = points[i] as OutlinePoint;
  const b = points[(i + 1) % points.length] as OutlinePoint;
  const from = at[i] ?? 0;
  const span = (at[i + 1] ?? 1) - from;
  const k = span > 0 ? (v - from) / span : 0;
  return [a[0] + (b[0] - a[0]) * k, a[1] + (b[1] - a[1]) * k];
}

/** The stretch of the contour from `from` to `to` (in turns, `to` ahead of `from`, wrapping past the start). */
export function outlineSlice(from: number, to: number, outline = dougOutline()): OutlinePoint[] {
  const { points, at } = outline;
  const out: OutlinePoint[] = [outlinePoint(from, outline)];
  const start = wrap(from);
  const span = Math.min(1, Math.max(0, to - from));
  const first = Math.max(
    0,
    at.findIndex((v) => v > start),
  );
  for (let k = 0; k < points.length; k++) {
    // Every corner the stretch passes, in the order it passes them.
    const i = (first + k) % points.length;
    const ahead = wrap((at[i] ?? 0) - start);
    if (ahead <= 0 || ahead >= span) continue;
    out.push(points[i] as OutlinePoint);
  }
  out.push(outlinePoint(from + span, outline));
  return out;
}
