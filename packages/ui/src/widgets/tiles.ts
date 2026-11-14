/**
 * A widget's tones (ADR 0135), the same as the chat's charts: the stroke in the agent's deep tone (its light one on
 * a dark page), the fill a 2px Bayer dither in its light tone. CSS reads them as variables, so bars, a goal's fill,
 * the building sweep and the dashboards' thumbnails share one tile.
 *
 * DougBot (`PIXEL_ART` off) draws no dither: the fill is glass in the bot's own color (IDENTIDADE.md §4, a bot's color
 * shows where it is), which the apps give as a hex, and the tile is that color as a flat wash.
 */
import type { CSSProperties } from "react";
import { type AgentColorName, gradientOf, isHexColor } from "../agent/engine.js";
import { PIXEL_ART } from "../brand/doug";
import { chartAreaTones, chartInk } from "../sky/chart";
import { bayerAt, mix } from "../sky/math";

/** Points per dither cell, as the chat's charts draw them. */
export const WIDGET_CELL = 2;

/** The stroke and the fill of an agent color (the color as `AgentAvatar` takes it: a name or a hex). */
export function widgetTones(color: string, dark: boolean): { stroke: string; fill: string } {
  const c = color as AgentColorName;
  if (!PIXEL_ART) {
    // The bot's color itself; on a light page its lines go darker, to read on white.
    const cor = isHexColor(color) ? color : gradientOf(c)[0];
    return { stroke: dark ? cor : mix(cor, "#000000", 0.55), fill: cor };
  }
  return { stroke: chartInk(c, dark), fill: chartAreaTones(c, dark)[0] };
}

const tiles = new Map<string, string>();

/**
 * A 4×4 Bayer tile of `color` at `density` (0..1, the share of cells lit), as a CSS `url()` of an 8×8 SVG: each
 * cell is 2px when drawn at `background-size: 8px 8px`.
 */
export function ditherTile(color: string, density = 0.55): string {
  const key = `${color}|${density}`;
  const hit = tiles.get(key);
  if (hit) return hit;
  let cells = "";
  for (let y = 0; y < 4; y++)
    for (let x = 0; x < 4; x++)
      if (bayerAt(x, y) < density)
        cells += `<rect x="${x * WIDGET_CELL}" y="${y * WIDGET_CELL}" width="${WIDGET_CELL}" height="${WIDGET_CELL}"/>`;
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="8" height="8" shape-rendering="crispEdges" fill="${color}">${cells}</svg>`;
  const url = `url("data:image/svg+xml,${encodeURIComponent(svg)}")`;
  tiles.set(key, url);
  return url;
}

/** DougBot's tile: `color` as a flat wash of glass, an image like the dither's so the same CSS draws it. */
export function glassTile(color: string): string {
  const wash = `color-mix(in srgb, ${color} 30%, transparent)`;
  return `linear-gradient(${wash}, ${wash})`;
}

/**
 * CSS variables for a widget in an agent's tones: `--wg-s` the stroke (and `--wg-c`, the update's flash), `--wg-f`
 * the fill, `--wg-tile` the dither tile (`background: var(--wg-tile) 0 0 / 8px 8px`), a wash of glass in DougBot.
 */
export function widgetTileVars(color: string, dark: boolean): CSSProperties {
  const { stroke, fill } = widgetTones(color, dark);
  return {
    "--wg-s": stroke,
    "--wg-c": stroke,
    "--wg-f": fill,
    "--wg-tile": PIXEL_ART ? ditherTile(fill) : glassTile(fill),
  } as CSSProperties;
}
