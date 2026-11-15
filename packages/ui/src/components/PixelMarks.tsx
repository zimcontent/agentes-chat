import type { CSSProperties } from "react";
import { DOUG_OUTLINE_BOX, DOUG_OUTLINE_PATH } from "../brand/doug-outline";
import { cx } from "../cx";

/**
 * Pixel marks that sit next to the PixelSpinner:
 * `PixelDone`, one green pixel (the spinner grid's center cell) that pops in
 * when a step is done, `PixelFail`, an exclamation in two pixels of the danger
 * color when a step failed, and `PixelStop`, a solid rounded square that reads as
 * "stop" (it breathes while an agent works). Pure CSS; still under
 * prefers-reduced-motion. Decorative unless `label` is given.
 */

/** A cell of an n×n pixel grid `size` px wide: its pitch, the gap and the drawn side (PixelSpinner's rule). */
export function pixelCell(size: number, n: 3 | 2) {
  const cell = size / n;
  const gap = Math.max(1, Math.round(cell * 0.14));
  return { cell, gap, inner: Math.max(1, Math.round(cell - gap)) };
}

const a11y = (label: string | undefined) =>
  label ? { role: "img" as const, "aria-label": label } : { "aria-hidden": true as const };

export interface PixelDoneProps {
  size?: number;
  label?: string;
  className?: string;
}

/** Done: one pixel in the ok color, the size of the spinner's center cell, popping in over ~160 ms. */
export function PixelDone({ size = 14, label, className }: PixelDoneProps) {
  const { inner } = pixelCell(size, 3);
  return (
    <span
      className={cx("ac-pixdone", className)}
      style={{ width: size, height: size, "--mark-size": `${size}px`, "--px": `${inner}px` } as CSSProperties}
      {...a11y(label)}
    />
  );
}

/** Failed: an exclamation of two pixels (a tall one over the center cell's size) in the danger color. */
export function PixelFail({ size = 14, label, className }: PixelDoneProps) {
  const { inner, gap } = pixelCell(size, 3);
  return (
    <span
      className={cx("ac-pixfail", className)}
      style={
        {
          width: size,
          height: size,
          "--mark-size": `${size}px`,
          "--px": `${inner}px`,
          "--px-gap": `${gap}px`,
        } as CSSProperties
      }
      {...a11y(label)}
    />
  );
}

export interface PixelStopProps {
  size?: number;
  /** An agent is working: the square breathes (a slow fade, 1.6 s). */
  animated?: boolean;
  /** Stopped (a halted step): dimmed. */
  dim?: boolean;
  label?: string;
  className?: string;
}

/** Stop: one rounded square in the text color, ~3/4 of the box. */
export function PixelStop({ size = 13, animated = false, dim = false, label, className }: PixelStopProps) {
  const side = Math.round(size * 0.76);
  const radius = Math.max(2, Math.round(side * 0.24));
  return (
    <span
      className={cx("ac-pixstop", className)}
      data-animated={animated || undefined}
      data-dim={(!animated && dim) || undefined}
      style={
        {
          width: size,
          height: size,
          "--mark-size": `${size}px`,
          "--stop-side": `${side}px`,
          "--stop-radius": `${radius}px`,
        } as CSSProperties
      }
      {...a11y(label)}
    >
      <span />
    </span>
  );
}

export interface DougOutlineProps {
  size?: number;
  label?: string;
  className?: string;
}

/**
 * The Doug's head in outline, still: the working indicator's shape (PixelSpinner) for a mark that doesn't run, as
 * "waiting for you". The line is 1/8 of the box and takes the text color.
 */
export function DougOutline({ size = 12, label, className }: DougOutlineProps) {
  const box = DOUG_OUTLINE_BOX;
  const side = Math.max(box.w, box.h);
  // The frame leaves half a line clear on every side, the head centred in it.
  const line = side / 7;
  const frame = side + line;
  return (
    <svg
      className={cx("ac-dougline", className)}
      width={size}
      height={size}
      viewBox={`${box.x + box.w / 2 - frame / 2} ${box.y + box.h / 2 - frame / 2} ${frame} ${frame}`}
      style={{ "--mark-size": `${size}px` } as CSSProperties}
      focusable="false"
      role={label ? "img" : undefined}
      aria-label={label}
      aria-hidden={label ? undefined : true}
    >
      <path d={DOUG_OUTLINE_PATH} strokeWidth={line} />
    </svg>
  );
}
