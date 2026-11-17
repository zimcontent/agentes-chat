import { expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { createAfterGone } from "../../src/features/shared/after-gone";

const source = (path: string) => readFileSync(join(import.meta.dir, "../../src", path), "utf8");

test("what a sheet leaves waiting runs once it is gone, never while it slides out", () => {
  const q = createAfterGone();
  const ran: string[] = [];
  q.opened();
  q.closing(() => ran.push("gif"));
  expect(ran).toEqual([]);
  q.gone();
  expect(ran).toEqual(["gif"]);
  // Once only.
  q.gone();
  expect(ran).toEqual(["gif"]);
  // No sheet on screen: at once.
  q.closing(() => ran.push("now"));
  expect(ran).toEqual(["gif", "now"]);
});

test("a sheet reopened before the last was gone runs what the last left waiting: a GIF picked is never lost", () => {
  const q = createAfterGone();
  const ran: string[] = [];
  q.opened();
  q.closing(() => ran.push("gif"));
  q.opened();
  expect(ran).toEqual(["gif"]);
  // The new sheet is on screen: what it leaves waits for it.
  q.closing(() => ran.push("photo"));
  expect(ran).toEqual(["gif"]);
  q.gone();
  expect(ran).toEqual(["gif", "photo"]);
});

test("the screen leaving drops what waited, and nothing runs after", () => {
  const q = createAfterGone();
  const ran: string[] = [];
  q.opened();
  q.closing(() => ran.push("gif"));
  q.drop();
  q.gone();
  expect(ran).toEqual([]);
});

test("the sheet is gone when its slide out ends, finished or cut short, unless it was reopened", () => {
  const sheet = source("ui/Sheet.tsx");
  // The slide out's end always settles; settling unmounts only a sheet still closed.
  expect(sheet).toMatch(/withTiming\(height, \{[^}]*\}, \(\) => \{\s*runOnJS\(settle\)\(\);/);
  expect(sheet).toContain("if (!openRef.current) setMounted(false);");
  expect(sheet).not.toContain("if (done) runOnJS(setMounted)(false);");
  // A drag can't take a sheet that is sliding out, and a sheet back on screen before its modal went isn't gone.
  expect(sheet).toContain("onMoveShouldSetPanResponder: (_e, g) => openRef.current &&");
  expect(sheet).toContain("if (goneTimer.current) clearTimeout(goneTimer.current);");
  const host = source("features/shared/SheetHost.tsx");
  expect(host).toContain("afterGone.opened();");
  expect(host).toContain("useEffect(() => () => afterGone.drop(), [afterGone]);");
});
