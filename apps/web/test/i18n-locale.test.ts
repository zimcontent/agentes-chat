import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { setupDom } from "@agenteschat/ui/testing/dom";

setupDom();

import { titledWithUnread } from "@agenteschat/client/lib/unread";
import { setClientProductName } from "@agenteschat/i18n/brand";
import {
  chooseLocale,
  createI18n,
  detectedLocale,
  readLocaleState,
  rebrandLoaded,
  savedLocale,
  translateTabTitle,
} from "../src/i18n";

beforeEach(() => localStorage.clear());

describe("the language to start in (ADR 0122)", () => {
  test("this browser's pick, else the landing's cookie, else the browser's own, else English", () => {
    expect(savedLocale(["pt-PT"], "agentes_locale=en")).toBe("en");
    expect(savedLocale(["sv-SE"], "")).toBe("en");
    expect(savedLocale(["sv-SE", "pt-BR"], "")).toBe("pt-BR");
    expect(savedLocale(["fr-CA", "pt-BR"], "")).toBe("fr");
    expect(savedLocale(["en-US"], "agentes_locale=zh-Hans")).toBe("zh-Hans");
    expect(savedLocale(["en-US"], "a=1; agentes_locale=pt")).toBe("pt-BR");
    localStorage.setItem("agentes.locale", "pt-BR");
    expect(savedLocale(["en-US"], "agentes_locale=en")).toBe("pt-BR");
    // Automático: the browser's own, whatever the landing said.
    localStorage.setItem("agentes.locale", "auto");
    expect(savedLocale(["en-US"], "agentes_locale=pt")).toBe("en");
  });

  test("a pick made signed out waits for the next sign-in; one made signed in doesn't", () => {
    const i18n = createI18n("en");
    chooseLocale("pt-BR", i18n, false);
    expect(readLocaleState()).toEqual({ stored: "pt-BR", pending: true });
    chooseLocale("auto", i18n, true);
    expect(readLocaleState()).toEqual({ stored: "auto", pending: false });
    expect(detectedLocale(["sv-SE", "en"])).toBe("en");
    expect(detectedLocale(["zh-TW", "en"])).toBe("zh-Hans");
  });
});

describe("the tab's title", () => {
  test("follows the language, keeps the unread count in front and leaves a page's own title", async () => {
    const i18n = createI18n("en");
    translateTabTitle(i18n);
    expect(document.title).toBe("DougBot · Your team and your agents, in the same conversation");
    document.title = titledWithUnread(document.title, 3).title;
    await i18n.changeLanguage("pt-BR");
    expect(document.title).toBe("(3) DougBot · Seu time e seus agentes, na mesma conversa");
    document.title = "#general · Example";
    await i18n.changeLanguage("de");
    expect(document.title).toBe("#general · Example");
    // The page goes and puts back the title it found, an earlier language's.
    document.title = "(3) DougBot · Your team and your agents, in the same conversation";
    await new Promise((done) => setTimeout(done, 0));
    expect(document.title).toBe("(3) DougBot · Dein Team und deine Agenten, in derselben Unterhaltung");
  });

  test("a boot that hasn't learnt whether the server has a client writes no title at all", async () => {
    // The timeout of `/api/instance` (ADR doug-0023): the build's own name is never written over a page's.
    document.title = "A page's own title";
    const i18n = createI18n("en");
    translateTabTitle(i18n, { title: false });
    expect(document.title).toBe("A page's own title");
    // The server's answer arriving, or a page moving, doesn't make this boot overwrite it either.
    await i18n.changeLanguage("pt-BR");
    document.title = "Still a page's own title";
    await new Promise((done) => setTimeout(done, 0));
    expect(document.title).toBe("Still a page's own title");
  });
});

describe("a client's name reaching the strings already loaded (ADR doug-0023)", () => {
  afterEach(() => setClientProductName(null));

  test("the bundles in the instance are branded again, so the title already starts with the client's name", () => {
    const i18n = createI18n("en");
    // The language's bundle was built before the server's answer: the build's own name, and English's title.
    expect(i18n.t("app.tabTitle")).toBe("DougBot · Your team and your agents, in the same conversation");
    // main.tsx's two calls, in its order: the name, then every bundle already in the instance.
    setClientProductName("Padaria Aurora");
    rebrandLoaded(i18n);
    expect(i18n.t("app.tabTitle")).toBe("Padaria Aurora · Your team and your agents, in the same conversation");
    // Every language in the instance, not only the one in use: a switch to it reads the client's name too.
    expect(i18n.getResourceBundle("pt-BR", "translation").app.tabTitle).toStartWith("Padaria Aurora · ");
    // A language loaded after the name already carries it, and a second pass leaves the text as it is.
    rebrandLoaded(i18n);
    expect(i18n.t("app.tabTitle")).toBe("Padaria Aurora · Your team and your agents, in the same conversation");
  });

  test("a page of the same language reads the name: the table's tooltip, a string with the product in it", () => {
    const i18n = createI18n("en");
    expect(i18n.t("common.newVersion")).toBe("A new version of DougBot is out.");
    setClientProductName("Café Sol");
    rebrandLoaded(i18n);
    expect(i18n.t("common.newVersion")).toBe("A new version of Café Sol is out.");
  });
});
