// Writes the places that can't run the identity's code from it (dougbot-avatar.js): the browser tab's icon
// (apps/web/public/favicon.svg), the Doug of the boot screen in apps/web/index.html, before the app loads, and the
// tab's icon and the Doug of the page shown while the server is away (apps/web/public/unavailable.html).
// Run after copying a new dougbot-avatar.js: bun packages/ui/scripts/dougbot-files.ts (a test keeps them in step),
// then `bun run sync:unavailable`, which copies that page into docker-compose.yml.
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { dougBoot, dougFavicon, dougOutageIcon, dougOutageMark } from "../src/brand/dougbot-files";

const web = join(import.meta.dir, "../../../apps/web");
writeFileSync(join(web, "public/favicon.svg"), dougFavicon());
const html = join(web, "index.html");
const page = readFileSync(html, "utf8").replace(
  /<!-- dougbot:boot -->[\s\S]*?<!-- \/dougbot:boot -->/,
  `<!-- dougbot:boot -->${dougBoot()}<!-- /dougbot:boot -->`,
);
writeFileSync(html, page);
// Functions as replacements: a `$` in a drawing would otherwise be read as a pattern.
const outage = join(web, "public/unavailable.html");
writeFileSync(
  outage,
  readFileSync(outage, "utf8")
    .replace(/<link rel="icon"[^>]*>/, () => dougOutageIcon())
    .replace(/<svg class="doug"[\s\S]*?<\/svg>/, () => dougOutageMark()),
);
