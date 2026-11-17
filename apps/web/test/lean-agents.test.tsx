import { afterEach, describe, expect, test } from "bun:test";
import { setupDom } from "@agenteschat/ui/testing/dom";
import { act, cleanup, fireEvent, within } from "@testing-library/react";
import { ADA_ID, ATLAS_ID, createFakeApi, ORG_ID, seedState } from "./fake-api";
import { renderApp, screen, settle } from "./render";

setupDom();

afterEach(() => cleanup());

/*
 * The agents' area made lean (docs/adr/doug-0017-agents-lean.md): an agent's page opens on who it is and how it is
 * now, Ajustes holds every tab one click deeper, Equipe opens on "Seu time agora" and the Painel de IA changes an
 * agent's AI by intent.
 */

const go = async (path: string, state = seedState()) => {
  const r = await renderApp(`/org/${ORG_ID}/${path}`, { api: createFakeApi(state) });
  await settle(8);
  return { ...r, state };
};
const click = async (el: Element) => {
  await act(async () => fireEvent.click(el));
  await settle(4);
};

describe("an agent's page opens lean", () => {
  test("who it is, three actions and the facts card, with no tabs", async () => {
    await go(`agents/${ADA_ID}`);
    expect(screen().getByRole("heading", { level: 1, name: "Ada" })).toBeTruthy();
    expect(screen().getByRole("button", { name: "Tarefas" })).toBeTruthy();
    expect(screen().getByRole("button", { name: "Ajustes" })).toBeTruthy();
    for (const label of ["Pode usar", "Este mês", "Responde a"]) expect(screen().getByText(label)).toBeTruthy();
    expect(screen().getByRole("heading", { name: "Hoje" })).toBeTruthy();
    expect(screen().queryByRole("tablist", { name: "Seções da Ada" })).toBeNull();
  });

  test("Ajustes opens the full page on Configurações, and the cover's button comes back", async () => {
    const { router } = await go(`agents/${ADA_ID}`);
    await click(screen().getByRole("button", { name: "Ajustes" }));
    const tabs = screen().getByRole("tablist", { name: "Seções da Ada" });
    const names = within(tabs)
      .getAllByRole("tab")
      .map((t) => t.textContent);
    expect(names[0]).toBe("Configurações");
    expect(names).not.toContain("Visão geral");
    expect(router.state.location.search).toMatchObject({ tab: "settings" });
    await click(screen().getByRole("button", { name: "Ada" }));
    expect(router.state.location.search).not.toHaveProperty("tab");
    expect(screen().queryByRole("tablist", { name: "Seções da Ada" })).toBeNull();
  });

  test("an older address with a tab or a section alone opens Ajustes there", async () => {
    await go(`agents/${ADA_ID}?tab=memory`);
    const tabs = screen().getByRole("tablist", { name: "Seções da Ada" });
    expect(within(tabs).getByRole("tab", { name: /Memória/, selected: true })).toBeTruthy();
    cleanup();
    await go(`agents/${ADA_ID}?sec=budget`);
    const again = screen().getByRole("tablist", { name: "Seções da Ada" });
    expect(within(again).getByRole("tab", { name: /Configurações/, selected: true })).toBeTruthy();
  });
});

describe("Equipe opens on Seu time agora", () => {
  test("the agents with what they do now, each opening its page", async () => {
    const { router } = await go("team");
    expect(screen().getByRole("heading", { level: 1, name: "Seu time agora" })).toBeTruthy();
    expect(screen().getByRole("radio", { name: "Agora" }).getAttribute("aria-checked")).toBe("true");
    const ada = screen()
      .getAllByRole("link")
      .find((a) => a.classList.contains("team-now__row") && a.textContent?.includes("Ada"));
    expect(ada?.getAttribute("href")).toBe(`/org/${ORG_ID}/agents/${ADA_ID}`);
    await click(screen().getByRole("radio", { name: "Setores" }));
    expect(router.state.location.search).toMatchObject({ view: "sectors" });
  });

  test("?view= opens another view", async () => {
    await go("team?view=sectors");
    expect(screen().getByRole("radio", { name: "Setores" }).getAttribute("aria-checked")).toBe("true");
  });
});

describe("Painel de IA", () => {
  test("who uses what, and the accounts", async () => {
    await go("ai");
    expect(screen().getByRole("heading", { level: 1, name: "Painel de IA" })).toBeTruthy();
    expect(screen().getByRole("heading", { name: /Quem usa o quê/ })).toBeTruthy();
    expect(screen().getByRole("heading", { name: "Contas de IA" })).toBeTruthy();
    for (const id of [ADA_ID, ATLAS_ID])
      expect(document.querySelector(`.aip-who[href="/org/${ORG_ID}/agents/${id}"]`)).not.toBeNull();
  });

  test("?agent= opens that agent's change by intent: three choices, each with its model", async () => {
    await go(`ai?agent=${ADA_ID}`);
    const dialog = screen().getByRole("dialog", { name: "Trocar a IA da Ada" });
    const choices = within(dialog)
      .getAllByRole("radio")
      .map((r) => r.textContent ?? "");
    expect(choices.map((c) => c.split("Claude")[0])).toEqual([
      "Mais inteligente",
      "Equilíbrio",
      "Mais rápida e econômica",
    ]);
    expect(choices[2]).toContain("Claude Haiku 5.5");
    await click(within(dialog).getAllByRole("radio")[2] as HTMLElement);
    expect(within(dialog).getByRole("button", { name: "Trocar para Claude Haiku 5.5" })).toBeTruthy();
    expect(within(dialog).getByRole("link", { name: "Mais opções" }).getAttribute("href")).toBe(
      `/org/${ORG_ID}/agents/${ADA_ID}?tab=settings&sec=brain`,
    );
  });
});
