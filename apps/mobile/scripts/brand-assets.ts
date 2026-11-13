/**
 * DougBot's store bitmaps, written FROM THE CODE of the avatar (`src/brand/dougbot-avatar.js`, the identity's own
 * drawer): the only images the app ships of its own, because the stores and the launch screen demand bitmaps (the
 * icon, the Android adaptive icon's two layers, the native splash and Android's notification glyph). Every screen
 * draws the Doug by code; nothing here is used inside the UI.
 *
 *   cd apps/mobile && bun scripts/brand-assets.ts
 *
 * Rendered with resvg (SVG → PNG, filters included). Run it again after the identity's drawing changes.
 */
import { writeFileSync } from "node:fs";
import { join } from "node:path";
import { deflateSync } from "node:zlib";
import { Resvg } from "@resvg/resvg-js";
import { svgDoBot } from "../src/brand/bots";

const out = join(import.meta.dir, "..", "assets", "images");
const PALCO = "#0A0A0A";

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

/** An opaque PNG (RGB, no alpha channel): Apple refuses an app icon that has one. */
function opaquePng(svg: string, width: number): Buffer {
  const img = new Resvg(svg, { fitTo: { mode: "width", value: width }, font: { loadSystemFonts: false } }).render();
  const { width: w, height: h, pixels } = img;
  const raw = Buffer.alloc((w * 3 + 1) * h);
  for (let y = 0; y < h; y++) {
    raw[y * (w * 3 + 1)] = 0;
    for (let x = 0; x < w; x++) {
      const i = (y * w + x) * 4;
      const o = y * (w * 3 + 1) + 1 + x * 3;
      raw[o] = pixels[i] as number;
      raw[o + 1] = pixels[i + 1] as number;
      raw[o + 2] = pixels[i + 2] as number;
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

/** The Doug's drawing (viewBox 120) placed in a square canvas of `side` units: `scale` of it, centered, on `bg`. */
function placed(opts: { side: number; scale: number; bg?: string; perto?: boolean; brilho?: boolean; dy?: number }) {
  const inner = svgDoBot({
    bot: "doug",
    tamanho: 120,
    perto: opts.perto ?? false,
    brilho: opts.brilho ?? false,
    id: "d",
  })
    .replace(/^<svg[^>]*>/, "")
    .replace(/<\/svg>$/, "");
  const s = opts.side;
  const k = (s * opts.scale) / 120;
  const x = (s - 120 * k) / 2;
  const y = (s - 120 * k) / 2 + (opts.dy ?? 0) * s;
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${s}" height="${s}" viewBox="0 0 ${s} ${s}">${
    opts.bg ? `<rect width="${s}" height="${s}" fill="${opts.bg}"/>` : ""
  }<g transform="translate(${x} ${y}) scale(${k})">${inner}</g></svg>`;
}

// iOS icon: opaque, square (the system rounds it). The Doug's glass piece on the stage, its light on the floor.
writeFileSync(
  join(out, "icon.png"),
  opaquePng(placed({ side: 1024, scale: 0.86, bg: PALCO, brilho: true, dy: -0.02 }), 1024),
);
// Android adaptive icon: the stage behind, the Doug in front inside the 66% safe circle.
writeFileSync(
  join(out, "adaptive-icon-background.png"),
  png(
    `<svg xmlns="http://www.w3.org/2000/svg" width="1024" height="1024"><rect width="1024" height="1024" fill="${PALCO}"/></svg>`,
    1024,
  ),
);
writeFileSync(join(out, "adaptive-icon.png"), png(placed({ side: 1024, scale: 0.6, brilho: true }), 1024));
// The native launch image: the Doug alone, transparent (the splash's background is the theme's), 120 pt wide on
// screen, the same drawing `LaunchSplash` starts with.
writeFileSync(join(out, "splash-icon.png"), png(placed({ side: 512, scale: 1 }), 512));
// Android's notification glyph: one color on transparent (the system tints it): the Doug's glass frame with his eyes.
const frame = "M38 10H82C101 10 110 19 110 38V82C110 101 101 110 82 110H38C19 110 10 101 10 82V38C10 19 19 10 38 10Z";
writeFileSync(
  join(out, "notification-icon.png"),
  png(
    `<svg xmlns="http://www.w3.org/2000/svg" width="96" height="96" viewBox="0 0 120 120"><path fill="#fff" fill-rule="evenodd" d="${frame}M48.9 50a6 6 0 1 0 0.01 0ZM71.1 50a6 6 0 1 0 0.01 0Z"/></svg>`,
    96,
  ),
);
console.log(
  "icon.png, adaptive-icon(.png|-background.png), splash-icon.png, notification-icon.png written from the Doug's code",
);
