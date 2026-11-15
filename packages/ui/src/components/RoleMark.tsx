import type { CSSProperties } from "react";
import { gradientOf } from "../agent/engine.js";
import { PIXEL_ART } from "../brand/doug";
import { cx } from "../cx";
import { Icon, type IconName, iconNames } from "../icons/Icon";
import { ditherUrl } from "../sky/dither";
import type { AgentColor } from "./AgentLook";

/**
 * A color's face as a `background-image`: the agents' dither (`cells` across) with the pixel art, DougBot's glass
 * without it (the color's gradient, a light on its top and its depth at the foot, as a widget's bars). Every color
 * pick (a role, a project, an agent group) and a role's mark draw it, so they match.
 */
export function colorFace(color: string, cells = 8): string {
  if (PIXEL_ART) return `url("${ditherUrl(color as AgentColor, cells)}")`;
  const [top, bottom] = gradientOf(color as AgentColor);
  return `linear-gradient(180deg, rgba(255, 255, 255, 0.42), rgba(255, 255, 255, 0) 45%, rgba(0, 0, 0, 0.3)), linear-gradient(160deg, ${top}, ${bottom})`;
}

/** Dither cells and icon size for a mark `size` px wide: the icon at most about 70% of it, never crammed. */
const fit = (size: number) =>
  size <= 16
    ? { cells: 8, icon: 10 }
    : size <= 20
      ? { cells: 8, icon: 12 }
      : size <= 28
        ? { cells: 10, icon: 16 }
        : size <= 40
          ? { cells: 14, icon: 20 }
          : { cells: 18, icon: Math.round(size * 0.47) };

/**
 * A workspace role's mark (ADR 0085): the role's color in the agents' dither in a full circle (never a people tile
 * or an agent's cut corner), its icon in white on top. Decorative: the role's name is always beside it.
 */
export function RoleMark({
  color,
  icon,
  size = 26,
  className,
}: {
  /** One of the agents' colors (roles never use sky). */
  color: string;
  icon: string;
  size?: number;
  className?: string;
}) {
  const { cells, icon: px } = fit(size);
  const name = (iconNames as readonly string[]).includes(icon) ? (icon as IconName) : "shield";
  const style = { width: size, height: size, backgroundImage: colorFace(color, cells) };
  return (
    <span className={cx("ac-rolemark", className)} style={style as CSSProperties} aria-hidden="true">
      {px <= 20 ? (
        <Icon name={name} size={px as 14 | 16 | 18 | 20} />
      ) : (
        <Icon name={name} size={20} style={{ width: px, height: px }} />
      )}
    </span>
  );
}
