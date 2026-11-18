/**
 * The conversation's texture, the parts with no React Native in them (`ChatBackdrop` draws them): the site's dot grid
 * (dougbot.app's `radial-gradient` of the ink, 1 px dots) and a soft glow from the top in the bot's color, the lime
 * for Doug and in groups. Quiet enough that words over it keep their contrast in both themes: the dots stay under 8%
 * of the ink and the glow under 16% of its color.
 */

/** The grid's step, in points, and its dots' radius. */
export const BACKDROP_STEP = 20;
export const BACKDROP_DOT = 1;

export interface BackdropTones {
  /** The dots' color and opacity. */
  dot: string;
  dotOpacity: number;
  /** The glow's color, its opacity at its heart (it fades to nothing). */
  glow: string;
  glowOpacity: number;
}

/** The brand's green (`CORES_BOTS.verde`), the glow where no bot gives its own. */
export const BRAND_GREEN = "#9CFA05";

const HEX = /^#[0-9a-f]{6}$/i;

/**
 * The texture's tones for a theme and an accent (a bot's own `#rrggbb`; anything else is the brand's green). Light
 * pages take a stronger glow, since a lime wash over white reads fainter than over the dark stage.
 */
export function backdropTones(dark: boolean, accent?: string | null): BackdropTones {
  const glow = accent && HEX.test(accent) ? accent : BRAND_GREEN;
  return dark
    ? { dot: "#FFFFFF", dotOpacity: 0.07, glow, glowOpacity: 0.11 }
    : { dot: "#0A0A0A", dotOpacity: 0.075, glow, glowOpacity: 0.15 };
}
