import { afterEach, expect, test } from "bun:test";
import { setupDom } from "@dougbot/ui/testing/dom";

setupDom();

import type { ApiClient, VideoReview } from "@dougbot/client";
import { act, cleanup, fireEvent, within } from "@testing-library/react";
import { createFakeApi, ENG_ID, ORG_ID, seedState } from "./fake-api";
import { renderApp, screen, settle } from "./render";

/* Design review (docs/adr/doug-0010-design-review.md): the slides, numbered pins and notes by slide, the editor's lock. */

afterEach(() => {
  cleanup();
  localStorage.clear();
});

const REVIEW_ID = "11111111-2222-4333-8444-555555555555";
const note = (n: Partial<VideoReview["notes"][number]>): VideoReview["notes"][number] => ({
  id: crypto.randomUUID(),
  version: 1,
  atMs: null,
  endMs: null,
  page: null,
  kind: null,
  x: null,
  y: null,
  body: "",
  attachments: [],
  voice: false,
  author: { id: "u1", name: "Gabriel" },
  sent: false,
  createdAt: new Date().toISOString(),
  ...n,
});
const review = (over: Partial<VideoReview> = {}): VideoReview => ({
  id: REVIEW_ID,
  medium: "design",
  title: "Carrossel Glenwood",
  client: "Lexeer",
  status: "in_review",
  version: 1,
  artifactId: "a1",
  cover: "a1",
  agent: { id: "agent-1", name: "Rosa", handle: "rosa" },
  channelId: ENG_ID,
  threadId: null,
  openNotes: 2,
  updatedAt: new Date().toISOString(),
  createdAt: new Date().toISOString(),
  brief: "Carrossel de venda, 3 lâminas.",
  links: [],
  versions: [
    {
      version: 1,
      artifactId: "a1",
      note: "",
      light: false,
      pages: ["a1", "a2", "a3"],
      source: true,
      editedBy: null,
      createdAt: "",
    },
  ],
  notes: [
    note({ page: 2, x: 0.8, y: 0.2, kind: "layout", body: "foto em tela cheia" }),
    note({ page: 1, x: 0.5, y: 0.5, body: "logo no fundo" }),
    note({ page: null, body: "tom mais quente" }),
  ],
  decidedBy: null,
  decidedAt: null,
  ...over,
});

const go = async (r: VideoReview) => {
  const api = createFakeApi(seedState()) as ApiClient;
  const calls: string[] = [];
  api.videoReviews = {
    list: async () => ({ reviews: [r] }),
    get: async () => r,
    videoUrl: () => "",
    pageUrl: (_o, _r, v, n) => `/pages/${v}/${n}`,
    source: async () => "<html><body><section class='slide'><h1>Oi</h1></section></body></html>",
    saveDesign: async () => r,
    addNote: async (_o, _r, input) => {
      calls.push(`note:${input.page}:${input.body}`);
      return note({
        body: input.body,
        page: input.page ?? null,
        x: input.x ?? null,
        y: input.y ?? null,
        kind: input.kind ?? null,
      });
    },
    addVoiceNote: async () => note({}),
    deleteNote: async () => {},
    decide: async (_o, _r, input) => {
      calls.push(`decide:${input.decision}`);
      return r;
    },
  };
  await renderApp(`/org/${ORG_ID}/review/${REVIEW_ID}`, { api });
  await settle(10);
  return calls;
};

test("a piece shows its slides, the pins of the slide in view and its notes numbered in slide order", async () => {
  await go(review());
  const main = screen().getByRole("main");
  expect(within(main).getByText("Lâmina 1 de 3")).toBeTruthy();
  expect((within(main).getByRole("img", { name: "Lâmina 1" }) as HTMLImageElement).getAttribute("src")).toBe(
    "/pages/1/1",
  );
  // Pins are numbered as the list is, slide by slide: the slide-1 note is 1 even though it was written second.
  const pins = [...main.querySelectorAll(".dr-hit .dr-pin")].map((p) => p.textContent);
  expect(pins).toEqual(["1"]);
  expect(main.querySelectorAll(".dr-strip .dr-thumb").length).toBe(3);
  await act(async () => fireEvent.click(within(main).getByRole("button", { name: "Próxima lâmina" })));
  await settle(3);
  expect([...main.querySelectorAll(".dr-hit .dr-pin")].map((p) => p.textContent)).toEqual(["2"]);
  expect(within(main).getByText("Peça toda")).toBeTruthy();
});

test("a tap on the slide opens a note there; saving sends its slide", async () => {
  const calls = await go(review({ notes: [] }));
  const main = screen().getByRole("main");
  const hit = main.querySelector(".dr-hit") as HTMLElement;
  await act(async () => {
    fireEvent.pointerDown(hit, { clientX: 10, clientY: 10 });
    fireEvent.pointerUp(hit, { clientX: 10, clientY: 10 });
  });
  await settle(3);
  fireEvent.change(within(main).getByPlaceholderText("O que muda aqui?"), { target: { value: "título maior" } });
  await act(async () => fireEvent.click(within(main).getByRole("button", { name: "Salvar" })));
  await settle(4);
  expect(calls).toContain("note:1:título maior");
});

test("Editar stays locked on pictures only and once decided", async () => {
  await go(
    review({
      versions: [
        {
          version: 1,
          artifactId: "a1",
          note: "",
          light: false,
          pages: ["a1"],
          source: false,
          editedBy: null,
          createdAt: "",
        },
      ],
    }),
  );
  expect(screen().getByText("Esta versão é só imagem: não há o que editar.")).toBeTruthy();
  cleanup();
  await go(review({ status: "approved" }));
  expect(screen().getByText("Só a versão mais nova, em revisão, pode ser editada.")).toBeTruthy();
});
