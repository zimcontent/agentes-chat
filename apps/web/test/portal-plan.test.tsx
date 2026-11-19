import { afterEach, describe, expect, test } from "bun:test";
import { setupDom } from "@agenteschat/ui/testing/dom";

setupDom();

import { ApiError } from "@agenteschat/client";
import { peekDraft } from "@agenteschat/client/lib/drafts";
import { act, cleanup, fireEvent, within } from "@testing-library/react";
import { orderAfterDrop, pansBoard } from "@/components/portal/board-parts";
import { ADA_ID, createFakeApi, fakePortalOf, meWithRole, ORG_ID, seedState } from "./fake-api";
import { type FakePortal, portalCard, portalItem } from "./fakes/portal";
import { renderApp, screen, settle } from "./render";

afterEach(() => {
  cleanup();
  localStorage.clear();
  sessionStorage.clear();
});

type State = ReturnType<typeof seedState>;
const ME = "u-walter";
const pad = (n: number) => String(n).padStart(2, "0");
const ymd = (d: Date) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
/** A day of this month, so the calendar opens on it whenever the test runs. */
const thisMonth = (day: number) => {
  const now = new Date();
  return ymd(new Date(now.getFullYear(), now.getMonth(), day));
};
const daysFromToday = (n: number) => {
  const d = new Date();
  d.setDate(d.getDate() + n);
  return ymd(d);
};
const withPortal = () => seedState({ authConfig: { approvalPortal: true } });

/**
 * Acme's schedule: two weeks and a card in no list. Week one holds a card being made (labels, a member, a checklist,
 * a comment, both dates) and one that was sent and approved; week two holds one to do. One post has no card.
 */
const fill = (portal: FakePortal) => {
  portal.lists = [
    { id: "l-000001", name: "Semana 02 a 06/11", client: "acme" },
    { id: "l-000002", name: "Semana 09 a 13/11", client: "acme" },
  ];
  portal.labels = [
    { id: "e-000001", name: "em edição", color: "yellow" },
    { id: "e-000002", name: "legenda ok", color: "green" },
  ];
  portal.cards = [
    portalCard({
      id: "c-000001",
      client: "acme",
      title: "Reel do treino",
      state: "doing",
      list: "l-000001",
      order: 1,
      labels: ["e-000001"],
      members: [ME],
      description: "Gravar na academia.",
      produceOn: thisMonth(10),
      date: `${thisMonth(14)}T18:00`,
      checklist: [
        { id: "k1", text: "Roteiro", done: true },
        { id: "k2", text: "Gravação", done: false },
      ],
      comments: [
        { id: "m1", by: "u-joao", text: "Veja https://exemplo.test/ref. Ficou bom", at: Date.now() - 3_600_000 },
      ],
    }),
    portalCard({
      id: "c-000002",
      client: "acme",
      title: "Carrossel de receitas",
      type: "carousel",
      list: "l-000001",
      order: 2,
      item: "p1",
    }),
    portalCard({
      id: "c-000003",
      client: "acme",
      title: "Story de enquete",
      type: "story",
      list: "l-000002",
      order: 1,
    }),
    portalCard({ id: "c-000004", client: "acme", title: "Ideia solta", order: 5 }),
  ];
  portal.items = [
    portalItem({
      id: "p1",
      client: "acme",
      title: "Carrossel de receitas",
      type: "carousel",
      status: "approved",
      scheduledFor: `${thisMonth(20)}T12:00:00-03:00`,
    }),
    portalItem({
      id: "p2",
      client: "acme",
      title: "Post antigo",
      status: "published",
      publishedAt: `${thisMonth(3)}T09:00:00-03:00`,
    }),
  ];
};
const go = async (path: string, state: State = withPortal(), seed: (portal: FakePortal) => void = fill) => {
  const api = createFakeApi(state);
  const portal = fakePortalOf.get(api) as FakePortal;
  seed(portal);
  const app = await renderApp(`/org/${ORG_ID}/${path}`, { api });
  await settle(8);
  return { ...app, state, portal };
};
const click = async (el: Element) => {
  await act(async () => fireEvent.click(el));
  await settle(4);
};
const key = async (el: Element, k: string) => {
  await act(async () => {
    fireEvent.keyDown(el, { key: k });
    fireEvent.keyUp(el, { key: k });
  });
  await settle(3);
};
const openMenu = async (button: HTMLElement) => {
  button.focus();
  await key(button, "Enter");
  return screen().getByRole("menu");
};
const main = () => document.querySelector(".portal") as HTMLElement;
const list = (name: string) => main().querySelector(`.plan-col[aria-label="${name}"]`) as HTMLElement;
const lists = () => [...main().querySelectorAll(".plan-col")].map((c) => c.getAttribute("aria-label"));
const cardsIn = (name: string) =>
  [...list(name).querySelectorAll(".plan-card .issue-card__title")].map((c) => c.textContent);
const card = (title: string) =>
  [...main().querySelectorAll<HTMLElement>(".plan-card")].find(
    (c) => c.querySelector(".issue-card__title")?.textContent === title,
  ) as HTMLElement;
const calls = (state: State, method: string) => state.calls.filter((c) => c.method === method).map((c) => c.args);
const PLAN = "portal?client=acme&tab=plan";

describe("the strategic schedule", () => {
  test("a column per list in the team's order, then the cards in no list; each card in its stage's colour", async () => {
    await go(PLAN);
    expect(lists()).toEqual(["Semana 02 a 06/11", "Semana 09 a 13/11", "Sem lista"]);
    expect(cardsIn("Semana 02 a 06/11")).toEqual(["Reel do treino", "Carrossel de receitas"]);
    expect(cardsIn("Semana 09 a 13/11")).toEqual(["Story de enquete"]);
    expect(cardsIn("Sem lista")).toEqual(["Ideia solta"]);
    // The stage is automatic: the card's own until it is sent, the post's from then on.
    expect(card("Reel do treino").dataset.stage).toBe("doing");
    expect(card("Carrossel de receitas").dataset.stage).toBe("approved");
    expect(card("Story de enquete").dataset.stage).toBe("todo");
    const face = card("Reel do treino");
    // The board's own card: its type, its stage and the team's labels as chips, then its facts.
    expect([...face.querySelectorAll(".portal-card__chips .ac-chip")].map((c) => c.textContent)).toEqual([
      "Reel",
      "Em produção",
      "em edição",
    ]);
    expect(face.querySelector(".portal-dot")?.getAttribute("data-stage")).toBe("doing");
    expect(face.querySelector(".portal-swatch")?.getAttribute("data-color")).toBe("yellow");
    expect([...face.querySelectorAll(".ac-factline__fact")].map((f) => f.getAttribute("title"))).toEqual([
      expect.stringMatching(/^Post: 14 de /),
      expect.stringMatching(/^Produção: 10 de /),
      "1 comentário",
      "1 de 2 feitos",
      "Tem descrição",
    ]);
    // The same column and card as the client's board.
    expect(face.classList.contains("portal-card")).toBe(true);
    expect(face.closest(".issues-col.portal-col")).toBeTruthy();
    expect(face.querySelector(".ac-avatar")).toBeTruthy();
  });

  test("the legend at the foot: every stage with its name, then the team's labels", async () => {
    await go(PLAN);
    const legend = within(main()).getByRole("region", { name: "Legenda" });
    expect([...legend.querySelectorAll(".portal-stagechip")].map((s) => s.textContent)).toEqual([
      "A produzir",
      "Em produção",
      "Para aprovação",
      "Em ajuste",
      "Aprovado",
      "Agendado",
      "Postado",
    ]);
    expect(
      [...legend.querySelectorAll(".portal-labelchip")].map((l) => [
        l.textContent,
        l.querySelector(".portal-swatch")?.getAttribute("data-color"),
      ]),
    ).toEqual([
      ["em edição", "yellow"],
      ["legenda ok", "green"],
    ]);
  });

  test("a card picked with Space and moved with the arrows lands in the next list: its list and order are saved", async () => {
    const { state } = await go(PLAN);
    const face = card("Reel do treino");
    face.focus();
    await key(face, " ");
    await key(document.activeElement ?? face, "ArrowRight");
    await key(document.activeElement ?? face, " ");
    const [moved] = calls(state, "portal.updateCard");
    expect(moved?.[1]).toBe("c-000001");
    const sent = moved?.[2] as { list: string; order: number };
    expect(sent.list).toBe("l-000002");
    expect(typeof sent.order).toBe("number");
    expect(Object.keys(sent).sort()).toEqual(["list", "order"]);
    expect(cardsIn("Semana 09 a 13/11")).toContain("Reel do treino");
    expect(cardsIn("Semana 02 a 06/11")).toEqual(["Carrossel de receitas"]);
  });

  test("a list is renamed in place and moved from its menu; a new one is added at the end", async () => {
    const { state } = await go(PLAN);
    await click(within(list("Semana 02 a 06/11")).getByRole("button", { name: "Semana 02 a 06/11" }));
    const field = within(main()).getByRole("textbox", { name: "Nome da lista" });
    await act(async () => fireEvent.change(field, { target: { value: "Semana 1" } }));
    await key(field, "Enter");
    expect(calls(state, "portal.renameList")).toEqual([[ORG_ID, "l-000001", "Semana 1"]]);
    expect(lists()).toEqual(["Semana 1", "Semana 09 a 13/11", "Sem lista"]);

    const menu = await openMenu(within(list("Semana 1")).getByRole("button", { name: "Ações: Semana 1" }));
    expect(within(menu).getByRole("menuitem", { name: "Mover para a esquerda" }).getAttribute("aria-disabled")).toBe(
      "true",
    );
    await click(within(menu).getByRole("menuitem", { name: "Mover para a direita" }));
    expect(calls(state, "portal.orderLists")).toEqual([[ORG_ID, "acme", ["l-000002", "l-000001"]]]);
    expect(lists()).toEqual(["Semana 09 a 13/11", "Semana 1", "Sem lista"]);

    await click(within(main()).getByRole("button", { name: "Adicionar lista" }));
    const name = within(main()).getByRole("textbox", { name: "Nome da lista" });
    await act(async () => fireEvent.change(name, { target: { value: "Semana 16 a 20/11" } }));
    await key(name, "Enter");
    await act(async () => fireEvent.submit(name.closest("form") as HTMLFormElement));
    await settle(4);
    expect(calls(state, "portal.createList")[0]).toEqual([ORG_ID, "acme", "Semana 16 a 20/11"]);
    expect(lists()).toContain("Semana 16 a 20/11");
  });

  test("Nova lista at the page's head: no card, a list made first in the schedule, which then shows", async () => {
    const { state, router } = await go("portal?client=acme");
    expect(within(main()).queryByRole("button", { name: "Novo cartão" })).toBeNull();
    await click(within(main()).getByRole("button", { name: "Nova lista" }));
    const dialog = screen().getByRole("dialog", { name: "Nova lista" });
    const make = within(dialog).getByRole("button", { name: "Nova lista" }) as HTMLButtonElement;
    expect(make.disabled).toBe(true);
    await act(async () =>
      fireEvent.change(within(dialog).getByRole("textbox", { name: "Nome da lista" }), {
        target: { value: "Semana 23 a 27/11" },
      }),
    );
    await click(make);
    await settle(6);
    expect(calls(state, "portal.createList")).toEqual([[ORG_ID, "acme", "Semana 23 a 27/11"]]);
    const made = calls(state, "portal.orderLists")[0]?.[2] as string[];
    expect(made).toHaveLength(3);
    expect(made.slice(1)).toEqual(["l-000001", "l-000002"]);
    expect(screen().queryByRole("dialog", { name: "Nova lista" })).toBeNull();
    expect(router.state.location.search).toEqual({ client: "acme", tab: "plan" });
    expect(lists()).toEqual(["Semana 23 a 27/11", "Semana 02 a 06/11", "Semana 09 a 13/11", "Sem lista"]);
  });

  test("Adicionar cartão at a list's foot: a title and Enter, and it stays open for the next", async () => {
    const { state } = await go(PLAN);
    await click(within(list("Semana 09 a 13/11")).getByRole("button", { name: "Adicionar cartão" }));
    const title = within(list("Semana 09 a 13/11")).getByRole("textbox", { name: "Título do cartão" });
    await act(async () => fireEvent.change(title, { target: { value: "Bastidores" } }));
    await act(async () => fireEvent.submit(title.closest("form") as HTMLFormElement));
    await settle(4);
    expect(calls(state, "portal.createCard")[0]?.[1]).toMatchObject({
      client: "acme",
      title: "Bastidores",
      list: "l-000002",
    });
    expect(cardsIn("Semana 09 a 13/11")).toEqual(["Story de enquete", "Bastidores"]);
    expect(within(list("Semana 09 a 13/11")).getByRole("textbox", { name: "Título do cartão" })).toBeTruthy();
  });

  test("Gerenciar etiquetas: a label is created, recoloured by name and deleted", async () => {
    const { state } = await go(PLAN);
    await click(within(main()).getByRole("button", { name: "Gerenciar etiquetas" }));
    const dialog = screen().getByRole("dialog", { name: "Gerenciar etiquetas" });
    await act(async () =>
      fireEvent.change(within(dialog).getByRole("textbox", { name: "Nome da etiqueta" }), {
        target: { value: "falta material" },
      }),
    );
    await click(within(dialog).getByRole("button", { name: "Adicionar etiqueta" }));
    expect(calls(state, "portal.createLabel")).toEqual([[ORG_ID, { name: "falta material", color: "green" }]]);
    expect(within(dialog).getByRole("textbox", { name: "Nome da etiqueta: falta material" })).toBeTruthy();

    const rename = within(dialog).getByRole("textbox", { name: "Nome da etiqueta: em edição" });
    await act(async () => {
      fireEvent.change(rename, { target: { value: "editando" } });
      fireEvent.blur(rename);
    });
    await settle(4);
    expect(calls(state, "portal.updateLabel")).toEqual([[ORG_ID, "e-000001", { name: "editando" }]]);

    await click(within(dialog).getByRole("button", { name: "Excluir etiqueta legenda ok" }));
    expect(calls(state, "portal.deleteLabel")).toEqual([[ORG_ID, "e-000002"]]);
    expect(within(dialog).queryByRole("textbox", { name: "Nome da etiqueta: legenda ok" })).toBeNull();
  });

  test("the calendar: each card on the day its post goes out, a post with no card too; then by production date", async () => {
    const { router } = await go(PLAN);
    await click(within(main()).getByRole("button", { name: "Calendário" }));
    expect(router.state.location.search).toEqual({ client: "acme", tab: "plan", view: "calendar" });
    const day = (n: number) => main().querySelector(`.plan-cal__day[data-day="${thisMonth(n)}"]`) as HTMLElement;
    const chips = (n: number) => [...day(n).querySelectorAll(".plan-cal__chip")].map((c) => c.textContent);
    expect(chips(14)).toEqual(["Reel do treino"]);
    // A sent card goes on the portal's date, in the post's stage; a post no card stands for shows as well.
    expect(chips(20)).toEqual(["Carrossel de receitas"]);
    expect(day(20).querySelector(".plan-cal__chip")?.getAttribute("data-stage")).toBe("approved");
    expect(chips(3)).toEqual(["Post antigo"]);
    expect(chips(10)).toEqual([]);
    // Monday first.
    expect(new Date(`${main().querySelector(".plan-cal__day")?.getAttribute("data-day")}T12:00`).getDay()).toBe(1);

    await click(within(main()).getByRole("radio", { name: "Data de produção" }));
    expect(chips(10)).toEqual(["Reel do treino"]);
    expect(chips(14)).toEqual([]);
    expect(chips(3)).toEqual([]);

    await click(within(day(10)).getByRole("button", { name: "Reel do treino" }));
    expect(router.state.location.search).toMatchObject({ card: "c-000001" });
    expect(screen().getByRole("dialog", { name: "Reel do treino" })).toBeTruthy();
  });
});

describe("a card the team approved in Review (ADR 9001, addendum 2026-11-18)", () => {
  /** "Story de enquete" holds the approved video Review put on it; "Ideia solta" is still in the team's review. */
  const approved = (portal: FakePortal) => {
    fill(portal);
    const story = portal.cards.find((c) => c.id === "c-000003");
    // A card left at the default type, holding one video: the approved one.
    if (story)
      Object.assign(story, {
        type: "image",
        files: [{ id: "22222222-2222-4222-8222-222222222222", name: "pool.mp4" }],
      });
    portal.reviews = {
      "c-000003": { status: "approved", reviewId: "33333333-3333-4333-8333-333333333333", approved: 1, total: 1 },
      "c-000004": { status: "in_review", reviewId: "44444444-4444-4444-8444-444444444444", approved: 0, total: 1 },
    };
  };

  test("on the schedule it says it, in the approved colour, and carries Subir para aprovação to the send", async () => {
    await go(PLAN, withPortal(), approved);
    const story = card("Story de enquete");
    expect(story.dataset.stage).toBe("approved");
    expect(within(story).getByText("Aprovado pela equipe")).toBeTruthy();
    expect(card("Ideia solta").dataset.stage).toBe("doing");
    expect(within(card("Ideia solta")).getByText("Em revisão na equipe")).toBeTruthy();
    // Only a card ready to go up carries the send on its face.
    expect(within(card("Ideia solta")).queryByRole("button", { name: "Subir para aprovação" })).toBeNull();
    expect(within(card("Reel do treino")).queryByRole("button", { name: "Subir para aprovação" })).toBeNull();
    await click(within(story).getByRole("button", { name: "Subir para aprovação" }));
    const dialog = screen().getByRole("dialog", { name: "Subir para aprovação" });
    // The approved video is the card's file, and one video goes up as a reel.
    expect(within(dialog).getByText("pool.mp4")).toBeTruthy();
    expect(within(dialog).getByRole("combobox", { name: "Tipo" }).textContent).toContain("Reel");
  });

  test("its dialog opens the review it was approved in", async () => {
    await go(`${PLAN}&card=c-000003`, withPortal(), approved);
    const dialog = screen().getByRole("dialog", { name: "Story de enquete" });
    expect(within(dialog).getByText("Aprovado pela equipe")).toBeTruthy();
    expect(within(dialog).getByRole("link", { name: "Abrir na Revisão" }).getAttribute("href")).toBe(
      `/org/${ORG_ID}/review/33333333-3333-4333-8333-333333333333`,
    );
  });

  test("on the board it leaves its column for Aprovado, above what the client approved, with the send", async () => {
    await go("portal?client=acme", withPortal(), approved);
    const column = (name: string) => main().querySelector(`.issues-col[aria-label="${name}"]`) as HTMLElement;
    const ready = within(column("Aprovado")).getByRole("article", { name: "Story de enquete" });
    expect(within(ready).getByText("Aprovado pela equipe")).toBeTruthy();
    expect(within(ready).getByRole("button", { name: "Subir para aprovação" })).toBeTruthy();
    expect(within(column("A produzir")).queryByRole("article", { name: "Story de enquete" })).toBeNull();
    // Still in Review: in its own column, saying so.
    const waiting = within(column("A produzir")).getByRole("article", { name: "Ideia solta" });
    expect(within(waiting).getByText("Em revisão na equipe")).toBeTruthy();
  });
});

describe("moving things on the boards", () => {
  test("a card dropped at the top of another list gets that list and an order before its first card", async () => {
    const { state } = await go(PLAN);
    const face = card("Story de enquete");
    face.focus();
    await key(face, " ");
    await key(document.activeElement ?? face, "ArrowLeft");
    // It lands where it was in its own list (the top); up keeps it there.
    await key(document.activeElement ?? face, "ArrowUp");
    await key(document.activeElement ?? face, " ");
    const [moved] = calls(state, "portal.updateCard");
    const sent = moved?.[2] as { list: string; order: number };
    expect(sent.list).toBe("l-000001");
    // Before "Reel do treino" (order 1): nothing else is renumbered.
    expect(sent.order).toBeLessThan(1);
    expect(cardsIn("Semana 02 a 06/11")).toEqual(["Story de enquete", "Reel do treino", "Carrossel de receitas"]);
  });

  test("Esc gives a picked card back, and nothing is saved", async () => {
    const { state } = await go(PLAN);
    const face = card("Reel do treino");
    face.focus();
    await key(face, " ");
    await key(document.activeElement ?? face, "ArrowRight");
    await key(document.activeElement ?? face, "Escape");
    expect(calls(state, "portal.updateCard")).toEqual([]);
    expect(cardsIn("Semana 02 a 06/11")).toEqual(["Reel do treino", "Carrossel de receitas"]);
  });

  test("a move the portal refuses goes back, with its words", async () => {
    const { portal } = await go(PLAN);
    const face = card("Reel do treino");
    face.focus();
    await key(face, " ");
    await key(document.activeElement ?? face, "ArrowRight");
    portal.fail = new ApiError(400, "portal.refused", "Esta lista está fechada");
    await key(document.activeElement ?? face, " ");
    await settle(6);
    expect(screen().getByText("Esta lista está fechada")).toBeTruthy();
    expect(cardsIn("Semana 02 a 06/11")).toEqual(["Reel do treino", "Carrossel de receitas"]);
  });

  test("a card's menu moves it to another list, at its end: no drag and no arrows needed", async () => {
    const { state } = await go(PLAN);
    const menu = await openMenu(within(card("Ideia solta")).getByRole("button", { name: "Ações: Ideia solta" }));
    await click(within(menu).getByRole("menuitem", { name: "Mover para Semana 09 a 13/11" }));
    const sent = calls(state, "portal.updateCard")[0]?.[2] as { list: string; order: number };
    expect(sent.list).toBe("l-000002");
    expect(sent.order).toBeGreaterThan(1);
    expect(cardsIn("Semana 09 a 13/11")).toEqual(["Story de enquete", "Ideia solta"]);
  });

  test("a list dropped between others takes that place", () => {
    const ids = ["a", "b", "c", "d"];
    // `index` counts the other lists: before the first, between two, past the last.
    expect(orderAfterDrop(ids, "c", 0)).toEqual(["c", "a", "b", "d"]);
    expect(orderAfterDrop(ids, "a", 2)).toEqual(["b", "c", "a", "d"]);
    expect(orderAfterDrop(ids, "b", 9)).toEqual(["a", "c", "d", "b"]);
    expect(orderAfterDrop(ids, "b", 1)).toEqual(ids);
    expect(orderAfterDrop(ids, "nope", 0)).toEqual(ids);
  });

  test("on the client's board a team card moves between A produzir and Em produção, and no further", async () => {
    const { state } = await go("portal?client=acme");
    const column = (name: string) => main().querySelector(`.issues-col[aria-label="${name}"]`) as HTMLElement;
    const titles = (name: string) =>
      [...column(name).querySelectorAll(".portal-card .issue-card__title")].map((c) => c.textContent);
    expect(titles("A produzir")).toEqual(["Story de enquete", "Ideia solta"]);
    const face = within(column("A produzir")).getByRole("article", { name: "Ideia solta" });
    face.focus();
    await key(face, " ");
    // While it moves, the portal's columns show they take none.
    expect(column("Para aprovação").hasAttribute("data-closed")).toBe(true);
    expect(column("Em produção").hasAttribute("data-closed")).toBe(false);
    await key(document.activeElement ?? face, "ArrowRight");
    // Past In production there is nowhere to go: the portal's columns are no drop target.
    await key(document.activeElement ?? face, "ArrowRight");
    await key(document.activeElement ?? face, " ");
    expect(calls(state, "portal.updateCard")).toEqual([[ORG_ID, "c-000004", { state: "doing" }]]);
    expect(titles("Em produção")).toContain("Ideia solta");
    expect(titles("A produzir")).toEqual(["Story de enquete"]);
    expect(column("Para aprovação").hasAttribute("data-closed")).toBe(false);
  });

  test("a press pans the board only on its empty space: never on a card, a list's head or a control", async () => {
    await go(PLAN);
    const board = main().querySelector(".issues-boardwrap") as HTMLElement;
    const col = list("Semana 02 a 06/11");
    expect(pansBoard(board)).toBe(true);
    expect(pansBoard(board.querySelector(".issues-board"))).toBe(true);
    expect(pansBoard(col)).toBe(true);
    expect(pansBoard(col.querySelector(".issues-col__cards"))).toBe(true);
    const face = card("Reel do treino");
    expect(pansBoard(face)).toBe(false);
    expect(pansBoard(face.querySelector(".issue-card__title"))).toBe(false);
    expect(pansBoard(face.querySelector(".ac-chip"))).toBe(false);
    expect(pansBoard(col.querySelector(".issues-col__head"))).toBe(false);
    expect(pansBoard(col.querySelector(".issues-col__head h2"))).toBe(false);
    expect(pansBoard(col.querySelector(".plan-col__name"))).toBe(false);
    expect(pansBoard(within(col).getByRole("button", { name: "Adicionar cartão" }))).toBe(false);
    expect(pansBoard(card("Carrossel de receitas").querySelector("a"))).toBe(false);
    expect(pansBoard(null)).toBe(false);
    // A list is picked up by its head, where the board never pans.
    expect(col.querySelector(".issues-col__head")?.hasAttribute("data-grab")).toBe(true);
  });
});

describe("a card opened", () => {
  const open = async (state: State = withPortal()) => {
    const app = await go(`${PLAN}&card=c-000001`, state);
    return { ...app, dialog: screen().getByRole("dialog", { name: "Reel do treino" }) };
  };

  test("the day it is made and the day it goes out are two fields, each saying what it is; its stage is read only", async () => {
    const { dialog } = await open();
    const produce = within(dialog).getByText("Data de produção").closest(".ac-field") as HTMLElement;
    const post = within(dialog).getByText("Data do post").closest(".ac-field") as HTMLElement;
    expect(produce).not.toBe(post);
    expect(produce.textContent).toContain("O dia em que a equipe faz.");
    expect(produce.textContent).toMatch(/10 de /);
    expect(post.textContent).toContain("O dia e a hora em que vai ao ar.");
    expect(post.textContent).toMatch(/14 de /);
    expect((within(dialog).getByRole("combobox", { name: "Hora" }) as HTMLInputElement).value).toBe("18:00");
    const stage = within(dialog).getByRole("group", { name: "Etapa" });
    expect(stage.querySelector(".portal-stagechip")?.textContent).toBe("Em produção");
    expect(stage.querySelector("button, input, select")).toBeNull();
    expect(
      within(dialog).getByRole("group", { name: "Etiquetas" }).querySelector(".portal-labelchip")?.textContent,
    ).toBe("em edição");
    expect(within(dialog).getByRole("group", { name: "Checklist" }).textContent).toContain("1/2");
  });

  test("the card is a task too: Tarefa #N beside its stage opens the task", async () => {
    const { dialog } = await open();
    // No task known for it: nothing to open.
    expect(within(dialog).queryByRole("link", { name: /^Tarefa #/ })).toBeNull();
    cleanup();
    await go(`${PLAN}&card=c-000001`, withPortal(), (portal) => {
      fill(portal);
      const made = portal.cards.find((c) => c.id === "c-000001");
      if (made) made.task = "i-000012";
      portal.tasks = [{ cardId: "c-000001", id: "i-000012", number: 12 }];
    });
    const stage = within(screen().getByRole("dialog", { name: "Reel do treino" })).getByRole("group", {
      name: "Etapa",
    });
    expect(within(stage).getByRole("link", { name: "Tarefa #12" }).getAttribute("href")).toBe(
      `/org/${ORG_ID}/issues/12`,
    );
  });

  test("members are people and agents; the first is the one responsible, and an agent made the one goes first", async () => {
    const { state, dialog } = await open();
    const members = () => within(dialog).getByRole("group", { name: "Membros" });
    const lead = () => members().querySelector(".portal-detail__chips .portal-detail__lead")?.parentElement;
    expect(lead()?.textContent).toContain("Walter");
    expect(lead()?.textContent).toContain("Responsável");
    expect(members().textContent).not.toContain("O agente começa a trabalhar nela na hora.");

    await click(within(members()).getByRole("button", { name: "Membros" }));
    // The workspace's people first, then its agents, each with the product's own agent face.
    const options = [...document.querySelectorAll(".portal-detail__options > li")];
    expect(options.slice(-2).map((o) => o.querySelector("label")?.textContent)).toEqual(["Ada", "Atlas"]);
    expect(options.at(-2)?.querySelector(".ac-avatar--agent")).not.toBeNull();
    // Only who is on the card can be made the one responsible.
    expect(screen().queryByRole("button", { name: "Tornar Ada responsável" })).toBeNull();

    await click(screen().getByRole("checkbox", { name: /Ada/ }));
    expect(calls(state, "portal.updateCard")[0]?.[2]).toEqual({ members: [ME, ADA_ID] });
    expect(members().textContent).not.toContain("O agente começa a trabalhar nela na hora.");

    await click(screen().getByRole("button", { name: "Tornar Ada responsável" }));
    expect(calls(state, "portal.updateCard")[1]?.[2]).toEqual({ members: [ADA_ID, ME] });
    expect(lead()?.textContent).toContain("Ada");
    expect(lead()?.querySelector(".ac-avatar--agent")).not.toBeNull();
    // Whoever had it stays on the card.
    expect(members().querySelectorAll(".portal-detail__chips .portal-detail__person").length).toBe(2);
    expect(members().textContent).toContain("O agente começa a trabalhar nela na hora.");
  });

  test("a change is kept as it is made: a ticked item; the description when Salvar is pressed", async () => {
    const { state, dialog } = await open();
    await click(within(dialog).getByRole("checkbox", { name: "Gravação" }));
    expect(calls(state, "portal.updateCard")[0]?.[2]).toEqual({
      checklist: [
        { id: "k1", text: "Roteiro", done: true },
        { id: "k2", text: "Gravação", done: true },
      ],
    });
    // Read, the description is words on the page; "Editar" makes it a field with its formatting bar.
    const part = within(dialog).getByRole("region", { name: "Descrição" });
    expect(part.querySelector("textarea")).toBeNull();
    expect(part.querySelector(".portal-article__text")?.textContent).toBe("Gravar na academia.");
    await click(within(part).getByRole("button", { name: "Editar descrição" }));
    const field = within(part).getByRole("textbox", { name: "Descrição" }) as HTMLTextAreaElement;
    expect(field.value).toBe("Gravar na academia.");
    expect(within(part).getByRole("toolbar", { name: "Formatação" })).toBeTruthy();
    // Bold wraps what is selected in its marks.
    field.setSelectionRange(0, 6);
    await click(within(part).getByRole("button", { name: "Negrito" }));
    expect(field.value).toBe("**Gravar** na academia.");
    // Cancelar leaves it as it was, and nothing is saved.
    await click(within(part).getByRole("button", { name: "Cancelar" }));
    expect(part.querySelector("textarea")).toBeNull();
    expect(calls(state, "portal.updateCard")).toHaveLength(1);

    await click(within(part).getByRole("button", { name: "Editar descrição" }));
    await act(async () =>
      fireEvent.change(within(part).getByRole("textbox", { name: "Descrição" }), {
        target: { value: "Gravar no **estúdio**." },
      }),
    );
    await click(within(part).getByRole("button", { name: "Salvar" }));
    expect(calls(state, "portal.updateCard")[1]?.[2]).toEqual({ description: "Gravar no **estúdio**." });
    expect(part.querySelector("textarea")).toBeNull();
    expect(part.querySelector(".portal-article__text strong")?.textContent).toBe("estúdio");
  });

  test("the description reads as an article: formatted, every address a link, a long one folded under Mostrar mais", async () => {
    const drive = "https://drive.google.com/drive/folders/1RD4nrQcK9QeYk2X?usp=drive_link";
    await go(`${PLAN}&card=c-000001`, withPortal(), (portal) => {
      fill(portal);
      const made = portal.cards.find((c) => c.id === "c-000001");
      if (!made) return;
      made.description = [
        // As another board writes a link: its own title after the address.
        `OBRA: [${drive}](${drive} "smartCard-inline")`,
        "",
        "ROTEIRO — **BUILT TO ENDURE**",
        "Reels · 60s",
        "__________________________",
        "Veja https://exemplo.test/roteiro e o [documento](https://exemplo.test/doc).",
        ...Array.from({ length: 14 }, (_, i) => `- Passo ${i + 1}`),
      ].join("\n");
    });
    const part = within(screen().getByRole("dialog", { name: "Reel do treino" })).getByRole("region", {
      name: "Descrição",
    });
    const text = part.querySelector(".portal-article__text") as HTMLElement;
    const links = [...text.querySelectorAll("a")].map((a) => a.getAttribute("href"));
    expect(links).toEqual([drive, "https://exemplo.test/roteiro", "https://exemplo.test/doc"]);
    for (const a of text.querySelectorAll("a")) expect(a.getAttribute("rel")).toBe("noopener noreferrer");
    // The other board's link title is never shown, nor its marks.
    expect(text.textContent).not.toContain("smartCard");
    expect(text.querySelector("strong")?.textContent).toBe("BUILT TO ENDURE");
    expect(text.querySelector("hr")).toBeTruthy();
    expect(text.querySelectorAll("li")).toHaveLength(14);
    expect(within(text).getByRole("link", { name: "documento" })).toBeTruthy();

    expect(text.hasAttribute("data-folded")).toBe(true);
    const more = within(part).getByRole("button", { name: "Mostrar mais" });
    expect(more.getAttribute("aria-expanded")).toBe("false");
    await click(more);
    expect(text.hasAttribute("data-folded")).toBe(false);
    await click(within(part).getByRole("button", { name: "Mostrar menos" }));
    expect(text.hasAttribute("data-folded")).toBe(true);
  });

  test("a short description has no Mostrar mais, and an empty one asks for one and opens the field", async () => {
    const { dialog } = await open();
    expect(within(dialog).queryByRole("button", { name: "Mostrar mais" })).toBeNull();
    cleanup();
    await go(`${PLAN}&card=c-000003`);
    const part = within(screen().getByRole("dialog", { name: "Story de enquete" })).getByRole("region", {
      name: "Descrição",
    });
    const add = within(part).getByRole("button", { name: "Adicione uma descrição mais detalhada…" });
    await act(async () => fireEvent.click(add));
    expect(within(part).getByRole("textbox", { name: "Descrição" })).toBeTruthy();
  });

  test("Concluído beside the title marks the card finished, and takes it back", async () => {
    const { state, dialog } = await open();
    const done = within(dialog).getByRole("button", { name: "Concluído" });
    expect(done.getAttribute("aria-pressed")).toBe("false");
    await click(done);
    expect(calls(state, "portal.updateCard")[0]?.[2]).toEqual({ done: true });
    expect(within(dialog).getByRole("button", { name: "Concluído" }).getAttribute("aria-pressed")).toBe("true");
    await click(within(dialog).getByRole("button", { name: "Concluído" }));
    expect(calls(state, "portal.updateCard")[1]?.[2]).toEqual({ done: false });
    // The title is the head's own field, kept when it is left.
    const title = within(dialog).getByRole("textbox", { name: "Título" });
    await act(async () => {
      fireEvent.change(title, { target: { value: "Reel do treino novo" } });
      fireEvent.blur(title);
    });
    await settle(4);
    expect(calls(state, "portal.updateCard")[2]?.[2]).toEqual({ title: "Reel do treino novo" });
  });

  test("attachments show each file with a way to open it; a comment from another board says who wrote it there", async () => {
    await go(`${PLAN}&card=c-000001`, withPortal(), (portal) => {
      fill(portal);
      const made = portal.cards.find((c) => c.id === "c-000001");
      if (!made) return;
      made.files = [{ id: "11111111-1111-4111-8111-111111111111", name: "capa.png" }];
      made.comments.push({
        id: "m2",
        by: "Ronny",
        text: "EDITADO: https://drive.google.com/file/d/1ZyXwVuTsRqPoNm/view?usp=drive_link",
        at: Date.now() - 60 * 24 * 3_600_000,
      });
    });
    const dialog = screen().getByRole("dialog", { name: "Reel do treino" });
    const files = within(dialog).getByRole("group", { name: "Anexos" });
    expect(files.querySelector(".portal-files__row[data-preview] .portal-files__thumb")).toBeTruthy();
    expect(within(files).getByRole("button", { name: "Abrir capa.png" })).toBeTruthy();
    expect(within(files).getByRole("button", { name: "Remover capa.png" })).toBeTruthy();

    const side = within(dialog).getByRole("region", { name: "Comentários" });
    const old = [...side.querySelectorAll<HTMLElement>(".portal-comment")].at(-1) as HTMLElement;
    expect(old.querySelector("b")?.textContent).toBe("Ronny");
    // Older than a week: its date, not how long ago.
    expect(old.querySelector("time")?.textContent).toMatch(/^\d{1,2} \S+/);
    const pill = within(old).getByRole("link");
    expect(pill.className).toContain("link-pill");
    expect(pill.getAttribute("href")).toBe("https://drive.google.com/file/d/1ZyXwVuTsRqPoNm/view?usp=drive_link");
  });

  test("comments newest first, by who wrote them, their links as links and nothing else as markup; a new one is posted", async () => {
    const { state, dialog } = await open();
    const side = within(dialog).getByRole("region", { name: "Comentários" });
    const first = side.querySelector(".portal-comment") as HTMLElement;
    expect(first.querySelector("b")?.textContent).toBe("João");
    const link = within(first).getByRole("link");
    expect(link.getAttribute("href")).toBe("https://exemplo.test/ref");
    expect(link.getAttribute("rel")).toBe("noopener noreferrer");
    expect(first.querySelector(".portal-comment__text")?.textContent).toBe("Veja https://exemplo.test/ref. Ficou bom");

    const field = within(side).getByRole("textbox", { name: "Escreva um comentário" });
    await act(async () => fireEvent.change(field, { target: { value: "Subo <b>hoje</b>" } }));
    await click(within(side).getByRole("button", { name: "Comentar" }));
    expect(calls(state, "portal.addComment")).toEqual([[ORG_ID, "c-000001", "Subo <b>hoje</b>"]]);
    const texts = [...side.querySelectorAll(".portal-comment__text")].map((p) => p.textContent);
    expect(texts[0]).toBe("Subo <b>hoje</b>");
    expect(side.querySelectorAll(".portal-comment__text b").length).toBe(0);
    expect((field as HTMLTextAreaElement).value).toBe("");
  });

  test("Perguntar ao right hand opens its conversation with the task already in the composer's draft", async () => {
    const state = withPortal();
    const first = state.agents[0];
    if (!first) throw new Error("the seed has no agent");
    Object.assign(first, { builtin: "right_hand" });
    const { dialog, router } = await open(state);
    await click(within(dialog).getByRole("button", { name: `Perguntar ao ${first.name}` }));
    expect(router.state.location.pathname).toBe(`/org/${ORG_ID}/dm/agent/${first.id}`);
    // The conversation took the draft into its composer, for the person to go on writing.
    expect(peekDraft(`agent:${first.id}`)).toBeUndefined();
    const composer = [...document.querySelectorAll("textarea")].find((el) => el.value.startsWith("Sobre a tarefa"));
    expect(composer?.value).toBe("Sobre a tarefa “Reel do treino” (Acme, cartão c-000001): ");
  });

  test("a card that was sent offers the portal, not another send", async () => {
    await go(`${PLAN}&card=c-000002`);
    const dialog = screen().getByRole("dialog", { name: "Carrossel de receitas" });
    expect(within(dialog).queryByRole("button", { name: "Subir para aprovação" })).toBeNull();
    expect(within(dialog).getByRole("link", { name: "Abrir no portal" }).getAttribute("href")).toBe(
      "https://portal.example/acme/p1",
    );
  });

  test("a team card on the Quadro tab opens the same dialog", async () => {
    const { router } = await go("portal?client=acme");
    const column = main().querySelector('.issues-col[aria-label="Em produção"]') as HTMLElement;
    // On a card's face, sending is a plated button: green stays with the page's main action.
    const send = within(column).getByRole("button", { name: "Subir para aprovação" });
    expect(send.className).not.toContain("primary");
    await click(within(column).getByRole("article", { name: "Reel do treino" }));
    expect(router.state.location.search).toEqual({ client: "acme", card: "c-000001" });
    expect(within(screen().getByRole("dialog", { name: "Reel do treino" })).getByText("Data de produção")).toBeTruthy();
  });

  test("without the permission to give agents work: nothing to change, but a comment can still be posted", async () => {
    const state = withPortal();
    meWithRole(state, []);
    const org = state.me?.organizations[0];
    if (org) org.permissions = ["read", "post"];
    const { dialog } = await open(state);
    expect(within(main()).queryByRole("button", { name: "Adicionar lista" })).toBeNull();
    expect(within(main()).queryByRole("button", { name: "Adicionar cartão" })).toBeNull();
    expect(within(main()).queryByRole("button", { name: "Gerenciar etiquetas" })).toBeNull();
    expect(within(main()).queryByRole("button", { name: /^Ações/ })).toBeNull();
    expect(within(dialog).getByRole("region", { name: "Descrição" }).closest("fieldset")?.disabled).toBe(true);
    expect(within(dialog).queryByRole("button", { name: "Editar descrição" })).toBeNull();
    expect((within(dialog).getByRole("button", { name: "Concluído" }) as HTMLButtonElement).disabled).toBe(true);
    expect((within(dialog).getByRole("textbox", { name: "Título" }) as HTMLInputElement).readOnly).toBe(true);
    expect(within(dialog).queryByRole("button", { name: "Excluir" })).toBeNull();
    expect(within(dialog).queryByRole("button", { name: "Subir para aprovação" })).toBeNull();
    const field = within(dialog).getByRole("textbox", { name: "Escreva um comentário" });
    await act(async () => fireEvent.change(field, { target: { value: "Posso ajudar" } }));
    await click(within(dialog).getByRole("button", { name: "Comentar" }));
    expect(calls(state, "portal.addComment")).toEqual([[ORG_ID, "c-000001", "Posso ajudar"]]);
  });
});

describe("Suas tarefas on Home", () => {
  const tasks = () => document.querySelector(".home-tasks") as HTMLElement | null;
  const mine = (portal: FakePortal) => {
    portal.cards = [
      portalCard({
        id: "c-00000a",
        client: "acme",
        title: "Roteiro atrasado",
        members: [ME],
        produceOn: daysFromToday(-2),
      }),
      portalCard({
        id: "c-00000b",
        client: "acme",
        title: "Gravar hoje",
        state: "doing",
        members: [ME],
        produceOn: daysFromToday(0),
        date: `${daysFromToday(3)}T10:00`,
      }),
      portalCard({
        id: "c-00000c",
        client: "zeta",
        title: "Editar depois",
        members: [ME],
        produceOn: daysFromToday(4),
      }),
      portalCard({ id: "c-00000d", client: "zeta", title: "Sem dia", members: [ME] }),
      // Not mine, and one of mine already with the client: neither is a task of mine.
      portalCard({
        id: "c-00000e",
        client: "acme",
        title: "De outra pessoa",
        members: ["u-joao"],
        produceOn: daysFromToday(0),
      }),
      portalCard({
        id: "c-00000f",
        client: "acme",
        title: "Já enviado",
        members: [ME],
        produceOn: daysFromToday(-5),
        item: "p9",
      }),
    ];
    portal.items = [portalItem({ id: "p9", client: "acme", title: "Já enviado", status: "seen" })];
  };

  test("late first and standing out, then today, what comes next and what has no day; a row opens its card", async () => {
    await go("home", withPortal(), mine);
    const section = tasks() as HTMLElement;
    expect([...section.querySelectorAll(".home-tasks__group")].map((g) => g.getAttribute("aria-label"))).toEqual([
      "Atrasadas",
      "Hoje",
      "Próximas",
      "Sem data",
    ]);
    const titles = (group: string) =>
      [...within(section).getByRole("region", { name: group }).querySelectorAll(".home-tasks__title")].map(
        (r) => r.textContent,
      );
    expect(titles("Atrasadas")).toEqual(["Roteiro atrasado"]);
    expect(titles("Hoje")).toEqual(["Gravar hoje"]);
    expect(titles("Próximas")).toEqual(["Editar depois"]);
    expect(titles("Sem data")).toEqual(["Sem dia"]);
    expect(section.querySelector('[data-group="late"]')).toBeTruthy();
    const row = within(section).getByRole("link", { name: /Gravar hoje/ });
    expect(row.getAttribute("href")).toBe(`/org/${ORG_ID}/portal?client=acme&tab=plan&card=c-00000b`);
    expect(row.textContent).toContain("Acme");
    expect(row.textContent).toContain("Reel");
    expect(row.textContent).toContain("Em produção");
    expect(row.textContent).toMatch(/Produção \d+ de /);
    expect(row.textContent).toMatch(/Post \d+ de /);
  });

  test("with nothing to make it doesn't show, and neither on a server without a portal", async () => {
    await go("home", withPortal(), (p) => {
      p.cards = [portalCard({ id: "c-00000e", client: "acme", title: "De outra pessoa", members: ["u-joao"] })];
    });
    expect(tasks()).toBeNull();
    cleanup();
    await go("home", seedState(), mine);
    expect(tasks()).toBeNull();
  });
});

describe("the client's materials (ADR 9001 §20)", () => {
  /** Acme's schedule, plus a list of materials with a login in it. */
  const withMaterials = (portal: FakePortal) => {
    fill(portal);
    portal.lists.push({ id: "l-0000aa", name: "Acessos", client: "acme", kind: "materials" });
    portal.cards.push(
      portalCard({ id: "c-0000aa", client: "acme", title: "Login do Instagram", list: "l-0000aa", order: 1 }),
    );
  };
  const MATERIALS = "portal?client=acme&tab=materials";

  test("a tab of its own beside Postados: its lists only, with no stage on the cards; the schedule leaves them out", async () => {
    await go(MATERIALS, withPortal(), withMaterials);
    expect(
      within(main())
        .getByRole("radio", { name: /Materiais do cliente/ })
        .getAttribute("aria-checked"),
    ).toBe("true");
    expect(lists()).toEqual(["Acessos"]);
    expect(cardsIn("Acessos")).toEqual(["Login do Instagram"]);
    expect(card("Login do Instagram").querySelector(".portal-stagechip")).toBeNull();
    expect(within(main()).queryByRole("region", { name: "Legenda" })).toBeNull();
    cleanup();
    await go(PLAN, withPortal(), withMaterials);
    expect(lists()).toEqual(["Semana 02 a 06/11", "Semana 09 a 13/11", "Sem lista"]);
  });

  test("a right click on a card moves it to a list of either part, the materials under their own heading", async () => {
    const { state } = await go(PLAN, withPortal(), withMaterials);
    await act(async () => fireEvent.contextMenu(card("Story de enquete"), { clientX: 40, clientY: 60 }));
    await settle(2);
    const menu = screen().getByRole("menu");
    expect(within(menu).getByText("Materiais do cliente")).toBeTruthy();
    await click(within(menu).getByRole("menuitem", { name: "Acessos" }));
    const [moved] = calls(state, "portal.updateCard");
    expect(moved?.[1]).toBe("c-000003");
    expect((moved?.[2] as { list: string } | undefined)?.list).toBe("l-0000aa");
    expect(cardsIn("Semana 09 a 13/11")).toEqual([]);
  });

  test("and back: from the materials, its menu offers the schedule's lists", async () => {
    const { state } = await go(MATERIALS, withPortal(), withMaterials);
    const menu = await openMenu(
      within(card("Login do Instagram")).getByRole("button", { name: "Ações: Login do Instagram" }),
    );
    await click(within(menu).getByRole("menuitem", { name: "Mover para Semana 02 a 06/11 · Cronograma estratégico" }));
    expect((calls(state, "portal.updateCard")[0]?.[2] as { list: string } | undefined)?.list).toBe("l-000001");
  });

  /** The tab that takes a drop, given a box on screen (the test's page lays nothing out). */
  const tabBox = (name: RegExp) => {
    const tab = within(main()).getByRole("radio", { name });
    expect(tab.querySelector("[data-drop-away]")).not.toBeNull();
    tab.getBoundingClientRect = () => new DOMRect(600, 10, 160, 40);
    return tab;
  };
  /** A mouse presses `el`, goes past the slop, then over the tab and lets go there. */
  const dragOnto = async (el: HTMLElement, tab: HTMLElement) => {
    await act(async () => {
      fireEvent.pointerDown(el, { button: 0, pointerId: 1, pointerType: "mouse", clientX: 100, clientY: 300 });
      fireEvent.pointerMove(document, { pointerId: 1, pointerType: "mouse", clientX: 120, clientY: 290 });
      fireEvent.pointerMove(document, { pointerId: 1, pointerType: "mouse", clientX: 680, clientY: 30 });
    });
    await settle(2);
    expect(tab.hasAttribute("data-drop-over")).toBe(true);
    await act(async () => {
      fireEvent.pointerUp(document, { pointerId: 1, pointerType: "mouse", clientX: 680, clientY: 30 });
      await new Promise((r) => setTimeout(r, 520));
    });
    await settle(6);
    expect(tab.hasAttribute("data-drop-over")).toBe(false);
  };

  test("a card dragged onto the Materiais do cliente tab goes to the end of a list there", async () => {
    const { state } = await go(PLAN, withPortal(), withMaterials);
    await dragOnto(card("Story de enquete"), tabBox(/Materiais do cliente/));
    const [moved] = calls(state, "portal.updateCard");
    expect(moved?.[1]).toBe("c-000003");
    const sent = moved?.[2] as { list: string; order: number };
    expect(sent.list).toBe("l-0000aa");
    expect(sent.order).toBeGreaterThan(1);
    expect(screen().getByText("“Story de enquete” foi para Materiais do cliente, na lista Acessos.")).toBeTruthy();
    expect(cardsIn("Semana 09 a 13/11")).toEqual([]);
  });

  test("with no list in the materials yet, the drop makes one, Geral, and the card goes into it", async () => {
    const { state, portal } = await go(PLAN);
    await dragOnto(card("Story de enquete"), tabBox(/Materiais do cliente/));
    expect(calls(state, "portal.createList")).toEqual([[ORG_ID, "acme", "Geral", "materials"]]);
    const made = portal.lists.find((l) => l.name === "Geral");
    expect(made?.kind).toBe("materials");
    expect((calls(state, "portal.updateCard")[0]?.[2] as { list: string } | undefined)?.list).toBe(made?.id as string);
    expect(screen().getByText("“Story de enquete” foi para Materiais do cliente, na lista Geral.")).toBeTruthy();
  });

  test("a whole list dragged by its head onto the tab goes to the materials with its cards", async () => {
    const { state } = await go(PLAN, withPortal(), withMaterials);
    const head = list("Semana 09 a 13/11").querySelector(".issues-col__head") as HTMLElement;
    await dragOnto(head, tabBox(/Materiais do cliente/));
    expect(calls(state, "portal.setListKind")).toEqual([[ORG_ID, "l-000002", "materials"]]);
    expect(calls(state, "portal.orderLists")).toEqual([]);
  });

  test("from the materials, a card dragged onto the schedule's tab goes back there", async () => {
    const { state } = await go(MATERIALS, withPortal(), withMaterials);
    await dragOnto(card("Login do Instagram"), tabBox(/Cronograma estratégico/));
    expect((calls(state, "portal.updateCard")[0]?.[2] as { list: string } | undefined)?.list).toBe("l-000001");
  });

  test("on the Quadro, a team card dragged onto the tab goes to the materials", async () => {
    const { state } = await go("portal?client=acme", withPortal(), withMaterials);
    const face = within(main()).getByRole("article", { name: "Ideia solta" });
    await dragOnto(face, tabBox(/Materiais do cliente/));
    expect(calls(state, "portal.updateCard")[0]?.slice(1, 2)).toEqual(["c-000004"]);
    expect((calls(state, "portal.updateCard")[0]?.[2] as { list: string } | undefined)?.list).toBe("l-0000aa");
  });

  test("a whole list moves to the materials from its menu; a list added there is one of materials", async () => {
    const { state } = await go(PLAN, withPortal(), withMaterials);
    const menu = await openMenu(
      within(list("Semana 09 a 13/11")).getByRole("button", { name: "Ações: Semana 09 a 13/11" }),
    );
    await click(within(menu).getByRole("menuitem", { name: "Mover para Materiais do cliente" }));
    expect(calls(state, "portal.setListKind")).toEqual([[ORG_ID, "l-000002", "materials"]]);
    expect(lists()).not.toContain("Semana 09 a 13/11");

    cleanup();
    const again = await go(MATERIALS, withPortal(), withMaterials);
    await click(within(main()).getByRole("button", { name: "Adicionar lista" }));
    const name = within(main()).getByRole("textbox", { name: "Nome da lista" });
    await act(async () => fireEvent.change(name, { target: { value: "Marca" } }));
    await act(async () => fireEvent.submit(name.closest("form") as HTMLFormElement));
    await settle(4);
    expect(calls(again.state, "portal.createList")).toEqual([[ORG_ID, "acme", "Marca", "materials"]]);
    expect(lists()).toEqual(["Acessos", "Marca"]);
  });
});
