import { describe, expect, test } from "bun:test";
import { BRAND_NAME, brandText, brandTree, STRINGS } from "../src";
import { UPSTREAM_NAME } from "../src/brand";
import { appDocsUrl, BRAND_SITE, DOWNLOAD_URL } from "../src/docs";
import { loadStrings } from "../src/load";
import { LOCALE_CODES } from "../src/locale";

/** Every string of a tree, with where it is. */
function leaves(node: unknown, path = ""): [string, string][] {
  if (typeof node === "string") return [[path, node]];
  if (!node || typeof node !== "object") return [];
  return Object.entries(node).flatMap(([key, value]) => leaves(value, path ? `${path}.${key}` : key));
}

describe("this instance's name (DougBot)", () => {
  test("the product's name becomes ours, as a word", () => {
    expect(BRAND_NAME).toBe("DougBot");
    expect(brandText("Welcome to agentes.chat")).toBe("Welcome to DougBot");
    expect(brandText("agentes.chat is ready. Open agentes.chat.")).toBe("DougBot is ready. Open DougBot.");
    expect(brandText("o app do agentes.chat, e o agentes.chat Cloud")).toBe("o app do DougBot, e o DougBot Cloud");
    expect(brandText("agentes.chat's servers (agentes.chat)")).toBe("DougBot's servers (DougBot)");
    expect(brandText("“agentes.chat”: `agentes.chat`")).toBe("“DougBot”: `DougBot`");
    expect(brandText("agentes.chat\nagentes.chat")).toBe("DougBot\nDougBot");
  });

  test("an address stays as written: it has to keep working", () => {
    for (const address of [
      "https://agentes.chat/install",
      "https://agentes.chat",
      "curl -fsSL https://agentes.chat/install | sh",
      "ping@agentes.chat",
      "DougBot <ping@agentes.chat>",
      "app.agentes.chat",
      "https://app.agentes.chat/api/push-relay/v1",
      "/Applications/agentes.chat.app/Contents/MacOS/agentes-runner",
      "agentes.chat/docs/memory",
      "github.com/agentes-chat/agentes.chat/pull/148",
      "notagentes.chat",
    ])
      expect(brandText(address)).toBe(address);
    expect(brandText("Write to help@agentes.chat about agentes.chat.")).toBe(
      "Write to help@agentes.chat about DougBot.",
    );
  });

  test("a tree of words is renamed whole, and one with nothing to rename comes back as it was", () => {
    const tree = { a: "agentes.chat", b: { c: ["on agentes.chat", 3, null], d: (n: number) => `${n}` }, e: "plain" };
    const out = brandTree(tree);
    expect(out.a).toBe("DougBot");
    expect(out.b.c).toEqual(["on DougBot", 3, null]);
    expect(out.b.d).toBe(tree.b.d);
    expect(out.e).toBe("plain");
    const same = { a: "DougBot", b: { c: ["https://agentes.chat/install"] } };
    expect(brandTree(same)).toBe(same);
  });

  test("no string of the apps names the original project, in any language", () => {
    for (const code of LOCALE_CODES) {
      const named = leaves(STRINGS[code]).filter(([, text]) => brandText(text) !== text);
      expect({ code, named }).toEqual({ code, named: [] });
    }
  });

  test("the strings an app loads come under our name too", async () => {
    for (const code of LOCALE_CODES) {
      const named = leaves(await loadStrings[code]()).filter(([, text]) => brandText(text) !== text);
      expect({ code, named }).toEqual({ code, named: [] });
    }
  });

  test("the apps' help and download links stay on this instance's site", () => {
    expect(BRAND_SITE).toBe("https://time.zimcontent.com");
    expect(appDocsUrl()).toBe("https://time.zimcontent.com/docs");
    expect(appDocsUrl("memory")).toBe("https://time.zimcontent.com/docs/memory");
    expect(appDocsUrl("computers", "folders")).toBe("https://time.zimcontent.com/docs/computers#folders");
    expect(DOWNLOAD_URL).toBe("https://time.zimcontent.com/download");
    for (const url of [appDocsUrl("wiki"), DOWNLOAD_URL]) expect(url).not.toContain(UPSTREAM_NAME);
  });
});
