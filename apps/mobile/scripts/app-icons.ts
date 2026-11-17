/**
 * Every ready app icon's file, from the Doug (ADR 0179; DougBot's own, docs/adr/doug-0010-doug-app-icons.md):
 * `cd apps/mobile && bun scripts/app-icons.ts`, then commit what changed. The first id is the icon the apps ship with;
 * the others are what a person may pick on their device. Nothing is drawn by hand: change the drawing in
 * src/brand/doug-icons.js (`READY_ICONS`) and run this again.
 *
 * - Phone (assets/app-icons/<id>/): iOS 1024 in light, dark and tinted; Android's front, back and one-color layers
 *   (1024 for the shipped icon, 432, Android's largest, for the others, which the app-icons plugin copies as they are)
 *   and, for the others, the 192 icon of Android before 8; the picker's previews.
 * - Desktop: nothing here. Its build draws its own from the same drawing (apps/desktop/scripts/icons.ts).
 * - Web (apps/web/public/): favicon.ico, apple-touch-icon.png and icon-512.png, app-icons/<id>.ico/.png for the pick
 *   (the tab's icon and the picker's preview).
 * The icons a person makes are drawn when the app is built (scripts/made-icons.mjs), and the shipped icon's own files
 * (assets/images/icon*.png) by scripts/brand-assets.ts, from the same drawing.
 */
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { iconSvg, READY_ICONS } from "../src/brand/doug-icons.js";
import { ico, opaquePng, png, rounded } from "./icon-png.mjs";

const ROOT = join(import.meta.dir, "..", "..", "..");
function write(path: string, data: Buffer) {
  const full = join(ROOT, path);
  mkdirSync(dirname(full), { recursive: true });
  writeFileSync(full, data);
  console.log(`${path} ${Math.round(data.length / 1024)} KB`);
}

const ids = Object.keys(READY_ICONS) as (keyof typeof READY_ICONS)[];
for (const id of ids) {
  const { light, dark } = READY_ICONS[id];
  const shipped = id === ids[0];
  const phone = `apps/mobile/assets/app-icons/${id}`;
  write(`${phone}/ios.png`, opaquePng(iconSvg(light), 1024));
  write(`${phone}/ios-dark.png`, opaquePng(iconSvg(dark), 1024));
  write(`${phone}/ios-tinted.png`, opaquePng(iconSvg(dark, "tinted"), 1024, true));
  const AN = shipped ? 1024 : 432;
  write(`${phone}/android-foreground.png`, png(iconSvg(light, "front"), AN));
  write(`${phone}/android-background.png`, opaquePng(iconSvg(light, "back"), AN));
  write(`${phone}/android-monochrome.png`, png(iconSvg(light, "mono"), AN));
  if (!shipped) write(`${phone}/android-legacy.png`, png(rounded(iconSvg(light)), 192));
  write(`${phone}/preview.png`, opaquePng(iconSvg(light), 180));
  write(`${phone}/preview-dark.png`, opaquePng(iconSvg(dark), 180));

  // The tab's icon: his head close up at 16, 32 and 48 (a whole icon is a blur there).
  const tab = iconSvg(light, "favicon");
  const favicon = ico([16, 32, 48].map((size) => ({ size, png: png(tab, size) })));
  write(`apps/web/public/app-icons/${id}.ico`, favicon);
  write(`apps/web/public/app-icons/${id}.png`, opaquePng(iconSvg(light), 160));
  if (shipped) {
    write("apps/web/public/favicon.ico", favicon);
    write("apps/web/public/apple-touch-icon.png", opaquePng(iconSvg(light), 180));
    write("apps/web/public/icon-512.png", opaquePng(iconSvg(light), 512));
  }
}
