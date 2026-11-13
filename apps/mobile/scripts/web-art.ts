/**
 * The web app's two bitmaps of the brand, written FROM THE CODE of the avatar (`packages/ui/src/brand/dougbot-avatar.js`,
 * the identity's own drawer):
 *
 *   cd apps/mobile && bun scripts/web-art.ts
 *
 * writes into `apps/web/public/`: the share card a link to the app shows (`og.png`, 1200×630, named in index.html): the
 * Doug whole on the stage with his light on the floor, beside the name in Manrope (IDENTIDADE.md §3), and no other
 * words, so it reads in every language; and the glyph a browser notification shows in Android's status bar
 * (`push-badge.png`, one colour on transparent, the system tints it): the Doug's glass frame with his eyes, the phone
 * app's own (`brand-assets.ts`). It lives here because the app already has resvg and Manrope's files.
 */
import { writeFileSync } from "node:fs";
import { join } from "node:path";
import { Resvg } from "@resvg/resvg-js";
import DougBot from "../../../packages/ui/src/brand/dougbot-avatar.js";

const out = join(import.meta.dir, "..", "..", "web", "public");
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

/** The share card: the stage, the green's light behind the Doug, the Doug and the name on one middle line. */
function shareCard() {
  const [w, h] = [1200, 630];
  // The name's size; the Doug is larger than the signature's 1.42 here, where he is the picture.
  const t = 132;
  const doug = 300;
  const gap = 56;
  // "DougBot" in Manrope 800/500 at -0.02em sets about 4.25 times its size wide.
  const name = t * 4.25;
  const x = (w - (doug + gap + name)) / 2;
  const face = DougBot.avatar({ bot: "doug", tamanho: 120, perto: false, brilho: true, id: "d" })
    .replace(/^<svg[^>]*>/, "")
    .replace(/<\/svg>$/, "");
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}" viewBox="0 0 ${w} ${h}">
<defs><radialGradient id="luz" cx="50%" cy="50%" r="50%"><stop offset="0" stop-color="#9CFA05" stop-opacity="0.2"/><stop offset="1" stop-color="#9CFA05" stop-opacity="0"/></radialGradient></defs>
<rect width="${w}" height="${h}" fill="#0A0A0A"/>
<circle cx="${x + doug / 2}" cy="${h / 2}" r="${doug * 1.15}" fill="url(#luz)"/>
<g transform="translate(${x} ${(h - doug) / 2}) scale(${doug / 120})">${face}</g>
<text x="${x + doug + gap}" y="${h / 2}" dominant-baseline="central" font-family="Manrope" font-size="${t}" letter-spacing="${-0.02 * t}" fill="#EDEDED"><tspan font-weight="800">Doug</tspan><tspan font-weight="500">Bot</tspan></text>
</svg>`;
}
writeFileSync(join(out, "og.png"), png(shareCard(), 1200));

const frame = "M38 10H82C101 10 110 19 110 38V82C110 101 101 110 82 110H38C19 110 10 101 10 82V38C10 19 19 10 38 10Z";
writeFileSync(
  join(out, "push-badge.png"),
  png(
    `<svg xmlns="http://www.w3.org/2000/svg" width="96" height="96" viewBox="0 0 120 120"><path fill="#fff" fill-rule="evenodd" d="${frame}M48.9 50a6 6 0 1 0 0.01 0ZM71.1 50a6 6 0 1 0 0.01 0Z"/></svg>`,
    96,
  ),
);
console.log(`og.png and push-badge.png written into ${out}`);
