import type { ViewStyle } from "react-native";
import type { Scheme } from "./palette";

/**
 * The site's surfaces on the phone (dougbot.app's `doug.css`, round 3.1): pure, so they are unit-tested.
 *
 * - `panel`: a card that holds rows or a figure, one step above the stage, with the glass's lit top line and its
 *   1 px rim (the site's `.ac-card`, `--dg-glass-card`).
 * - `pill`: a round control that floats (the site's `--dg-pill` with `--dg-edge`): header buttons, tool plates.
 * - `chosen`: the one thing the screen puts first, in the lime's wash with its hairline and glow (the sidebar's open
 *   row, `--dg-lime-chosen`): Doug pinned on Início.
 *
 * Light keeps the same shapes on the light stage: a white card with a hairline, a faint plate.
 */
export interface Surface {
  backgroundColor: string;
  boxShadow: string;
}

const DARK_PANEL: Surface = {
  backgroundColor: "#141414",
  boxShadow: "inset 0px 1px 0px rgba(255, 255, 255, 0.05), inset 0px 0px 0px 1px rgba(255, 255, 255, 0.08)",
};
const LIGHT_PANEL: Surface = {
  backgroundColor: "#FFFFFF",
  boxShadow: "inset 0px 0px 0px 1px rgba(10, 10, 10, 0.08), 0px 1px 2px rgba(0, 0, 0, 0.04)",
};

const DARK_PILL: Surface = {
  backgroundColor: "rgba(255, 255, 255, 0.055)",
  boxShadow:
    "inset 0px 1px 0px rgba(255, 255, 255, 0.16), inset 0px -1px 0px rgba(255, 255, 255, 0.04), inset 0px 0px 0px 1px rgba(255, 255, 255, 0.085)",
};
const LIGHT_PILL: Surface = {
  backgroundColor: "rgba(10, 10, 10, 0.04)",
  boxShadow: "inset 0px 0px 0px 1px rgba(10, 10, 10, 0.08)",
};

const DARK_CHOSEN: Surface = {
  backgroundColor: "#141414",
  boxShadow:
    "inset 0px 1px 0px rgba(156, 250, 5, 0.12), inset 0px 0px 0px 1px rgba(156, 250, 5, 0.32), 0px 0px 30px -12px rgba(156, 250, 5, 0.45)",
};
const LIGHT_CHOSEN: Surface = {
  backgroundColor: "#FFFFFF",
  boxShadow: "inset 0px 0px 0px 1px rgba(62, 107, 0, 0.35), 0px 6px 20px -10px rgba(62, 107, 0, 0.35)",
};

export const panelSurface = (scheme: Scheme): Surface => (scheme === "dark" ? DARK_PANEL : LIGHT_PANEL);
export const pillSurface = (scheme: Scheme): Surface => (scheme === "dark" ? DARK_PILL : LIGHT_PILL);
export const chosenSurface = (scheme: Scheme): Surface => (scheme === "dark" ? DARK_CHOSEN : LIGHT_CHOSEN);

/**
 * The chosen card drawn with a border and no shadow (Doug pinned on Início): the same fill and the lime hairline as a
 * 1 px border, so nothing outside the card is painted and nothing is composited per frame.
 */
export const chosenBorder = (scheme: Scheme, radius: number): ViewStyle => ({
  backgroundColor: chosenSurface(scheme).backgroundColor,
  borderWidth: 1,
  borderColor: scheme === "dark" ? "rgba(156, 250, 5, 0.32)" : "rgba(62, 107, 0, 0.35)",
  borderRadius: radius,
});

/** The lime's wash over a chosen card, from its top left corner (the site's radial light, as a gradient). */
export const chosenWash = (scheme: Scheme): readonly [string, string] =>
  scheme === "dark"
    ? ["rgba(156, 250, 5, 0.16)", "rgba(156, 250, 5, 0)"]
    : ["rgba(124, 200, 4, 0.14)", "rgba(124, 200, 4, 0)"];

/** A panel's corner: rows and figures 24, small cards 20 (the site's `--db-r-4` and up). */
export const PANEL_RADIUS = 24;
export const CARD_RADIUS = 20;

/** The style of a surface, for a `View`. */
export const surfaceStyle = (s: Surface, radius: number): ViewStyle => ({
  backgroundColor: s.backgroundColor,
  boxShadow: s.boxShadow,
  borderRadius: radius,
});
