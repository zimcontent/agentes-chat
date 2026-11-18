import { type ShadowLayer, type ShadowName, type ThemeColors, shadows as tokenShadows } from "@agenteschat/tokens";
import { CORES_BOTS, dbTokens } from "../brand/tokens";

/**
 * The phone app's colors (pure: no React Native import, so it is unit-tested). The design system's tokens,
 * with the light theme made native like iOS: white lists and
 * chat, the grouped gray only where iOS groups (profile, Atividade, sheets) with white cards on it, lighter
 * fills, darker secondary text and lighter hairlines. The dark theme stays the tokens'.
 */
export type Scheme = "light" | "dark";

export interface AppColors extends ThemeColors {
  /** The grouped background (Settings-like screens, Atividade, sheets); white cards sit on it. */
  grouped: string;
  /** My own message bubble: the lime's wash over the glass (the site's own bubble, `--own-bubble`). */
  bubble: string;
  /** Someone else's bubble: the glass's own step (the site's `.ac-msg__text`). */
  bubbleTheirs: string;
  /** A bubble's 1 px rim and lit top line: mine in the lime, theirs in white. */
  bubbleRim: string;
  bubbleTheirsRim: string;
  /**
   * The same rims as a plain 1 px border (`bubbleRim` is a box shadow): what the conversation's bubbles wear, since a
   * box shadow on every row is an offscreen layer redrawn each frame on iOS.
   */
  bubbleEdge: string;
  bubbleTheirsEdge: string;
  /** The only color for "waits on you" (requests, questions, what expires). */
  amber: string;
  /** Words in amber on an amber-tinted fill (a "Needs you" chip): darker in light, so they keep 4.5:1. */
  amberInk: string;
  /** A small tag's fill (chips, states). */
  chip: string;
  /** Unread: the row's dot, the same red as the tab bar's badge (the system red). */
  badge: string;
  /** A sheet's grabber where we draw it (Android; iOS draws its own), the system's tone for it. */
  grabber: string;
  /** DougBot's green (#9CFA05): only the Doug and the screen's main action. */
  green: string;
  /** Ink on the green. */
  greenInk: string;
  /** The green as words, an icon or a thin edge: the dark variant in light, for AA. */
  greenText: string;
  /** A chosen item's fill: the green at 12% (`--db-verde-suave`). */
  chosen: string;
  /** An active field's edge: the green at 35% (`--db-verde-luz`). */
  greenGlow: string;
  /** The glass's 1 px edge (`--db-vidro-borda`). */
  glassEdge: string;
  /** The glass's lit top line (`--db-vidro-brilho`). */
  glassTop: string;
  /** A small glass piece's fill, top to bottom (`--db-vidro-cartao`). */
  glassCard: readonly [string, string];
}

/**
 * DougBot (identidade/dougbot-identidade, `src/brand/tokens.ts`): the app's colors are the identity's palco, vidro,
 * texto and lines in both themes. Green (#9CFA05) is never a theme color here: only the Doug and the screen's main
 * action (Button primary, the composer's send) paint it, and a chosen item uses the soft green (`chosen`). The
 * "agent" accent of the old theme (links, work in progress) is the ink: color comes from the bots.
 */
function fromDoug(scheme: Scheme): AppColors {
  const t = dbTokens(scheme);
  const dark = scheme === "dark";
  return {
    bg: t.palco,
    raised: t.palco2,
    raised2: t.palco3,
    sunken: t.palco3,
    side: t.palco,
    pane: t.palco2,
    glass: t.vidro,
    glassSolid: t.palco2,
    line: t.linha,
    line2: t.linha2,
    lineStrong: t.linha3,
    ink: t.texto,
    ink2: dark ? "#D4D4D4" : "#1F211C",
    muted: t.texto2,
    // The quiet words at 4.6:1 on the dark stage (the site's `--db-texto-leve`); the identity's #6B6B6B stays for marks.
    faint: dark ? "#8A8A8A" : t.texto3,
    focusColor: t.verdeTexto,
    agent: t.texto,
    agent2: t.texto2,
    agentSoft: dark ? "#1A1A1A" : "#ECEFE8",
    onAgent: t.palco,
    ok: dark ? "#D4D4D4" : "#1F211C",
    warn: t.atencao,
    warnSoft: dark ? "#33270F" : "#FBEED5",
    onWarn: t.verdeTinta,
    danger: t.erro,
    info: CORES_BOTS.azul,
    plate: dark ? "rgba(255, 255, 255, 0.06)" : "rgba(10, 10, 10, 0.05)",
    plateSoft: dark ? "rgba(255, 255, 255, 0.04)" : "rgba(10, 10, 10, 0.03)",
    scrim: dark ? "rgba(0, 0, 0, 0.6)" : "rgba(10, 10, 10, 0.32)",
    surface: t.palco,
    surfaceRaised: t.palco2,
    surfaceSunken: t.palco3,
    inkMuted: t.texto2,
    action: t.texto,
    onAction: t.palco,
    attention: t.atencao,
    onAttention: t.verdeTinta,
    attentionSoft: dark ? "#33270F" : "#FBEED5",
    success: t.texto,
    grouped: t.palco,
    // The person's own message: 14% of the lime over the glass's step, with a lime rim (dougbot.app's bubbles).
    bubble: dark ? "#2C3917" : "#E4F3C8",
    bubbleTheirs: t.palco3,
    bubbleRim: dark
      ? "inset 0px 1px 0px rgba(156, 250, 5, 0.1), inset 0px 0px 0px 1px rgba(156, 250, 5, 0.2)"
      : "inset 0px 0px 0px 1px rgba(62, 107, 0, 0.18)",
    bubbleTheirsRim: dark
      ? "inset 0px 1px 0px rgba(255, 255, 255, 0.05), inset 0px 0px 0px 1px rgba(255, 255, 255, 0.047)"
      : "inset 0px 0px 0px 1px rgba(10, 10, 10, 0.06)",
    bubbleEdge: dark ? "rgba(156, 250, 5, 0.22)" : "rgba(62, 107, 0, 0.2)",
    bubbleTheirsEdge: dark ? "rgba(255, 255, 255, 0.06)" : "rgba(10, 10, 10, 0.07)",
    amber: t.atencao,
    amberInk: dark ? t.atencao : "#7A4700",
    chip: t.palco3,
    badge: t.erro,
    grabber: dark ? "rgba(237, 237, 237, 0.3)" : "rgba(10, 10, 10, 0.25)",
    green: t.verde,
    greenInk: t.verdeTinta,
    greenText: t.verdeTexto,
    chosen: t.verdeSuave,
    greenGlow: t.verdeLuz,
    glassEdge: t.vidroBorda,
    glassTop: t.vidroBrilho,
    glassCard: t.vidroCartao,
  };
}

export function appColors(scheme: Scheme): AppColors {
  return fromDoug(scheme);
}

/** A card inside a dark sheet: one step above the sheet, as the sheet is one above the screen. */
const DARK_SHEET_CARD = "#262626";

/**
 * The colors inside a form sheet. In dark the sheet is lifted one step above the screen behind it (the dark
 * page's own color made the two read as one) and its cards one more, as the system's own sheets do. Light
 * keeps the grouped gray with white cards on it, which already stands apart from the dimmed white screen.
 */
export function sheetColors(colors: AppColors, scheme: Scheme): AppColors {
  if (scheme !== "dark") return colors;
  return {
    ...colors,
    // The sheet on the glass's own step (`--db-palco-3`), its cards one more: each step told apart.
    bg: colors.raised2,
    grouped: colors.raised2,
    surface: colors.raised2,
    raised: DARK_SHEET_CARD,
    raised2: DARK_SHEET_CARD,
    surfaceRaised: DARK_SHEET_CARD,
    // Android's "glass" plates (round buttons) are opaque: a card's tone, so they don't vanish into the sheet.
    glassSolid: DARK_SHEET_CARD,
  };
}

/** Light elevations are softer (a hairline and a short shadow, like iOS); dark keeps the tokens'. */
const NATIVE_LIGHT_SHADOWS: Partial<Record<ShadowName, ShadowLayer[]>> = {
  e1: [
    { x: 0, y: 1, blur: 2, spread: 0, color: "rgba(0, 0, 0, 0.04)" },
    { x: 0, y: 0, blur: 0, spread: 0.5, color: "rgba(60, 60, 67, 0.12)" },
  ],
  e2: [
    { x: 0, y: 4, blur: 14, spread: -6, color: "rgba(0, 0, 0, 0.12)" },
    { x: 0, y: 0, blur: 0, spread: 0.5, color: "rgba(60, 60, 67, 0.14)" },
  ],
};

export function appShadows(scheme: Scheme): Record<ShadowName, ShadowLayer[]> {
  return scheme === "dark" ? tokenShadows.dark : { ...tokenShadows.light, ...NATIVE_LIGHT_SHADOWS };
}

/** A `#rrggbb` color at `alpha` (0–1), as `#rrggbbaa`. */
export const withAlpha = (hex: string, alpha: number) =>
  `${hex.slice(0, 7)}${Math.round(alpha * 255)
    .toString(16)
    .padStart(2, "0")}`;

export type ToastTone = "success" | "info" | "warning" | "danger" | "neutral";

/**
 * A toast's tone: a failure (`x`, `alert`) is danger, a done check (or no icon) success, any other icon neutral.
 * The web's toasts glow the same way per tone (`.ac-toast--*`).
 */
export const toastToneOf = (icon: string | undefined): ToastTone =>
  icon === "x" || icon === "alert" ? "danger" : icon === undefined || icon === "check" ? "success" : "neutral";

/** A tone's color: its icon's, and its glow's (neutral's glow is fainter than its icon). */
export const toneColor = (colors: AppColors, tone: ToastTone) =>
  ({ success: colors.ok, info: colors.agent, warning: colors.warn, danger: colors.danger, neutral: colors.ink2 })[tone];

/**
 * The tone's soft glow from the toast's right edge, as the web's (24% of the tone in light, 30% in dark, fading out
 * over the last 45%): the gradient's colors and stops, left to right.
 */
export function toastGlow(colors: AppColors, tone: ToastTone, scheme: Scheme) {
  const color = tone === "neutral" ? colors.faint : toneColor(colors, tone);
  return {
    colors: [withAlpha(color, 0), withAlpha(color, 0), withAlpha(color, scheme === "dark" ? 0.3 : 0.24)] as const,
    locations: [0, 0.55, 1] as const,
  };
}
