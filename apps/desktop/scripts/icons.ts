/**
 * Draws the desktop app's icons. DougBot: the tray glyphs are the Doug's head with his two eyes cut out of it
 * (the outline and the eyes are the identity's drawer's, apps/mobile/src/brand/dougbot-avatar.js), and the app icon
 * is the Doug's own drawing (apps/mobile/src/brand/bots.ts, the identity's code) rendered with resvg. Run by CI
 * before `tauri build` (`bun apps/desktop/scripts/icons.ts`), then `tauri icon` makes the .icns, .ico and PNG sizes
 * from a 1024 px master: app-icon.png on macOS, app-icon-tile.png on Windows and Linux (both the Doug here).
 *
 * Outputs (all ignored by git):
 *   src-tauri/icons/tray/{idle,working,paused,offline,update,browsing,needs}.png  36×36 template images (18 pt @2x)
 *   app-icon.png                                                   1024×1024 app icon master, macOS's shape (ADR 0179)
 *   app-icon-tile.png                                              1024×1024 the same, a full rounded square (Windows, Linux)
 *   src-tauri/icons/app/<id>.png, <id>-tile.png                    the icons a person may pick, Dock and window
 *
 * Dependencies: a tiny PNG encoder over node:zlib for the tray; resvg for the app icon.
 */
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { deflateSync } from "node:zlib";
import { Resvg } from "@resvg/resvg-js";
import { png, rounded } from "../../mobile/scripts/icon-png.mjs";
import { DougBot, svgDoBot } from "../../mobile/src/brand/bots";
import { iconSvg, READY_ICONS } from "../../mobile/src/brand/doug-icons.js";

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
 * DougBot: the body's silhouette is the Doug's head (`CABECA`, the drawer's path on its 120 frame: x 24…96, y
 * 20.9…102), in unit coordinates over the body's square: its height fills the square, its width sits centered.
 */
const HEAD = { top: 20.9, height: 81.1, middle: 60 };
const unitX = (x: number) => 0.5 + (x - HEAD.middle) / HEAD.height;
const unitY = (y: number) => (y - HEAD.top) / HEAD.height;

/** The head's outline as a polygon: the path's curves (M, C, H, V, absolute) walked in short straight steps. */
const OUTLINE: [number, number][] = (() => {
  const words = DougBot.CABECA.match(/[MCHVZ]|-?\d*\.?\d+/g) ?? [];
  const pts: [number, number][] = [];
  let [x, y] = [0, 0];
  let i = 0;
  const num = () => Number(words[i++]);
  while (i < words.length) {
    const c = words[i++];
    if (c === "M") {
      [x, y] = [num(), num()];
      pts.push([x, y]);
    } else if (c === "H") {
      x = num();
      pts.push([x, y]);
    } else if (c === "V") {
      y = num();
      pts.push([x, y]);
    } else if (c === "C") {
      const [x1, y1, x2, y2, x3, y3] = [num(), num(), num(), num(), num(), num()];
      for (let k = 1; k <= 16; k++) {
        const t = k / 16;
        const m = 1 - t;
        pts.push([
          m * m * m * x + 3 * m * m * t * x1 + 3 * m * t * t * x2 + t * t * t * x3,
          m * m * m * y + 3 * m * m * t * y1 + 3 * m * t * t * y2 + t * t * t * y3,
        ]);
      }
      [x, y] = [x3, y3];
    }
  }
  return pts.map(([px, py]) => [unitX(px), unitY(py)]);
})();

function inBody(u: number, v: number): boolean {
  let inside = false;
  for (let i = 0, j = OUTLINE.length - 1; i < OUTLINE.length; j = i++) {
    const [ax, ay] = OUTLINE[i] as [number, number];
    const [bx, by] = OUTLINE[j] as [number, number];
    if (ay > v !== by > v && u < ((bx - ax) * (v - ay)) / (by - ay) + ax) inside = !inside;
  }
  return inside;
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

/** His eyes at rest: two upright pills (the drawer's: 11 by 20.8 around x 46.6 and 73.2, y 69.6). */
const ROUND_EYES: Box[] = [46.6, 73.2].map((x) => ({
  x: unitX(x - 5.5),
  y: unitY(69.6 - 10.4),
  w: 11 / HEAD.height,
  h: 20.8 / HEAD.height,
}));

function shifted(eyes: Box[], dx: number): Box[] {
  return eyes.map((e) => ({ ...e, x: e.x + dx }));
}

/** Paused: the eyes are closed, a dash each (the drawer's: 18 by 6.8, a little under the eyes' middle). */
const DASH_EYES: Box[] = [46.6, 73.2].map((x) => ({
  x: unitX(x - 9),
  y: unitY(70.9 - 3.4),
  w: 18 / HEAD.height,
  h: 6.8 / HEAD.height,
}));

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
function appIconPng(S = 1024): Uint8Array {
  const k = (S * 0.8) / 100;
  const inner = svgDoBot({ bot: "doug", tamanho: 120, perto: false, brilho: false, id: "d" })
    .replace(/^<svg[^>]*>/, "")
    .replace(/<\/svg>$/, "");
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${S}" height="${S}" viewBox="0 0 ${S} ${S}"><g transform="translate(${S / 2 - 60 * k} ${S / 2 - 60 * k}) scale(${k})">${inner}</g></svg>`;
  return new Resvg(svg, { fitTo: { mode: "width", value: S }, font: { loadSystemFonts: false } }).render().asPng();
}

/* ---------- App icon (ADR 0179): the Doug's app icons (apps/mobile/src/brand/doug-icons.js) ---------- */

/**
 * An icon in macOS's shape: its square on Apple's grid (824 of 1024, corners of 185) with the shadow under it, the
 * margin all round transparent.
 */
function macSvg(icon: (typeof READY_ICONS)[keyof typeof READY_ICONS]["light"]): string {
  const inner = iconSvg(icon)
    .replace(/^<svg[^>]*>/, "")
    .replace(/<\/svg>$/, "");
  return `<svg xmlns="http://www.w3.org/2000/svg" width="1024" height="1024" viewBox="0 0 1024 1024"><defs><filter id="mcs" x="-20%" y="-20%" width="140%" height="140%"><feGaussianBlur stdDeviation="14"/></filter><clipPath id="mcc"><rect x="100" y="100" width="824" height="824" rx="185"/></clipPath></defs><rect x="100" y="112" width="824" height="824" rx="185" fill="#000" opacity=".3" filter="url(#mcs)"/><g clip-path="url(#mcc)"><g transform="translate(100 100) scale(${824 / 1024})">${inner}</g></g></svg>`;
}

/**
 * The bundle's masters (1024; `tauri icon` makes the .icns, .ico and PNGs from one) are the Doug's own drawing, on
 * every system. Every icon's Dock picture (512, macOS's shape) and window picture (256, the rounded square) are what
 * the person may pick while the app runs (src/app_icon.rs embeds them): the shipped one is the Doug's drawing too, the
 * others the Doug's app icons, the same as the phone's and the web's.
 */
function appIcons(): {
  master: Uint8Array;
  tile: Uint8Array;
  dock: Map<string, Uint8Array>;
  window: Map<string, Uint8Array>;
} {
  const dock = new Map<string, Uint8Array>();
  const window = new Map<string, Uint8Array>();
  const ids = Object.keys(READY_ICONS) as (keyof typeof READY_ICONS)[];
  for (const id of ids) {
    const { light } = READY_ICONS[id];
    dock.set(id, png(macSvg(light), 512));
    window.set(id, png(rounded(iconSvg(light)), 256));
  }
  const [shipped] = ids;
  if (!shipped) throw new Error("icons: no app icons");
  // DougBot: the shipped icon, on every system, is the Doug's drawing.
  dock.set(shipped, appIconPng(512));
  window.set(shipped, appIconPng(256));
  return { master: appIconPng(), tile: appIconPng(), dock, window };
}

/* ---------- Write ---------- */

const trayDir = join(root, "src-tauri", "icons", "tray");
mkdirSync(trayDir, { recursive: true });
for (const state of ["idle", "working", "paused", "offline", "update", "browsing", "needs"] as const) {
  writeFileSync(join(trayDir, `${state}.png`), trayPng(state));
}
const icons = appIcons();
writeFileSync(join(root, "app-icon.png"), icons.master);
writeFileSync(join(root, "app-icon-tile.png"), icons.tile);
const appDir = join(root, "src-tauri", "icons", "app");
mkdirSync(appDir, { recursive: true });
for (const [id, bytes] of icons.dock) writeFileSync(join(appDir, `${id}.png`), bytes);
for (const [id, bytes] of icons.window) writeFileSync(join(appDir, `${id}-tile.png`), bytes);
console.log(`icons: tray (7 states), app-icon.png, app-icon-tile.png and ${icons.dock.size} app icons written`);
