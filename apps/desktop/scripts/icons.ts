/**
 * Draws the desktop app's icons. DougBot: the tray glyphs are the Doug's glass frame (a rounded square) with the
 * agent engine's pill eyes (packages/ui/src/agent/engine.js), and the app icon is the Doug's own drawing
 * (apps/mobile/src/brand/bots.ts, the identity's code) rendered with resvg. Run by CI before `tauri build` (`bun apps/desktop/scripts/icons.ts`), then
 * `tauri icon app-icon.png` makes the .icns and the PNG sizes from the 1024 px master.
 *
 * Outputs (all ignored by git):
 *   src-tauri/icons/tray/{idle,working,paused,offline,update,browsing,needs}.png  36×36 template images (18 pt @2x)
 *   app-icon.png                                                   1024×1024 app icon master
 *
 * Dependencies: a tiny PNG encoder over node:zlib for the tray; resvg for the app icon.
 */
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { deflateSync } from "node:zlib";
import { Resvg } from "@resvg/resvg-js";
import { eyeShapes } from "../../../packages/ui/src/agent/engine.js";
import { svgDoBot } from "../../mobile/src/brand/bots";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");

/* ---------- PNG ---------- */

const CRC_TABLE = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c >>> 0;
  }
  return t;
})();

function crc32(bytes: Uint8Array): number {
  let c = 0xffffffff;
  for (const b of bytes) c = (CRC_TABLE[(c ^ b) & 0xff] as number) ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

function chunk(type: string, data: Uint8Array): Uint8Array {
  const out = new Uint8Array(12 + data.length);
  const view = new DataView(out.buffer);
  view.setUint32(0, data.length);
  for (let i = 0; i < 4; i++) out[4 + i] = type.charCodeAt(i);
  out.set(data, 8);
  view.setUint32(8 + data.length, crc32(out.subarray(4, 8 + data.length)));
  return out;
}

/** RGBA pixels (width × height × 4) to a PNG file. */
export function encodePng(width: number, height: number, rgba: Uint8Array): Uint8Array {
  const header = new Uint8Array(13);
  const hv = new DataView(header.buffer);
  hv.setUint32(0, width);
  hv.setUint32(4, height);
  header[8] = 8; // bit depth
  header[9] = 6; // RGBA
  const raw = new Uint8Array(height * (width * 4 + 1));
  for (let y = 0; y < height; y++) {
    raw[y * (width * 4 + 1)] = 0; // filter: none
    raw.set(rgba.subarray(y * width * 4, (y + 1) * width * 4), y * (width * 4 + 1) + 1);
  }
  const parts = [
    new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk("IHDR", header),
    chunk("IDAT", new Uint8Array(deflateSync(raw, { level: 9 }))),
    chunk("IEND", new Uint8Array(0)),
  ];
  const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0));
  let at = 0;
  for (const p of parts) {
    out.set(p, at);
    at += p.length;
  }
  return out;
}

/**
 * DougBot: the body's silhouette is the Doug's glass frame, a rounded square (the phone app's path
 * `M38 10H82C101 10 110 19 110 38V82…` on a 120 viewBox: the square 10..110 with a corner radius of 28), in unit
 * coordinates over the body's square.
 */
const FRAME_RADIUS = 0.28;
function inBody(u: number, v: number): boolean {
  if (u < 0 || u > 1 || v < 0 || v > 1) return false;
  const cx = Math.min(Math.max(u, FRAME_RADIUS), 1 - FRAME_RADIUS);
  const cy = Math.min(Math.max(v, FRAME_RADIUS), 1 - FRAME_RADIUS);
  return (u - cx) ** 2 + (v - cy) ** 2 <= FRAME_RADIUS ** 2;
}

/* ---------- Shapes (unit body coordinates: u, v in 0..1 over the body's square) ---------- */

interface Box {
  x: number;
  y: number;
  w: number;
  h: number;
}

/** A pill (rounded on its short side). */
function inPill(u: number, v: number, b: Box): boolean {
  if (u < b.x || u > b.x + b.w || v < b.y || v > b.y + b.h) return false;
  const r = Math.min(b.w, b.h) / 2;
  const cx = Math.min(Math.max(u, b.x + r), b.x + b.w - r);
  const cy = Math.min(Math.max(v, b.y + r), b.y + b.h - r);
  return (u - cx) ** 2 + (v - cy) ** 2 <= r * r;
}

const ROUND_EYES: Box[] = eyeShapes("round").map((e: Box) => ({ x: e.x, y: e.y, w: e.w, h: e.h }));

function shifted(eyes: Box[], dx: number): Box[] {
  return eyes.map((e) => ({ ...e, x: e.x + dx }));
}

/** Paused: the eyes are short dashes. */
const DASH_EYES: Box[] = [0.375, 0.625].map((cx) => ({ x: cx - 0.085, y: 0.47, w: 0.17, h: 0.085 }));

function distToSegment(px: number, py: number, ax: number, ay: number, bx: number, by: number): number {
  const dx = bx - ax;
  const dy = by - ay;
  const t = Math.max(0, Math.min(1, ((px - ax) * dx + (py - ay) * dy) / (dx * dx + dy * dy)));
  return Math.hypot(px - (ax + t * dx), py - (ay + t * dy));
}

/* ---------- Tray: 36×36 template images (only alpha counts; macOS tints them) ---------- */

type TrayState = "idle" | "working" | "paused" | "offline" | "update" | "browsing" | "needs";
const TRAY_PX = 36;
/** The body's square inside the 36 px canvas. */
const TB = { x: 4, y: 4, s: 28 };
const SS = 4; // supersampling per axis

function trayCoverage(state: TrayState, px: number, py: number): boolean {
  const u = (px - TB.x) / TB.s;
  const v = (py - TB.y) / TB.s;
  const eyes = state === "paused" ? DASH_EYES : state === "working" ? shifted(ROUND_EYES, 0.05) : ROUND_EYES;
  const inEye = eyes.some((e) => inPill(u, v, e));
  if (state === "offline") {
    // Outline only, eyes filled.
    if (inEye) return true;
    const stroke = 2.6 / TB.s;
    const inner = (uu: number, vv: number) =>
      inBody((uu - stroke) / (1 - 2 * stroke), (vv - stroke) / (1 - 2 * stroke));
    return inBody(u, v) && !inner(u, v);
  }
  if (state === "browsing" || state === "needs") {
    // A badge cut out of the bottom-right corner: a ring while an agent is in its browser, a
    // filled dot when one needs a person. Same place and gap as the update badge.
    const bx = 28;
    const by = 28;
    const d = Math.hypot(px - bx, py - by);
    if (d <= 8) {
      if (d > 6.4) return false; // the gap around the badge
      return state === "needs" ? true : d >= 3.6;
    }
  }
  if (state === "update") {
    // A round badge cut out of the bottom-right corner, with a down arrow in it.
    const bx = 27;
    const by = 27;
    const d = Math.hypot(px - bx, py - by);
    if (d <= 8.6) {
      if (d > 7.2) return false; // the gap around the badge
      const half = 1.15;
      return (
        distToSegment(px, py, bx, by - 4, bx, by + 3.2) <= half ||
        distToSegment(px, py, bx - 3, by + 0.4, bx, by + 3.4) <= half ||
        distToSegment(px, py, bx + 3, by + 0.4, bx, by + 3.4) <= half
      );
    }
  }
  return inBody(u, v) && !inEye;
}

function trayPng(state: TrayState): Uint8Array {
  const rgba = new Uint8Array(TRAY_PX * TRAY_PX * 4);
  for (let y = 0; y < TRAY_PX; y++)
    for (let x = 0; x < TRAY_PX; x++) {
      let hits = 0;
      for (let sy = 0; sy < SS; sy++)
        for (let sx = 0; sx < SS; sx++) if (trayCoverage(state, x + (sx + 0.5) / SS, y + (sy + 0.5) / SS)) hits++;
      const i = (y * TRAY_PX + x) * 4;
      rgba[i] = 0;
      rgba[i + 1] = 0;
      rgba[i + 2] = 0;
      rgba[i + 3] = Math.round((hits / (SS * SS)) * 255);
    }
  return encodePng(TRAY_PX, TRAY_PX, rgba);
}

/* ---------- App icon: 1024 px, the Doug's glass piece on a transparent canvas ---------- */

/**
 * DougBot: the piece is its own tile (macOS icon grid), about 80% of the side with a transparent margin around.
 * The Doug's drawing spans 10..110 of its 120 viewBox, so it is scaled by `0.8 * side / 100`.
 */
function appIconPng(): Uint8Array {
  const S = 1024;
  const k = (S * 0.8) / 100;
  const inner = svgDoBot({ bot: "doug", tamanho: 120, perto: false, brilho: false, id: "d" })
    .replace(/^<svg[^>]*>/, "")
    .replace(/<\/svg>$/, "");
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${S}" height="${S}" viewBox="0 0 ${S} ${S}"><g transform="translate(${S / 2 - 60 * k} ${S / 2 - 60 * k}) scale(${k})">${inner}</g></svg>`;
  return new Resvg(svg, { fitTo: { mode: "width", value: S }, font: { loadSystemFonts: false } }).render().asPng();
}

/* ---------- Write ---------- */

const trayDir = join(root, "src-tauri", "icons", "tray");
mkdirSync(trayDir, { recursive: true });
for (const state of ["idle", "working", "paused", "offline", "update", "browsing", "needs"] as const) {
  writeFileSync(join(trayDir, `${state}.png`), trayPng(state));
}
writeFileSync(join(root, "app-icon.png"), appIconPng());
console.log("icons: tray (7 states) and app-icon.png written");
