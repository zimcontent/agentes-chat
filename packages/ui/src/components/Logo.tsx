import type { CSSProperties, ImgHTMLAttributes } from "react";
import { BRAND_MARK_URL, BRAND_NAME } from "../brand/doug";
import { cx } from "../cx";

/**
 * Doug's mark: the mascot's art from one swappable file (`BRAND_MARK_URL`), so the final art replaces the placeholder
 * without touching any screen.
 */
export function DougMark({
  size,
  className,
  label,
  ...rest
}: { size?: number; className?: string; label?: string } & Omit<ImgHTMLAttributes<HTMLImageElement>, "src" | "alt">) {
  return (
    <img
      {...rest}
      src={BRAND_MARK_URL}
      className={cx("ac-logo__mark", className)}
      style={size ? { width: size, height: size } : undefined}
      alt={label ?? ""}
      aria-hidden={label ? undefined : true}
      draggable={false}
    />
  );
}

/** The product's mark wherever the app showed its own (kept as `LogoMark` so every caller follows the brand). */
export const LogoMark = DougMark;

export interface LogoProps {
  /** Kept for callers: both variants show the name alone. */
  variant?: "main" | "expanded";
  /** One-color version. */
  mono?: boolean;
  /** Font size in px; the mark scales with it. Below 18px use `LogoMark` alone. */
  size?: number;
  className?: string;
  style?: CSSProperties;
}

/** The product's logo: mark + name. Accessible name is the brand's. */
export function Logo({ mono, size = 24, className, style }: LogoProps) {
  return (
    <span
      className={cx("ac-logo", mono && "ac-logo--mono", className)}
      style={{ fontSize: size, ...style }}
      role="img"
      aria-label={BRAND_NAME}
    >
      <DougMark />
      <span className="ac-logo__word" aria-hidden="true">
        {BRAND_NAME}
      </span>
    </span>
  );
}
