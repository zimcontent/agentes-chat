/**
 * DougBot's store bitmaps, written FROM THE CODE of the avatar (`src/brand/dougbot-avatar.js`, the identity's own
 * drawer): the only images the app ships of its own, because the stores and the launch screen demand bitmaps (the
 * icon in its three appearances, the Android adaptive icon's layers, the native splash and Android's notification
 * glyph). Every screen draws the Doug by code; nothing here is used inside the UI.
 *
 *   cd apps/mobile && bun scripts/brand-assets.ts
 *
 * Rendered with resvg (SVG → PNG, filters included). Run it again after the identity's drawing changes. The icon is
 * the app icons' shipped one (src/brand/doug-icons.js), the same drawing as every icon a person may pick.
 */
import { writeFileSync } from "node:fs";
import { join } from "node:path";
import { type DougBotOpcoes, svgDoBot } from "../src/brand/bots";
import { iconSvg, SHIPPED_ICON } from "../src/brand/doug-icons.js";
import { opaquePng, png } from "./icon-png.mjs";

const out = join(import.meta.dir, "..", "assets", "images");

/** A drawing of the Doug's (viewBox 120) in a square of `side` units: `scale` of it, centered, `dy` of it down. */
function placed(side: number, scale: number, dy: number, opcoes: Partial<DougBotOpcoes>, id: string) {
  const inner = svgDoBot({ bot: "doug", tamanho: 120, perto: false, brilho: false, id, ...opcoes })
    .replace(/^<svg[^>]*>/, "")
    .replace(/<\/svg>$/, "");
  const k = (side * scale) / 120;
  const at = (side - 120 * k) / 2;
  return `<g transform="translate(${at} ${at + dy * side}) scale(${k})">${inner}</g>`;
}
const svg = (side: number, body: string) =>
  `<svg xmlns="http://www.w3.org/2000/svg" width="${side}" height="${side}" viewBox="0 0 ${side} ${side}">${body}</svg>`;

// The icon, opaque and square (the system rounds it), in iOS's three appearances, drawn as the app icons are
// (src/brand/doug-icons.js, the shipped one): by day his black head on the green glass; by night his head in green
// glass lighting the stage; tinted, the night's picture in greys.
const S = 1024;
const night = { ...SHIPPED_ICON, ground: "night" as const };
writeFileSync(join(out, "icon.png"), opaquePng(iconSvg(SHIPPED_ICON), S));
writeFileSync(join(out, "icon-dark.png"), opaquePng(iconSvg(night), S));
writeFileSync(join(out, "icon-tinted.png"), opaquePng(iconSvg(night, "tinted"), S, true));
// Android adaptive icon: the green glass behind, his head in front inside the safe circle (61% of the side), and
// the one-colour layer a themed home screen tints.
writeFileSync(join(out, "adaptive-icon-background.png"), opaquePng(iconSvg(SHIPPED_ICON, "back"), S));
writeFileSync(join(out, "adaptive-icon.png"), png(iconSvg(SHIPPED_ICON, "front"), S));
writeFileSync(join(out, "adaptive-icon-monochrome.png"), png(iconSvg(SHIPPED_ICON, "mono"), S));
// The native launch image: the Doug in his piece, transparent (the splash's background is the theme's), 120 pt wide
// on screen, the same drawing `LaunchSplash` starts with.
writeFileSync(join(out, "splash-icon.png"), png(svg(512, placed(512, 1, 0, {}, "d")), 512));
// Android's notification glyph: one color on transparent (the system tints it): his head, the eyes cut out of it.
writeFileSync(
  join(out, "notification-icon.png"),
  png(
    svgDoBot({ bot: "doug", tamanho: 96, peca: false, material: "chapado", cor: "#fff", brilho: false, id: "n" }),
    96,
  ),
);
console.log(
  "icon(.png|-dark.png|-tinted.png), adaptive-icon(.png|-background.png|-monochrome.png), splash-icon.png, notification-icon.png written from the Doug's code",
);
