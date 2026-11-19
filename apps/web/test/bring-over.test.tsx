import { afterEach, describe, expect, test } from "bun:test";
import { setupDom } from "@dougbot/ui/testing/dom";

setupDom();

import type { CarrySource } from "@dougbot/client";
import { cleanup, fireEvent } from "@testing-library/react";
import { createFakeApi, ORG_ID, seedState } from "./fake-api";
import { renderApp, screen, settle } from "./render";

afterEach(() => cleanup());

const LONG_WORKSPACE = "Agência de marketing digital das lojas da região sul, do sudeste e do centro-oeste";
const LONG_ROLE =
  "Cuida do atendimento ao cliente de todas as lojas, responde dúvidas de pedidos, trocas e devoluções e avisa o time";

/**
 * "Trazer de outro workspace" with what breaks its rows (break-ui): a workspace with an 80-character name, an agent
 * with a long role, three skills and two connections, one that is here already, a sign-in that died, GitHub through
 * the app alone and a second workspace with one connection. CI's geometry check lays the dialog out at 1280 and 320.
 */
const SOURCES: CarrySource[] = [
  {
    id: "org-a",
    name: LONG_WORKSPACE,
    logo: null,
    connections: [
      {
        id: "c-stripe",
        connector: "custom:c-stripe",
        label: "Stripe (Zim Content Produções Audiovisuais Ltda)",
        serverUrl: "https://mcp.stripe.com",
        authType: "oauth",
        accountLabel: "financeiro.contas-a-receber@subsidiaria.example.com",
        icon: null,
        blocked: null,
        here: false,
      },
      {
        id: "c-notion",
        connector: "custom:c-notion",
        label: "Notion",
        serverUrl: "https://mcp.notion.com/mcp",
        authType: "oauth",
        accountLabel: null,
        icon: null,
        blocked: null,
        here: true,
      },
      {
        id: "c-sentry",
        connector: "sentry",
        label: "Sentry",
        serverUrl: "https://mcp.sentry.dev/mcp",
        authType: "oauth",
        accountLabel: "acme",
        icon: null,
        blocked: "needs_reconnect",
        here: false,
      },
      {
        id: "c-github",
        connector: "github",
        label: "GitHub",
        serverUrl: "https://api.githubcopilot.com/mcp/",
        authType: "github_app",
        accountLabel: "acme, acme-labs",
        icon: null,
        blocked: "github_app",
        here: false,
      },
    ],
    agents: [
      {
        id: "a-bia",
        name: "Bia",
        handle: "bia",
        role: LONG_ROLE,
        appearance: null,
        skills: ["triagem", "trocas", "tom-de-voz"],
        connectionIds: ["c-stripe"],
        here: false,
      },
      {
        id: "a-leo",
        name: "Leo",
        handle: "leo",
        role: "",
        appearance: null,
        skills: [],
        connectionIds: [],
        here: true,
      },
    ],
  },
  {
    id: "org-b",
    name: "Casa",
    logo: null,
    connections: [
      {
        id: "c-linear",
        connector: "custom:c-linear",
        label: "Linear",
        serverUrl: "https://mcp.linear.app/mcp",
        authType: "oauth",
        accountLabel: null,
        icon: null,
        blocked: null,
        here: false,
      },
    ],
    agents: [],
  },
];

async function open(sources: CarrySource[] = SOURCES) {
  const state = seedState();
  state.carrySources = structuredClone(sources);
  const api = createFakeApi(state);
  await renderApp(`/org/${ORG_ID}/settings/connectors`, { api });
  await settle(8);
  return { state };
}

const box = (name: RegExp) => screen().getByRole("checkbox", { name });

describe("Trazer de outro workspace", () => {
  test("nobody with nothing to bring sees the button", async () => {
    await open([]);
    expect(screen().queryByRole("button", { name: "Trazer de outro workspace" })).toBeNull();
  });

  test("picking an agent takes its connections along, and what can't come says why", async () => {
    const { state } = await open();
    fireEvent.click(screen().getByRole("button", { name: "Trazer de outro workspace" }));
    await settle();
    const dialog = screen().getByRole("dialog", { name: "Trazer de outro workspace" });
    expect([...dialog.querySelectorAll(".ac-grouphead")].map((h) => h.textContent)).toEqual([LONG_WORKSPACE, "Casa"]);
    // Here already, a dead sign-in and GitHub through the app alone: said on the row, never pickable.
    const off = [...dialog.querySelectorAll<HTMLElement>(".scope-row[data-off]")];
    expect(off.map((r) => r.querySelector(".ac-chip")?.textContent)).toEqual([
      "Já está aqui",
      "Já está aqui",
      "Precisa reconectar",
      "Instale o GitHub App aqui",
    ]);
    for (const row of off) expect(row.querySelector("[role=checkbox]")?.hasAttribute("disabled")).toBe(true);
    // The agent's line says what comes with it.
    const bia = dialog.querySelector<HTMLElement>("label[for='bring-a-a-bia']");
    expect([...(bia?.querySelectorAll(".small") ?? [])].map((s) => s.textContent)).toEqual([
      LONG_ROLE,
      "3 skills",
      "Vem com Stripe (Zim Content Produções Audiovisuais Ltda)",
    ]);

    expect(screen().getByRole("button", { name: "Trazer" }).hasAttribute("disabled")).toBe(true);
    fireEvent.click(box(/^Bia/));
    await settle();
    // Its connection shows checked and locked: it comes with the agent, and counts once.
    const stripe = box(/^Stripe/);
    expect(stripe.getAttribute("aria-checked")).toBe("true");
    expect(stripe.hasAttribute("disabled")).toBe(true);
    expect(screen().getByRole("button", { name: "Trazer 1 item" })).toBeTruthy();
    fireEvent.click(box(/^Linear/));
    await settle();
    fireEvent.click(screen().getByRole("button", { name: "Trazer 2 itens" }));
    await settle(6);
    expect(screen().queryByRole("dialog", { name: "Trazer de outro workspace" })).toBeNull();
    expect(state.calls.filter((c) => c.method === "carry.bring").map((c) => c.args[1])).toEqual([
      { agentIds: ["a-bia"], connectionIds: ["c-linear"] },
    ]);
    expect(screen().getByText("2 itens trazidos para este workspace")).toBeTruthy();
  });

  test("an AI key of another workspace is picked by its name and ending, and comes over (ADR 9002 addendum)", async () => {
    const withKey: CarrySource[] = [
      {
        id: "org-c",
        name: "ConsigBOT",
        logo: null,
        connections: [],
        agents: [],
        keys: [{ id: "k-od", provider: "opendesign", label: "OpenDesign", hint: "9f3a", here: false }],
      },
    ];
    const { state } = await open(withKey);
    fireEvent.click(screen().getByRole("button", { name: "Trazer de outro workspace" }));
    await settle();
    const dialog = screen().getByRole("dialog", { name: "Trazer de outro workspace" });
    expect(dialog.textContent).toContain("Chaves de IA");
    expect(dialog.textContent).toContain("…9f3a");
    fireEvent.click(box(/OpenDesign/));
    fireEvent.click(screen().getByRole("button", { name: "Trazer 1 item" }));
    await settle(6);
    expect(state.calls.filter((c) => c.method === "carry.bring").map((c) => c.args[1])).toEqual([
      { agentIds: [], connectionIds: [], credentialIds: ["k-od"] },
    ]);
    expect(screen().getByText("1 item trazido para este workspace")).toBeTruthy();
  });
});
