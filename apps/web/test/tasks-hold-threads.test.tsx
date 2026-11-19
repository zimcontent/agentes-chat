import { afterEach, describe, expect, test } from "bun:test";
import { setupDom } from "@dougbot/ui/testing/dom";

setupDom();

import { act, cleanup, fireEvent, within } from "@testing-library/react";
import { createFakeApi, ENG_ID, ORG_ID, seedState } from "./fake-api";
import { renderApp, screen, settle } from "./render";

/**
 * A task holds the thread it came from, and threads are no place of their own (ADR doug-0018): "Criar tarefa" on a
 * message, the same task when asked again, Threads out of the sidebar and its old address on Tarefas.
 */

afterEach(() => cleanup());

const openMenu = async (trigger: HTMLElement) => {
  trigger.focus();
  await act(async () => {
    fireEvent.keyDown(trigger, { key: "Enter" });
    fireEvent.keyUp(trigger, { key: "Enter" });
  });
  await act(() => new Promise((r) => setTimeout(r, 0)));
  return screen().getByRole("menu");
};

const toasts = () =>
  screen()
    .queryAllByRole("status")
    .map((s) => s.textContent ?? "");

describe("tasks hold threads", () => {
  test("Criar tarefa on a message makes a task once; asked again, the same task comes back", async () => {
    const state = seedState();
    const api = createFakeApi(state);
    await renderApp(`/org/${ORG_ID}/c/${ENG_ID}`, { api });
    await settle(8);
    const make = async () => {
      const bar = screen().getByRole("toolbar", { name: "Ações da mensagem de João" });
      const menu = await openMenu(within(bar).getByRole("button", { name: "Mais ações da mensagem" }));
      await act(async () => fireEvent.click(within(menu).getByRole("menuitem", { name: "Criar tarefa" })));
      await settle(4);
    };
    await make();
    expect(toasts().some((t) => /Tarefa #\d+ criada\. A conversa continua aqui e aparece na tarefa\./.test(t))).toBe(
      true,
    );
    const made = await api.issues.list(ORG_ID);
    const task = made.find((i) => i.source.type === "message");
    expect(task?.conversation?.channelId).toBe(ENG_ID);
    await make();
    expect(toasts().some((t) => t.includes(`Esta conversa já é a tarefa #${task?.number}.`))).toBe(true);
    expect((await api.issues.list(ORG_ID)).length).toBe(made.length);
  });

  test("Threads is no sidebar tool, and its old address opens Tarefas", async () => {
    await renderApp(`/org/${ORG_ID}/threads`, { api: createFakeApi(seedState()) });
    await settle(8);
    const nav = screen().getByRole("navigation", { name: "Navegação do workspace" });
    expect(within(nav).queryByRole("link", { name: "Threads" })).toBeNull();
    expect(screen().getByRole("heading", { level: 1, name: "Tarefas" })).toBeTruthy();
  });
});
