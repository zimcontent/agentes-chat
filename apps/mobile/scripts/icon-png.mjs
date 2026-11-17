// SVG to the icon files' PNG and ICO (ADR 0179; DougBot's icons, docs/adr/doug-0010-doug-app-icons.md), with resvg.
// Plain ESM so the phone's build plugin runs it under Node (scripts/made-icons.mjs) and Bun runs it from the
// committed files' scripts (scripts/app-icons.ts, scripts/brand-assets.ts).
import { deflateSync } from "node:zlib";
import { Resvg } from "@resvg/resvg-js";

const CRC = Array.from({ length: 256 }, (_, n) => {
  let c = n;
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  return c >>> 0;
});
const crc32 = (b) => {
  let c = 0xffffffff;
  for (const x of b) c = CRC[(c ^ x) & 255] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
};
function chunk(type, data) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length);
  const td = Buffer.concat([Buffer.from(type, "ascii"), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(td));
  return Buffer.concat([len, td, crc]);
}

const draw = (svg, width) =>
  new Resvg(svg, { fitTo: { mode: "width", value: width }, font: { loadSystemFonts: false } }).render();

/** The picture as a PNG with its transparency. */
export const png = (svg, width) => Buffer.from(draw(svg, width).asPng());

/**
 * An opaque PNG (RGB, no alpha channel): Apple refuses an app icon that has one. `grey` writes each pixel's lightness
 * alone: the tinted appearance is a picture in greys that the system colours.
 */
export function opaquePng(svg, width, grey = false) {
  const img = draw(svg, width);
  const { width: w, height: h, pixels } = img;
  const raw = Buffer.alloc((w * 3 + 1) * h);
  for (let y = 0; y < h; y++) {
    raw[y * (w * 3 + 1)] = 0;
    for (let x = 0; x < w; x++) {
      const i = (y * w + x) * 4;
      const o = y * (w * 3 + 1) + 1 + x * 3;
      const [r, g, b] = [pixels[i], pixels[i + 1], pixels[i + 2]];
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
    chunk("IDAT", deflateSync(raw, { level: 9 })),
    chunk("IEND", Buffer.alloc(0)),
  ]);
}

/** The square picture with the corners an icon of Android before 8 has (transparent around them). */
export function rounded(svg, share = 0.18) {
  const side = Number(/width="([\d.]+)"/.exec(svg)?.[1] ?? 1024);
  return svg
    .replace(
      /^(<svg[^>]*>)/,
      `$1<defs><clipPath id="rr"><rect width="${side}" height="${side}" rx="${side * share}"/></clipPath></defs><g clip-path="url(#rr)">`,
    )
    .replace(/<\/svg>$/, "</g></svg>");
}

/** An .ico with these PNGs in it (browsers pick one by size). */
export function ico(images) {
  const head = Buffer.alloc(6 + 16 * images.length);
  head.writeUInt16LE(0, 0);
  head.writeUInt16LE(1, 2);
  head.writeUInt16LE(images.length, 4);
  let at = head.length;
  images.forEach(({ size, png: bytes }, i) => {
    const e = 6 + 16 * i;
    head[e] = size >= 256 ? 0 : size;
    head[e + 1] = size >= 256 ? 0 : size;
    head.writeUInt16LE(1, e + 4);
    head.writeUInt16LE(32, e + 6);
    head.writeUInt32LE(bytes.length, e + 8);
    head.writeUInt32LE(at, e + 12);
    at += bytes.length;
  });
  return Buffer.concat([head, ...images.map((i) => i.png)]);
}
