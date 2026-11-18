import { afterEach, describe, expect, test } from "bun:test";
import { setupDom } from "@agenteschat/ui/testing/dom";

setupDom();

import type { LegalFacts } from "@agenteschat/client";
import { cleanup } from "@testing-library/react";
import { fillLegal, legalText, stripDraftBanner } from "@/legal/text";
import { createFakeApi, ORG_ID, seedState } from "./fake-api";
import { renderApp, screen, settle } from "./render";

afterEach(() => {
  cleanup();
  localStorage.clear();
});

const signedOut = (legal?: Partial<LegalFacts>) => createFakeApi(seedState({ me: null, legal }));

const heading = () => screen().getByRole("heading", { level: 1 }).textContent;
/** The document's own text, headings included: what the reader sees, without the page's furniture. */
const body = () => document.querySelector(".legal__doc")?.textContent ?? "";

describe("the legal pages", () => {
  test("/termos opens DougBot's Terms of Use in Portuguese, with no sign-in", async () => {
    await renderApp("/termos", { api: signedOut() });
    expect(heading()).toBe("Termos de Uso");
    expect(document.querySelector(".legal__draft")?.textContent).toContain("Rascunho, sujeito à revisão jurídica");
    // The company's own fields read as placeholders when the server has none.
    expect(body()).toContain("[a preencher]");
  });

  test("/privacidade opens the Privacy Policy and links to the Terms for the other document", async () => {
    const { router } = await renderApp("/privacidade", { api: signedOut() });
    expect(router.state.location.pathname).toBe("/privacidade");
    expect(heading()).toBe("Política de Privacidade");
    expect(screen().getByRole("link", { name: "Termos de Uso" })).toBeTruthy();
  });

  test("/terms and /privacy serve the English text, and the switch moves to it", async () => {
    await renderApp("/terms", { api: signedOut() });
    expect(heading()).toBe("Terms of Use");
    expect(document.documentElement.lang || document.querySelector(".legal")?.getAttribute("lang")).toBe("en");
    cleanup();
    await renderApp("/privacy", { api: signedOut() });
    expect(heading()).toBe("Privacy Policy");
  });

  test("the Data Processing Addendum is an annex of the Privacy Policy", async () => {
    await renderApp("/privacidade", { api: signedOut() });
    expect(body()).toContain("Acordo de Tratamento de Dados (DPA)");
  });

  test("the installation's company details fill the placeholders, and the empty ones say so", async () => {
    await renderApp("/termos", {
      api: signedOut({
        companyName: "Padaria Aurora Serviços Ltda.",
        taxId: "00.000.000/0001-00",
        address: "Rua das Flores, 100, São Paulo, SP",
        dpoName: "Ana Lima",
        dpoEmail: "dpo@example.com",
      }),
    });
    expect(body()).toContain("Padaria Aurora Serviços Ltda.");
    expect(body()).toContain("00.000.000/0001-00");
    expect(body()).toContain("dpo@example.com");
    // Every field the server was given is filled in: no token is left for the reader to see.
    expect(body()).not.toContain("{{");
    expect(body()).not.toContain("{{");
  });
});

describe("Configurações › Sua conta", () => {
  test("the legal links open each document in a new tab, at this server's own pages", async () => {
    const state = seedState({ authConfig: { termsUrl: "/termos", privacyUrl: "/privacidade" } });
    await renderApp(`/org/${ORG_ID}/settings/account`, { api: createFakeApi(state) });
    await settle(6);
    const terms = screen().getByRole("link", { name: "Termos" }) as HTMLAnchorElement;
    const privacy = screen().getByRole("link", { name: "Política de privacidade" }) as HTMLAnchorElement;
    expect(terms.getAttribute("href")).toBe("/termos");
    expect(privacy.getAttribute("href")).toBe("/privacidade");
    expect(terms.getAttribute("target")).toBe("_blank");
    expect(privacy.getAttribute("target")).toBe("_blank");
  });
});

describe("fillLegal", () => {
  const facts: LegalFacts = {
    companyName: "Café Sol Ltda.",
    taxId: null,
    address: null,
    dpoName: "Theo",
    dpoEmail: null,
    serverLocation: null,
    logRetention: null,
    backupRetentionDays: 30,
    voiceRetentionDays: 7,
  };

  test("a setting replaces its placeholder, an empty or missing one becomes the placeholder of the language", () => {
    expect(fillLegal("{{legalName}} e {{cnpj}}", facts, "pt-BR")).toBe("Café Sol Ltda. e [a preencher]");
    expect(fillLegal("{{legalName}} and {{cnpj}}", facts, "en")).toBe("Café Sol Ltda. and [to be filled]");
  });

  test("the retention numbers come from the settings, with a default when the server says none", () => {
    expect(fillLegal("{{backupRetentionDays}} {{voiceRetentionDays}}", facts, "pt-BR")).toBe("30 7");
    expect(fillLegal("{{backupRetentionDays}}", undefined, "en")).toBe("14");
  });

  test("a field the documents do not know stays as written, so a reviewer sees the mistake", () => {
    expect(fillLegal("{{nope}}", facts, "pt-BR")).toBe("{{nope}}");
  });
});

describe("the draft banner", () => {
  test("the file's own banner is kept for whoever reads it there, and does not show twice on the page", () => {
    // The committed files put it under the title.
    const withBanner = "# Title\n\n> [!warning] Draft, subject to legal review\n> Second line.\n\nBody.";
    expect(stripDraftBanner(withBanner)).toBe("# Title\n\nBody.");
    // One at the top goes too, and a `>` quote anywhere else stays.
    expect(stripDraftBanner("> [!warning] Draft\n\n# Title")).toBe("# Title");
    expect(stripDraftBanner("# Title\n\n> a real quote\n\nBody.")).toBe("# Title\n\n> a real quote\n\nBody.");
    // A document written without one goes through as it is.
    expect(stripDraftBanner("# Title\n\nBody.")).toBe("# Title\n\nBody.");
    // Every committed document carries one: stripping it leaves none, and the text starts at its title.
    for (const doc of ["terms", "privacy"] as const)
      for (const lang of ["pt-BR", "en"] as const) {
        const stripped = stripDraftBanner(legalText(doc, lang));
        expect({ doc, lang, banner: stripped.includes("[!warning]") }).toEqual({ doc, lang, banner: false });
        expect(stripped.startsWith("# ")).toBe(true);
      }
  });
});

describe("the documents in the repository", () => {
  test("each document exists in both languages, with the same sections in the same order", () => {
    for (const [doc, pt, en] of [
      ["terms", legalText("terms", "pt-BR"), legalText("terms", "en")],
      ["privacy", legalText("privacy", "pt-BR"), legalText("privacy", "en")],
    ] as const) {
      expect({ doc, pt: pt.length > 2000 }).toEqual({ doc, pt: true });
      const heads = (text: string) => text.split("\n").filter((line) => /^#{1,2} /.test(line)).length;
      expect({ doc, pt: heads(pt), en: heads(en) }).toEqual({ doc, pt: heads(pt), en: heads(pt) });
    }
  });

  test("both mention the controller/processor split, the LGPD, the rights and the DPO", () => {
    const pt = legalText("privacy", "pt-BR");
    expect(pt).toContain("controladora");
    expect(pt).toContain("operador");
    expect(pt).toContain("LGPD");
    expect(pt).toContain("{{dpoEmail}}");
    const en = legalText("privacy", "en");
    expect(en).toContain("controller");
    expect(en).toContain("processor");
    expect(en).toContain("LGPD");
  });
});
