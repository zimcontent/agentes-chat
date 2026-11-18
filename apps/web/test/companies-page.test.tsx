import { afterEach, describe, expect, test } from "bun:test";
import { setupDom } from "@agenteschat/ui/testing/dom";

setupDom();

import { act, cleanup, fireEvent } from "@testing-library/react";
import { isStrictEmail } from "@agenteschat/client/lib/text";
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

  test("a bad address keeps Send off; a good one sends the app's own language, never the browser's raw tag", async () => {
    stubFetch();
    try {
      window.history.replaceState(null, "", "/empresas");
      await renderApp("/empresas", { api: createFakeApi(seedState({ me: null })) });
      await fill("a,victim@x.com");
      const send = () => screen().getByRole("button", { name: /Enviar pedido|Send request/ }) as HTMLButtonElement;
      expect(send().disabled).toBe(true);
      // A good address turns it on.
      await act(async () => fireEvent.change(screen().getByLabelText("E-mail"), { target: { value: "ana@aurora.com" } }));
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
});
