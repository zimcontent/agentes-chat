import { describe, expect, test } from "bun:test";
import type { PlanCard, PortalBoard, PortalCard, PortalItem, PortalPlan } from "@agenteschat/client";
import {
  BOARD,
  boardColumns,
  boardIndexAt,
  boardListWidth,
  boardPaint,
  boardQuery,
  boardStep,
  cardBadges,
  cardMatches,
  cardOfItem,
  columnCount,
  commentsNewestFirst,
  contrast,
  coverOf,
  edgeScroll,
  findItem,
  isClientSlug,
  isPortalId,
  listShift,
  listSlotAt,
  listsFor,
  orderAfterDrop,
  orderNudged,
  otherTeamColumn,
  planGroups,
  readyToSend,
  releaseDateOf,
  STAGE_COLOR,
  searchGroups,
  sendInputOf,
  sendProblemOf,
  statusLine,
  summaryStatus,
} from "../../src/features/portal/model";
import { portalWords } from "../../src/features/portal/words";
import { appColors } from "../../src/ui/palette";

const counts = (over: Partial<Record<string, number>> = {}) => ({
  todo: 0,
  doing: 0,
  approval: 0,
  adjusting: 0,
  approved: 0,
  scheduled: 0,
  posted: 0,
  ...over,
});

const card = (over: Partial<PortalCard> = {}): PortalCard => ({
  id: "c1",
  client: "acme-foods",
  title: "Launch reel",
  type: "reel",
  state: "todo",
  caption: "",
  date: null,
  editor: null,
  owner: null,
  note: "",
  files: [],
  produceOn: null,
  list: null,
  order: 1,
  description: "",
  labels: [],
  members: [],
  checklist: [],
  comments: [],
  item: null,
  task: null,
  done: false,
  material: false,
  createdAt: 0,
  updatedAt: 0,
  ...over,
});

const planCard = (over: Partial<PlanCard> = {}): PlanCard => ({
  ...card(over),
  stage: "todo",
  postOn: null,
  link: null,
  ...over,
});

const item = (over: Partial<PortalItem> = {}): PortalItem => ({
  client: "acme-foods",
  id: "i1",
  title: "Post",
  type: "image",
  status: "sent",
  scheduledFor: null,
  released: false,
  publishedAt: null,
  createdAt: null,
  updatedAt: null,
  editor: null,
  caption: "",
  files: 1,
  video: false,
  version: 1,
  missing: [],
  lastNote: null,
  postUrl: null,
  link: "https://portal.example/p/i1",
  ...over,
});

const board = (over: Partial<PortalBoard["items"]> = {}, cards: PortalBoard["cards"] = { todo: [], doing: [] }) =>
  ({
    client: "acme-foods",
    cards,
    items: { approval: [], adjusting: [], approved: [], scheduled: [], posted: [], ...over },
  }) satisfies PortalBoard;

describe("portal on the phone", () => {
  test("a client's line from the overview's counts, by the pipeline's priority", () => {
    expect(summaryStatus({ open: 5, counts: counts({ adjusting: 2, approved: 1 }) })).toEqual({
      kind: "adjusting",
      count: 2,
    });
    expect(summaryStatus({ open: 3, counts: counts({ approved: 1, approval: 2 }) })).toEqual({
      kind: "schedule",
      count: 1,
    });
    expect(summaryStatus({ open: 2, counts: counts({ approval: 2 }) })).toEqual({ kind: "client", count: 2 });
    expect(summaryStatus({ open: 1, counts: counts({ doing: 1 }) })).toEqual({ kind: "making" });
    expect(summaryStatus({ open: 1, counts: counts({ scheduled: 1 }) })).toEqual({ kind: "clear" });
    expect(summaryStatus({ open: 0, counts: counts({ posted: 9 }) })).toEqual({ kind: "idle" });
  });

  test("the status in words, in both languages", () => {
    expect(statusLine(portalWords("pt-BR"), { kind: "adjusting", count: 1 })).toBe("1 ajuste pedido");
    expect(statusLine(portalWords("en"), { kind: "adjusting", count: 3 })).toBe("3 adjustments asked");
    expect(statusLine(portalWords("en"), { kind: "idle" })).toBe("Nothing open");
  });

  test("the words have the same keys in Portuguese and English", () => {
    const keys = (o: object, at = ""): string[] =>
      Object.entries(o).flatMap(([k, v]) =>
        v && typeof v === "object" ? keys(v, `${at}${k}.`) : [`${at}${k}:${typeof v}`],
      );
    expect(keys(portalWords("pt"))).toEqual(keys(portalWords("en")));
    expect(portalWords("es").title).toBe(portalWords("en").title);
  });

  test("the board's columns in order, team cards first, posts after", () => {
    const b = board({ approval: [item()] }, { todo: [card()], doing: [] });
    const cols = boardColumns(b);
    expect(cols.map((c) => c.column)).toEqual(["todo", "doing", "approval", "adjusting", "approved", "scheduled"]);
    expect(cols.filter((c) => columnCount(c) > 0).map((c) => c.column)).toEqual(["todo", "approval"]);
  });

  test("a post is found with its column, posted included", () => {
    const b = board({ posted: [item({ id: "p" })], adjusting: [item({ id: "a" })] });
    expect(findItem(b, "a")?.column).toBe("adjusting");
    expect(findItem(b, "p")?.column).toBe("posted");
    expect(findItem(b, "x")).toBeNull();
    expect(findItem(undefined, "a")).toBeNull();
  });

  test("a post opens the card it came from, wherever that card is", () => {
    const plan: PortalPlan = {
      client: "acme-foods",
      lists: [{ id: "l1", name: "Week 1", kind: "plan", cards: [planCard({ id: "a", item: "i1" })] }],
      unlisted: [planCard({ id: "b", item: "i2" })],
      loose: [],
      labels: [],
    };
    expect(cardOfItem(plan, "i1")?.id).toBe("a");
    expect(cardOfItem(plan, "i2")?.id).toBe("b");
    expect(cardOfItem(plan, "i3")).toBeNull();
  });

  test("the schedule's groups and the materials' stay apart; cards in no list close the schedule", () => {
    const plan: PortalPlan = {
      client: "acme-foods",
      lists: [
        {
          id: "l1",
          name: "Week 1",
          kind: "plan",
          cards: [planCard({ id: "b", order: 2 }), planCard({ id: "a", order: 1 })],
        },
        { id: "m1", name: "Logins", kind: "materials", cards: [planCard({ id: "m", material: true })] },
      ],
      unlisted: [planCard({ id: "u" })],
      loose: [],
      labels: [],
    };
    const schedule = planGroups(plan, "plan");
    expect(schedule.map((g) => g.id)).toEqual(["l1", null]);
    expect(schedule[0]?.cards.map((c) => c.id)).toEqual(["a", "b"]);
    expect(planGroups(plan, "materials").map((g) => g.id)).toEqual(["m1"]);
    expect(listsFor(plan, { material: true }).map((l) => l.id)).toEqual(["m1"]);
    expect(listsFor(plan, { material: false }).map((l) => l.id)).toEqual(["l1"]);
  });

  test("a card's cover: its first picture, else its first video", () => {
    expect(
      coverOf([
        { id: "v", name: "a.mp4" },
        { id: "i", name: "b.JPG" },
      ]),
    ).toEqual({
      file: { id: "i", name: "b.JPG" },
      kind: "image",
    });
    expect(coverOf([{ id: "v", name: "a.mov" }])?.kind).toBe("video");
    expect(coverOf([{ id: "d", name: "brief.pdf" }])).toBeNull();
  });

  test("why a card can't be sent, read from its files", () => {
    expect(sendProblemOf(card({ files: [] }))).toBe("noFiles");
    expect(sendProblemOf(card({ type: "reel", files: [{ id: "i", name: "a.png" }] }))).toBe("reelOneVideo");
    expect(sendProblemOf(card({ type: "reel", files: [{ id: "v", name: "a.mp4" }] }))).toBeNull();
    expect(sendProblemOf(card({ type: "carousel", files: [{ id: "d", name: "a.pdf" }] }))).toBe("notMedia");
  });

  test("a send carries what the card knows but its date, and only that", () => {
    const sent = sendInputOf(
      card({
        files: [{ id: "v", name: "a.mp4" }],
        caption: "Hello",
        date: "2026-11-20T14:00:00-03:00",
        editor: " Ana ",
      }),
      "k1",
    );
    expect(sent).toEqual({
      client: "acme-foods",
      type: "reel",
      artifactIds: ["v"],
      title: "Launch reel",
      caption: "Hello",
      editor: "Ana",
      card: "c1",
      key: "k1",
    });
    const bare = sendInputOf(card({ title: " ", date: "2026-11-20" }), "k2");
    expect("date" in bare).toBe(false);
    expect("title" in bare).toBe(false);
    expect("caption" in bare).toBe(false);
  });

  test("an approved post is released from the phone only for its own date still ahead", () => {
    const now = new Date(2026, 10, 16, 12, 0);
    expect(releaseDateOf(item({ status: "approved", scheduledFor: "2026-11-20T14:00:00-03:00" }), now)).toBe(
      "2026-11-20T14:00",
    );
    expect(releaseDateOf(item({ status: "approved", scheduledFor: "2026-11-10T14:00:00-03:00" }), now)).toBeNull();
    expect(releaseDateOf(item({ status: "approved", scheduledFor: null }), now)).toBeNull();
    expect(
      releaseDateOf(item({ status: "approved", released: true, scheduledFor: "2026-11-20T14:00:00-03:00" }), now),
    ).toBeNull();
    expect(releaseDateOf(item({ status: "sent", scheduledFor: "2026-11-20T14:00:00-03:00" }), now)).toBeNull();
  });

  test("route segments keep the portal's slugs and ids, and nothing that leaves the path", () => {
    expect(isClientSlug("acme-foods")).toBe(true);
    expect(isClientSlug("café_2.0")).toBe(true);
    expect(isClientSlug("..")).toBe(false);
    expect(isClientSlug("a/b")).toBe(false);
    expect(isClientSlug("")).toBe(false);
    expect(isClientSlug(undefined)).toBe(false);
    expect(isPortalId("6f1c2b-x")).toBe(true);
  });

  test("small rules: the other team column, comments newest first", () => {
    expect(otherTeamColumn("todo")).toBe("doing");
    expect(otherTeamColumn("doing")).toBe("todo");
    expect(
      commentsNewestFirst([
        { id: "a", by: "u", text: "", at: 1 },
        { id: "b", by: "u", text: "", at: 3 },
      ]).map((c) => c.id),
    ).toEqual(["b", "a"]);
  });
});

describe("the schedule as Trello's board on the phone", () => {
  test("a list takes the screen but the side, the gap and the next list's edge", () => {
    expect(boardListWidth(390)).toBe(390 - BOARD.side - BOARD.gap - BOARD.peek);
    expect(boardStep(390)).toBe(boardListWidth(390) + BOARD.gap);
    // A small phone keeps a list wide enough to read; a tablet doesn't stretch one across the screen.
    expect(boardListWidth(200)).toBe(BOARD.min);
    expect(boardListWidth(1024)).toBe(BOARD.max);
  });

  test("the list in front follows the swipe and never leaves the lists there are", () => {
    const step = boardStep(390);
    expect(boardIndexAt(0, step, 4)).toBe(0);
    expect(boardIndexAt(step * 0.4, step, 4)).toBe(0);
    expect(boardIndexAt(step * 0.6, step, 4)).toBe(1);
    expect(boardIndexAt(step * 2, step, 4)).toBe(2);
    expect(boardIndexAt(step * 9, step, 4)).toBe(3);
    expect(boardIndexAt(-40, step, 4)).toBe(0);
    expect(boardIndexAt(100, step, 0)).toBe(0);
  });

  test("a light board with dark lists and cards in both themes, every word and mark legible", () => {
    for (const dark of [false, true]) {
      const p = boardPaint(dark);
      const words = appColors("dark");
      // The board light, the lists dark on it, the cards a step above their list.
      expect(contrast(p.board, "#000000")).toBeGreaterThan(contrast(p.list, "#000000"));
      expect(contrast(p.card, "#000000")).toBeGreaterThan(contrast(p.list, "#000000"));
      for (const bg of [p.list, p.card]) {
        expect(contrast(words.ink, bg)).toBeGreaterThanOrEqual(4.5);
        expect(contrast(words.muted, bg)).toBeGreaterThanOrEqual(4.5);
        expect(contrast(words.faint, bg)).toBeGreaterThanOrEqual(4.5);
      }
      // The dots on the board, and the list on the board's light (a count is at least 3:1).
      expect(contrast(p.dotOn, p.board)).toBeGreaterThanOrEqual(4.5);
      expect(contrast(p.dot, p.board)).toBeGreaterThanOrEqual(3);
      expect(contrast(p.list, p.board)).toBeGreaterThanOrEqual(3);
      // Each stage's dot stays 3:1 on a card.
      for (const color of Object.values(STAGE_COLOR)) expect(contrast(color, p.card)).toBeGreaterThanOrEqual(3);
    }
  });

  test("a search reads words without case or accents, and a task's number with or without #", () => {
    expect(boardQuery("   ")).toBeNull();
    expect(boardQuery("Lançamento")).toEqual({ words: "lancamento", task: null });
    expect(boardQuery("#49")).toEqual({ words: "#49", task: 49 });
    expect(boardQuery("49")).toEqual({ words: "49", task: 49 });
  });

  test("a card answers by title, description, caption, label or task number", () => {
    const labels = new Map([["lb1", "Urgente"]]);
    const c = planCard({ title: "Carrossel lançamento", description: "Fotos da obra", caption: "Nova coleção" });
    const q = (text: string) => boardQuery(text) as NonNullable<ReturnType<typeof boardQuery>>;
    expect(cardMatches(c, q("lancamento"), undefined, labels)).toBe(true);
    expect(cardMatches(c, q("OBRA"), undefined, labels)).toBe(true);
    expect(cardMatches(c, q("coleção"), undefined, labels)).toBe(true);
    expect(cardMatches(c, q("urgente"), undefined, labels)).toBe(false);
    expect(cardMatches({ ...c, labels: ["lb1"] }, q("urgente"), undefined, labels)).toBe(true);
    expect(cardMatches(c, q("#49"), 49, labels)).toBe(true);
    expect(cardMatches(c, q("49"), 49, labels)).toBe(true);
    expect(cardMatches(c, q("#4"), 49, labels)).toBe(false);
    expect(cardMatches(c, q("reel"), 49, labels)).toBe(false);
  });

  test("while searching the board keeps only the matching cards, and hides lists with none", () => {
    const a = planCard({ id: "a", title: "Reel bastidores" });
    const b = planCard({ id: "b", title: "Story enquete" });
    const groups = [
      { id: "l1", name: "Semana 1", cards: [a, b] },
      { id: "l2", name: "Semana 2", cards: [b] },
      { id: null, name: null, cards: [a] },
    ];
    const numbers = new Map([["b", 12]]);
    expect(searchGroups(groups, null, numbers, [])).toEqual(groups);
    const reel = searchGroups(groups, boardQuery("reel"), numbers, []);
    expect(reel.map((g) => [g.id, g.cards.map((c) => c.id)])).toEqual([
      ["l1", ["a"]],
      [null, ["a"]],
    ]);
    expect(searchGroups(groups, boardQuery("#12"), numbers, []).map((g) => g.id)).toEqual(["l1", "l2"]);
    expect(searchGroups(groups, boardQuery("nada"), numbers, [])).toEqual([]);
  });

  test("a list dropped somewhere takes that place among the others", () => {
    const ids = ["a", "b", "c", "d"];
    expect(orderAfterDrop(ids, "a", 2)).toEqual(["b", "c", "a", "d"]);
    expect(orderAfterDrop(ids, "d", 0)).toEqual(["d", "a", "b", "c"]);
    expect(orderAfterDrop(ids, "b", 1)).toEqual(ids);
    expect(orderAfterDrop(ids, "b", 99)).toEqual(["a", "c", "d", "b"]);
    expect(orderAfterDrop(ids, "b", -3)).toEqual(["b", "a", "c", "d"]);
    expect(orderAfterDrop(ids, "zz", 0)).toEqual(ids);
  });

  test("the slot under a held list follows the finger and the board's scroll", () => {
    const step = boardStep(390);
    // The finger over the first list, the second, and past the last.
    expect(listSlotAt(0, BOARD.side + 10, step, 4)).toBe(0);
    expect(listSlotAt(0, BOARD.side + step + 10, step, 4)).toBe(1);
    expect(listSlotAt(step * 2, BOARD.side + 10, step, 4)).toBe(2);
    expect(listSlotAt(step * 9, 300, step, 4)).toBe(3);
    expect(listSlotAt(0, -50, step, 4)).toBe(0);
    expect(listSlotAt(0, 100, step, 0)).toBe(0);
  });

  test("while a list is held the others slide aside to show the order its drop makes", () => {
    const ids = ["a", "b", "c", "d"];
    for (const [from, slot] of [
      [0, 2],
      [3, 1],
      [1, 1],
      [2, 0],
    ] as const) {
      // Each list's place plus its slide is its place in the order the drop makes.
      const after = orderAfterDrop(ids, ids[from] as string, slot);
      ids.forEach((id, i) => {
        expect(i + listShift(i, from, slot)).toBe(after.indexOf(id));
      });
    }
    expect(listShift(-1, 0, 2)).toBe(0);
  });

  test("a held list near the board's side scrolls it that way, and in the middle it stays", () => {
    expect(edgeScroll(380, 390)).toBeGreaterThan(0);
    expect(edgeScroll(10, 390)).toBeLessThan(0);
    expect(edgeScroll(195, 390)).toBe(0);
  });

  test("moving a list one place left or right, and nothing at an end", () => {
    expect(orderNudged(["a", "b", "c"], "b", -1)).toEqual(["b", "a", "c"]);
    expect(orderNudged(["a", "b", "c"], "b", 1)).toEqual(["a", "c", "b"]);
    expect(orderNudged(["a", "b", "c"], "a", -1)).toBeNull();
    expect(orderNudged(["a", "b", "c"], "c", 1)).toBeNull();
    expect(orderNudged(["a", "b", "c"], "x", 1)).toBeNull();
  });

  test("a card's face counts its checklist, comments and files, and says when it has a description", () => {
    expect(cardBadges(planCard())).toEqual({ checks: null, comments: 0, files: 0, described: false });
    const full = planCard({
      description: "  Brief from the client  ",
      checklist: [
        { id: "a", text: "Script", done: true },
        { id: "b", text: "Shoot", done: false },
      ],
      comments: [{ id: "m", by: "u1", text: "ok", at: 1 }],
      files: [{ id: "f", name: "cover.png" }],
    } as Partial<PlanCard>);
    expect(cardBadges(full)).toEqual({ checks: { done: 1, total: 2 }, comments: 1, files: 1, described: true });
    expect(cardBadges(planCard({ description: "   " })).described).toBe(false);
  });

  test("the board's words exist in both languages", () => {
    for (const lang of ["pt-BR", "en"]) {
      const w = portalWords(lang);
      expect(w.addCard.length).toBeGreaterThan(0);
      expect(w.addDescription.endsWith("…")).toBe(true);
      expect(w.moveCardTitle("Reel")).toContain("Reel");
      expect(w.listOf(2, 9)).toContain("2");
    }
    expect(portalWords("pt-BR").addDescription).toBe("Adicione uma descrição mais detalhada…");
  });
});

describe("a card ready to go up from the board", () => {
  const base = {
    type: "image" as const,
    files: [{ id: "f", name: "a.png" }],
    stage: "doing" as const,
    done: true,
    material: false,
  };
  test("the team's, done and with its files", () => {
    expect(readyToSend(base)).toBe(true);
    expect(readyToSend({ ...base, stage: "todo" })).toBe(true);
  });
  test("not while it is being made, once it was sent, without files, or as a material", () => {
    expect(readyToSend({ ...base, done: false })).toBe(false);
    expect(readyToSend({ ...base, stage: "approval" })).toBe(false);
    expect(readyToSend({ ...base, files: [] })).toBe(false);
    expect(readyToSend({ ...base, material: true })).toBe(false);
  });
});
