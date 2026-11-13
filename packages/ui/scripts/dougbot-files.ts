// Writes the two places that can't run the identity's code from it (dougbot-avatar.js): the browser tab's icon
// (apps/web/public/favicon.svg) and the Doug of the boot screen in apps/web/index.html, before the app loads.
// Run after copying a new dougbot-avatar.js: bun packages/ui/scripts/dougbot-files.ts (a test keeps both in step).
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { dougFavicon, dougBoot } from "../src/brand/dougbot-files";

const web = join(import.meta.dir, "../../../apps/web");
writeFileSync(join(web, "public/favicon.svg"), dougFavicon());
const html = join(web, "index.html");
const page = readFileSync(html, "utf8").replace(
  /<!-- dougbot:boot -->[\s\S]*?<!-- \/dougbot:boot -->/,
  `<!-- dougbot:boot -->${dougBoot()}<!-- /dougbot:boot -->`,
);
writeFileSync(html, page);
