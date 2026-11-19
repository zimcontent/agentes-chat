import { afterEach, describe, expect, test } from "bun:test";
import { setupDom } from "@dougbot/ui/testing/dom";

setupDom();

import { resetHeldPlaces } from "@dougbot/client";
import { act, cleanup, fireEvent, within } from "@testing-library/react";
import { ADA_ID, createFakeApi, ENG_ID, ORG_ID, seedState } from "./fake-api";
import { renderApp, settle } from "./render";

afterEach(() => {
  cleanup();
  resetHeldPlaces();
});

/** The live browser cards drawn (the page, not the folded lines). */
const cards = () => [...document.querySelectorAll(".brw-ac.is-open")] as HTMLElement[];
const lines = () => [...document.querySelectorAll(".brw-stack__line")] as HTMLElement[];

/** Two turns of Ada in #eng, both in her browser: two live rows, each with its browser card. */
async function twoTurns() {
  const state = seedState();
  const api = createFakeApi(state);
  const r = await renderApp(`/org/${ORG_ID}/c/${ENG_ID}`, { api });
  await settle(5);
  const socket = r.sockets.last();
  await act(async () => socket.open());
  const ev = (event: Record<string, unknown>) =>
    act(async () => socket.push({ type: "event", channelId: ENG_ID, event: { channelId: ENG_ID, ...event } }));
  for (const runId of ["r-first", "r-second"]) {
    const run = { threadId: null, runId, agentId: ADA_ID };
    await ev({ type: "agent.thinking", ...run });
    await ev({ type: "agent.tool", ...run, tool: "browser_open", detail: "https://mydoug.io/portal" });
    await settle();
  }
  await settle(3);
  return { state, ev };
}

describe("one browser per conversation: an agent's earlier live cards fold", () => {
  test("only the newest card shows the page; the earlier one is a line that opens it", async () => {
    await twoTurns();
    expect(cards()).toHaveLength(1);
    expect(lines()).toHaveLength(1);
    const line = lines()[0] as HTMLElement;
    // The line comes first (the earlier turn), the page after it (the newest).
    const card = cards()[0] as HTMLElement;
    expect(line.compareDocumentPosition(card) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(line.textContent).toContain("Navegador · mydoug.io/portal");
    const open = within(line).getByRole("button", { name: /Mostrar a tela/ });
    expect(open.getAttribute("aria-expanded")).toBe("false");
    // Opened on request: its page too, under the line.
    await act(async () => fireEvent.click(open));
    await settle();
    expect(cards()).toHaveLength(2);
    expect(
      within(line)
        .getByRole("button", { name: /Esconder a tela/ })
        .getAttribute("aria-expanded"),
    ).toBe("true");
    await act(async () => fireEvent.click(within(line).getByRole("button", { name: /Esconder a tela/ })));
    await settle();
    expect(cards()).toHaveLength(1);
  });

  test("Assumir still works on the newest card, and the card in control stays the one shown", async () => {
    const { state } = await twoTurns();
    const card = cards()[0] as HTMLElement;
    await act(async () => fireEvent.click(within(card).getByRole("button", { name: "Assumir" })));
    await settle(3);
    const call = state.calls.find((c) => c.method === "browser.takeover");
    // Bound to the newest turn, whose card it was taken from.
    expect(call?.args).toEqual([ORG_ID, ADA_ID, "r-second"]);
    expect(cards()).toHaveLength(1);
    expect(cards()[0]?.classList.contains("is-control")).toBe(true);
    expect(lines()).toHaveLength(1);
  });
});
