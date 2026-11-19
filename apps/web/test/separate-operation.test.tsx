import { afterEach, describe, expect, test } from "bun:test";
import { setupDom } from "@agenteschat/ui/testing/dom";

setupDom();

import { act, cleanup, fireEvent, within } from "@testing-library/react";
import { createFakeApi, ORG_ID, seedState } from "./fake-api";
import { renderApp, screen, settle } from "./render";

/** Configurações › Geral: a separate operation (ADR doug-0035), changed by the owners. */

afterEach(() => cleanup());

const card = () => {
  const title = screen().getByRole("heading", { name: "Operação separada" });
  const section = title.closest("section, .ac-card, [aria-labelledby]");
  if (!section) throw new Error("no card");
  return within(section as HTMLElement);
};

describe("a separate operation", () => {
  test("the owner turns it on and keeps names; a connection on a shared sign-in is named", async () => {
    const state = seedState();
    state.separateOperation = {
      on: false,
      names: [],
      canEdit: true,
      sharedSignIns: [{ id: "c-drive", label: "Google Drive", workspaces: ["Outra Empresa"] }],
    };
    await renderApp(`/org/${ORG_ID}/settings/general`, { api: createFakeApi(state) });
    await settle(6);
    const here = card();
    expect(
      here.getByText("Google Drive usa o mesmo login de Outra Empresa. Conecte de novo com a conta desta operação."),
    ).toBeTruthy();
    await act(async () => fireEvent.click(here.getByRole("switch", { name: "Só o ofício vai e vem" })));
    await settle(4);
    const names = here.getByRole("textbox", { name: /Nomes desta operação/ });
    await act(async () => fireEvent.change(names, { target: { value: "Padaria Aurora,\nTorre Norte" } }));
    await act(async () => fireEvent.blur(names));
    await settle(4);
    const saved = state.calls.filter((c) => c.method === "carry.setSeparateOperation").map((c) => c.args[1]);
    expect(saved).toEqual([{ on: true }, { names: ["Padaria Aurora", "Torre Norte"] }]);
    expect(state.separateOperation).toMatchObject({ on: true, names: ["Padaria Aurora", "Torre Norte"] });
  });

  test("an admin who isn't an owner reads it and can't change it", async () => {
    const state = seedState();
    state.separateOperation = { on: true, names: ["Padaria Aurora"], canEdit: false, sharedSignIns: [] };
    await renderApp(`/org/${ORG_ID}/settings/general`, { api: createFakeApi(state) });
    await settle(6);
    const here = card();
    expect(here.getByRole("switch", { name: "Só o ofício vai e vem" }).hasAttribute("disabled")).toBe(true);
    expect(here.getByText("Só os donos mudam.")).toBeTruthy();
  });
});
