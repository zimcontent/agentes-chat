/**
 * The tab bar's own glyphs (Início, Esperando você, Portal, Revisão, Configurações: the web sidebar's rows, in the
 * same order and with the same icons) as SVG documents, in two states: outline (unselected) and filled or bolder
 * (selected). They are template images: one opaque color, and the native tab bar tints them by state. 24×24 viewBox,
 * stroke 1.7 with round caps. Pure: `tabIcons.ts` rasterizes them with Skia.
 */

export const TAB_GLYPHS = ["home", "waiting", "portal", "review", "settings"] as const;
export type TabGlyph = (typeof TAB_GLYPHS)[number];

/** A glyph and its state, as one name (the icon "family" of the tab bar takes a single name). */
export type TabGlyphKey = TabGlyph | `${TabGlyph}.selected`;

export function tabGlyphKey(glyph: TabGlyph, selected: boolean): TabGlyphKey {
  return selected ? `${glyph}.selected` : glyph;
}

export function parseTabGlyphKey(key: string): { glyph: TabGlyph; selected: boolean } | null {
  const selected = key.endsWith(".selected");
  const glyph = (selected ? key.slice(0, -".selected".length) : key) as TabGlyph;
  return TAB_GLYPHS.includes(glyph) ? { glyph, selected } : null;
}

const STROKE = 1.7;
const f = (n: number) => Number(n.toFixed(3));

/**
 * The web sidebar's icons (`packages/ui` line icons, a 20 grid) drawn on the bar's 24 grid: scaled by 1.2, the stroke
 * narrowed by as much so it lands at the bar's 1.7. The bar draws them as templates (only alpha counts), so a
 * selected glyph either fills with its inner mark cut out by the even-odd rule, or, where the mark is a line, draws
 * bolder (as the system's search tab).
 */
const WEB = 1.2;
const BOLD = 2.3;
const webGroup = (inner: string, color: string, width = STROKE) =>
  `<g transform="scale(${WEB})" fill="none" stroke="${color}" stroke-width="${f(width / WEB)}" stroke-linecap="round" stroke-linejoin="round">${inner}</g>`;

/** Início: the sidebar's house; selected, its body fills with the door cut out. */
function homeGlyph(selected: boolean, color: string): string {
  const roof = '<path d="M3.5 9 10 3.5 16.5 9"/>';
  if (!selected)
    return webGroup(`${roof}<path d="M5 7.8v6.7A1.5 1.5 0 0 0 6.5 16h2v-4h3v4h2a1.5 1.5 0 0 0 1.5-1.5V7.8"/>`, color);
  const body = "M5 7.8 10 3.6l5 4.2v6.7a1.5 1.5 0 0 1-1.5 1.5h-7A1.5 1.5 0 0 1 5 14.5ZM8.5 16v-4h3v4Z";
  return webGroup(`${roof}<path d="${body}" fill="${color}" fill-rule="evenodd" stroke="none"/>`, color);
}

/** Esperando você: the sidebar's question in a circle, bolder when selected. */
function waitingGlyph(selected: boolean, color: string): string {
  const mark = "M8 7.9a2.1 2.1 0 1 1 2.8 1.9c-.5.3-.8.7-.8 1.3v.3M10 14v.01";
  return webGroup(`<circle cx="10" cy="10" r="7"/><path d="${mark}"/>`, color, selected ? BOLD : STROKE);
}

/** Portal: the sidebar's card with a check, bolder when selected. */
function portalGlyph(selected: boolean, color: string): string {
  const card = "M7 3h6a4 4 0 0 1 4 4v6a4 4 0 0 1-4 4H3V7a4 4 0 0 1 4-4z";
  return webGroup(`<path d="${card}"/><path d="m7 10.2 2 2 4-4.4"/>`, color, selected ? BOLD : STROKE);
}

/** Revisão: the sidebar's video frame with its play; selected, the frame fills with the play cut out. */
function reviewGlyph(selected: boolean, color: string): string {
  if (!selected)
    return webGroup(
      '<rect x="3" y="4.5" width="14" height="11" rx="2.5"/><path d="m8.5 7.8 3.7 2.2-3.7 2.2z"/>',
      color,
    );
  const frame = "M5.5 4.5h9A2.5 2.5 0 0 1 17 7v6a2.5 2.5 0 0 1-2.5 2.5h-9A2.5 2.5 0 0 1 3 13V7a2.5 2.5 0 0 1 2.5-2.5Z";
  return webGroup(`<path d="${frame}M8.5 7.8v4.4l3.7-2.2Z" fill="${color}" fill-rule="evenodd"/>`, color);
}

/** Configurações: the sidebar's two sliders; selected, their knobs fill. */
function settingsGlyph(selected: boolean, color: string): string {
  const knob = selected ? ` fill="${color}"` : "";
  return webGroup(
    `<path d="M3.5 6h7M15.5 6h1M3.5 14h1M9.5 14h7"/><circle cx="13" cy="6" r="2"${knob}/><circle cx="7" cy="14" r="2"${knob}/>`,
    color,
  );
}

/** The SVG document of a tab glyph in a state, drawn in `color` (any opaque color: it is a template). */
export function tabGlyphSvg(glyph: TabGlyph, selected: boolean, color = "#000000"): string {
  let body: string;
  switch (glyph) {
    case "home":
      body = homeGlyph(selected, color);
      break;
    case "waiting":
      body = waitingGlyph(selected, color);
      break;
    case "portal":
      body = portalGlyph(selected, color);
      break;
    case "review":
      body = reviewGlyph(selected, color);
      break;
    case "settings":
      body = settingsGlyph(selected, color);
      break;
  }
  return `<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24">${body}</svg>`;
}
