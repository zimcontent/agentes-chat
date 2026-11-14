/**
 * DougBot's store bitmaps, written FROM THE CODE of the avatar (`src/brand/dougbot-avatar.js`, the identity's own
 * drawer): the only images the app ships of its own, because the stores and the launch screen demand bitmaps (the
 * icon in its three appearances, the Android adaptive icon's layers, the native splash and Android's notification
 * glyph). Every screen draws the Doug by code; nothing here is used inside the UI.
 *
 *   cd apps/mobile && bun scripts/brand-assets.ts
 *
 * Rendered with resvg (SVG → PNG, filters included). Run it again after the identity's drawing changes.
 */
import { writeFileSync } from "node:fs";
import { join } from "node:path";
import { deflateSync } from "node:zlib";
import { Resvg } from "@resvg/resvg-js";
import { type DougBotOpcoes, svgDoBot } from "../src/brand/bots";

const out = join(import.meta.dir, "..", "assets", "images");
const VERDE = "#9CFA05";
/** The icon's side, and the head's share of it: his head (85 of the drawer's 120 box) comes to 58% of the side. */
const S = 1024;
const HEAD = 0.824;
/** His head sits a little above the icon's middle: its shadow takes the room under it. */
const UP = -0.014;

function png(svg: string, width: number): Buffer {
  return new Resvg(svg, { fitTo: { mode: "width", value: width }, font: { loadSystemFonts: false } }).render().asPng();
}

/** CRC-32 for the PNG chunks. */
const CRC = Array.from({ length: 256 }, (_, n) => {
  let c = n;
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  return c >>> 0;
});
const crc32 = (b: Buffer) => {
  let c = 0xffffffff;
  for (const x of b) c = (CRC[(c ^ x) & 255] as number) ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
};
function chunk(type: string, data: Buffer) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length);
  const td = Buffer.concat([Buffer.from(type, "ascii"), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(td));
  return Buffer.concat([len, td, crc]);
}

/**
 * An opaque PNG (RGB, no alpha channel): Apple refuses an app icon that has one. `grey` writes each pixel's
 * lightness alone: the tinted appearance is a picture in greys that the system colours.
 */
function opaquePng(svg: string, width: number, grey = false): Buffer {
  const img = new Resvg(svg, { fitTo: { mode: "width", value: width }, font: { loadSystemFonts: false } }).render();
  const { width: w, height: h, pixels } = img;
  const raw = Buffer.alloc((w * 3 + 1) * h);
  for (let y = 0; y < h; y++) {
    raw[y * (w * 3 + 1)] = 0;
    for (let x = 0; x < w; x++) {
      const i = (y * w + x) * 4;
      const o = y * (w * 3 + 1) + 1 + x * 3;
      const [r, g, b] = [pixels[i] as number, pixels[i + 1] as number, pixels[i + 2] as number];
      const l = grey ? Math.round(0.2126 * r + 0.7152 * g + 0.0722 * b) : null;
      raw[o] = l ?? r;
      raw[o + 1] = l ?? g;
      raw[o + 2] = l ?? b;
    }
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(w, 0);
  ihdr.writeUInt32BE(h, 4);
  ihdr[8] = 8;
  ihdr[9] = 2;
  return Buffer.concat([
    Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
    chunk("IHDR", ihdr),
    chunk("IDAT", deflateSync(raw)),
    chunk("IEND", Buffer.alloc(0)),
  ]);
}

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
const blur = (id: string, px: number) =>
  `<filter id="${id}" filterUnits="userSpaceOnUse" x="-200" y="-200" width="${S + 400}" height="${S + 400}"><feGaussianBlur stdDeviation="${px}"/></filter>`;

/**
 * The icon's ground, edge to edge (the system cuts the corners): the Doug's piece of green glass grown to the whole
 * square, light from above and the green in depth below. The top stays a pale green, not white: on a white wallpaper
 * a white top loses the icon's edge.
 */
const GLASS = `<defs>
<linearGradient id="g" gradientUnits="userSpaceOnUse" x1="0" y1="0" x2="0" y2="${S}"><stop offset="0" stop-color="#E2FF98"/><stop offset=".3" stop-color="#CEFF63"/><stop offset=".66" stop-color="${VERDE}"/><stop offset="1" stop-color="#72D400"/></linearGradient>
<radialGradient id="gl" gradientUnits="userSpaceOnUse" cx="512" cy="-60" r="620"><stop offset="0" stop-color="#fff" stop-opacity=".46"/><stop offset=".5" stop-color="#fff" stop-opacity=".15"/><stop offset="1" stop-color="#fff" stop-opacity="0"/></radialGradient>
<radialGradient id="gd" gradientUnits="userSpaceOnUse" cx="512" cy="1180" r="560"><stop offset="0" stop-color="#3F8A00" stop-opacity=".5"/><stop offset="1" stop-color="#3F8A00" stop-opacity="0"/></radialGradient>
</defs><rect width="${S}" height="${S}" fill="url(#g)"/><rect width="${S}" height="${S}" fill="url(#gl)"/><rect width="${S}" height="${S}" fill="url(#gd)"/>`;
/** The stage by night, and the light a head of `light` gives it. */
const stage = (light: string) => `<defs>
<linearGradient id="g" gradientUnits="userSpaceOnUse" x1="0" y1="0" x2="0" y2="${S}"><stop offset="0" stop-color="#2A2D31"/><stop offset=".45" stop-color="#16171A"/><stop offset="1" stop-color="#08080A"/></linearGradient>
<radialGradient id="gl" gradientUnits="userSpaceOnUse" cx="512" cy="540" r="560"><stop offset="0" stop-color="${light}" stop-opacity=".2"/><stop offset=".5" stop-color="${light}" stop-opacity=".07"/><stop offset="1" stop-color="${light}" stop-opacity="0"/></radialGradient>
</defs><rect width="${S}" height="${S}" fill="url(#g)"/><rect width="${S}" height="${S}" fill="url(#gl)"/>`;

/**
 * His head on the green glass: black, with what it hides from the light (a wide soft shadow of its shape, and a
 * closer one on the glass under it). `scale` and `dy` as in `placed`.
 */
function headOnGlass(scale = HEAD, dy = UP) {
  const shade = "#2C4601";
  const floor = S * (0.5 + dy) + S * scale * 0.455;
  return (
    `<defs>${blur("s1", (41 * scale) / HEAD)}${blur("s2", (23 * scale) / HEAD)}</defs>` +
    `<g opacity=".17" filter="url(#s1)">${placed(S, scale, dy + 0.049 * (scale / HEAD), { peca: false, material: "chapado", cor: shade, estado: "dormindo" }, "hs")}</g>` +
    `<ellipse cx="${S / 2}" cy="${floor}" rx="${S * scale * 0.276}" ry="${S * scale * 0.036}" fill="${shade}" opacity=".5" filter="url(#s2)"/>` +
    placed(S, scale, dy, { peca: false, material: "preto" }, "h")
  );
}
/** His head in glass of `cor` on the stage, lit from behind: its colour around it and on the floor under it. */
function headOnStage(cor: string) {
  const floor = S * (0.5 + UP) + S * HEAD * 0.472;
  return (
    `<defs>${blur("s1", 83)}${blur("s2", 41)}</defs>` +
    `<g opacity=".4" filter="url(#s1)">${placed(S, HEAD, UP, { peca: false, material: "chapado", cor, estado: "dormindo" }, "hs")}</g>` +
    `<ellipse cx="${S / 2}" cy="${floor}" rx="${S * HEAD * 0.246}" ry="${S * HEAD * 0.028}" fill="${cor}" opacity=".34" filter="url(#s2)"/>` +
    placed(S, HEAD, UP, { peca: false, cor }, "h")
  );
}

// The icon, opaque and square (the system rounds it), in iOS's three appearances. By day his black head on the green
// glass; by night his head in green glass lighting the stage; tinted, the night's picture in greys.
writeFileSync(join(out, "icon.png"), opaquePng(svg(S, GLASS + headOnGlass()), S));
writeFileSync(join(out, "icon-dark.png"), opaquePng(svg(S, stage(VERDE) + headOnStage(VERDE)), S));
writeFileSync(join(out, "icon-tinted.png"), opaquePng(svg(S, stage("#D8D8D8") + headOnStage("#D8D8D8")), S, true));
// Android adaptive icon: the green glass behind, his head in front inside the safe circle (61% of the side), and
// the one-colour layer a themed home screen tints.
writeFileSync(join(out, "adaptive-icon-background.png"), opaquePng(svg(S, GLASS), S));
writeFileSync(join(out, "adaptive-icon.png"), png(svg(S, headOnGlass(0.586, -0.006)), S));
writeFileSync(
  join(out, "adaptive-icon-monochrome.png"),
  png(svg(S, placed(S, 0.586, -0.006, { peca: false, material: "chapado", cor: "#fff" }, "m")), S),
);
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
