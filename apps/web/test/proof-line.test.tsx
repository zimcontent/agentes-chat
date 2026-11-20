import { afterEach, expect, test } from "bun:test";
import { setupDom } from "@dougbot/ui/testing/dom";

setupDom();

import type { Message } from "@dougbot/client";
import { act, cleanup, fireEvent } from "@testing-library/react";
import { createFakeApi, LODI_ID, ORG_ID, seedDm, seedState } from "./fake-api";
import { renderApp, screen, settle } from "./render";

afterEach(() => {
  cleanup();
  localStorage.clear();
});

const DM = `dm-${LODI_ID}`;

test("an agent's reply carries what it delivered as one quiet line that opens each (docs/adr/doug-0040)", async () => {
  const state = seedState();
  seedDm(state, { type: "agent", id: LODI_ID });
  const reply: Message = {
    id: "m-proof",
    channelId: DM,
    threadId: null,
    author: { type: "agent", id: LODI_ID },
    body: "Pronto, mandei o relatório e abri a tarefa.",
    mentionedAgentIds: [],
    agentRunId: "r-proof",
    meta: {
      proof: [
        // Shown as its card above: left out of the line.
        { kind: "file", label: "Roteiro", ref: "a-card" },
        { kind: "file", label: "relatorio.pdf", ref: "a-pdf" },
        { kind: "task", label: "#42", ref: "42" },
        { kind: "link", label: "github.com/acme/app/issues/7", ref: "https://github.com/acme/app/issues/7" },
        { kind: "image", label: "", ref: "a-shot" },
        { kind: "action", label: "ana@acme.com" },
      ],
      artifacts: [{ id: "a-card", version: 1, title: "Roteiro" }],
    },
    createdAt: new Date(Date.now() - 60_000).toISOString(),
  };
  state.messages.push(reply);
  const r = await renderApp(`/org/${ORG_ID}/dm/agent/${LODI_ID}`, { api: createFakeApi(state) });
  await settle(8);
  await act(async () => r.sockets.last().open());
  await settle(3);

  const line = screen().getByRole("group", { name: "O que ele entregou" });
  const chips = () => [...line.querySelectorAll(".proof-line__chip")].map((c) => c.textContent);
  // One line: the first three, then how many more.
  expect(chips()).toEqual(["relatorio.pdf", "#42", "github.com/acme/app/issues/7", "+2"]);
  expect(line.textContent).not.toContain("Roteiro");
  const task = line.querySelector("a.proof-line__chip[href]") as HTMLAnchorElement;
  expect(task.getAttribute("href")).toBe(`/org/${ORG_ID}/issues/42`);
  const page = [...line.querySelectorAll("a")].find((a) => a.textContent === "github.com/acme/app/issues/7");
  expect(page?.getAttribute("href")).toBe("https://github.com/acme/app/issues/7");
  expect(page?.getAttribute("target")).toBe("_blank");
  expect(page?.getAttribute("rel")).toContain("noopener");

  await act(async () => fireEvent.click(screen().getByRole("button", { name: "Mostrar tudo" })));
  expect(chips()).toEqual(["relatorio.pdf", "#42", "github.com/acme/app/issues/7", "Print", "ana@acme.com"]);
  // An outside action has nothing to open: words, not a link or a button.
  const action = [...line.querySelectorAll(".proof-line__chip")].at(-1);
  expect(action?.tagName).toBe("SPAN");
});
