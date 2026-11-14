/**
 * The emails' pictures, written FROM THE CODE of the avatar (`packages/ui/src/brand/dougbot-avatar.js`, the identity's
 * own drawer), at twice the size the layout shows them:
 *
 *   cd apps/mobile && bun scripts/email-art.ts
 *
 * writes into `apps/web/public/email/`: the signature (the Doug close up and the name in Manrope, IDENTIDADE.md §3) in
 * ink on a tile of the page's colour and in bone for the dark design, every bot an email may show (`EMAIL_BOTS` in
 * packages/engine/src/email/layout.ts: the identity's team, and each free bot by form, colour and eyes), and the Doug
 * alone for a browser notification's picture. An email client runs no code and most show no SVG, so these are the only bitmaps of the bots besides the
 * stores' (`brand-assets.ts`). It lives here because the app already has resvg and Manrope's files.
 *
 * Rendered with resvg (SVG → PNG, filters included). A changed drawing gets a new file name (Gmail's image proxy
 * caches by name): bump `ART` in the layout, or `DOUG_ART` when only the Doug's changed.
 */
import { writeFileSync } from "node:fs";
import { join } from "node:path";
import { Resvg } from "@resvg/resvg-js";
import {
  BOT_SHOWN,
  botFile,
  EMAIL_BOTS,
  LOGO,
  LOGO_BONE,
  LOGO_INK,
  LOGO_PAGE,
  MARK,
} from "../../../packages/engine/src/email/layout";
import DougBot from "../../../packages/ui/src/brand/dougbot-avatar.js";

const out = join(import.meta.dir, "..", "..", "web", "public", "email");
const fonts = join(import.meta.dir, "..", "node_modules", "@expo-google-fonts", "manrope");
const MANROPE = [
  join(fonts, "800ExtraBold", "Manrope_800ExtraBold.ttf"),
  join(fonts, "500Medium", "Manrope_500Medium.ttf"),
];

const png = (svg: string, width: number) =>
  new Resvg(svg, {
    fitTo: { mode: "width", value: width },
    font: { loadSystemFonts: false, fontFiles: MANROPE, defaultFontFamily: "Manrope" },
  })
    .render()
    .asPng();

/** A drawing's inside (viewBox 120), to place in a larger picture. */
const inner = (svg: string) => svg.replace(/^<svg[^>]*>/, "").replace(/<\/svg>$/, "");

// Every bot at twice its shown size, closed on its face as the app draws it under 60 px, no light on the floor
// (a light ground, a row of names).
for (const bot of EMAIL_BOTS) {
  const svg = DougBot.avatar({ ...bot, tamanho: 120, perto: true, brilho: false, id: "b" });
  writeFileSync(join(out, botFile(bot)), png(svg, BOT_SHOWN.scene * 2));
}

/**
 * The signature (IDENTIDADE.md §3): the Doug 1.42 times the name's size, 0.36 of it away, "Doug" 800 and "Bot" 500 in
 * one colour, set on the picture's middle line.
 */
function signature(color: string, tile?: string) {
  const { width: w, height: h, name: t } = LOGO;
  const doug = Math.round(t * 1.42);
  const k = doug / 120;
  const x = doug + t * 0.36;
  const face = inner(DougBot.avatar({ bot: "doug", tamanho: 120, perto: true, brilho: false, id: "d" }));
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}" viewBox="0 0 ${w} ${h}">${
    tile ? `<rect width="${w}" height="${h}" rx="8" fill="${tile}"/>` : ""
  }<g transform="translate(0 ${(h - doug) / 2}) scale(${k})">${face}</g><text x="${x}" y="${h / 2}" dominant-baseline="central" font-family="Manrope" font-size="${t}" letter-spacing="${-0.02 * t}" fill="${color}"><tspan font-weight="800">Doug</tspan><tspan font-weight="500">Bot</tspan></text></svg>`;
}
writeFileSync(join(out, LOGO_INK), png(signature("#0A0A0A", LOGO_PAGE), LOGO.width * 2));
writeFileSync(join(out, LOGO_BONE), png(signature("#EDEDED"), LOGO.width * 2));
// A browser notification's picture: the Doug whole, as the app's icon.
writeFileSync(
  join(out, MARK),
  png(DougBot.avatar({ bot: "doug", tamanho: 120, perto: false, brilho: false, id: "m" }), 192),
);

console.log(`${EMAIL_BOTS.length} bots, the signature and the mark written into ${out}`);
