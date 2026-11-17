import { type ReactNode, useEffect, useRef, useState } from "react";
import { bodyTones } from "../agent/engine.js";
import { cx } from "../cx";
import type { AgentColor } from "./AgentLook";
import { useLocked } from "./Field";
import { reduced, token } from "./RunPixels";

export interface EffortStep<V extends string> {
  value: V;
  label: string;
}

/**
 * Draws one frame (exported for tests and prototypes), DougBot's way (no pixel art): one rounded bar per step,
 * climbing left to right, a gap between them. Bars up to `pos` (in steps, 0..steps) fill in the agent's tone, the
 * bar being reached fills as far as `pos` goes; the rest stays in the faint tone. `t` breathes the reached bar's top
 * a little (0 stands still).
 */
export function drawEffort(
  ctx: CanvasRenderingContext2D,
  canvas: HTMLCanvasElement,
  opts: { pos: number; steps: number; t: number; fill: string; tip: string; ink: string; off: string },
) {
  const dpr = Math.min(2, typeof devicePixelRatio === "number" ? devicePixelRatio || 1 : 1);
  const W = Math.round(canvas.clientWidth * dpr);
  const H = Math.round(canvas.clientHeight * dpr);
  if (!W || !H) return;
  if (canvas.width !== W || canvas.height !== H) {
    canvas.width = W;
    canvas.height = H;
  }
  ctx.clearRect(0, 0, W, H);
  const n = Math.max(1, opts.steps);
  const gap = Math.round(6 * dpr);
  const bw = (W - gap * (n - 1)) / n;
  const r = Math.min(bw / 2, 8 * dpr);
  const bar = (x: number, y: number, w: number, h: number) => {
    ctx.beginPath();
    if (typeof ctx.roundRect === "function") ctx.roundRect(x, y, w, h, Math.min(r, w / 2, h / 2));
    else ctx.rect(x, y, w, h);
    ctx.fill();
  };
  for (let i = 0; i < n; i++) {
    const h = Math.round(H * (0.3 + (0.7 * i) / Math.max(1, n - 1)));
    const x = i * (bw + gap);
    const y = H - h;
    ctx.globalAlpha = 0.22;
    ctx.fillStyle = opts.off;
    bar(x, y, bw, h);
    const share = Math.max(0, Math.min(1, opts.pos - i));
    if (share > 0) {
      ctx.globalAlpha = 1;
      ctx.save();
      ctx.beginPath();
      ctx.rect(x, 0, bw * share, H);
      ctx.clip();
      const g = ctx.createLinearGradient(0, y, 0, H);
      g.addColorStop(0, opts.tip);
      g.addColorStop(1, opts.fill);
      ctx.fillStyle = g;
      bar(x, y, bw, h);
      ctx.restore();
    }
  }
  ctx.globalAlpha = 1;
}

/**
 * How much an agent thinks, as a slider: a ramp of
 * rounded bars in the agent's color fills up to the chosen step, the step names
 * under it, the label and what the step means on the line above. Drag or click
 * the ramp, click a name, or the arrow keys (`role="slider"`, one tab stop).
 * Still with reduced motion.
 */
export function EffortPixels<V extends string>({
  value,
  onValueChange,
  steps,
  label,
  hint,
  unset,
  color = "sky",
  disabled: off,
  className,
}: {
  /** Null: nothing chosen yet, the ramp stays empty. */
  value: V | null;
  onValueChange: (value: V) => void;
  steps: EffortStep<V>[];
  label: string;
  /** What a step means (null: nothing chosen), on the label's line; follows the finger while dragging. */
  hint?: (value: V | null) => ReactNode;
  /** The ramp's name while nothing is chosen. */
  unset?: string;
  color?: AgentColor;
  disabled?: boolean;
  className?: string;
}) {
  const locked = useLocked();
  const disabled = off || locked;
  const canvas = useRef<HTMLCanvasElement>(null);
  const n = steps.length;
  const index = steps.findIndex((s) => s.value === value);
  // While dragging: how far the fill reaches, in steps.
  const [drag, setDrag] = useState<number | null>(null);
  const shown = drag === null ? index : Math.min(n - 1, Math.max(0, Math.ceil(drag) - 1));
  const motion = useRef({ pos: index + 1, target: index + 1 });
  motion.current.target = drag ?? index + 1;
  const still = reduced();
  // Still: a new frame only when the choice moves.
  const frameKey = still ? `${index}:${drag}` : "";

  // biome-ignore lint/correctness/useExhaustiveDependencies: frameKey repaints a still ramp when the choice moves
  useEffect(() => {
    const c = canvas.current;
    const ctx = c?.getContext?.("2d");
    if (!c || !ctx) return;
    const tones = bodyTones(color);
    let colors = { ink: "", off: "" };
    let frame = 0;
    let raf = 0;
    const paint = (now: number) => {
      // The theme can change under us: the tokens are read again now and then.
      if (frame++ % 30 === 0) colors = { ink: token(c, "--ink", "#151514"), off: token(c, "--faint", "#6f6f6a") };
      const m = motion.current;
      m.pos = still ? m.target : m.pos + (m.target - m.pos) * 0.16;
      drawEffort(ctx, c, {
        pos: m.pos,
        steps: n,
        t: still ? 0 : now,
        fill: tones[1] ?? "#5b8def",
        tip: tones[3] ?? "#9cc0ff",
        ...colors,
      });
      if (!still) raf = requestAnimationFrame(paint);
    };
    raf = requestAnimationFrame(paint);
    return () => cancelAnimationFrame(raf);
  }, [color, n, still, frameKey]);

  const reach = (x: number) => {
    const r = canvas.current?.getBoundingClientRect();
    if (!r?.width) return null;
    return Math.min(n, Math.max(0.3, ((x - r.left) / r.width) * n));
  };
  const step = (by: number) => {
    const next = steps[Math.min(n - 1, Math.max(0, index + by))];
    if (next && next.value !== value) onValueChange(next.value);
  };
  const current = steps[shown];
  return (
    <div
      className={cx("ac-effort", disabled && "ac-effort--off", className)}
      role="slider"
      tabIndex={disabled ? -1 : 0}
      aria-label={label}
      aria-valuemin={1}
      aria-valuemax={n}
      aria-valuenow={current ? shown + 1 : undefined}
      aria-valuetext={current?.label ?? unset}
      aria-disabled={disabled || undefined}
      onKeyDown={(e) => {
        const by = { ArrowRight: 1, ArrowUp: 1, ArrowLeft: -1, ArrowDown: -1 }[e.key];
        if (!by || disabled) return;
        e.preventDefault();
        step(by);
      }}
    >
      <span className="ac-effort__head">
        <span>{label}</span>
        {hint && <span className="ac-effort__hint">{hint(current?.value ?? null)}</span>}
      </span>
      <canvas
        ref={canvas}
        className="ac-effort__ramp"
        onPointerDown={(e) => {
          if (disabled) return;
          e.currentTarget.setPointerCapture?.(e.pointerId);
          setDrag(reach(e.clientX));
        }}
        onPointerMove={(e) => {
          if (drag !== null) setDrag(reach(e.clientX) ?? drag);
        }}
        onPointerUp={() => {
          if (drag === null) return;
          const next = steps[shown];
          setDrag(null);
          if (next && next.value !== value) onValueChange(next.value);
        }}
        onPointerCancel={() => setDrag(null)}
      />
      <span
        className="ac-effort__names"
        aria-hidden="true"
        style={{ gridTemplateColumns: `repeat(${n}, minmax(0, 1fr))` }}
      >
        {steps.map((s, i) => (
          <button
            key={s.value}
            type="button"
            tabIndex={-1}
            disabled={disabled}
            data-on={i === shown || undefined}
            onClick={() => s.value !== value && onValueChange(s.value)}
          >
            {s.label}
          </button>
        ))}
      </span>
    </div>
  );
}
