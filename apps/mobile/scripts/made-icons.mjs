// The files of the icons a person makes on their phone (ADR 0179; DougBot's, docs/adr/doug-0010-doug-app-icons.md):
// `node scripts/made-icons.mjs <dir>`. Never committed (320 icons): the phone's plugin (plugins/with-app-icons.js) runs
// this when the app is built and keeps the result while the drawing stays the same. Drawn from the identity's code
// (src/brand/doug-icons.js) with resvg, in a few threads.
//
// - <id>/ios.png: the 1024 icon (one look; a made icon has no dark or tinted version).
// - <id>/android-foreground.png (432) and <id>/android-legacy.png (192, Android before 8).
// - back-<ground>-<color>/android-background.png and mono-<face>/android-monochrome.png (432): shared by every icon of
//   that ground and color, and of that face. The leaning Doug's are apart: …-peek.
import { mkdirSync, writeFileSync } from "node:fs";
import { availableParallelism } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { isMainThread, Worker, workerData } from "node:worker_threads";
import {
  ICON_COLORS,
  ICON_FACES,
  ICON_GROUNDS,
  ICON_POSES,
  iconSvg,
  madeIconId,
  madeIcons,
} from "../src/brand/doug-icons.js";
import { opaquePng, png, rounded } from "./icon-png.mjs";

/** Every file to write: its path and how to draw it. */
function jobs() {
  const list = [];
  for (const icon of madeIcons()) {
    const id = madeIconId(icon);
    list.push({ path: `${id}/ios.png`, icon, layer: "whole", width: 1024, opaque: true });
    list.push({ path: `${id}/android-foreground.png`, icon, layer: "front", width: 432 });
    list.push({ path: `${id}/android-legacy.png`, icon, layer: "legacy", width: 192 });
  }
  for (const pose of ICON_POSES) {
    const tail = pose === "peek" ? "-peek" : "";
    for (const ground of ICON_GROUNDS)
      for (const color of ICON_COLORS)
        list.push({
          path: `back-${ground}-${color}${tail}/android-background.png`,
          icon: { ground, color, face: "normal", pose },
          layer: "back",
          width: 432,
          opaque: true,
        });
    for (const face of ICON_FACES)
      list.push({
        path: `mono-${face}${tail}/android-monochrome.png`,
        icon: { ground: "day", color: "green", face, pose },
        layer: "mono",
        width: 432,
      });
  }
  return list;
}

function draw(dir, job) {
  const svg = job.layer === "legacy" ? rounded(iconSvg(job.icon)) : iconSvg(job.icon, job.layer);
  const bytes = job.opaque ? opaquePng(svg, job.width) : png(svg, job.width);
  const full = join(dir, job.path);
  mkdirSync(dirname(full), { recursive: true });
  writeFileSync(full, bytes);
}

/** Writes every made icon's files into `dir`, the work shared among `threads`. */
export async function writeMadeIcons(dir, threads = Math.max(1, Math.min(8, availableParallelism() - 1))) {
  const all = jobs();
  const workers = Array.from(
    { length: threads },
    (_, part) =>
      new Promise((resolve, reject) => {
        const worker = new Worker(fileURLToPath(import.meta.url), { workerData: { dir, part, threads } });
        worker.on("error", reject);
        worker.on("exit", (code) => (code === 0 ? resolve() : reject(new Error(`made-icons: a thread ended ${code}`))));
      }),
  );
  await Promise.all(workers);
  return all.length;
}

if (!isMainThread) {
  const { dir, part, threads } = workerData;
  jobs().forEach((job, i) => {
    if (i % threads === part) draw(dir, job);
  });
} else if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  const [, , dir] = process.argv;
  if (!dir) throw new Error("made-icons: which directory?");
  const started = Date.now();
  const n = await writeMadeIcons(dir);
  console.log(`made-icons: ${n} files in ${Math.round((Date.now() - started) / 1000)} s`);
}
