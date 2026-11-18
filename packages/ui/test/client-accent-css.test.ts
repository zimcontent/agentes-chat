import { expect, test } from "bun:test";

/**
 * A client's highlight (ADR doug-0032 §3): `--client-accent` on <html> paints the highlighted words and the focus ring,
 * and only a server that set one lets it reach a part of the page that themes itself. Without a client the nested
 * part keeps the green of its own theme, which is what keeps every other installation byte-for-byte the green it was.
 */

const css = await Bun.file(new URL("../src/styles/doug.css", import.meta.url).pathname).text();

/** Every rule written exactly as `selector {` at the top level, its declarations: `html:root` is written more than once. */
const rules = (selector: string) =>
  css
    .split(`\n${selector} {`)
    .slice(1)
    .map((block) => block.split("}")[0] ?? "");

test("the accent stands on the highlighted words and the focus ring, and nowhere else", () => {
  const root = rules("html:root").find((block) => block.includes("--client-accent")) ?? "";
  expect(root).toContain("--client-accent: var(--db-verde-acento)");
  expect(root).toContain("--accent-text: var(--client-accent)");
  expect(root).toContain("--focus-color: var(--client-accent)");
});

test("a nested theme part reads the client's accent only when the server marked one", () => {
  const nested = rules("html[data-client-accent] [data-theme]")[0] ?? "";
  expect(nested).toContain("--accent-text: var(--client-accent)");
  expect(nested).toContain("--focus-color: var(--client-accent)");
  // Never a bare `[data-theme]` rule naming the accent: without a mark it would pull a no-client server's root green
  // into a part in the other theme. Every accent rule that isn't the root's carries the mark.
  const accentRules = css.match(/^[^\n{]*\{[^}]*--accent-text: var\(--client-accent\)[^}]*\}/gm) ?? [];
  for (const block of accentRules) {
    const selector = block.slice(0, block.indexOf("{")).trim();
    if (selector === "html:root") continue;
    expect(selector).toContain("[data-client-accent]");
  }
  expect(accentRules.length).toBeGreaterThanOrEqual(1);
});
