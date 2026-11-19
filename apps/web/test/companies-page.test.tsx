import { afterEach, describe, expect, test } from "bun:test";
import { setupDom } from "@dougbot/ui/testing/dom";

setupDom();

import { isStrictEmail } from "@dougbot/client/lib/text";
import { act, cleanup, fireEvent } from "@testing-library/react";
import { createFakeApi, seedState } from "./fake-api";
import { renderApp, screen, settle } from "./render";

afterEach(() => {
  cleanup();
  window.history.replaceState(null, "", "/");
});

/** What the page's form sent, and whether it was answered. */
let posted: { body: Record<string, unknown>; headers: Headers }[] = [];
const realFetch = globalThis.fetch;

function stubFetch(): void {
  posted = [];
  globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    if (url.endsWith("/api/companies")) {
      posted.push({ body: JSON.parse(String(init?.body ?? "{}")), headers: new Headers(init?.headers) });
      return new Response(JSON.stringify({ ok: true }), { status: 202 });
    }
    if (url.endsWith("/api/companies/delete")) {
      posted.push({ body: JSON.parse(String(init?.body ?? "{}")), headers: new Headers(init?.headers) });
      return new Response(JSON.stringify({ ok: true }), { status: 200 });
    }
    return new Response(JSON.stringify({ error: { code: "not_found", message: "Not found" } }), { status: 404 });
  }) as unknown as typeof fetch;
}

/** Fills every field the server needs, but the email, which each test sets. */
async function fill(email: string): Promise<void> {
  const box = (name: string) => screen().getByRole("textbox", { name });
  const type = (el: Element, value: string) => act(async () => fireEvent.change(el, { target: { value } }));
  await type(box("Seu nome"), "Ana Souza");
  await type(box("Empresa"), "Aurora Bakery");
  await type(box("E-mail"), email);
  await type(box("WhatsApp"), "+5511912345678");
  await act(async () => fireEvent.click(screen().getByLabelText(/Concordo que o DougBot/)));
}

describe("the company request page", () => {
  test("a comma or a query in the address never counts as one, as on the server", () => {
    expect(isStrictEmail("ana@company.com")).toBe(true);
    expect(isStrictEmail("a,victim@x.com")).toBe(false);
    expect(isStrictEmail("a@b.co?cc=x")).toBe(false);
  });

  test("on agentes.chat Cloud the page is not found: neither the form nor its links exist there", async () => {
    stubFetch();
    try {
      window.history.replaceState(null, "", "/empresas");
      // The fake server is on the Cloud by default (`instance.cloud`).
      await renderApp("/empresas", { api: createFakeApi(seedState({ me: null })) });
      expect(screen().getByText(/Página não encontrada|Page not found/)).toBeDefined();
      expect(screen().queryByLabelText("E-mail")).toBeNull();
    } finally {
      globalThis.fetch = realFetch;
    }
  });

  test("a bad address keeps Send off; a good one sends the app's own language, never the browser's raw tag", async () => {
    stubFetch();
    try {
      window.history.replaceState(null, "", "/empresas");
      // A self-hosted server: on the Cloud neither the route nor the page exists (ADR doug-0033).
      await renderApp("/empresas", { api: createFakeApi(seedState({ me: null, instance: { cloud: false } })) });
      await fill("a,victim@x.com");
      const send = () => screen().getByRole("button", { name: /Enviar pedido|Send request/ }) as HTMLButtonElement;
      expect(send().disabled).toBe(true);
      // A good address turns it on.
      await act(async () =>
        fireEvent.change(screen().getByLabelText("E-mail"), { target: { value: "ana@aurora.com" } }),
      );
      expect(send().disabled).toBe(false);
      await act(async () => fireEvent.click(send()));
      await settle(4);
      const [first] = posted;
      expect(first?.body).toMatchObject({ email: "ana@aurora.com", consent: true, interests: [] });
      // The locale is a resolved code (`pt-BR`), never `pt-BR-pt` or a raw browser tag.
      expect(first?.body.locale).toBe("pt-BR");
    } finally {
      globalThis.fetch = realFetch;
    }
  });

  test("the landing compares with Grok Bot, shows the team, and the waiting list answers in its own card", async () => {
    stubFetch();
    try {
      window.history.replaceState(null, "", "/empresas");
      await renderApp("/empresas", { api: createFakeApi(seedState({ me: null, instance: { cloud: false } })) });
      expect(screen().getByRole("heading", { level: 1, name: /Seu braço direito/ })).toBeDefined();
      // The comparison names the other service as its own column, and every row says both sides.
      expect(screen().getAllByText("Grok Bot").length).toBeGreaterThan(0);
      expect(screen().getAllByText("Onde roda").length).toBe(2);
      expect(screen().getAllByText("Num servidor só seu").length).toBeGreaterThan(0);
      for (const name of ["Doug", "Rosa", "Sony", "Mark", "Chess", "Kiara", "Junin"])
        expect(screen().getAllByText(name).length).toBeGreaterThan(0);
      // The hero's button leads to the waiting list, whose form is the company request.
      expect(screen().getByRole("link", { name: "Entrar na lista de espera" }).getAttribute("href")).toBe("#lista");
      await fill("ana@aurora.com");
      await act(async () => fireEvent.click(screen().getByRole("button", { name: "Enviar pedido" })));
      await settle(4);
      expect(posted).toHaveLength(1);
      // The answer takes the list's place on the same page: the landing stays around it.
      expect(screen().getByRole("heading", { level: 2, name: "Seu pedido chegou" })).toBeDefined();
      expect(screen().getByRole("heading", { level: 1, name: /Seu braço direito/ })).toBeDefined();
    } finally {
      globalThis.fetch = realFetch;
    }
  });

  test("the delete link asks first, and only its button posts the token to erase", async () => {
    stubFetch();
    try {
      const token = "Kp3vTz8bRnW2sQyL6mXj0AdCg4HeFuN1";
      window.history.replaceState(null, "", `/empresas?delete=${token}`);
      await renderApp(`/empresas?delete=${token}`, {
        api: createFakeApi(seedState({ me: null, instance: { cloud: false } })),
      });
      // Opening the page posts nothing: a scanner that only fetches the link deletes nothing.
      expect(posted).toHaveLength(0);
      // The button sends the token, on a POST, and the page says it is gone.
      await act(async () =>
        fireEvent.click(screen().getByRole("button", { name: /Apagar meu pedido|Delete my request/ })),
      );
      await settle(4);
      const [erase] = posted;
      expect(erase?.body).toMatchObject({ token });
      expect(erase?.headers.get("content-type")).toContain("application/json");
      expect(screen().getByText(/Pedido apagado|Request deleted/)).toBeDefined();
    } finally {
      globalThis.fetch = realFetch;
    }
  });
});
