import { expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { BOOT_STYLES, redirected } from "../vite-boot-styles";

// Doug: the sign-in screen loads without the sidebar, the command menu, the new agent's dialog and the install guide,
// and with the same stylesheets in the same order (vite-boot-styles.ts).
const SRC = join(import.meta.dir, "../src");
const read = (path: string) => readFileSync(join(SRC, path), "utf8");
const imports = (path: string) => [...read(path).matchAll(/^import [^;]*?from "([^"]+)";/gms)].map((m) => m[1]);

test("what the first screen holds imports the shell's small pieces, not the screens that own them", () => {
  const heavy = /\/(?:Sidebar|CommandMenu|NewAgentDialog)$/;
  for (const file of ["components/DesktopMenus.tsx", "components/DesktopTitleBar.tsx", "components/NavDrawer.tsx"])
    expect({ file, heavy: imports(file).filter((from) => heavy.test(from ?? "")) }).toEqual({ file, heavy: [] });
  expect(imports("routes/download.tsx")).not.toContain("@/components/install/guide");
});

test("the boot stylesheets come ahead of the theme, in their list's order, from one file", () => {
  const main = read("main.tsx");
  expect(main.indexOf('import "./boot-styles";')).toBeGreaterThan(-1);
  expect(main.indexOf('import "./boot-styles";')).toBeLessThan(main.indexOf('import "./styles.css";'));
  expect(imports("boot-styles.ts")).toEqual([]);
  const listed = [...read("boot-styles.ts").matchAll(/^import "\.\/(.+)";$/gm)].map((m) => m[1]);
  expect(listed).toEqual(BOOT_STYLES);
});

test("a boot stylesheet imported anywhere else becomes the empty one; others stay", () => {
  const root = "/repo/apps/web/src";
  expect(redirected(`${root}/components/presence.css`, `${root}/components/Avatar.tsx`)).toBe(true);
  expect(redirected(`${root}/components/presence.css?direct`, `${root}/components/Avatar.tsx`)).toBe(true);
  expect(redirected(`${root}/components/presence.css`, `${root}/boot-styles.ts`)).toBe(false);
  expect(redirected("C:\\repo\\apps\\web\\src\\pages\\onboarding.css", "C:\\repo\\apps\\web\\src\\x.tsx")).toBe(true);
  expect(redirected(`${root}/styles.css`, `${root}/main.tsx`)).toBe(false);
  expect(redirected(`${root}/components/sidebar.css`, `${root}/components/Sidebar.tsx`)).toBe(false);
});
