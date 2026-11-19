import { afterEach, describe, expect, test } from "bun:test";
import { setupDom } from "@dougbot/ui/testing/dom";

setupDom();

import { act, cleanup, fireEvent, within } from "@testing-library/react";
import { pansBoard } from "@/components/portal/board-parts";
import { ADA_ID, createFakeApi, fakePortalOf, ORG_ID, seedState } from "./fake-api";
import type { FakePortal } from "./fakes/portal";
import { agencyMembers, fillAgency, JOAO, ME } from "./fakes/portal-agency";
import { renderApp, screen, settle } from "./render";

afterEach(() => {
  cleanup();
  localStorage.clear();
  sessionStorage.clear();
});

const go = async (path = "portal", seed: (portal: FakePortal) => void = fillAgency) => {
  const state = seedState({ authConfig: { approvalPortal: true } });
  const like = state.members[0];
  if (like) state.members.push(...agencyMembers(like));
  const api = createFakeApi(state);
  seed(fakePortalOf.get(api) as FakePortal);
  const app = await renderApp(`/org/${ORG_ID}/${path}`, { api });
  await settle(8);
  return { ...app, state };
};
const click = async (el: Element) => {
  await act(async () => fireEvent.click(el));
  await settle(4);
};
const main = () => document.querySelector(".portal") as HTMLElement;
const part = (name: string) => within(main()).getByRole("region", { name });
const tile = (name: string) => within(part("Agora")).getByRole("button", { name: new RegExp(name) });
const column = (name: string) =>
  main().querySelector(`.portal-pipeline .issues-col[aria-label="${name}"]`) as HTMLElement;
const cards = (name: string) => [...column(name).querySelectorAll(".issue-card__title")].map((c) => c.textContent);
const allCards = () => [...main().querySelectorAll(".portal-pipeline .issue-card__title")].map((c) => c.textContent);
const row = (client: string) => within(part("Clientes")).getByRole("link", { name: new RegExp(`^${client}`) });
const pick = async (field: HTMLElement, option: string | RegExp) => {
  field.focus();
  await act(async () => fireEvent.keyDown(field, { key: "Enter" }));
  await click(screen().getByRole("option", { name: option }));
};
/** The agency's portal with two cards' tasks known, the first of them an agent's. */
const withTasks = (portal: FakePortal) => {
  fillAgency(portal);
  for (const [cardId, number] of [
    ["c-00a001", 41],
    ["c-00b001", 42],
  ] as const) {
    const made = portal.cards.find((c) => c.id === cardId);
    if (made) made.task = `i-0000${number}`;
    portal.tasks.push({ cardId, id: `i-0000${number}`, number });
  }
  const first = portal.cards.find((c) => c.id === "c-00a001");
  if (first) first.members = [ADA_ID, JOAO];
};

describe("the portal's first screen", () => {
  test("Agora: four numbers with their line of context; only Precisa de você takes the attention tone", async () => {
    await go();
    const tiles = [...part("Agora").querySelectorAll(".portal-tile")].map((el) => [
      el.querySelector(".portal-tile__name")?.textContent,
      el.querySelector(".portal-tile__num")?.textContent,
      el.querySelector(".portal-tile__hint")?.textContent,
    ]);
    expect(tiles).toEqual([
      // One adjustment asked (itself past its day) and one more late card: two things wait on the team.
      ["Precisa de você", "2", "Em ajuste 1 · Atrasadas 2"],
      ["Em produção", "5", "A produzir 2 · Em produção 3"],
      ["Com o cliente", "4", "Esperando a resposta dele"],
      ["Para agendar", "4", "1 agendado"],
    ]);
    expect(
      [...part("Agora").querySelectorAll(".portal-tile[data-attention]")].map((el) => el.getAttribute("data-focus")),
    ).toEqual(["you"]);
    expect(main().querySelector(".ac-pagehead")?.textContent).toContain("5 clientes");
  });

  test("Clientes: a card each with its mark, the one thing that matters most, its work along the line, who and when", async () => {
    await go();
    const names = [...part("Clientes").querySelectorAll(".portal-clientcard__name")].map((n) => n.textContent);
    // Who waits on the team first, then the busiest (by name among equals); nothing open last.
    expect(names).toEqual(["Acme", "Norte Moveis", "Orla Cafe", "Zeta", "Vila Pet"]);
    const sentence = (client: string) => row(client).querySelector(".portal-clientcard__status");
    expect(sentence("Acme")?.textContent).toBe("1 ajuste pedido");
    expect(sentence("Norte Moveis")?.textContent).toBe("3 para agendar");
    expect(sentence("Orla Cafe")?.textContent).toBe("3 com o cliente");
    expect(sentence("Zeta")?.textContent).toBe("Em produção");
    expect(sentence("Vila Pet")?.textContent).toBe("Sem trabalho aberto");
    // Only what waits on the team takes the attention tone.
    expect(sentence("Acme")?.hasAttribute("data-attention")).toBe(true);
    expect(sentence("Norte Moveis")?.hasAttribute("data-attention")).toBe(false);

    const acme = row("Acme");
    expect(acme.getAttribute("href")).toBe(`/org/${ORG_ID}/portal?client=acme`);
    // The boards' own card.
    expect(acme.classList.contains("portal-card")).toBe(true);
    expect(acme.querySelector(".portal-mark")?.textContent).toBe("A");
    expect(row("Norte Moveis").querySelector(".portal-mark")?.textContent).toBe("NM");
    expect(acme.querySelector(".portal-clientcard__open")?.textContent).toBe("6 em aberto");
    // Six stages, always, in the pipeline's order: each one's name beside how many it has, the empty ones stepped back.
    const steps = (client: string) =>
      [...row(client).querySelectorAll(".portal-stat")].map((s) => [
        s.getAttribute("data-stage"),
        s.querySelector(".portal-stat__num")?.textContent,
        s.hasAttribute("data-empty"),
      ]);
    expect(steps("Acme")).toEqual([
      ["todo", "1", false],
      ["doing", "1", false],
      ["approval", "1", false],
      ["adjusting", "1", false],
      ["approved", "1", false],
      ["scheduled", "1", false],
    ]);
    expect(steps("Zeta")).toEqual([
      ["todo", "1", false],
      ["doing", "2", false],
      ["approval", "0", true],
      ["adjusting", "0", true],
      ["approved", "0", true],
      ["scheduled", "0", true],
    ]);
    expect(row("Zeta").querySelector('.portal-stat[data-stage="doing"]')?.textContent).toBe("Em produção2");
    // Four people across Acme's work, each once, and its next post.
    expect(acme.querySelectorAll(".portal-clientcard__people .ac-avatar").length).toBe(4);
    expect(acme.querySelector(".portal-clientcard__next")?.textContent).toMatch(/^Próximo post\d+ de .*18:00$/);
    expect(row("Norte Moveis").querySelector(".portal-clientcard__next")).toBeNull();
    // Nothing open: the same card, six hollow stops, no count, no foot, and no bar anywhere.
    const idle = row("Vila Pet");
    expect(idle.hasAttribute("data-idle")).toBe(true);
    expect(steps("Vila Pet").map((s) => s[2])).toEqual([true, true, true, true, true, true]);
    expect(idle.querySelector(".portal-clientcard__open")).toBeNull();
    expect(idle.querySelector(".portal-clientcard__foot")).toBeNull();
    expect(main().querySelector(".portal-bar")).toBeNull();
    // One legend of the stages' colours under the grid.
    expect([...part("Clientes").querySelectorAll(".portal-stagechip")].map((c) => c.textContent)).toEqual([
      "A produzir",
      "Em produção",
      "Para aprovação",
      "Em ajuste",
      "Aprovado",
      "Agendado",
    ]);
  });

  test("Esteira: every client's open work in the boards' own columns, each card saying its client first", async () => {
    const { router } = await go();
    expect(
      [...main().querySelectorAll(".portal-pipeline .issues-col")].map((c) => c.getAttribute("aria-label")),
    ).toEqual(["A produzir", "Em produção", "Para aprovação", "Em ajuste", "Aprovado", "Agendado"]);
    expect(allCards().length).toBe(15);
    expect(cards("Em ajuste")).toEqual(["Depoimento da aluna Júlia"]);
    const asked = within(column("Em ajuste")).getByRole("article", { name: "Acme: Depoimento da aluna Júlia" });
    expect([...asked.querySelectorAll(".ac-chip")].map((c) => c.textContent)).toEqual(["Acme", "Reel", "atrasada"]);
    expect(asked.querySelector(".portal-card__note--asked")?.textContent).toBe(
      "O cliente pediuTrocar a música e cortar os 3 segundos finais.",
    );
    expect(asked.querySelectorAll(".portal-card__who .ac-avatar").length).toBe(2);
    // The same card as the boards', read only: nothing to press on it but the card itself.
    expect(asked.classList.contains("portal-card")).toBe(true);
    expect(asked.querySelector("button")).toBeNull();
    // The board's empty space pans it, as on the other boards.
    expect(pansBoard(column("Em ajuste"))).toBe(true);
    expect(pansBoard(asked)).toBe(false);

    await click(asked);
    expect(router.state.location.search).toEqual({ client: "acme", tab: "plan", card: "c-00a001" });
  });

  test("every card is a task: its number on the pipeline's cards and rows, an agent among who is on it", async () => {
    await go("portal", withTasks);
    const asked = within(column("Em ajuste")).getByRole("article", { name: "Acme: Depoimento da aluna Júlia" });
    const number = asked.querySelector(".ac-factline__fact");
    expect(number?.textContent).toBe("#41");
    expect(number?.getAttribute("title")).toBe("Tarefa #41");
    // The agent that has it first, with its own face, then the person.
    const faces = [...asked.querySelectorAll(".portal-card__who .ac-avatar")];
    expect(faces.length).toBe(2);
    expect(faces[0]?.classList.contains("ac-avatar--agent")).toBe(true);
    // A card whose task isn't known says no number, and neither does a post with no card.
    const plain = within(column("A produzir")).getByRole("article", { name: "Acme: Story de enquete: qual treino?" });
    expect(plain.textContent).not.toContain("#");
    expect(within(part("Esteira")).getByRole("link", { name: "Ver todas as tarefas" }).getAttribute("href")).toBe(
      `/org/${ORG_ID}/issues`,
    );

    await click(within(part("Esteira")).getByRole("button", { name: "Lista" }));
    const table = within(part("Esteira")).getByRole("table");
    const titled = within(table).getByRole("link", { name: "Tour pelo novo showroom" }).closest("td");
    expect(titled?.querySelector(".portal-table__task")?.textContent).toBe("#42");
  });

  test("Nova tarefa: a client, a title and an agent as the one responsible make a card, which is a task", async () => {
    const { state } = await go("portal", withTasks);
    await click(within(part("Esteira")).getByRole("button", { name: "Nova tarefa" }));
    const dialog = screen().getByRole("dialog", { name: "Nova tarefa" });
    const save = within(dialog).getByRole("button", { name: "Salvar" }) as HTMLButtonElement;
    expect(save.disabled).toBe(true);
    await act(async () =>
      fireEvent.change(within(dialog).getByLabelText("Título"), { target: { value: "Reel dos bastidores" } }),
    );
    await pick(within(dialog).getByRole("combobox", { name: "Cliente" }), "Zeta");
    expect(dialog.textContent).not.toContain("O agente começa a trabalhar nela na hora.");
    await pick(within(dialog).getByRole("combobox", { name: "Responsável" }), /^Ada/);
    expect(dialog.textContent).toContain("O agente começa a trabalhar nela na hora.");
    await click(save);
    expect(state.calls.filter((c) => c.method === "portal.createCard").map((c) => c.args[1])).toEqual([
      expect.objectContaining({ client: "zeta", title: "Reel dos bastidores", members: [ADA_ID] }),
    ]);
    expect(screen().queryByRole("dialog", { name: "Nova tarefa" })).toBeNull();
    // On the pipeline at once, with its task's number (the one after the workspace's last).
    const made = within(column("A produzir")).getByRole("article", { name: "Zeta: Reel dos bastidores" });
    expect(made.querySelector(".ac-factline__fact")?.textContent).toBe("#43");
    expect(made.querySelector(".portal-card__who .ac-avatar--agent")).not.toBeNull();
  });

  test("without the permission to give agents work there is no Nova tarefa, and the way to the tasks stays", async () => {
    const state = seedState({ authConfig: { approvalPortal: true } });
    const org = state.me?.organizations[0];
    if (org) org.permissions = ["read", "post"];
    const api = createFakeApi(state);
    fillAgency(fakePortalOf.get(api) as FakePortal);
    await renderApp(`/org/${ORG_ID}/portal`, { api });
    await settle(8);
    expect(within(part("Esteira")).queryByRole("button", { name: "Nova tarefa" })).toBeNull();
    expect(within(part("Esteira")).getByRole("link", { name: "Ver todas as tarefas" })).toBeTruthy();
  });

  test("a post with no card opens its client's board", async () => {
    const { router } = await go();
    await click(within(column("Para aprovação")).getByRole("article", { name: "Orla Cafe: Happy hour de quinta" }));
    expect(router.state.location.search).toEqual({ client: "orla-cafe" });
  });

  test("a tile filters the pipeline, says so in the address, and a second press shows everything again", async () => {
    const { router } = await go();
    await click(tile("Precisa de você"));
    expect(router.state.location.search).toEqual({ stage: "you" });
    expect(tile("Precisa de você").getAttribute("aria-pressed")).toBe("true");
    expect(allCards().sort()).toEqual(["Depoimento da aluna Júlia", "Story de enquete: qual treino?"]);
    // The same filter as a chip over the board.
    expect(within(part("Esteira")).getByRole("button", { name: /Precisa de você/, pressed: true })).toBeTruthy();
    await click(tile("Precisa de você"));
    expect(router.state.location.search).toEqual({});
    expect(allCards().length).toBe(15);

    await click(within(part("Esteira")).getByRole("button", { name: /Para agendar/ }));
    expect(router.state.location.search).toEqual({ stage: "schedule" });
    expect(cards("Aprovado").length).toBe(4);
    expect(allCards().length).toBe(4);
  });

  test("Só eu and one client, shared by the address", async () => {
    await go("portal?who=me");
    expect(allCards().sort()).toEqual([
      "Carrossel de receitas rápidas",
      "Reel: lançamento da linha de inverno",
      "Story de enquete: qual treino?",
      "Tour pelo novo showroom",
    ]);
    expect(within(part("Esteira")).getByRole("combobox", { name: "Pessoa" }).textContent).toContain("Só eu");
    cleanup();
    await go("portal?of=zeta&who=u-caio");
    expect(allCards().sort()).toEqual(["Depoimento do arquiteto", "Tour pelo novo showroom"]);
    expect(within(part("Esteira")).getByRole("combobox", { name: "Cliente" }).textContent).toContain("Zeta");
    expect(within(part("Esteira")).getByRole("combobox", { name: "Pessoa" }).textContent).toContain("Caio");
  });

  test("Lista: the same work as a table by stage, sorted by production day, turned around from its head", async () => {
    const { router } = await go();
    await click(within(part("Esteira")).getByRole("button", { name: "Lista" }));
    expect(router.state.location.search).toEqual({ view: "list" });
    expect(main().querySelector(".portal-pipeline")).toBeNull();
    const table = within(part("Esteira")).getByRole("table");
    expect(
      within(table)
        .getAllByRole("columnheader")
        .slice(0, 6)
        .map((h) => h.textContent),
    ).toEqual(["Cliente", "Título", "Tipo", "Responsáveis", "Produção", "Post"]);
    const group = (stage: string) => table.querySelector(`tbody[data-group="${stage}"]`) as HTMLElement;
    const titles = (stage: string) =>
      [...group(stage).querySelectorAll(".portal-table__title")].map((c) => c.textContent);
    expect(group("doing").querySelector(".portal-table__group")?.textContent).toBe("Em produção3");
    expect(titles("doing")).toEqual([
      "Reel: lançamento da linha de inverno",
      "Tour pelo novo showroom",
      "Carrossel: antes e depois",
    ]);
    expect(group("todo").querySelector("tr[data-late] .portal-table__late")?.textContent).toContain("atrasada");
    const link = within(group("doing")).getByRole("link", { name: "Tour pelo novo showroom" });
    expect(link.getAttribute("href")).toBe(`/org/${ORG_ID}/portal?client=zeta&tab=plan&card=c-00b001`);
    await click(within(table).getByRole("button", { name: /Produção/ }));
    expect(titles("doing")).toEqual([
      "Carrossel: antes e depois",
      "Tour pelo novo showroom",
      "Reel: lançamento da linha de inverno",
    ]);
  });

  test("filters that match nothing say so, and Limpar filtros shows everything again", async () => {
    const { router } = await go("portal?of=zeta&stage=schedule&view=list");
    expect(within(part("Esteira")).getByText("Nada com esses filtros")).toBeTruthy();
    expect(within(part("Esteira")).queryByRole("table")).toBeNull();
    await click(within(part("Esteira")).getByRole("button", { name: "Limpar filtros" }));
    // The view chosen stays.
    expect(router.state.location.search).toEqual({ view: "list" });
    expect(within(part("Esteira")).getByRole("table")).toBeTruthy();
  });

  test("clients with nothing open at all: the rows say so and the pipeline says nothing is open", async () => {
    await go("portal", (p) => {
      p.clients = ["acme", "zeta"];
    });
    expect([...part("Clientes").querySelectorAll(".portal-clientcard__status")].map((s) => s.textContent)).toEqual([
      "Sem trabalho aberto",
      "Sem trabalho aberto",
    ]);
    expect([...part("Agora").querySelectorAll(".portal-tile__num")].map((n) => n.textContent)).toEqual([
      "0",
      "0",
      "0",
      "0",
    ]);
    expect(part("Agora").querySelector(".portal-tile[data-attention]")).toBeNull();
    expect(within(part("Esteira")).getByText("Nada em aberto")).toBeTruthy();
  });

  test("my own id in the address reads as Só eu", async () => {
    await go(`portal?who=${ME}`);
    expect(within(part("Esteira")).getByRole("combobox", { name: "Pessoa" }).textContent).toContain("Só eu");
    expect(screen().queryByText("Nada com esses filtros")).toBeNull();
  });
});
