import { afterEach, describe, expect, test } from "bun:test";
import { setupDom } from "@agenteschat/ui/testing/dom";

setupDom();

import type { DougTemplateMember, TeamTemplate } from "@agenteschat/client";
import type { OnboardingStepId } from "@agenteschat/client/lib/onboarding";
import { act, cleanup, fireEvent } from "@testing-library/react";
import { createFakeApi, type FakeState, GENERAL_ID, ORG_ID, seedState, withRightHand } from "./fake-api";
import { renderApp, screen, settle } from "./render";

/*
 * The Doug team in the onboarding (docs/adr/doug-0020-time-doug.md), on the web: its card first on how a team starts,
 * "Quem entra no seu time?" (every box checked, the right hand fixed, the QG de Tráfego's team under its MARK), and
 * "Ensine a sua marca ao time" (a company's name and tone, required, saved as the workspace skill "Marca").
 */

afterEach(() => {
  cleanup();
  sessionStorage.clear();
});

const button = (name: string | RegExp) => screen().getByRole("button", { name });
const answer = (name: RegExp) => screen().getByRole("radio", { name });
const click = async (el: Element, rounds = 10) => {
  await act(async () => fireEvent.click(el));
  await settle(rounds);
};
const type = async (label: string, value: string) => {
  await act(async () => fireEvent.change(screen().getByLabelText(label), { target: { value } }));
};
const calls = (state: FakeState, method: string) => state.calls.filter((c) => c.method === method);
const heading = () => document.querySelector(".onb__title")?.textContent;
/** The row of "Quem entra" whose name is `name` (its box, its face, its role). */
const rowOf = (name: string) =>
  [...document.querySelectorAll(".onb-who__row")].find(
    (r) => r.querySelector("b")?.textContent === name,
  ) as HTMLElement;

/** A member of the Doug team's template, as `GET …/team-templates` lists it. */
const member = (
  handle: string,
  name: string,
  role: string,
  extra: Partial<DougTemplateMember> = {},
): DougTemplateMember => ({
  handle,
  name,
  role,
  line: `${name} cuida de ${role.toLowerCase()}.`,
  qg: null,
  channel: null,
  reportsTo: null,
  needsComputer: false,
  rightHand: false,
  routines: 1,
  skills: 2,
  ...extra,
});

/** The Doug team's template: the right hand, ROSA, and the QG de Tráfego (its MARK and two under it). */
const DOUG: TeamTemplate = {
  id: "doug",
  name: "Time Doug",
  sub: "Design, vídeo, tráfego, estratégia, social media, código e financeiro",
  description: "O time inteiro da casa.",
  team: {
    lead: "O Time Doug.",
    agents: [],
    newChannels: [],
    skills: [],
    weekly: null,
    approvals: "",
    invite: [],
  },
  members: [
    member("doug", "DOUG", "Gerente da operação", { rightHand: true, skills: 18 }),
    member("rosa", "ROSA", "Diretora de arte", { qg: "design", channel: "qg-design", needsComputer: true, skills: 6 }),
    member("mark", "MARK", "Líder do QG de Tráfego", { qg: "trafego", channel: "qg-trafego", skills: 3 }),
    member("copywriter", "Copywriter", "Copywriter do QG de Tráfego", {
      qg: "trafego",
      channel: "qg-trafego",
      reportsTo: "mark",
      skills: 2,
    }),
    member("operador", "Operador", "Operador do QG de Tráfego", {
      qg: "trafego",
      channel: "qg-trafego",
      reportsTo: "mark",
      needsComputer: true,
      skills: 1,
    }),
  ],
  needsComputer: ["rosa", "operador"],
};

/** A workspace set up to the team step, its "no agents yet" answered: how a team starts comes next. */
const atStart = (extra: Partial<FakeState> = {}) => {
  const state = withRightHand(seedState({ agents: [] }));
  if (state.me)
    state.me.organizations = [
      {
        id: ORG_ID,
        name: "Padaria Aurora",
        role: "owner",
        onboarding: { step: "import" as OnboardingStepId, generalChannelId: GENERAL_ID },
      },
    ];
  state.context = "Padaria";
  state.teamTemplates = [DOUG];
  Object.assign(state, extra);
  return state;
};

/** Our tests show the steps the workspace already walks the person through; settled to how a team starts. */
async function howStart(state: FakeState) {
  await renderApp("/onboarding", { api: createFakeApi(state) });
  await settle(14);
}

describe("the Doug team's card on how a team starts", () => {
  test("it comes first, already picked, with its faces and the sentence saying what it does", async () => {
    await howStart(atStart());
    expect(heading()).toBe("Como você quer começar o time?");
    const doug = answer(/Começar com o Time Doug/);
    // Checked, before the template and "from scratch".
    expect(doug.getAttribute("aria-checked")).toBe("true");
    const card = doug.closest("label") as HTMLElement;
    expect(card.textContent).toContain("Recomendado");
    expect(card.textContent).toContain("design, vídeo, tráfego");
    // Every face and "· N agents" beside them: the right hand first, uncheckable, the QG's team under it.
    expect(card.querySelectorAll(".onb-start__faces > *").length).toBe(DOUG.members?.length ?? 0);
    expect(card.querySelector(".onb-start__names")?.textContent).toContain("5 agentes");
    // The button leads to "Quem entra", not to the templates.
    expect(button("Escolher quem entra")).toBeTruthy();
  });
});

describe('"Quem entra no seu time?"', () => {
  test("every box is checked, the right hand fixed, and the QG de Tráfego's team under its MARK", async () => {
    const state = atStart();
    await howStart(state);
    await click(button("Escolher quem entra"), 14);
    expect(heading()).toBe("Quem entra no seu time?");
    const rows = document.querySelectorAll(".onb-who__list .onb-who__row");
    // The right hand, ROSA, the MARK and its two.
    expect(rows.length).toBe(DOUG.members?.length ?? 0);
    // Every checkable box is checked; the right hand's row has no box, and says it stays.
    const boxes = screen().getAllByRole("checkbox");
    expect(boxes.length).toBe((DOUG.members?.length ?? 1) - 1);
    for (const box of boxes) expect(box.getAttribute("data-state")).toBe("checked");
    const lead = [...rows].find((r) => r.textContent?.includes("DOUG"));
    expect(lead?.querySelector("[role='checkbox']")).toBeNull();
    expect(lead?.textContent).toContain("Fica");
    // The MARK's two sit in a group of their own, under it.
    const group = document.querySelector(".onb-who__team");
    expect(group?.textContent).toContain("Copywriter");
    expect(group?.textContent).toContain("Operador");
    // The summary beside it.
    const side = document.querySelector(".onb-who__side")?.textContent ?? "";
    expect(side).toContain("5 agentes no time");
    expect(side).toContain("skills de ofício");
  });

  test("unchecking a box moves the count and the handles sent to the server, the right hand always kept", async () => {
    const state = atStart();
    await howStart(state);
    await click(button("Escolher quem entra"), 14);
    // The box in ROSA's row (its label is the whole row's words, so the row finds it).
    const rosa = rowOf("ROSA").querySelector("[role='checkbox']") as HTMLElement;
    await click(rosa, 6);
    expect(document.querySelector(".onb-who__side")?.textContent).toContain("4 agentes no time");
    const operador = rowOf("Operador").querySelector("[role='checkbox']") as HTMLElement;
    await click(operador, 6);
    await click(button("Criar o time"), 20);
    const [applied] = calls(state, "agents.applyTeamTemplate");
    expect(applied?.args[1]).toBe("doug");
    // The handles sent: every one still checked, in the template's order, the right hand always instead of ROSA and
    // the Operador.
    expect(applied?.args[3]).toEqual(["doug", "mark", "copywriter"]);
  });

  test("an agent that needs a computer says so, and its button opens the app's own computer flow", async () => {
    await howStart(atStart());
    await click(button("Escolher quem entra"), 14);
    const row = rowOf("ROSA");
    expect(row.textContent).toContain("precisa de um computador conectado");
    // The box is a button of its own: the one with the words is Connect's.
    const connect = [...row.querySelectorAll("button")].find((b) => b.textContent === "Conectar computador");
    expect(connect).toBeTruthy();
  });

  test("Back goes to how the team starts, its card still picked", async () => {
    await howStart(atStart());
    await click(button("Escolher quem entra"), 14);
    await click(button("Voltar"), 12);
    expect(heading()).toBe("Como você quer começar o time?");
    expect(answer(/Começar com o Time Doug/).getAttribute("aria-checked")).toBe("true");
  });
});

describe('"Ensine a sua marca ao time"', () => {
  /** The team made: `brandPending` says its brand step waits (`GET /me`), so the rail puts it next. */
  const brandWaits = () => {
    const state = atStart({ brandState: { brand: null, pending: true } });
    if (state.me)
      state.me.organizations = [
        {
          id: ORG_ID,
          name: "Padaria Aurora",
          role: "owner",
          onboarding: { step: "brand" as OnboardingStepId, generalChannelId: GENERAL_ID, brandPending: true },
        },
      ];
    return state;
  };

  test("its name and tone are required; the server saves the workspace skill and the step is answered", async () => {
    const state = brandWaits();
    await renderApp("/onboarding", { api: createFakeApi(state) });
    await settle(16);
    expect(heading()).toBe("Ensine a sua marca ao time");
    // Nothing typed: Continuar waits.
    expect((button("Continuar") as HTMLButtonElement).disabled).toBe(true);
    await type("Nome da empresa", "Padaria Aurora");
    // A name alone is not enough: a tone is required.
    expect((button("Continuar") as HTMLButtonElement).disabled).toBe(true);
    await click(button("Divertido"), 4);
    expect((button("Continuar") as HTMLButtonElement).disabled).toBe(false);
    await type("Site", "padariaaurora.com.br");
    await click(button("Continuar"), 16);
    const [saved] = calls(state, "orgs.saveBrand");
    expect(saved?.args).toEqual([
      ORG_ID,
      {
        company: "Padaria Aurora",
        tones: ["divertido"],
        tone: null,
        site: "padariaaurora.com.br",
        instagram: null,
        audience: null,
        files: [],
        links: [],
      },
    ]);
    expect(state.brandState?.pending).toBe(false);
  });

  test("a written tone answers it too, and the site, the profile, the audience and the manual are optional", async () => {
    const state = brandWaits();
    await renderApp("/onboarding", { api: createFakeApi(state) });
    await settle(16);
    await type("Nome da empresa", "Padaria Aurora");
    await click(button("Escrever o seu"), 4);
    await type("Nas suas palavras: como a marca fala", "Fala como vizinha de bairro");
    await type("Instagram", "@padariaaurora");
    await click(button("Continuar"), 16);
    const [saved] = calls(state, "orgs.saveBrand");
    expect(saved?.args[1]).toMatchObject({
      company: "Padaria Aurora",
      tones: [],
      tone: "Fala como vizinha de bairro",
      instagram: "@padariaaurora",
      site: null,
    });
  });

  test("a brand already said comes back filled in, so going back to it changes nothing", async () => {
    const state = brandWaits();
    state.brandState = {
      pending: true,
      brand: {
        company: "Padaria Aurora",
        tones: ["divertido"],
        tone: null,
        site: "padariaaurora.com.br",
        instagram: null,
        audience: null,
        files: [],
        links: [],
      },
    };
    await renderApp("/onboarding", { api: createFakeApi(state) });
    await settle(16);
    expect((screen().getByLabelText("Nome da empresa") as HTMLInputElement).value).toBe("Padaria Aurora");
    expect((screen().getByLabelText("Site") as HTMLInputElement).value).toBe("padariaaurora.com.br");
    expect(button("Divertido").getAttribute("aria-pressed")).toBe("true");
  });
});
