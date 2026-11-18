import { afterEach, describe, expect, test } from "bun:test";
import { setupDom } from "@agenteschat/ui/testing/dom";

setupDom();

import type { DougTemplateMember, TeamTemplate } from "@agenteschat/client";
import type { OnboardingStepId } from "@agenteschat/client/lib/onboarding";
import { act, cleanup, fireEvent } from "@testing-library/react";
import { BrandStep } from "@/pages/onboarding/BrandStep";
import { createFakeApi, type FakeState, fakeDevicesOf, GENERAL_ID, ORG_ID, seedState, withRightHand } from "./fake-api";
import { renderApp, renderPage, screen, settle } from "./render";

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

/** A business's own template, beside the Doug team's: the "time pronto" step must never fall on the doug. */
const AGENCY: TeamTemplate = {
  id: "agency",
  name: "Agência",
  sub: "Contas, criação e mídia",
  description: "Para uma agência.",
  team: {
    lead: "Um time para a agência.",
    agents: [
      {
        name: "Íris",
        handle: "iris",
        role: "Atendimento",
        line: "Íris cuida das contas.",
        instructions: "Atendimento",
        appearance: null,
        channel: "contas",
        routines: [],
        firstTask: null,
      },
    ],
    newChannels: ["contas"],
    skills: [],
    weekly: null,
    approvals: "",
    invite: [],
  },
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
  state.teamTemplates = [DOUG, AGENCY];
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
    // The summary above the list: a label under its number, and the number said once (a `dt` before its `dd`).
    const side = document.querySelector(".onb-who__side") as HTMLElement;
    expect(side.textContent).toContain("agentes no time");
    expect(side.querySelector("dd")?.textContent).toBe("5");
    expect(side.querySelector("dt")?.textContent).toBe("agentes no time");
    // The number said once: never inside the label too.
    expect(side.querySelector("dt")?.textContent).not.toContain("5");
    expect(side.textContent).toContain("skills de ofício");
  });

  test("unchecking a box moves the count and the handles sent to the server, the right hand always kept", async () => {
    const state = atStart();
    await howStart(state);
    await click(button("Escolher quem entra"), 14);
    // The box in ROSA's row (its label is the whole row's words, so the row finds it).
    const rosa = rowOf("ROSA").querySelector("[role='checkbox']") as HTMLElement;
    await click(rosa, 6);
    expect(document.querySelector(".onb-who__counts dd")?.textContent).toBe("4");
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

  test("every box unchecked: there is no team to make, so the button waits and says why", async () => {
    const state = atStart();
    await howStart(state);
    await click(button("Escolher quem entra"), 14);
    // Uncheck ROSA, the MARK (its team with it) and the Operador, the right hand staying: nothing is left to create.
    await click(rowOf("ROSA").querySelector("[role='checkbox']") as HTMLElement, 6);
    await click(rowOf("MARK").querySelector("[role='checkbox']") as HTMLElement, 6);
    // The right hand alone in the list, and the button can't press: the words say what it still waits for.
    expect(document.querySelector(".onb-who__counts dd")?.textContent).toBe("1");
    const create = button("Criar o time") as HTMLButtonElement;
    expect(create.disabled).toBe(true);
    expect(document.querySelector(".onb__help")?.textContent).toBe("Marque pelo menos um agente do Time Doug.");
    // Pressing it anyway makes nothing: the step stays where it is.
    await click(create, 10);
    expect(calls(state, "agents.applyTeamTemplate")).toHaveLength(0);
    expect(heading()).toBe("Quem entra no seu time?");
  });

  test("Back goes to how the team starts, its card still picked", async () => {
    await howStart(atStart());
    await click(button("Escolher quem entra"), 14);
    await click(button("Voltar"), 12);
    expect(heading()).toBe("Como você quer começar o time?");
    expect(answer(/Começar com o Time Doug/).getAttribute("aria-checked")).toBe("true");
  });
});

describe("a server newer than the Doug team", () => {
  test("the doug is never the 'time pronto' template, nor in the select's list", async () => {
    // A gallery that still lists the doug (an older server): the templates behind the "ready-made" step skip it.
    const state = atStart();
    const app = createFakeApi(state);
    await renderApp("/onboarding", { api: app });
    await settle(14);
    // "Start with a ready-made team", then its button: the step shows the agency's team, never the doug's.
    await click(answer(/Começar com um time pronto/), 4);
    await click(button("Ver o time pronto"), 8);
    await settle(6);
    expect(heading()).toBe("Seu time");
    const select = screen().getByRole("combobox", { name: "Modelos de time" });
    expect(select.textContent).toContain("Agência");
    expect(select.textContent).not.toContain("Time Doug");
    // The team plan shown is the agency's (Íris), never a doug member (ROSA).
    expect(document.querySelector(".tp-agents")?.textContent).toContain("Íris");
    expect(document.querySelector(".tp-agents")?.textContent).not.toContain("ROSA");
  });
});

describe('the rail while "Quem entra" is on screen', () => {
  test('"Seu time" carries no "Depois" while the team is being made', async () => {
    await howStart(atStart());
    await click(button("Escolher quem entra"), 14);
    const team = [...document.querySelectorAll(".onb__step")].find((s) => s.textContent?.includes("Seu time"));
    expect(team?.textContent).not.toContain("Depois");
  });

  test('"Seu time" on the rail, from "Quem entra", returns to how the team starts, its card still picked', async () => {
    await howStart(atStart());
    await click(button("Escolher quem entra"), 14);
    expect(heading()).toBe("Quem entra no seu time?");
    const team = [...document.querySelectorAll(".onb__step")].find((s) => s.textContent?.includes("Seu time"));
    await click(team as HTMLElement, 12);
    expect(heading()).toBe("Como você quer começar o time?");
    expect(answer(/Começar com o Time Doug/).getAttribute("aria-checked")).toBe("true");
  });

  test("the eyebrow and the count move together, the same index+1", async () => {
    await howStart(atStart());
    await click(button("Escolher quem entra"), 14);
    const eyebrow = document.querySelector(".onb__eyebrow")?.textContent ?? "";
    const count = document.querySelector(".onb__progress-text")?.textContent ?? "";
    // "Passo 5 de 7" beside "5 de 7".
    const n = eyebrow.match(/Passo (\d+) de (\d+)/);
    expect(n).not.toBeNull();
    expect(count).toContain(`${n?.[1]} de ${n?.[2]}`);
    // "Faltam" is the steps from this one on (the current included).
    const left = Number(n?.[2]) - Number(n?.[1]) + 1;
    expect(count).toContain(left === 1 ? "Falta 1 etapa" : `Faltam ${left} etapas`);
  });
});

describe('"Quem entra": its choices and its computer', () => {
  test("the choices survive Back: unchecking ROSA and coming back finds it unchecked", async () => {
    await howStart(atStart());
    await click(button("Escolher quem entra"), 14);
    const rosa = rowOf("ROSA").querySelector("[role='checkbox']") as HTMLElement;
    await click(rosa, 6);
    expect(rosa.getAttribute("data-state")).toBe("unchecked");
    await click(button("Voltar"), 12);
    expect(heading()).toBe("Como você quer começar o time?");
    await click(button("Escolher quem entra"), 14);
    expect((rowOf("ROSA").querySelector("[role='checkbox']") as HTMLElement).getAttribute("data-state")).toBe(
      "unchecked",
    );
  });

  test("unchecking the MARK unchecks and switches off its whole team", async () => {
    await howStart(atStart());
    await click(button("Escolher quem entra"), 14);
    const mark = rowOf("MARK").querySelector("[role='checkbox']") as HTMLElement;
    await click(mark, 6);
    expect(mark.getAttribute("data-state")).toBe("unchecked");
    // Its two are off too, and their own boxes can't be pressed until it's back on.
    for (const name of ["Copywriter", "Operador"]) {
      const box = rowOf(name).querySelector("[role='checkbox']") as HTMLElement;
      expect(box.getAttribute("data-state")).toBe("unchecked");
      expect((box as HTMLButtonElement).disabled).toBe(true);
    }
    // The list's count says only the right hand and ROSA are in it.
    expect(document.querySelector(".onb-who__counts dd")?.textContent).toBe("2");
    // The MARK's team carries no "Depois" on the rail either: it's the agent count, not the step's answer.
    await click(mark, 6);
    expect(document.querySelector(".onb-who__counts dd")?.textContent).toBe("5");
  });

  test("connecting a computer opens the app's own flow over the step, never leaving it", async () => {
    await howStart(atStart());
    await click(button("Escolher quem entra"), 14);
    const row = rowOf("ROSA");
    const connect = [...row.querySelectorAll("button")].find((b) => b.textContent === "Conectar computador");
    await click(connect as HTMLElement, 12);
    // The Connect flow's chooser is over the step, which stays behind it.
    expect(screen().getByRole("dialog")).toBeTruthy();
    expect(document.querySelector(".onb__title")?.textContent).toBe("Quem entra no seu time?");
  });

  test("with a computer in the workspace, what needs one stops saying so", async () => {
    const state = atStart();
    const app = createFakeApi(state);
    const devices = fakeDevicesOf.get(app) as NonNullable<ReturnType<typeof fakeDevicesOf.get>>;
    devices.set({
      devices: [
        {
          id: "00000000-0000-4000-8000-000000000901",
          machineKind: "connected",
          name: "Escritório",
          os: "linux",
          arch: "x64",
          hostname: "office-1",
          cpus: null,
          memoryGb: null,
          ownerUserId: null,
          belongsToWorkspace: true,
          spill: { own: true, others: false },
          systemMode: false,
          audience: { mode: "everyone", userIds: [], roleIds: [] },
          status: { kind: "ready" },
          maxTasks: 1,
          toolchains: {},
          lastSeenAt: new Date().toISOString(),
          mayUse: true,
          mayManage: true,
          phones: [],
        },
      ],
      requests: [],
    });
    await renderApp("/onboarding", { api: app });
    await settle(14);
    await click(button("Escolher quem entra"), 14);
    expect(rowOf("ROSA").textContent).not.toContain("precisa de um computador conectado");
  });
});

describe("making the Doug team", () => {
  /** The brand waiting: the server's answer once the team is made, so the rail puts "Sua marca" next. */
  const brandPending = (state: FakeState) => {
    if (state.me)
      state.me.organizations = state.me.organizations.map((o) =>
        o.id === ORG_ID && o.onboarding ? { ...o, onboarding: { ...o.onboarding, brandPending: true } } : o,
      );
    return state;
  };

  test("creating the team goes to the brand step, the rail reading it from `/me` before asking again", async () => {
    const state = atStart();
    if (state.me)
      state.me.organizations = state.me.organizations.map((o) =>
        o.id === ORG_ID && o.onboarding ? { ...o, onboarding: { ...o.onboarding } } : o,
      );
    const app = createFakeApi(state);
    await renderApp("/onboarding", { api: app });
    await settle(14);
    await click(button("Escolher quem entra"), 14);
    await click(button("Criar o time"), 20);
    // The brand step, never a flash to "connect an AI" between the team and it: the rail read `brandPending` from the
    // answer, not from a `/me` that hadn't arrived.
    expect(heading()).toBe("Ensine a sua marca ao time");
    // The team was made once, its agents read again.
    expect(calls(state, "agents.applyTeamTemplate")).toHaveLength(1);
  });

  test("the brand step's note names the agents that need a computer, and its button opens the flow", async () => {
    // The team made here, in this visit: ROSA and Operador need one (the template says so) and none is connected.
    const state = atStart();
    await renderApp("/onboarding", { api: createFakeApi(state) });
    await settle(14);
    await click(button("Escolher quem entra"), 14);
    await click(button("Criar o time"), 20);
    expect(heading()).toBe("Ensine a sua marca ao time");
    // The note on the brand step names them.
    const note = [...document.querySelectorAll(".onb-brand .onb__status")].map((n) => n.textContent).join(" ");
    expect(note).toContain("Falta um computador conectado");
    expect(note).toContain("ROSA");
  });

  test("its Connect opens the app's own flow over the brand, never dropping the step", async () => {
    // Made here, so the step after it keeps the agents it named (the answer's computers, not the template's).
    await renderApp("/onboarding", { api: createFakeApi(atStart()) });
    await settle(14);
    await click(button("Escolher quem entra"), 14);
    await click(button("Criar o time"), 20);
    expect(heading()).toBe("Ensine a sua marca ao time");
    // The note's own link ("Conecte um computador"), not the step's Continuar.
    const connect = [...document.querySelectorAll(".onb-brand button")].find(
      (b) => b.textContent === "Conectar computador",
    ) as HTMLElement;
    expect(connect).toBeTruthy();
    await click(connect, 12);
    // The Connect flow's chooser is over the step, which stays behind it: the brand's form is still there.
    expect(screen().getByRole("dialog")).toBeTruthy();
    expect(document.querySelector(".onb__title")?.textContent).toBe("Ensine a sua marca ao time");
  });

  test("the brand waiting with no team read yet: the rail is on its brand, never back on who joins", async () => {
    // The server keeps the wait, and the agents read late (or are still the right hand's alone here).
    const state = brandPending(atStart());
    await renderApp("/onboarding", { api: createFakeApi(state) });
    await settle(16);
    expect(heading()).toBe("Ensine a sua marca ao time");
    const steps = [...document.querySelectorAll(".onb__step")].map((s) => s.textContent ?? "");
    expect(steps.some((s) => s.includes("Quem entra"))).toBe(false);
    const brand = steps.find((s) => s.includes("Sua marca"));
    expect(brand).toBeTruthy();
    // "Seu time" carries no "Depois": the team was made, the brand is what waits, so the step is never read as skipped.
    expect(steps.find((s) => s.includes("Seu time"))).not.toContain("Depois");
  });

  test("409 `doug_team.made`: the step goes on as if this press made it, the error cleared", async () => {
    // Made in another tab while this one was on "Quem entra": the server refuses, and `/me` says its brand waits.
    const state = atStart({ dougMade: true });
    await renderApp("/onboarding", { api: createFakeApi(state) });
    await settle(14);
    await click(button("Escolher quem entra"), 14);
    await click(button("Criar o time"), 20);
    // Made meanwhile: no error left behind, and the step went on: the brand is next, as if this press had made it.
    expect(document.querySelector(".onb__error")).toBeNull();
    expect(calls(state, "agents.applyTeamTemplate")).toHaveLength(1);
    expect(heading()).toBe("Ensine a sua marca ao time");
  });

  test("a second press while the team is being made never makes a second one", async () => {
    const state = atStart();
    const app = createFakeApi(state);
    await renderApp("/onboarding", { api: app });
    await settle(14);
    await click(button("Escolher quem entra"), 14);
    const create = button("Criar o time") as HTMLButtonElement;
    await act(async () => {
      fireEvent.click(create);
      fireEvent.click(create);
    });
    await settle(20);
    expect(calls(state, "agents.applyTeamTemplate")).toHaveLength(1);
  });
});

describe('"Ensine a sua marca ao time"', () => {
  /** The team made: `brandPending` says its brand step waits (`GET /me`), so the rail puts it next. */
  const brandWaits = (extra: Partial<FakeState> = {}) => {
    const state = atStart({ brandState: { brand: null, pending: true }, ...extra });
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
    // Nothing typed: Continuar waits, and says what it waits for.
    expect((button("Continuar") as HTMLButtonElement).disabled).toBe(true);
    expect(document.body.textContent).toContain("Diga o nome da empresa.");
    await type("Nome da empresa", "Padaria Aurora");
    // A name alone is not enough: a tone is required.
    expect((button("Continuar") as HTMLButtonElement).disabled).toBe(true);
    expect(document.body.textContent).toContain("Escolha um tom de voz ou escreva com as suas palavras.");
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

  test("the save moves the step on: the fake answers `brandPending: false` and the rail goes past it", async () => {
    const state = brandWaits();
    await renderApp("/onboarding", { api: createFakeApi(state) });
    await settle(16);
    await type("Nome da empresa", "Padaria Aurora");
    await click(button("Divertido"), 4);
    await click(button("Continuar"), 18);
    // Saved: `GET /me` reads it answered (the rail no longer on "Sua marca"), the step answered.
    expect(state.brandState?.pending).toBe(false);
    expect(heading()).not.toBe("Ensine a sua marca ao time");
  });

  test("'Not now' isn't offered: the brand is required, so there is only Continuar", async () => {
    const state = brandWaits();
    await renderApp("/onboarding", { api: createFakeApi(state) });
    await settle(16);
    expect(screen().queryByRole("button", { name: "Conto depois" })).toBeNull();
    expect(document.querySelector(".onb__skip")).toBeNull();
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

  test("a skeleton while the brand loads, and a retry if it fails", async () => {
    const failing = brandWaits({ brandError: new Error("offline") });
    const app = createFakeApi(failing);
    await renderApp("/onboarding", { api: app });
    await settle(16);
    expect(document.body.textContent).toContain("Algo deu errado");
    expect(screen().getByRole("button", { name: "Tentar de novo" })).toBeTruthy();
    // Read again, it comes: the form is there, never a blank one that overwrote anything.
    failing.brandError = undefined;
    await click(screen().getByRole("button", { name: "Tentar de novo" }), 10);
    expect((screen().getByLabelText("Nome da empresa") as HTMLInputElement).value).toBe("");
  });

  test("a pasted link and a written tone, never added by their buttons, go in the save all the same", async () => {
    const state = brandWaits();
    await renderApp("/onboarding", { api: createFakeApi(state) });
    await settle(16);
    await type("Nome da empresa", "Padaria Aurora");
    // A link pasted into its field, and the person goes straight to Continuar: never pressed "Adicionar".
    await click(button("Colar um link"), 4);
    await type("Colar um link", "padariaaurora.com.br/marca");
    // A tone written, its chip leaving the field open: what was typed counts.
    await click(button("Escrever o seu"), 4);
    await type("Nas suas palavras: como a marca fala", "Fala como vizinha de bairro");
    await click(button("Continuar"), 16);
    const [saved] = calls(state, "orgs.saveBrand");
    expect(saved?.args[1]).toMatchObject({
      company: "Padaria Aurora",
      tone: "Fala como vizinha de bairro",
      // The pasted link is in the save, not left behind in its field: the server takes it with the rest.
      links: ["padariaaurora.com.br/marca"],
    });
  });

  test("a read that fails after the brand was here keeps the form, never the error state", async () => {
    // The step itself, its data in hand and a refetch that failed: what the person typed over stays on screen.
    await renderPage(
      <BrandStep
        orgId={ORG_ID}
        state={{
          pending: true,
          brand: {
            company: "Padaria Aurora",
            tones: ["divertido"],
            tone: null,
            site: null,
            instagram: null,
            audience: null,
            files: [],
            links: [],
          },
          skillId: null,
          tones: [],
        }}
        error={new Error("offline")}
        onRetry={() => {}}
        computerNote={null}
        onConnectComputer={() => {}}
        onSaved={() => {}}
      />,
      { api: createFakeApi(seedState()) },
    );
    expect((screen().getByLabelText("Nome da empresa") as HTMLInputElement).value).toBe("Padaria Aurora");
    expect(screen().queryByRole("button", { name: "Tentar de novo" })).toBeNull();
    expect(screen().queryByRole("alert")).toBeNull();
  });

  test("an upload that fails says so under the list; the brand never saved, the step waits", async () => {
    const state = brandWaits({ uploadFails: "manual" });
    await renderApp("/onboarding", { api: createFakeApi(state) });
    await settle(16);
    await type("Nome da empresa", "Padaria Aurora");
    await click(button("Divertido"), 4);
    const pick = document.querySelector(".onb-brand input[type='file']") as HTMLInputElement;
    const file = new File(["x"], "manual.pdf", { type: "application/pdf" });
    await act(async () => fireEvent.change(pick, { target: { files: [file] } }));
    await settle(8);
    const alert = document.querySelector(".onb-brand [role='alert']");
    expect(alert?.textContent).toContain("Não foi enviado");
    // No file kept: the save sends none.
    await click(button("Continuar"), 16);
    const [saved] = calls(state, "orgs.saveBrand");
    expect(saved?.args[1]).toMatchObject({ files: [] });
  });

  test("the manual's file reaches the save with its Drive id", async () => {
    const state = brandWaits();
    await renderApp("/onboarding", { api: createFakeApi(state) });
    await settle(16);
    await type("Nome da empresa", "Padaria Aurora");
    await click(button("Divertido"), 4);
    const pick = document.querySelector(".onb-brand input[type='file']") as HTMLInputElement;
    const file = new File(["x"], "manual.pdf", { type: "application/pdf" });
    await act(async () => fireEvent.change(pick, { target: { files: [file] } }));
    await settle(8);
    // The list shows it, "Enviado" under its name.
    const row = document.querySelector(".onb-brand__file") as HTMLElement;
    expect(row.textContent).toContain("manual.pdf");
    expect(row.textContent).toContain("Enviado");
    await click(button("Continuar"), 16);
    const saved = calls(state, "orgs.saveBrand")[0]?.args[1] as { files: string[] } | undefined;
    expect(saved?.files).toHaveLength(1);
    // The fake honours `files`: the saved brand reads it back.
    expect(state.brandState?.brand?.files).toHaveLength(1);
  });
});
