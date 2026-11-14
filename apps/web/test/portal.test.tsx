import { afterEach, describe, expect, test } from "bun:test";
import { setupDom } from "@agenteschat/ui/testing/dom";

setupDom();

import { ApiError, keys, PORTAL_JOB_POLL_MS } from "@agenteschat/client";
import { act, cleanup, fireEvent, within } from "@testing-library/react";
import { createFakeApi, fakePortalOf, meWithRole, ORG_ID, seedState } from "./fake-api";
import { notification } from "./fakes/notifications";
import { type FakePortal, portalCard, portalItem } from "./fakes/portal";
import { renderApp, screen, settle } from "./render";

afterEach(() => {
  cleanup();
  localStorage.clear();
  sessionStorage.clear();
});

type State = ReturnType<typeof seedState>;
/** A server with an approval portal (ADR 9001). */
const withPortal = (over: Parameters<typeof seedState>[0] = {}) =>
  seedState({ ...over, authConfig: { approvalPortal: true } });
/**
 * Two clients: one with a card in each of the team's columns and a post waiting for approval, sent back, scheduled
 * and published; one with a single post the client approved, not scheduled yet.
 */
const fill = (portal: FakePortal) => {
  portal.cards = [
    portalCard({
      id: "c-000001",
      client: "acme-foods",
      title: "Lançamento do cardápio",
      type: "carousel",
      date: "2026-11-20",
      owner: "Maria",
      note: "Usar as fotos novas",
      files: [{ id: "11111111-1111-4111-8111-111111111111", name: "capa.png" }],
    }),
    portalCard({ id: "c-000002", client: "acme-foods", title: "Bastidores da cozinha", state: "doing" }),
  ];
  portal.items = [
    portalItem({ id: "p1", client: "acme-foods", title: "Reel de inauguração", status: "seen", missing: ["caption"] }),
    portalItem({
      id: "p2",
      client: "acme-foods",
      title: "Promoção de sexta",
      type: "image",
      status: "adjust_requested",
      lastNote: { at: null, by: "Joana", text: "Trocar a cor do <b>fundo</b>" },
    }),
    portalItem({
      id: "p3",
      client: "acme-foods",
      title: "Receita da semana",
      status: "scheduled",
      scheduledFor: "2026-11-21T14:00:00-03:00",
    }),
    portalItem({
      id: "p4",
      client: "acme-foods",
      title: "Abertura da loja",
      status: "published",
      publishedAt: "2026-10-05T10:00:00-03:00",
      postUrl: "https://social.example/p/abc",
    }),
    portalItem({ id: "p5", client: "blue-studio", title: "Antes e depois", status: "approved" }),
  ];
};
const go = async (path = "portal", state: State = withPortal(), seed: (portal: FakePortal) => void = fill) => {
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
/** A card's menu, opened with the keyboard as a person would (the kit's Menu opens on Enter). */
const openMenu = async (button: HTMLElement) => {
  button.focus();
  await act(async () => {
    fireEvent.keyDown(button, { key: "Enter" });
    fireEvent.keyUp(button, { key: "Enter" });
  });
  await settle(2);
  return screen().getByRole("menu");
};
const main = () => document.querySelector(".portal") as HTMLElement;
const nav = () => document.getElementById("app-nav") as HTMLElement;
// By its label, not its role: the page behind an open dialog is hidden from roles.
const column = (name: string) => main().querySelector(`.issues-col[aria-label="${name}"]`) as HTMLElement;
const cardsIn = (name: string) =>
  [...column(name).querySelectorAll(".portal-card .issue-card__title")].map((c) => c.textContent);
const calls = (state: State, method: string) => state.calls.filter((c) => c.method === method).map((c) => c.args);

describe("the overview", () => {
  test("the header counts clients and open work; a row per client, who asked for adjustments first", async () => {
    await go();
    expect(within(main()).getByRole("heading", { level: 1 }).textContent).toBe("Portal");
    expect(main().querySelector(".ac-pagehead")?.textContent).toContain("2 clientes · 6 em aberto");
    const clients = [...main().querySelectorAll(".portal-clientcard")];
    expect(clients.map((c) => c.querySelector(".portal-clientcard__name")?.textContent)).toEqual([
      "Acme Foods",
      "Blue Studio",
    ]);
    expect(clients[0]?.getAttribute("href")).toBe(`/org/${ORG_ID}/portal?client=acme-foods`);
    expect(clients[0]?.querySelector(".portal-clientcard__status")?.textContent).toBe("1 ajuste pedido");
    // Never the old column's name.
    expect(main().textContent).not.toContain("Pronto");
  });

  test("a client opens its board, and the way back returns to every client", async () => {
    const { router } = await go();
    await click(within(main()).getByRole("link", { name: /Blue Studio/ }));
    expect(router.state.location.search).toEqual({ client: "blue-studio" });
    expect(within(main()).getByRole("heading", { level: 1 }).textContent).toBe("Blue Studio");
    expect(cardsIn("Aprovado")).toEqual(["Antes e depois"]);
    await click(within(main()).getByRole("button", { name: "Todos os clientes" }));
    expect(router.state.location.search).toEqual({});
    expect(main().querySelectorAll(".portal-clientcard").length).toBe(2);
  });

  test("a server with no portal says so, with nothing to press", async () => {
    await go("portal", seedState());
    expect(within(main()).getByText("Nenhum portal de aprovação conectado")).toBeTruthy();
    expect(within(main()).queryByRole("button")).toBeNull();
  });

  test("a portal that doesn't answer: what happened, and another try", async () => {
    const { portal } = await go("portal", withPortal(), (p) => {
      fill(p);
      p.fail = new ApiError(502, "portal.unavailable", "The approval portal isn't available right now");
    });
    expect(within(main()).getByText("O portal de aprovação não está respondendo agora.")).toBeTruthy();
    expect(portal.fail).toBeNull();
    await click(within(main()).getByRole("button", { name: "Tentar de novo" }));
    expect(main().querySelectorAll(".portal-clientcard").length).toBe(2);
  });
});

describe("how fresh the portal's side is", () => {
  const notices = () => [...main().querySelectorAll(".portal-notices .ac-alert")].map((n) => n.textContent);
  /** A moment of today, so the line says only the hour. */
  const today = (hours: number, minutes: number) => {
    const at = new Date();
    at.setHours(hours, minutes, 0, 0);
    return at.toISOString();
  };

  test("nothing shows while the portal answers and nothing waits to reach it", async () => {
    await go();
    expect(main().querySelector(".portal-notices")).toBeNull();
    await click(within(main()).getByRole("link", { name: /Acme Foods/ }));
    expect(main().querySelector(".portal-notices")).toBeNull();
  });

  test("the portal not answering: the page says it shows the last read and when; changes on their way are counted", async () => {
    await go("portal", withPortal(), (p) => {
      fill(p);
      p.state = { stale: true, readAt: today(9, 5), queued: 2 };
    });
    expect(notices()).toEqual([
      "O portal não está respondendo. Mostrando os dados de 09:05.",
      "2 alterações aguardando chegar ao portal.",
    ]);
    // The warning is announced as one, the count is a plain notice.
    expect(within(main()).getByRole("alert").textContent).toContain("O portal não está respondendo.");
    // What was read last still shows under it, and a client's board says the same.
    expect(main().querySelectorAll(".portal-clientcard").length).toBe(2);
    await click(within(main()).getByRole("link", { name: /Acme Foods/ }));
    expect(notices()).toEqual([
      "O portal não está respondendo. Mostrando os dados de 09:05.",
      "2 alterações aguardando chegar ao portal.",
    ]);
    expect(cardsIn("Em ajuste")).toEqual(["Promoção de sexta"]);
  });

  test("one change waiting while the portal answers: the count alone, and no time when none is known", async () => {
    const { portal, services } = await go("portal?client=acme-foods", withPortal(), (p) => {
      fill(p);
      p.state = { stale: false, readAt: null, queued: 1 };
    });
    expect(notices()).toEqual(["1 alteração aguardando chegar ao portal."]);
    expect(within(main()).queryByRole("alert")).toBeNull();
    portal.state = { stale: true, readAt: null, queued: 0 };
    await act(async () => void (await services.queryClient.refetchQueries({ queryKey: keys.portal(ORG_ID) })));
    await settle(4);
    expect(notices()).toEqual(["O portal não está respondendo. Mostrando a última leitura."]);
  });
});

describe("a client's board", () => {
  test("six columns: the team's cards in the first two, the portal's posts in the others", async () => {
    await go("portal?client=acme-foods");
    expect([...main().querySelectorAll(".issues-col")].map((c) => c.querySelector("h2")?.textContent)).toEqual([
      "A produzir",
      "Em produção",
      "Para aprovação",
      "Em ajuste",
      "Aprovado",
      "Agendado",
    ]);
    expect(cardsIn("A produzir")).toEqual(["Lançamento do cardápio"]);
    expect(cardsIn("Em produção")).toEqual(["Bastidores da cozinha"]);
    expect(cardsIn("Para aprovação")).toEqual(["Reel de inauguração"]);
    expect(cardsIn("Em ajuste")).toEqual(["Promoção de sexta"]);
    expect(cardsIn("Aprovado")).toEqual([]);
    expect(cardsIn("Agendado")).toEqual(["Receita da semana"]);
    // A scheduled post is nobody's move: nothing to schedule again.
    expect(within(column("Agendado")).queryByRole("button", { name: "Agendar post" })).toBeNull();

    const card = within(column("A produzir")).getByRole("article", { name: "Lançamento do cardápio" });
    expect(card.textContent).toContain("Carrossel");
    expect(card.textContent).toContain("20 de nov.");
    expect(card.textContent).toContain("Maria");
    expect(card.textContent).toContain("1 arquivo");
    expect(card.textContent).toContain("Usar as fotos novas");
    expect(within(card).getByRole("button", { name: "Subir para aprovação" })).toBeTruthy();

    const seen = within(column("Para aprovação")).getByRole("article", { name: "Reel de inauguração" });
    expect([...seen.querySelectorAll(".ac-chip")].map((c) => c.textContent)).toEqual(["Reel", "Visto", "Sem legenda"]);
    const link = within(seen).getByRole("link", { name: "Abrir no portal" });
    expect(link.getAttribute("href")).toBe("https://portal.example/acme-foods/p1");
    expect(link.getAttribute("target")).toBe("_blank");
    expect(link.getAttribute("rel")).toBe("noopener noreferrer");

    // What the client typed is plain words: its tags show as text, never as markup.
    const asked = within(column("Em ajuste")).getByRole("article", { name: "Promoção de sexta" });
    expect(asked.querySelector(".ac-chip--waiting")?.textContent).toBe("Ajuste pedido");
    const note = asked.querySelector(".portal-card__note--asked") as HTMLElement;
    expect(note.textContent).toBe("JoanaTrocar a cor do <b>fundo</b>");
    expect(note.querySelectorAll("b").length).toBe(1);
  });

  test("Postados: what went out, by month, with the way to the published post", async () => {
    const { router } = await go("portal?client=acme-foods");
    await click(within(main()).getByRole("radio", { name: /Postados/ }));
    expect(router.state.location.search).toEqual({ client: "acme-foods", tab: "posted" });
    const month = within(main()).getByRole("region", { name: "outubro de 2026" });
    expect(month.querySelector(".portal-posted__title")?.textContent).toBe("Abertura da loja");
    expect(month.querySelector(".portal-posted__when")?.textContent).toBe("5 de out., 10:00");
    expect(within(month).getByRole("link", { name: "Ver o post" }).getAttribute("href")).toBe(
      "https://social.example/p/abc",
    );
    expect(main().querySelector(".issues-col")).toBeNull();
    // No card stands for this post: nothing of it is in the Drive.
    expect(within(month).queryByRole("link", { name: "Link do Drive" })).toBeNull();
  });

  test("Postados: a post whose card carries files also opens its file in the Drive", async () => {
    await go("portal?client=acme-foods&tab=posted", withPortal(), (portal) => {
      fill(portal);
      portal.cards.push(
        portalCard({
          id: "c-000009",
          client: "acme-foods",
          title: "Abertura da loja",
          item: "p4",
          files: [{ id: "22222222-2222-4222-8222-222222222222", name: "abertura.mp4" }],
        }),
      );
    });
    const month = within(main()).getByRole("region", { name: "outubro de 2026" });
    expect(within(month).getByRole("link", { name: "Ver o post" })).toBeTruthy();
    expect(within(month).getByRole("link", { name: "Link do Drive" }).getAttribute("href")).toBe(
      `/org/${ORG_ID}/drive?artifact=22222222-2222-4222-8222-222222222222`,
    );
  });

  test("a client's colour: picked on its page, it marks the client and its work on the overview", async () => {
    const { state, portal } = await go("portal?client=acme-foods");
    const menu = await openMenu(within(main()).getByRole("button", { name: /Cor do cliente/ }));
    expect(within(menu).getAllByRole("menuitem")).toHaveLength(13);
    await click(within(menu).getByRole("menuitem", { name: /Azul escuro/ }));
    expect(calls(state, "portal.setClientColor")).toEqual([[ORG_ID, "acme-foods", "navy"]]);
    expect(portal.colors).toEqual({ "acme-foods": "navy" });
    // The button says the colour chosen.
    expect(within(main()).getByRole("button", { name: /Azul escuro/ })).toBeTruthy();
    cleanup();

    await go("portal", withPortal(), (fake) => {
      fill(fake);
      fake.colors = { "acme-foods": "navy" };
    });
    const mark = (client: string) => main().querySelector(`.portal-clientcard[href*="client=${client}"] .portal-mark`);
    expect(mark("acme-foods")?.getAttribute("data-client-color")).toBe("navy");
    expect(mark("blue-studio")?.getAttribute("data-client-color")).toBeNull();
    // In the pipeline the label with the client's name is in its colour; the card itself stays the board's own.
    const labels = [...main().querySelectorAll(".portal-pipeline .portal-clientchip[data-client-color]")];
    expect(labels.length).toBeGreaterThan(0);
    expect(labels.every((el) => el.textContent === "Acme Foods")).toBe(true);
    expect(labels.every((el) => el.getAttribute("data-client-color") === "navy")).toBe(true);
    expect(main().querySelector(".portal-pipeline .portal-card[data-client-color]")).toBeNull();
  });

  test("a card moves between A produzir and Em produção from its menu", async () => {
    const { state } = await go("portal?client=acme-foods");
    const menu = await openMenu(
      within(column("A produzir")).getByRole("button", { name: "Ações: Lançamento do cardápio" }),
    );
    await click(within(menu).getByRole("menuitem", { name: "Mover para Em produção" }));
    expect(calls(state, "portal.updateCard")).toEqual([[ORG_ID, "c-000001", { state: "doing" }]]);
    expect(cardsIn("A produzir")).toEqual([]);
    expect(cardsIn("Em produção")).toEqual(["Lançamento do cardápio", "Bastidores da cozinha"]);
  });

  test("Novo cartão: the title is all it needs, and it lands in A produzir", async () => {
    const { state } = await go("portal?client=acme-foods");
    await click(within(main()).getByRole("button", { name: "Novo cartão" }));
    const dialog = screen().getByRole("dialog", { name: "Novo cartão" });
    const save = within(dialog).getByRole("button", { name: "Salvar" }) as HTMLButtonElement;
    expect(save.disabled).toBe(true);
    await act(async () =>
      fireEvent.change(within(dialog).getByLabelText("Título"), { target: { value: "Depoimento do chef" } }),
    );
    await click(save);
    expect(calls(state, "portal.createCard")[0]?.[1]).toMatchObject({
      client: "acme-foods",
      title: "Depoimento do chef",
      type: "reel",
      files: [],
    });
    expect(screen().queryByRole("dialog", { name: "Novo cartão" })).toBeNull();
    expect(cardsIn("A produzir")).toEqual(["Lançamento do cardápio", "Depoimento do chef"]);
  });

  test("a card is deleted only after a yes", async () => {
    const { state } = await go("portal?client=acme-foods");
    const menu = await openMenu(
      within(column("Em produção")).getByRole("button", { name: "Ações: Bastidores da cozinha" }),
    );
    await click(within(menu).getByRole("menuitem", { name: "Excluir" }));
    const dialog = screen().getByRole("dialog", { name: "Excluir este cartão?" });
    expect(dialog.textContent).toContain("“Bastidores da cozinha” sai do quadro.");
    expect(calls(state, "portal.deleteCard")).toEqual([]);
    await click(within(dialog).getByRole("button", { name: "Excluir" }));
    expect(calls(state, "portal.deleteCard")).toEqual([[ORG_ID, "c-000002"]]);
    expect(cardsIn("Em produção")).toEqual([]);
  });

  test("Subir para aprovação from a card: its fields and files go, the send is followed to its end", async () => {
    const { state, portal, services } = await go("portal?client=acme-foods");
    portal.holdSends = true;
    const card = within(column("A produzir")).getByRole("article", { name: "Lançamento do cardápio" });
    await click(within(card).getByRole("button", { name: "Subir para aprovação" }));
    const dialog = screen().getByRole("dialog", { name: "Subir para aprovação" });
    expect((within(dialog).getByLabelText("Título") as HTMLInputElement).value).toBe("Lançamento do cardápio");
    expect(dialog.querySelector(".portal-files__name")?.textContent).toBe("capa.png");
    await click(within(dialog).getByRole("button", { name: "Subir" }));
    const [sent] = calls(state, "portal.send");
    expect(sent?.[1]).toMatchObject({
      client: "acme-foods",
      type: "carousel",
      artifactIds: ["11111111-1111-4111-8111-111111111111"],
      title: "Lançamento do cardápio",
      date: "2026-11-20T09:00",
      card: "c-000001",
    });
    expect(typeof (sent?.[1] as { key?: string } | undefined)?.key).toBe("string");
    expect(within(dialog).getByRole("status").textContent).toBe("Subindo para a aprovação de Acme Foods…");

    // The send is asked about every 2 s while it goes: here the next ask comes at once.
    const [job] = [...portal.jobs.keys()] as [string];
    const asking = services.queryClient.getQueryCache().find({ queryKey: keys.portalJob(ORG_ID, job) });
    expect(asking?.observers.map((o) => typeof o.options.refetchInterval)).toEqual(["function"]);
    expect(PORTAL_JOB_POLL_MS).toBe(2000);
    portal.finish(job, { missing: ["cover"] });
    await act(async () => void (await services.queryClient.refetchQueries({ queryKey: keys.portalJob(ORG_ID, job) })));
    await settle(6);
    expect(within(dialog).getByRole("status").textContent).toBe("Subiu para aprovação.");
    expect(dialog.querySelector(".portal-send__missing")?.textContent).toBe("Ainda faltaSem capa");
    expect(within(dialog).getByRole("link", { name: "Abrir no portal" }).getAttribute("rel")).toBe(
      "noopener noreferrer",
    );
    // The board was read again as the send ended: the card left, the post waits for the client.
    expect(cardsIn("A produzir")).toEqual([]);
    expect(cardsIn("Para aprovação")).toEqual(["Reel de inauguração", "Lançamento do cardápio"]);
  });

  test("a reel takes one video: pictures alone can't go as one, and the form says why", async () => {
    await go("portal?client=acme-foods");
    const card = within(column("A produzir")).getByRole("article", { name: "Lançamento do cardápio" });
    await click(within(card).getByRole("button", { name: "Subir para aprovação" }));
    const dialog = screen().getByRole("dialog", { name: "Subir para aprovação" });
    const submit = () => within(dialog).getByRole("button", { name: "Subir" }) as HTMLButtonElement;
    expect(submit().disabled).toBe(false);
    await click(within(dialog).getByRole("combobox", { name: "Tipo" }));
    await click(screen().getByRole("option", { name: "Reel" }));
    expect(submit().disabled).toBe(true);
    expect(dialog.textContent).toContain("Um reel é um vídeo só. A capa vai à parte.");
    expect(within(dialog).getByRole("button", { name: "Escolher a capa" })).toBeTruthy();
  });

  test("the portal's refusal shows in its own words, and the card dialog stays open", async () => {
    const { portal } = await go("portal?client=acme-foods");
    await click(within(main()).getByRole("button", { name: "Novo cartão" }));
    const dialog = screen().getByRole("dialog", { name: "Novo cartão" });
    await act(async () => fireEvent.change(within(dialog).getByLabelText("Título"), { target: { value: "X" } }));
    portal.fail = new ApiError(400, "portal.refused", "Este cliente não aceita cards novos");
    await click(within(dialog).getByRole("button", { name: "Salvar" }));
    expect(within(dialog).getByRole("alert").textContent).toBe("Este cliente não aceita cards novos");
  });

  test("without the permission to give agents work: everything to read, nothing to press on a card", async () => {
    const state = withPortal();
    meWithRole(state, []);
    // What the server sends a member whose roles don't let them give agents work.
    const org = state.me?.organizations[0];
    if (org) org.permissions = ["read", "post"];
    await go("portal?client=acme-foods", state);
    expect(cardsIn("A produzir")).toEqual(["Lançamento do cardápio"]);
    expect(within(main()).queryByRole("button", { name: "Novo cartão" })).toBeNull();
    expect(within(main()).queryByRole("button", { name: "Subir para aprovação" })).toBeNull();
    expect(within(main()).queryByRole("button", { name: /^Ações/ })).toBeNull();
    expect(within(main()).queryByRole("button", { name: /^Editar/ })).toBeNull();
    expect(within(main()).queryByRole("button", { name: "Agendar post" })).toBeNull();
    // The way to the portal stays: reading needs no permission.
    expect(within(main()).getAllByRole("link", { name: "Abrir no portal" }).length).toBe(3);
  });
});

describe("Agendar post", () => {
  /**
   * Blue Studio with three more approved posts: one with a date proposed far ahead, one with a date long gone, and
   * one already released for scheduling.
   */
  const approved = (portal: FakePortal) => {
    fill(portal);
    portal.items.push(
      portalItem({
        id: "p6",
        client: "blue-studio",
        title: "Vídeo do evento",
        status: "approved",
        scheduledFor: "2099-01-15T10:30:00-03:00",
      }),
      portalItem({
        id: "p7",
        client: "blue-studio",
        title: "Retrospectiva",
        status: "approved",
        scheduledFor: "2020-01-01T10:00:00-03:00",
      }),
      portalItem({
        id: "p8",
        client: "blue-studio",
        title: "Bastidores do ensaio",
        status: "approved",
        scheduledFor: "2099-02-01T09:00:00-03:00",
        released: true,
      }),
    );
  };
  const post = (title: string) => within(column("Aprovado")).getByRole("article", { name: title });
  const open = async (title: string) => {
    await click(within(post(title)).getByRole("button", { name: "Agendar post" }));
    return screen().getByRole("dialog", { name: "Agendar post" });
  };
  const confirm = (dialog: HTMLElement) =>
    within(dialog).getByRole("button", { name: "Confirmar" }) as HTMLButtonElement;

  test("every approved post not released yet carries it; with no date the dialog starts empty and can't be confirmed", async () => {
    const { state } = await go("portal?client=blue-studio", withPortal(), approved);
    expect(cardsIn("Aprovado")).toEqual(["Antes e depois", "Vídeo do evento", "Retrospectiva", "Bastidores do ensaio"]);
    expect(within(column("Aprovado")).getAllByRole("button", { name: "Agendar post" }).length).toBe(3);
    expect(post("Antes e depois").textContent).not.toContain("agendando…");
    // One already released says so and can't be released again: the portal would refuse it.
    const released = post("Bastidores do ensaio");
    expect([...released.querySelectorAll(".ac-chip")].map((c) => c.textContent)).toEqual([
      "Reel",
      "Aprovado",
      "agendando…",
    ]);
    expect(within(released).queryByRole("button", { name: "Agendar post" })).toBeNull();
    const dialog = await open("Antes e depois");
    // It says where the post goes and that Agendado comes a few minutes later.
    expect(dialog.textContent).toContain("O post vai sozinho para o serviço de publicação");
    expect(dialog.textContent).toContain("Ele passa para Agendado em alguns minutos.");
    expect((within(dialog).getByRole("combobox", { name: "Hora" }) as HTMLInputElement).value).toBe("");
    expect(confirm(dialog).disabled).toBe(true);
    expect(calls(state, "portal.schedule")).toEqual([]);
  });

  test("a proposed date is no release: the dialog opens on it, and confirming releases the post for that time", async () => {
    const { state } = await go("portal?client=blue-studio", withPortal(), approved);
    const chips = () => [...post("Vídeo do evento").querySelectorAll(".ac-chip")].map((c) => c.textContent);
    expect(chips()).toEqual(["Reel", "Aprovado"]);
    const dialog = await open("Vídeo do evento");
    expect((within(dialog).getByRole("combobox", { name: "Hora" }) as HTMLInputElement).value).toBe("10:30");
    expect(confirm(dialog).disabled).toBe(false);
    await click(confirm(dialog));
    expect(calls(state, "portal.schedule")).toEqual([[ORG_ID, "blue-studio", "p6", "2099-01-15T10:30"]]);
    expect(screen().queryByRole("dialog", { name: "Agendar post" })).toBeNull();
    expect(screen().getByText("Liberado para 15 de jan. de 2099, 10:30.")).toBeTruthy();
    // Still in Aprovado right after, with its date: the publishing service confirms it a few minutes later. Until
    // then it reads as scheduling, with nothing left to press.
    expect(cardsIn("Aprovado")).toContain("Vídeo do evento");
    expect(chips()).toEqual(["Reel", "Aprovado", "agendando…"]);
    expect(within(post("Vídeo do evento")).queryByRole("button", { name: "Agendar post" })).toBeNull();
  });

  test("a time that already passed can't be confirmed, and the dialog says so", async () => {
    await go("portal?client=blue-studio", withPortal(), approved);
    const dialog = await open("Retrospectiva");
    expect(dialog.textContent).toContain("Escolha um horário que ainda não passou.");
    expect(confirm(dialog).disabled).toBe(true);
  });

  test("the portal's refusal shows in the dialog in its own words, and the dialog stays", async () => {
    const { portal } = await go("portal?client=blue-studio", withPortal(), approved);
    const dialog = await open("Vídeo do evento");
    portal.fail = new ApiError(400, "portal.refused", "Este post ainda não foi aprovado pelo cliente");
    await click(confirm(dialog));
    expect(within(dialog).getByRole("alert").textContent).toBe("Este post ainda não foi aprovado pelo cliente");
    expect(screen().getByRole("dialog", { name: "Agendar post" })).toBeTruthy();
  });
});

describe("Portal in the sidebar", () => {
  const tools = () =>
    // The tools in the list: not Configurações, and not More's copies of the ones it holds (shown only when open).
    [...nav().querySelectorAll<HTMLElement>(".sidebar__tools a.sidebar__item:not(.sidebar__dock-settings)")]
      .filter((a) => !a.closest(".sidebar__more-active"))
      .map((a) => a.querySelector(".sidebar__item-label") as HTMLElement)
      .map((l) => l.textContent);
  const openMore = async () => {
    await click(within(nav()).getByRole("button", { name: "Mais" }));
    return screen().getByRole("dialog", { name: "Mais" });
  };
  const quiet = (state: State) => {
    for (const a of state.approvals) a.status = "approved";
    for (const p of state.proposals) p.status = "accepted";
    return state;
  };

  test("only where the server has a portal: listed by default, and in Go to…", async () => {
    await go("portal", quiet(withPortal()));
    expect(tools()).toEqual(["Início", "Portal", "Threads", "Tarefas", "Drive"]);
    const row = within(nav()).getByRole("link", { name: "Portal" });
    expect(row.getAttribute("href")).toBe(`/org/${ORG_ID}/portal`);
    expect(row.getAttribute("data-status")).toBe("active");
  });

  test("without one nothing changes: not in the list, not in More, not in Personalizar", async () => {
    await go("drive", quiet(seedState()));
    expect(tools()).toEqual(["Início", "Threads", "Tarefas", "Drive"]);
    const more = await openMore();
    expect(within(more).queryByRole("link", { name: /Portal/ })).toBeNull();
    await click(within(more).getByRole("button", { name: "Personalizar a barra lateral" }));
    const setup = screen().getByRole("dialog", { name: "Personalizar a barra lateral" });
    expect(within(setup).queryByRole("radiogroup", { name: "Portal" })).toBeNull();
    expect(within(setup).getByRole("radiogroup", { name: "Esperando você" })).toBeTruthy();
  });

  test("with something waiting on me, Esperando você and Portal share one row, each its own link", async () => {
    await go(
      "drive",
      quiet(withPortal({ notifications: [notification({ id: "w1", kind: "mention", waiting: true })] })),
    );
    const pair = nav().querySelector(".sidebar__pair") as HTMLElement;
    expect([...pair.querySelectorAll("a .sidebar__item-label")].map((l) => l.textContent)).toEqual([
      "Esperando você",
      "Portal",
    ]);
    expect(
      within(pair)
        .getByRole("link", { name: /Esperando você/ })
        .getAttribute("href"),
    ).toBe(`/org/${ORG_ID}/waiting`);
    expect(tools()).toEqual(["Início", "Esperando você", "Portal", "Threads", "Tarefas", "Drive"]);
  });

  test("a personal workspace's list draws rows: there the two are side by side on one row of their own", async () => {
    const state = quiet(withPortal({ notifications: [notification({ id: "w1", kind: "mention", waiting: true })] }));
    const org = state.me?.organizations[0];
    if (org) org.mode = "personal";
    await go("drive", state);
    const pair = nav().querySelector(".sidebar__tools > .sidebar__pair") as HTMLElement;
    expect(pair.closest(".sidebar__dock")).toBeNull();
    expect([...pair.children].map((c) => c.querySelector(".sidebar__item-label")?.textContent)).toEqual([
      "Esperando você",
      "Portal",
    ]);
    // What waits on me keeps its count beside its name.
    expect(pair.querySelector(".ac-count")?.textContent).toBe("1");
  });

  test("moved to More, it leaves the list and the pair with it", async () => {
    await go("drive", quiet({ ...withPortal(), sidebarItems: { portal: "more" } }));
    expect(tools()).toEqual(["Início", "Threads", "Tarefas", "Drive"]);
    expect(nav().querySelector(".sidebar__pair")).toBeNull();
    expect(
      within(await openMore())
        .getByRole("link", { name: /Portal/ })
        .getAttribute("href"),
    ).toBe(`/org/${ORG_ID}/portal`);
  });
});

describe("a card's task on Tarefas", () => {
  test("the task says it is a client's post in the Portal, and the link opens that client's board on the card", async () => {
    const api = createFakeApi(withPortal());
    fill(fakePortalOf.get(api) as FakePortal);
    // The task as the server sends a card's: its source names the client and the card.
    const read = api.issues.get;
    api.issues.get = async (orgId, number) => ({
      ...(await read(orgId, number)),
      source: { type: "portal", client: "acme-foods", cardId: "c-000001" },
    });
    const { router } = await renderApp(`/org/${ORG_ID}/issues/131`, { api });
    await settle(8);
    const link = screen().getByRole("link", { name: "Post de Acme Foods no Portal" });
    expect(link.getAttribute("href")).toBe(`/org/${ORG_ID}/portal?client=acme-foods&card=c-000001`);
    await click(link);
    expect(router.state.location.search).toEqual({ client: "acme-foods", card: "c-000001" });
    expect(screen().getByRole("dialog", { name: "Lançamento do cardápio" })).toBeTruthy();
  });
});
