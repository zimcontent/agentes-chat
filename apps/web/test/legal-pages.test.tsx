import { afterEach, describe, expect, spyOn, test } from "bun:test";
import { setupDom } from "@agenteschat/ui/testing/dom";

setupDom();

import type { LegalFacts } from "@agenteschat/client";
import { legalDocument } from "@agenteschat/i18n/legal";
import { cleanup, fireEvent } from "@testing-library/react";
import { fillLegal, legalText, stripDraftBanner } from "@/legal/text";
import { createFakeApi, ORG_ID, seedState } from "./fake-api";
import { renderApp, screen, settle } from "./render";

afterEach(() => {
  cleanup();
  localStorage.clear();
});

/** A server that isn't agentes.chat's and links DougBot's own pages (it names its company), signed out. */
const signedOut = (legal?: Partial<LegalFacts>) =>
  createFakeApi(
    seedState({
      me: null,
      legal,
      instance: { cloud: false, url: "http://localhost:3000" },
      authConfig: { termsUrl: "http://localhost:3000/termos", privacyUrl: "http://localhost:3000/privacidade" },
    }),
  );
const ownServer = (authConfig: { termsUrl?: string; privacyUrl?: string } = {}) =>
  createFakeApi(seedState({ me: null, instance: { cloud: false, url: "http://localhost:3000" }, authConfig }));
const cloud = () => createFakeApi(seedState({ me: null }));
const SERVICES = (on: Partial<LegalFacts["services"]>): LegalFacts["services"] => ({
  platformKey: false,
  jev: false,
  giphy: false,
  email: false,
  media: false,
  speech: false,
  push: false,
  pushDirect: false,
  pushRelay: false,
  composio: false,
  embeddings: false,
  whatsapp: false,
  errors: false,
  billing: false,
  support: false,
  telemetry: false,
  driveBackup: false,
  ...on,
});

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

  test("the page's language is the address's: lang on the page and the document, and the app's own comes back on leaving", async () => {
    await renderApp("/terms", { api: signedOut() });
    expect(document.querySelector(".legal")?.getAttribute("lang")).toBe("en");
    expect(document.documentElement.lang).toBe("en");
    cleanup();
    expect(document.documentElement.lang).not.toBe("en");
  });

  test("the language switch moves to the other language's address and its text", async () => {
    const { router } = await renderApp("/termos", { api: signedOut() });
    expect(heading()).toBe("Termos de Uso");
    fireEvent.click(screen().getByRole("combobox", { name: "Idioma" }));
    fireEvent.click(await screen().findByRole("option", { name: "English" }));
    await settle(6);
    expect(router.state.location.pathname).toBe("/terms");
    expect(heading()).toBe("Terms of Use");
    expect(document.documentElement.lang).toBe("en");
    fireEvent.click(screen().getByRole("combobox", { name: "Idioma" }));
    fireEvent.click(await screen().findByRole("option", { name: "Português (Brasil)" }));
    await settle(6);
    expect(router.state.location.pathname).toBe("/termos");
    expect(heading()).toBe("Termos de Uso");
  });

  test("while the company details load there is a skeleton, and no text or numbers of a default yet", async () => {
    const api = signedOut();
    const never = new Promise<LegalFacts>(() => {});
    api.system.legal = () => never;
    await renderApp("/privacidade", { api });
    expect(heading()).toBe("Política de Privacidade");
    expect(document.querySelector(".legal__loading")?.getAttribute("aria-busy")).toBe("true");
    expect(document.querySelector(".legal__doc")).toBeNull();
    expect(document.querySelector(".legal__draft")).toBeNull();
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
    expect(document.querySelector(".legal")?.getAttribute("lang")).toBe("en");
    expect(document.documentElement.lang).toBe("en");
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
    draft: false,
    backup: false,
    storage: "database",
    telemetryForced: false,
    companyRequestsRetentionDays: null,
    services: SERVICES({}),
  };

  test("a setting replaces its placeholder, an empty or missing one becomes the placeholder of the language", () => {
    expect(fillLegal("{{legalName}} e {{cnpj}}", facts, "pt-BR")).toBe("`Café Sol Ltda.` e `[a preencher]`");
    expect(fillLegal("{{legalName}} and {{cnpj}}", facts, "en")).toBe("`Café Sol Ltda.` and `[to be filled]`");
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
    expect(pt).toContain("{{dpoEmailLink}}");
    const en = legalText("privacy", "en");
    expect(en).toContain("controller");
    expect(en).toContain("processor");
    expect(en).toContain("LGPD");
  });
});

describe("which page each address shows", () => {
  test("agentes.chat Cloud's, where the server says it is the Cloud, and /termos goes to /terms there", async () => {
    for (const kind of ["terms", "privacy"] as const) {
      await renderApp(`/${kind}`, { api: cloud() });
      expect(screen().getByRole("heading", { level: 1, name: legalDocument(kind, "en").title })).toBeTruthy();
      cleanup();
    }
    const { router } = await renderApp("/termos", { api: cloud() });
    expect(router.state.location.pathname).toBe("/terms");
    expect(screen().getByRole("heading", { level: 1, name: legalDocument("terms", "en").title })).toBeTruthy();
  });

  test("a server with its own TERMS_URL / PRIVACY_URL sends all four addresses there, and shows none of ours", async () => {
    const own = { termsUrl: "https://example.com/terms", privacyUrl: "https://example.com/privacy" };
    const replace = spyOn(window.location, "replace").mockImplementation(() => {});
    try {
      for (const [path, url] of [
        ["/terms", own.termsUrl],
        ["/termos", own.termsUrl],
        ["/privacy", own.privacyUrl],
        ["/privacidade", own.privacyUrl],
      ] as const) {
        replace.mockClear();
        await renderApp(path, { api: ownServer(own) });
        expect(replace.mock.calls.map(([to]) => String(to))).toEqual([url]);
        expect(screen().queryByRole("heading", { level: 1 })).toBeNull();
        cleanup();
      }
    } finally {
      replace.mockRestore();
    }
  });

  test("with no page set, or an address of this same app that isn't ours, it says so, as before", async () => {
    await renderApp("/terms", { api: ownServer({ privacyUrl: "https://example.com/privacy" }) });
    expect(screen().getByRole("heading", { level: 1 }).textContent).toBe("Este servidor não tem página de termos");
    cleanup();
    await renderApp("/terms", { api: ownServer({ termsUrl: "http://localhost:3000/terms" }) });
    expect(screen().getByRole("heading", { level: 1 }).textContent).toBe("Este servidor não tem página de termos");
    cleanup();
    await renderApp("/privacidade", { api: ownServer() });
    expect(screen().getByRole("heading", { level: 1 }).textContent).toBe("Este servidor não tem página de privacidade");
  });
});

describe("the draft notice", () => {
  test("shows with LEGAL_DRAFT or a missing field, and goes once a lawyer's review is declared", async () => {
    await renderApp("/termos", { api: signedOut({ draft: true }) });
    expect(document.querySelector(".legal__draft")?.textContent).toBe(
      "Rascunho, sujeito à revisão jurídica. O que está entre colchetes ainda não foi preenchido.",
    );
    cleanup();
    await renderApp("/termos", { api: signedOut({ draft: false }) });
    expect(document.querySelector(".legal__draft")).toBeNull();
  });
});

describe("the paragraphs that depend on the installation", () => {
  const privacy = (facts: Partial<LegalFacts> = {}, lang: "pt-BR" | "en" = "pt-BR") =>
    fillLegal(stripDraftBanner(legalText("privacy", lang)), { ...BASE, ...facts }, lang);
  const BASE: LegalFacts = {
    companyName: "Padaria Aurora Serviços Ltda.",
    taxId: "00.000.000/0001-00",
    address: "Rua das Flores, 100",
    dpoName: "Ana Lima",
    dpoEmail: "dpo@example.com",
    serverLocation: "Brasil (São Paulo)",
    logRetention: null,
    backupRetentionDays: 14,
    voiceRetentionDays: 90,
    draft: false,
    backup: false,
    storage: "database",
    telemetryForced: false,
    companyRequestsRetentionDays: null,
    services: SERVICES({}),
  };

  test("the backup paragraph only exists where there is a backup bucket, and says what a number of 0 means", () => {
    expect(privacy()).toContain("Esta instalação não tem cópia de segurança do banco de dados configurada");
    expect(privacy()).not.toContain("faz uma cópia de segurança do banco de dados por dia");
    const on = privacy({ backup: true });
    expect(on).toContain("faz uma cópia de segurança do banco de dados por dia");
    expect(on).toContain("mantidas por 14 dias");
    // 0: no number is promised, and the service's own default is said.
    const zero = privacy({ backup: true, backupRetentionDays: 0 });
    expect(zero).not.toContain("mantidas por 0 dias");
    expect(zero).toContain("14 dias, se nada for configurado");
    expect(privacy({ backup: true }, "en")).toContain("kept for 14 days");
    expect(privacy({ backup: true, backupRetentionDays: 0 }, "en")).toContain("14 days, if none is configured");
  });

  test("the backup covers the database only: the WhatsApp gateway's databases are said to be outside it", () => {
    expect(privacy({ backup: true })).not.toContain("bancos do gateway do WhatsApp");
    const on = privacy({ backup: true, services: SERVICES({ whatsapp: true }) });
    expect(on).toContain("os bancos do gateway do WhatsApp (as sessões do número) não entram nela");
  });

  test("a voice retention of 0 says the audio is kept until deleted, never '0 dias'", () => {
    expect(privacy()).toContain("o áudio é apagado depois de 90 dias");
    const zero = privacy({ voiceRetentionDays: 0 });
    expect(zero).toContain("ele é guardado até ser apagado");
    expect(zero).not.toContain("depois de 0 dias");
    expect(zero).not.toContain("por 0 dias");
    expect(privacy({ voiceRetentionDays: 0 }, "en")).toContain("it is kept until it is deleted");
  });

  test("the usage report: on by default with its legal basis and how to turn it off, forced on the Cloud, off when off", () => {
    const on = privacy({ services: SERVICES({ telemetry: true }) });
    expect(on).toContain("ligado por padrão");
    expect(on).toContain("legítimo interesse");
    expect(on).toContain("TELEMETRY=off");
    expect(on).not.toContain("não pode ser desligado");
    const forced = privacy({ telemetryForced: true, services: SERVICES({ telemetry: true }) });
    expect(forced).toContain("não pode ser desligado");
    expect(forced).not.toContain("define `TELEMETRY=off`");
    const off = privacy();
    expect(off).toContain("Esta instalação não envia relatório de uso");
    expect(off).not.toContain("ligado por padrão");
    expect(privacy({ services: SERVICES({ telemetry: true }) }, "en")).toContain("on by default");
  });

  test("consent no longer lists the usage report, which is an opt-out on legitimate interest", () => {
    const consent =
      privacy()
        .split("\n")
        .find((line) => line.startsWith("- **Consentimento**")) ?? "";
    expect(consent).not.toContain("relatório de uso");
  });

  test("every optional service shows in section 5 only where it is on, and Annex II says on or off for each", () => {
    const all = privacy({
      backup: true,
      storage: "s3",
      services: SERVICES({
        platformKey: true,
        jev: true,
        giphy: true,
        email: true,
        support: true,
        media: true,
        speech: true,
        push: true,
        pushDirect: true,
        pushRelay: true,
        composio: true,
        embeddings: true,
        whatsapp: true,
        errors: true,
        billing: true,
        telemetry: true,
        driveBackup: true,
      }),
    });
    for (const piece of [
      "Roteador Jev",
      "o texto das mensagens recentes da conversa, o canal e o tópico",
      "GIPHY",
      "Evolution Go",
      "Suporte por e-mail",
      "Geração de imagens e vídeos",
      "Transcrição de voz",
      "Integrador de serviços (Composio)",
      "Busca por significado",
      "Relatórios de erro",
      "Cobrança",
      "Google Drive",
      "chave de modelo da plataforma",
    ])
      expect({ piece, found: all.includes(piece) }).toEqual({ piece, found: true });
    expect(all).toContain(
      "| Roteador Jev (TypeSafe ou OpenRouter) | Escolher quem responde, organizar a memória | O texto das mensagens recentes, o canal e o tópico | Ligado |",
    );
    const none = privacy();
    for (const piece of ["Roteador Jev", "Evolution Go", "Busca por significado", "Composio)", "Suporte por e-mail**"])
      expect({ piece, found: none.split("## 6.")[0]?.includes(piece) }).toEqual({ piece, found: false });
    expect(none).toContain(
      "| Roteador Jev (TypeSafe ou OpenRouter) | Escolher quem responde, organizar a memória | O texto das mensagens recentes, o canal e o tópico | Desligado |",
    );
    expect(none).not.toContain("[a preencher]");
    expect(none).not.toContain("{{");
  });

  test("the support e-mail names what it carries: the report and the asker's e-mail", () => {
    const on = privacy({ services: SERVICES({ support: true, email: true }) });
    expect(on).toContain("o nome e o e-mail da pessoa");
    expect(on).toContain("relato");
    expect(privacy({ services: SERVICES({ support: true }) }, "en")).toContain("the person's name and e-mail");
  });

  test("a server with the platform key, and one with phone pushes through the relay, say so", () => {
    expect(privacy({ services: SERVICES({ platformKey: true }) })).toContain("chave de modelo da plataforma");
    expect(privacy()).not.toContain("chave de modelo da plataforma");
    const relay = privacy({ services: SERVICES({ push: true, pushRelay: true }) });
    expect(relay).toContain("relay de notificações do projeto agentes.chat");
    expect(relay).not.toContain("diretamente ao Firebase");
  });

  test("the waiting list's section describes the form only where there is one, with its retention", () => {
    expect(privacy()).toContain("Esta instalação não tem formulário de lista de espera");
    const on = privacy({ companyRequestsRetentionDays: 365 });
    expect(on).toContain("guardados por 365 dias");
    expect(on).toContain("consentimento");
    expect(on).toContain("botão de apagar");
    expect(privacy({ companyRequestsRetentionDays: 365 }, "en")).toContain("kept for 365 days");
  });

  test("deletion says what happens to the files and what holds it back, and 'restaurable' is gone", () => {
    const text = privacy();
    expect(text).toContain("tarefa em segundo plano");
    expect(text).toContain("retenção legal");
    expect(text).not.toContain("restaurable");
    expect(text).toContain("podem ser restaurados");
  });

  test("model training is the providers' own terms, and the audit of commands is on the computer", () => {
    expect(privacy()).toContain("segue os termos e as configurações de cada um");
    const terms = fillLegal(legalText("terms", "pt-BR"), BASE, "pt-BR");
    expect(terms).toContain("tratam o que recebem pelos termos de cada um, inclusive quanto a treino");
    expect(terms).not.toContain("não permite que os suboperadores");
    expect(terms).toContain("ficam registrados no próprio computador, e não no histórico do app");
  });
});

describe("the company's own words in the documents", () => {
  const hostile: LegalFacts = {
    companyName: "Aurora `evil` [x](https://evil.example) **bold**",
    taxId: "00\n\n# Heading",
    address: "Rua | das | Flores",
    dpoName: "Ana",
    dpoEmail: "dpo@example.com",
    serverLocation: "Brasil",
    logRetention: null,
    backupRetentionDays: 14,
    voiceRetentionDays: 90,
    draft: false,
    backup: false,
    storage: "database",
    telemetryForced: false,
    companyRequestsRetentionDays: null,
    services: SERVICES({}),
  };

  test("a value is neutered before it goes into the Markdown: no backtick, line break or cell edge survives", () => {
    const out = fillLegal("{{legalName}} / {{cnpj}} / {{address}}", hostile, "pt-BR");
    expect(out).toBe("`Aurora 'evil' [x](https://evil.example) **bold**` / `00 # Heading` / `Rua / das / Flores`");
  });

  test("on the page, what looks like a link, bold or a heading in a value is shown as the text it is", async () => {
    await renderApp("/termos", { api: signedOut(hostile) });
    const doc = document.querySelector(".legal__doc");
    expect(doc?.textContent).toContain("Aurora 'evil' [x](https://evil.example) **bold**");
    expect(doc?.querySelector('a[href="https://evil.example"]')).toBeNull();
    expect(doc?.querySelectorAll("h1").length).toBe(0);
  });

  test("the DPO's e-mail is a real mailto link, and an address that is not an address is not a link", async () => {
    await renderApp("/privacidade", { api: signedOut({ dpoEmail: "dpo@example.com" }) });
    const links = [...document.querySelectorAll<HTMLAnchorElement>('.legal__doc a[href^="mailto:"]')];
    expect(links.length).toBeGreaterThan(0);
    expect(new Set(links.map((a) => a.getAttribute("href")))).toEqual(new Set(["mailto:dpo@example.com"]));
    expect(links[0]?.textContent).toBe("dpo@example.com");
    expect(fillLegal("{{dpoEmailLink}}", { ...hostile, dpoEmail: "x](javascript:alert(1))@a.b" }, "en")).not.toContain(
      "mailto:",
    );
    expect(fillLegal("{{dpoEmailLink}}", { ...hostile, dpoEmail: null }, "en")).toBe("`[to be filled]`");
  });
});

describe("the blocks", () => {
  const facts = { ...({} as LegalFacts), services: SERVICES({ jev: true }), backup: true } as LegalFacts;

  test("if, unless and else keep one side, and blocks nest", () => {
    expect(fillLegal("a{{#if backup}}B{{else}}C{{/if}}d", facts, "en")).toBe("aBd");
    expect(fillLegal("a{{#if svc.giphy}}B{{else}}C{{/if}}d", facts, "en")).toBe("aCd");
    expect(fillLegal("{{#unless svc.jev}}X{{/unless}}{{#unless svc.giphy}}Y{{/unless}}", facts, "en")).toBe("Y");
    expect(fillLegal("{{#if backup}}1{{#if svc.jev}}2{{else}}3{{/if}}4{{/if}}", facts, "en")).toBe(
      "1234".replace("3", "").replace("2", "2"),
    );
    expect(fillLegal("{{#if svc.giphy}}1{{#if svc.jev}}2{{/if}}{{/if}}z", facts, "en")).toBe("z");
  });

  test("a row's state reads Ligado / Desligado, and On / Off in English", () => {
    expect(fillLegal("{{on:svc.jev}} {{on:svc.giphy}}", facts, "pt-BR")).toBe("Ligado Desligado");
    expect(fillLegal("{{on:svc.jev}} {{on:svc.giphy}}", facts, "en")).toBe("On Off");
  });

  test("a page opened with no facts yet reads as every optional service off, never as on", () => {
    expect(fillLegal("{{#if svc.jev}}on{{else}}off{{/if}}", undefined, "en")).toBe("off");
  });
});
