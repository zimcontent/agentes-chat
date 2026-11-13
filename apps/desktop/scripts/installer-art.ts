/**
 * Draws the Windows installer's pictures (src-tauri/installer/installer.nsi, tauri.windows.conf.json). Run by CI
 * before `tauri build` on Windows (`bun apps/desktop/scripts/installer-art.ts`).
 *
 * DougBot: the pictures are the brand's own, drawn from the identity's code (the Doug, as in icons.ts) and the
 * name in curves, on the brand's dark stage; the sky, the pixel agent and the wordmark of pixel-art.ts are not used.
 *
 * Outputs (ignored by git), 24-bit BMPs at twice the size Windows shows them at 100% (the installer scales them
 * to its controls, so they stay sharp at 150% and 200%):
 *   src-tauri/installer/side.bmp       328×628  the welcome page's side (164×314)
 *   src-tauri/installer/side-done.bmp  328×628  the finish page's side: the same, the Doug done with the work
 *   src-tauri/installer/header.bmp     300×114  the header of the pages between (150×57)
 */
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { Resvg } from "@resvg/resvg-js";
import { type DougBotEstado, svgDoBot } from "../../mobile/src/brand/bots";
import { Picture } from "./pixel-art";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");

/** Pixels per point: everything is drawn at twice the size it shows at 100%. */
const K = 2;
/** The brand's dark stage, and the installer's own white header. */
const STAGE = "#0A0A0A";
const PAPER = "#FFFFFF";

/** The name in curves (Manrope: "Doug" 800, "Bot" 500), in the box `NAME_BOX` (x, y, width, height). */
const NAME_BOX = [185, 37.3, 390.8, 97.5] as const;
const NAME =
  "M185 109.3V37.3H208.3Q209.15 37.3 211.8 37.35Q214.45 37.4 216.9 37.7Q225.6 38.75 231.65 43.75Q237.7 48.75 240.85 56.45Q244 64.15 244 73.3Q244 82.45 240.85 90.15Q237.7 97.85 231.65 102.85Q225.6 107.85 216.9 108.9Q214.45 109.2 211.8 109.25Q209.15 109.3 208.3 109.3ZM198.8 96.5H208.3Q209.65 96.5 211.95 96.42Q214.25 96.35 216.1 96Q220.8 95.05 223.78 91.6Q226.75 88.15 228.18 83.3Q229.6 78.45 229.6 73.3Q229.6 67.9 228.12 63.05Q226.65 58.2 223.65 54.85Q220.65 51.5 216.1 50.6Q214.25 50.2 211.95 50.15Q209.65 50.1 208.3 50.1H198.8ZM276.8 110.8Q268.65 110.8 262.5 107.15Q256.35 103.5 252.93 97.07Q249.5 90.65 249.5 82.3Q249.5 73.85 253 67.42Q256.5 61 262.65 57.4Q268.8 53.8 276.8 53.8Q284.95 53.8 291.12 57.45Q297.3 61.1 300.75 67.52Q304.2 73.95 304.2 82.3Q304.2 90.7 300.73 97.12Q297.25 103.55 291.07 107.17Q284.9 110.8 276.8 110.8ZM276.8 98.1Q283.35 98.1 286.58 93.67Q289.8 89.25 289.8 82.3Q289.8 75.1 286.52 70.8Q283.25 66.5 276.8 66.5Q272.35 66.5 269.5 68.5Q266.65 70.5 265.27 74.05Q263.9 77.6 263.9 82.3Q263.9 89.55 267.17 93.82Q270.45 98.1 276.8 98.1ZM331.8 110.9Q325.45 110.9 321.45 108.75Q317.45 106.6 315.23 103.3Q313 100 312.05 96.42Q311.1 92.85 310.9 89.9Q310.7 86.95 310.7 85.6V55.3H324.5V80.8Q324.5 82.65 324.7 85.52Q324.9 88.4 325.95 91.3Q327 94.2 329.38 96.15Q331.75 98.1 336.1 98.1Q337.85 98.1 339.85 97.55Q341.85 97 343.6 95.42Q345.35 93.85 346.48 90.77Q347.6 87.7 347.6 82.7L355.4 86.4Q355.4 92.8 352.8 98.4Q350.2 104 344.98 107.45Q339.75 110.9 331.8 110.9ZM349.3 109.3V91.4H347.6V55.3H361.3V109.3ZM394.9 134.8Q390.3 134.8 386.15 133.32Q382 131.85 378.73 129.22Q375.45 126.6 373.4 123.1L386 117Q387.3 119.4 389.73 120.65Q392.15 121.9 395 121.9Q398.05 121.9 400.75 120.88Q403.45 119.85 405.08 117.82Q406.7 115.8 406.6 112.8V97.1H408.3V55.3H420.2V113Q420.2 115 420.03 116.78Q419.85 118.55 419.4 120.3Q418.1 125.25 414.58 128.45Q411.05 131.65 405.95 133.23Q400.85 134.8 394.9 134.8ZM393.7 110.8Q386.25 110.8 380.65 107.05Q375.05 103.3 371.93 96.85Q368.8 90.4 368.8 82.3Q368.8 74.05 371.98 67.62Q375.15 61.2 380.9 57.5Q386.65 53.8 394.4 53.8Q402.1 53.8 407.35 57.55Q412.6 61.3 415.3 67.75Q418 74.2 418 82.3Q418 90.4 415.27 96.85Q412.55 103.3 407.15 107.05Q401.75 110.8 393.7 110.8ZM395.9 98.7Q400.45 98.7 403.18 96.65Q405.9 94.6 407.1 90.9Q408.3 87.2 408.3 82.3Q408.3 77.4 407.1 73.7Q405.9 70 403.28 67.95Q400.65 65.9 396.4 65.9Q391.85 65.9 388.93 68.12Q386 70.35 384.6 74.07Q383.2 77.8 383.2 82.3Q383.2 86.85 384.55 90.57Q385.9 94.3 388.7 96.5Q391.5 98.7 395.9 98.7ZM430.7 109.3V37.3H458.75Q465.2 37.3 469.77 39.95Q474.35 42.6 476.77 46.92Q479.2 51.25 479.2 56.25Q479.2 62.12 476.19 66.51Q473.18 70.9 468.1 72.55L468 70.1Q474.95 71.95 478.8 76.91Q482.65 81.88 482.65 88.7Q482.65 95 480.06 99.61Q477.48 104.22 472.66 106.76Q467.85 109.3 461.25 109.3ZM439.7 100.8H459.55Q463.52 100.8 466.69 99.34Q469.85 97.88 471.68 95.16Q473.5 92.45 473.5 88.65Q473.5 85.02 471.86 82.11Q470.23 79.2 467.3 77.47Q464.38 75.75 460.55 75.75H439.7ZM439.7 67.35H458.65Q461.82 67.35 464.41 65.97Q467 64.6 468.52 62.11Q470.05 59.62 470.05 56.25Q470.05 51.6 466.89 48.65Q463.73 45.7 458.65 45.7H439.7ZM512.1 110.8Q504.03 110.8 498.2 107.15Q492.38 103.5 489.24 97.06Q486.1 90.62 486.1 82.25Q486.1 73.78 489.3 67.36Q492.5 60.95 498.34 57.38Q504.18 53.8 512.1 53.8Q520.2 53.8 526.04 57.44Q531.88 61.07 535.01 67.49Q538.15 73.9 538.15 82.25Q538.15 90.72 534.99 97.15Q531.83 103.58 525.98 107.19Q520.12 110.8 512.1 110.8ZM512.1 102.35Q520.48 102.35 524.59 96.75Q528.7 91.15 528.7 82.25Q528.7 73.12 524.55 67.69Q520.4 62.25 512.1 62.25Q506.45 62.25 502.79 64.8Q499.12 67.35 497.34 71.85Q495.55 76.35 495.55 82.25Q495.55 91.38 499.75 96.86Q503.95 102.35 512.1 102.35ZM575.8 109.3Q570.98 110.27 566.31 110.1Q561.65 109.92 557.99 108.2Q554.32 106.47 552.45 102.8Q550.85 99.62 550.73 96.35Q550.6 93.07 550.6 88.9V40.3H559.5V88.5Q559.5 91.82 559.58 94.16Q559.65 96.5 560.6 98.2Q562.4 101.42 566.33 101.96Q570.25 102.5 575.8 101.65ZM539.65 62.65V55.3H575.8V62.65Z";

/** The Doug's drawing (a 120 box) at (x, y), `size` wide, in the picture's points. */
function doug(x: number, y: number, size: number, opts: { estado?: DougBotEstado; perto?: boolean; brilho?: boolean }) {
  const inner = svgDoBot({ bot: "doug", tamanho: 120, perto: false, brilho: false, id: "d", ...opts })
    .replace(/^<svg[^>]*>/, "")
    .replace(/<\/svg>$/, "");
  return `<g transform="translate(${x} ${y}) scale(${size / 120})">${inner}</g>`;
}

/** The name, `width` wide, centered on `cx` with its top at `y`. */
function name(cx: number, y: number, width: number, fill: string) {
  const [bx, by, bw] = NAME_BOX;
  const k = width / bw;
  return `<path fill="${fill}" transform="translate(${cx - width / 2} ${y}) scale(${k}) translate(${-bx} ${-by})" d="${NAME}"/>`;
}

/** An SVG of `w`×`h` points on `bg`, as a picture at `K` pixels a point. */
function picture(w: number, h: number, bg: string, body: string): Picture {
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}" viewBox="0 0 ${w} ${h}"><rect width="${w}" height="${h}" fill="${bg}"/>${body}</svg>`;
  const img = new Resvg(svg, { fitTo: { mode: "width", value: w * K }, font: { loadSystemFonts: false } }).render();
  const p = new Picture(img.width, img.height, K);
  const rgba = img.pixels;
  for (let i = 0; i < img.width * img.height; i++)
    for (let c = 0; c < 3; c++) p.px[i * 3 + c] = rgba[i * 4 + c] as number;
  return p;
}

/* ---------- The three pictures ---------- */

/** The welcome and finish pages' side (164×314): the Doug on the stage, his light on the floor, the name under him. */
function side(done: boolean): Picture {
  const W = 164;
  const H = 314;
  return picture(
    W,
    H,
    STAGE,
    doug((W - 104) / 2, 78, 104, { brilho: true, estado: done ? "terminou" : "ok" }) + name(W / 2, 206, 92, "#FFFFFF"),
  );
}

/** The header (150×57), right of the page's title: the Doug close up on the installer's white. */
function header(): Picture {
  const W = 150;
  const H = 57;
  return picture(W, H, PAPER, doug(W - 52, 9, 40, { perto: true }));
}

const dir = join(root, "src-tauri", "installer");
mkdirSync(dir, { recursive: true });
writeFileSync(join(dir, "side.bmp"), side(false).bmp());
writeFileSync(join(dir, "side-done.bmp"), side(true).bmp());
writeFileSync(join(dir, "header.bmp"), header().bmp());
console.log("installer art: side.bmp, side-done.bmp and header.bmp written");
