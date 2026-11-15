import { afterEach, expect, test } from "bun:test";
import { setupDom } from "@agenteschat/ui/testing/dom";

setupDom();

import { act, cleanup, fireEvent, within } from "@testing-library/react";
import { ADA_ID, createFakeApi, ORG_ID, seedState } from "./fake-api";
import { renderApp, screen, settle } from "./render";

afterEach(() => cleanup());

const click = async (el: Element) => {
  await act(async () => fireEvent.click(el));
  await settle(2);
};
const card = () => screen().getByRole("region", { name: "Ronda" });

/** The agent's ronda in its settings (ADR 9004): off at first, on from the select, with its next pass and last one. */
test("Ronda: turned on from the select, it shows the next pass, the last one and Fazer uma ronda agora", async () => {
  const state = seedState();
  await renderApp(`/org/${ORG_ID}/agents/${ADA_ID}?tab=settings`, { api: createFakeApi(state) });
  await settle(8);
  const select = within(card()).getByRole("combobox", { name: "Quando passa" });
  expect(select.textContent).toBe("Desligada");
  expect(within(card()).queryByRole("button", { name: "Fazer uma ronda agora" })).toBeNull();

  await click(select);
  await click(screen().getByRole("option", { name: "8h, 13h e 18h" }));
  await settle(4);
  const set = state.calls.find((c) => c.method === "agents.setRonda");
  expect(set?.args.slice(0, 3)).toEqual([ORG_ID, ADA_ID, "three_daily"]);
  expect(within(card()).getByRole("combobox", { name: "Quando passa" }).textContent).toBe("8h, 13h e 18h");
  expect(card().textContent).toContain("Próxima:");
  expect(within(card()).getByRole("button", { name: "Fazer uma ronda agora" })).toBeTruthy();
});

test("Ronda: a slot that passed with nothing new says so", async () => {
  const state = seedState();
  state.rondas = {
    [ADA_ID]: {
      schedule: "daily",
      routineId: "ronda-1",
      personId: "me",
      nextRunAt: "2026-11-16T11:00:00.000Z",
      recent: [{ at: "2026-11-15T11:00:00.000Z", status: "skipped", code: "ronda_nothing", summary: "" }],
    },
  };
  await renderApp(`/org/${ORG_ID}/agents/${ADA_ID}?tab=settings`, { api: createFakeApi(state) });
  await settle(8);
  expect(card().textContent).toContain("Última: Pulada: nada mudou desde a última ronda");
});
