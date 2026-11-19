import type { ViewStyle } from "react-native";
import type { Scheme } from "./palette";

/**
 * The site's surfaces on the phone (dougbot.app's `doug.css`, round 3.1): pure, so they are unit-tested.
 *
 * - `panel`: a card that holds rows or a figure, one step above the stage, with its 1 px rim (the site's `.ac-card`).
 * - `pill`: a round control that floats (the site's `--dg-pill` with `--dg-edge`): header buttons, tool plates.
 * - `chosen`: the one thing the screen puts first, in the lime's wash with its hairline (the sidebar's open row,
 *   `--dg-lime-chosen`): Doug pinned on Início.
 *
 * The rim is a real border, never a `boxShadow`. On iOS React Native draws each box shadow as a layer of the view's
 * whole size with a mask, which the GPU renders off screen on every frame: the site's three inset shadows on the
 * panel that holds Início's whole list (live agents moving inside it) and on every message bubble kept the GPU busy
 * until the app and then the phone stalled (builds 20 to 25). A border costs nothing.
 */
export interface Surface {
  backgroundColor: string;
  borderColor: string;
}

const DARK_PANEL: Surface = { backgroundColor: "#141414", borderColor: "rgba(255, 255, 255, 0.08)" };
const LIGHT_PANEL: Surface = { backgroundColor: "#FFFFFF", borderColor: "rgba(10, 10, 10, 0.08)" };

const DARK_PILL: Surface = { backgroundColor: "rgba(255, 255, 255, 0.055)", borderColor: "rgba(255, 255, 255, 0.1)" };
const LIGHT_PILL: Surface = { backgroundColor: "rgba(10, 10, 10, 0.04)", borderColor: "rgba(10, 10, 10, 0.08)" };

const DARK_CHOSEN: Surface = { backgroundColor: "#141414", borderColor: "rgba(156, 250, 5, 0.32)" };
const LIGHT_CHOSEN: Surface = { backgroundColor: "#FFFFFF", borderColor: "rgba(62, 107, 0, 0.35)" };

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

/** The style of a surface, for a `View`: its fill and a 1 px border as its rim. */
export const surfaceStyle = (s: Surface, radius: number): ViewStyle => ({
  backgroundColor: s.backgroundColor,
  borderColor: s.borderColor,
  borderWidth: 1,
  borderRadius: radius,
});
