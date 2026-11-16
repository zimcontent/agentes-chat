import { describe, expect, test } from "bun:test";
import { createApp } from "../src/app";

const app = createApp({ edition: "selfhost", version: "1", modules: [], pingDatabase: async () => {} });
const go = async (path: string, acceptLanguage?: string) => {
  const res = await app.request(path, acceptLanguage ? { headers: { "accept-language": acceptLanguage } } : {});
  return [res.status, res.headers.get("location")];
};

// DougBot: the help pages are this server's own docs (`/docs/<page>` of its app, in the reader's language).
describe("the old help pages", () => {
  test("move for good to this server's docs, whatever the language asked", async () => {
    expect(await go("/help/memory?lang=en")).toEqual([301, "/docs/memory"]);
    expect(await go("/help/memory?lang=pt-BR")).toEqual([301, "/docs/memory"]);
    expect(await go("/help/jev?lang=ko")).toEqual([301, "/docs/jev"]);
    expect(await go("/help/computers", "pt-PT,pt;q=0.9")).toEqual([301, "/docs/computers"]);
  });

  test("the help root and a page that doesn't exist land on the docs index", async () => {
    expect(await go("/help?lang=es")).toEqual([301, "/docs"]);
    expect(await go("/help/")).toEqual([301, "/docs"]);
    expect(await go("/help/nope?lang=pt-BR")).toEqual([301, "/docs"]);
    expect(await go("/help/toString?lang=en")).toEqual([301, "/docs"]);
  });

  test("never leave for the original project's site", async () => {
    for (const path of ["/help", "/help/memory", "/help/install-on-a-server?lang=pt-BR"])
      expect((await go(path))[1]).not.toContain("agentes.chat");
  });
});
