import { type CSSProperties, useEffect, useRef } from "react";
import { bodyTones } from "../agent/engine.js";
import { DOUG_OUTLINE_BOX, dougOutline, type OutlinePoint, outlineSlice } from "../brand/doug-outline";
import { cx } from "../cx";
import type { AgentColor } from "./AgentLook";

/**
 * Our working indicator: the Doug's head in outline, a stretch of light running round it with a fading trail.
 * Tied to an agent it is drawn in that agent's own `bodyTones`; otherwise in the text color around it (ink, the
 * same tones as the words). Under prefers-reduced-motion the whole outline is lit and still. Decorative unless
 * `label` is given: the chip or button next to it says what is happening.
 */
export type PixelSpinnerSize = 14 | 16 | 24 | 32;

export interface PixelSpinnerProps {
  /** 14 (chips, rows), 16 (buttons), 24, 32. */
  size?: PixelSpinnerSize;
  /** The agent's color when the work is an agent's; neutral ink otherwise. */
  color?: AgentColor;
  /** Accessible name; without it the spinner is `aria-hidden`. */
  label?: string;
  className?: string;
}

/** One lap of the light round the head. */
export const OUTLINE_LAP_MS = 1300;
/** The light's three stretches, from its head back: where each ends, in laps behind the head. */
export const OUTLINE_TRAIL = [0.16, 0.29, 0.42] as const;
/** Neutral ink: the head of the light, two fading stretches, then the rest of the outline. */
const INK_ALPHA = [1, 0.62, 0.38, 0.2] as const;
const TICK_MS = 33;

/** Where the light's head is at `ms`, in laps (0–1). */
export const outlinePhase = (ms: number) => (ms % OUTLINE_LAP_MS) / OUTLINE_LAP_MS;

const reduced = () =>
  typeof matchMedia === "function" && matchMedia("(prefers-reduced-motion: reduce)").matches === true;
const now = () => (typeof performance === "object" ? performance.now() : Date.now());

// One clock for every spinner on the page (not one timer each).
const draws = new Set<(phase: number | null) => void>();
let timer: ReturnType<typeof setInterval> | null = null;
function join(draw: (phase: number | null) => void) {
  draws.add(draw);
  const still = reduced();
  draw(still ? null : outlinePhase(now()));
  if (!timer && !still) {
    timer = setInterval(() => {
      const phase = outlinePhase(now());
      for (const d of draws) d(phase);
    }, TICK_MS);
  }
  return () => {
    draws.delete(draw);
    if (draws.size === 0 && timer) {
      clearInterval(timer);
      timer = null;
    }
  };
}

/** Whether a CSS color (`rgb(…)`, as computed) is a light one: the ink of a dark ground. */
function lightInk(color: string) {
  const [r = 0, g = 0, b = 0] = (color.match(/\d+(\.\d+)?/g) ?? []).map(Number);
  return 0.299 * r + 0.587 * g + 0.114 * b > 140;
}

type Place = (p: OutlinePoint) => OutlinePoint;

function line(ctx: CanvasRenderingContext2D, pts: readonly OutlinePoint[], place: Place, close = false) {
  ctx.beginPath();
  pts.forEach((p, i) => {
    const [x, y] = place(p);
    if (i) ctx.lineTo(x, y);
    else ctx.moveTo(x, y);
  });
  if (close) ctx.closePath();
  ctx.stroke();
}

/** `phase` null: no motion, the whole outline lit. */
function paint(canvas: HTMLCanvasElement, color: AgentColor | undefined, phase: number | null) {
  const ctx = canvas.getContext?.("2d");
  // Nothing to draw on, or a context that draws no lines (a partial one, as a test's): the box stays empty.
  if (!ctx || typeof ctx.stroke !== "function" || typeof ctx.clearRect !== "function") return;
  const w = canvas.width;
  const tones = color ? bodyTones(color) : null;
  const ink = tones ? "" : getComputedStyle(canvas).color || "#151514";
  const box = DOUG_OUTLINE_BOX;
  // The line is 1/9 of the box (1.5 px at 14), and the head keeps half of it clear on every side.
  const stroke = w / 9;
  const scale = (w - stroke) / Math.max(box.w, box.h);
  const dx = (w - box.w * scale) / 2 - box.x * scale;
  const dy = (w - box.h * scale) / 2 - box.y * scale;
  const place: Place = ([x, y]) => [x * scale + dx, y * scale + dy];
  ctx.clearRect(0, 0, w, w);
  ctx.lineWidth = stroke;
  ctx.lineJoin = "round";
  // An agent's tones run dark to light: the light is the one that stands out from the ground (the words' ink
  // says which ground it is), the rest of the outline the one nearest to it.
  const onDark = !!tones && lightInk(getComputedStyle(canvas).color);
  const lit = tones ? (onDark ? [tones[3], tones[2], tones[1]] : [tones[1], tones[2], tones[3]]) : [];
  const shade = (i: number) => {
    if (tones) {
      ctx.strokeStyle = (i === 3 ? (onDark ? tones[1] : tones[3]) : lit[i]) ?? "#888888";
      ctx.globalAlpha = i === 3 ? 0.5 : 1;
    } else {
      ctx.strokeStyle = ink;
      ctx.globalAlpha = INK_ALPHA[i] ?? 0.2;
    }
  };
  ctx.lineCap = "butt";
  shade(phase === null ? 0 : 3);
  line(ctx, dougOutline().points, place, true);
  if (phase !== null) {
    // The farthest stretch first: each nearer one starts where the last ended, the head's end is round.
    for (let i = OUTLINE_TRAIL.length - 1; i >= 0; i--) {
      shade(i);
      ctx.lineCap = i === 0 ? "round" : "butt";
      line(ctx, outlineSlice(phase - (OUTLINE_TRAIL[i] ?? 0), phase - (OUTLINE_TRAIL[i - 1] ?? 0)), place);
    }
  }
  ctx.globalAlpha = 1;
}

export function PixelSpinner({ size = 16, color, label, className }: PixelSpinnerProps) {
  const ref = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    const canvas = ref.current;
    if (!canvas) return;
    const dpr = typeof devicePixelRatio === "number" && devicePixelRatio > 0 ? devicePixelRatio : 1;
    canvas.width = Math.round(size * dpr);
    canvas.height = Math.round(size * dpr);
    return join((phase) => paint(canvas, color, phase));
  }, [size, color]);
  return (
    <canvas
      ref={ref}
      className={cx("ac-pixspin", className)}
      style={{ width: size, height: size, "--mark-size": `${size}px` } as CSSProperties}
      data-color={color}
      role={label ? "img" : undefined}
      aria-label={label}
      aria-hidden={label ? undefined : true}
    />
  );
}
