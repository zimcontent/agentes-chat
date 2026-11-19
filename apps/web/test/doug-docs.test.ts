import { expect, test } from "bun:test";
import { HELP_PAGES, helpInline } from "@dougbot/i18n/help";
import { readyLocales } from "@dougbot/i18n/locale";
import { ABOUT_SLUG, brandCode, DOC_GROUPS, type DocSlug, docInline, docPage, docSlug } from "@/docs/doug-docs";

const ORIGIN = "https://doug.example";
const OLD = /agentes\.chat/;
const menu = DOC_GROUPS.flatMap((g) => g.pages);
const blocksOf = (slug: DocSlug, locale: string) =>
  docPage(slug, locale).sections.flatMap((s) =>
    s.blocks.flatMap((b) => (typeof b === "string" ? [b] : "list" in b ? b.list : [])).map((line) => ({ s, line })),
  );

test("the menu holds every help page once, and the open source page last", () => {
  expect([...menu].sort()).toEqual([...Object.keys(HELP_PAGES), ABOUT_SLUG].sort() as DocSlug[]);
  expect(menu.at(-1)).toBe(ABOUT_SLUG);
  expect(docSlug("ai-apps")).toBe("apps-de-ia");
  expect(docSlug("nope")).toBeUndefined();
});

test("no page says the original name in its words, in any language, but where the usage report goes", () => {
  for (const { code } of readyLocales()) {
    for (const slug of menu.filter((s) => s !== ABOUT_SLUG)) {
      const page = docPage(slug, code);
      expect(`${page.title} ${page.summary} ${page.sections.map((s) => s.heading).join(" ")}`).not.toMatch(OLD);
      for (const { s, line } of blocksOf(slug, code)) {
        const words = docInline(line, ORIGIN, s.named)
          .filter((p) => p.kind !== "code")
          .map((p) => p.text)
          .join("");
        if (s.named) expect(`${slug}#${s.id}`).toBe("install-on-a-server#data");
        else expect(words).not.toMatch(OLD);
      }
    }
  }
});

test("the installer's address is this server's, and a link between pages stays in the docs", () => {
  expect(brandCode("curl -fsSL https://agentes.chat/install | sh", ORIGIN)).toBe(`curl -fsSL ${ORIGIN}/install | sh`);
  const hrefs = blocksOf("run-on-your-computer", "pt-BR").flatMap(({ line }) =>
    docInline(line, ORIGIN).flatMap((p) => (p.kind === "link" ? [p.href] : [])),
  );
  expect(hrefs).toContain("/docs/install-on-a-server#choose");
  expect(hrefs.some((h) => h.startsWith("/help"))).toBe(false);
});

test("the other project's package and image are in no page", () => {
  for (const { code } of readyLocales()) {
    const blocks = docPage("install-on-a-server", code).sections.flatMap((s) => s.blocks);
    expect(JSON.stringify(blocks)).not.toMatch(/@dougbot|agentes-chat/);
    expect(blocks.some((b) => typeof b !== "string" && "code" in b && b.code.includes("/install | sh"))).toBe(true);
  }
});

test("the open source page names where the work comes from", () => {
  for (const locale of ["pt-BR", "en"]) {
    const text = blocksOf(ABOUT_SLUG, locale)
      .flatMap(({ line }) => helpInline(line).map((p) => p.text))
      .join(" ");
    expect(text).toContain("agentes.chat");
    expect(text).toContain("Codari Global, LLC");
    expect(text).toContain("AGPL-3.0");
  }
});
