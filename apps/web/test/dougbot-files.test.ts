import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { dougBoot, dougFavicon } from "../../../packages/ui/src/brand/dougbot-files";

// The two places that can't run the identity's code are written from it (packages/ui/scripts/dougbot-files.ts):
// a new dougbot-avatar.js shows up here until they are written again. No image files: the mark is SVG from code.
const web = join(import.meta.dir, "..");
const read = (p: string) => readFileSync(join(web, p), "utf8").replace(/\r\n/g, "\n");

describe("DougBot's files", () => {
  test("the tab's icon is the Doug close up, as the code draws it", () => {
    expect(read("public/favicon.svg")).toBe(dougFavicon());
  });
  test("the boot screen draws the Doug inline, as the code draws him, and no image", () => {
    const html = read("index.html");
    expect(html).toContain(`<!-- dougbot:boot -->${dougBoot()}<!-- /dougbot:boot -->`);
    expect(html).not.toMatch(/<img[^>]+doug/);
    expect(html).toContain("<title>DougBot</title>");
  });
});
