/**
 * The dock's icons at its icon size, 32 px: the mark (the Doug close up, the browser tab's icon) and Browser, Files
 * and Terminal, each a glyph of the app's own icon set on a small piece of dark glass. Only the Doug has color (the
 * identity's rule: the green is his). Then the Doug of the agent browser's start page, whole, as SVG. render.sh
 * bundles this file and reads what icons.html leaves as its text, a `<name> <base64>` line each.
 */
import DougBot from "../../../packages/ui/src/brand/dougbot-avatar.js";
import { dougFavicon } from "../../../packages/ui/src/brand/dougbot-files";
import { extraIcons } from "../../../packages/ui/src/icons/extra";
import type { IconShape } from "../../../packages/ui/src/icons/types";

const SIZE = 32;

/** In the set's 20 px grid and 1.6 stroke, like its `globe`. */
const FOLDER: IconShape[] = [
  [
    "path",
    {
      d: "M3 6.5A1.5 1.5 0 0 1 4.5 5h3.1l1.9 2h6A1.5 1.5 0 0 1 17 8.5v6a1.5 1.5 0 0 1-1.5 1.5h-11A1.5 1.5 0 0 1 3 14.5z",
    },
  ],
];
const PROMPT: IconShape[] = [["path", { d: "M5 6.5 8.5 10 5 13.5M10.5 14H15" }]];

const shapes = (icon: IconShape[]) =>
  icon
    .map(
      ([tag, attrs]) =>
        `<${tag} ${Object.entries(attrs)
          .map(([k, v]) => `${k}="${v}"`)
          .join(" ")}/>`,
    )
    .join("");

/**
 * A piece of 28 px with the identity's small radius, 8: the surface over glass (#1A1A1A) so it reads on the dock's
 * dark glass and on the apps menu's light one, a hairline, a line of light along its top, and the glyph at 18 px in
 * the stage's text color.
 */
const tile = (icon: IconShape[]) =>
  `<svg xmlns="http://www.w3.org/2000/svg" width="${SIZE}" height="${SIZE}" viewBox="0 0 32 32">` +
  `<defs><linearGradient id="l" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#fff" stop-opacity=".2"/>` +
  `<stop offset=".5" stop-color="#fff" stop-opacity=".09"/></linearGradient></defs>` +
  `<rect x="2" y="2" width="28" height="28" rx="8" fill="#1a1a1a"/>` +
  `<rect x="2.5" y="2.5" width="27" height="27" rx="7.5" fill="none" stroke="url(#l)"/>` +
  `<g transform="translate(7 7) scale(.9)" fill="none" stroke="#ededed" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round">${shapes(icon)}</g></svg>`;

const ICONS: [name: string, svg: string][] = [
  ["desktop-mark", dougFavicon()],
  ["desktop-browser", tile(extraIcons.globe)],
  ["desktop-files", tile(FOLDER)],
  ["desktop-terminal", tile(PROMPT)],
];

async function png(svg: string): Promise<string> {
  const img = new Image(SIZE, SIZE);
  img.src = `data:image/svg+xml,${encodeURIComponent(svg)}`;
  await img.decode();
  const canvas = document.createElement("canvas");
  canvas.width = SIZE;
  canvas.height = SIZE;
  canvas.getContext("2d")?.drawImage(img, 0, 0, SIZE, SIZE);
  return canvas.toDataURL("image/png").replace(/^data:image\/png;base64,/, "");
}

async function main() {
  const lines: string[] = [];
  for (const [name, svg] of ICONS) lines.push(`${name} ${await png(svg)}`);
  // From 60 px the Doug is whole, his head with room in its piece (the identity's §2); no light on the floor on a
  // light ground.
  const whole = DougBot.avatar({ bot: "doug", perto: false, brilho: false, id: "dbs", titulo: "DougBot" });
  lines.push(`start-doug ${btoa(whole)}`);
  document.body.textContent =`\n${lines.join("\n")}\n`;
}

void main();
