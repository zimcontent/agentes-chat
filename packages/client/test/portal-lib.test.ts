import { describe, expect, test } from "bun:test";
import type { TFunction } from "i18next";
import { ApiError } from "../src/api/http";
import type { PlanCard, PortalClientSummary, PortalColumn, PortalPipelineEntry, PortalPlan } from "../src/api/types";
import {
  filterPipeline,
  movedInPlan,
  PORTAL_BOARD_COLUMNS,
  PORTAL_COLUMNS,
  PORTAL_PIPELINE_STAGES,
  pipelineClientStatus,
  pipelineClients,
  pipelineNextPost,
  pipelinePeople,
  pipelineSteps,
  pipelineTiles,
  planCards,
  portalAhead,
  portalCalendar,
  portalChecks,
  portalClientHue,
  portalClientInitials,
  portalClientName,
  portalDayOf,
  portalErrorText,
  portalLink,
  portalListAcross,
  portalOrderAt,
  portalPostedByMonth,
  portalScheduling,
  portalSendDate,
  portalSendProblem,
  portalStatusWaits,
  portalTaskNumbers,
  portalTextParts,
  portalTimeOf,
  portalTotals,
  portalWhen,
  portalWithResponsible,
  rememberPortalClientNames,
  sortPipelineByProduction,
  sortPortalClients,
} from "../src/lib/portal";

const counts = (over: Partial<Record<PortalColumn, number>> = {}): Record<PortalColumn, number> => ({
  todo: 0,
  doing: 0,
  approval: 0,
  adjusting: 0,
  approved: 0,
  scheduled: 0,
  posted: 0,
  ...over,
});
const client = (name: string, open: number, over: Partial<Record<PortalColumn, number>> = {}): PortalClientSummary => ({
  client: name,
  counts: counts(over),
  open,
  next: null,
});
/** The key itself, so a test reads which words were picked. */
const t = ((key: string) => key) as unknown as TFunction;

describe("the approval portal's board (ADR 9001)", () => {
  test("seven columns, the last one a list of its own: the board shows six", () => {
    expect(PORTAL_COLUMNS).toEqual(["todo", "doing", "approval", "adjusting", "approved", "scheduled", "posted"]);
    expect([...PORTAL_BOARD_COLUMNS] as string[]).toEqual(PORTAL_COLUMNS.slice(0, 6));
  });

  test("a client's id reads as a name", () => {
    expect(portalClientName("acme-foods")).toBe("Acme Foods");
    expect(portalClientName("blue")).toBe("Blue");
  });

  test("the team's name wins over the id's, hidden clients' included, until a read says none", () => {
    rememberPortalClientNames({
      clients: [{ client: "acme-foods", name: "ACME" }, { client: "blue" }],
      hidden: [{ client: "teste-ajustes", name: "Teste" }],
    });
    expect(portalClientName("acme-foods")).toBe("ACME");
    expect(portalClientName("blue")).toBe("Blue");
    expect(portalClientName("teste-ajustes")).toBe("Teste");
    expect(portalClientInitials("acme-foods")).toBe("A");
    rememberPortalClientNames({ clients: [] });
    expect(portalClientName("acme-foods")).toBe("Acme Foods");
  });

  test("the overview: what waits on the team first (adjustments, then approved and not scheduled), then the busiest", () => {
    const sorted = sortPortalClients([
      client("quiet", 1),
      client("busy", 9),
      client("approved", 2, { approved: 2 }),
      client("asked", 1, { adjusting: 1 }),
    ]);
    expect(sorted.map((c) => c.client)).toEqual(["asked", "approved", "busy", "quiet"]);
    expect(portalTotals(sorted)).toEqual({ counts: counts({ approved: 2, adjusting: 1 }), open: 13 });
  });

  test("what was published, newest first, by the month the portal wrote", () => {
    const item = (id: string, publishedAt: string | null) => ({ id, publishedAt, scheduledFor: null, updatedAt: null });
    const groups = portalPostedByMonth([
      item("old", "2026-09-30T23:30:00-03:00"),
      item("none", null),
      item("new", "2026-10-05T10:00:00-03:00"),
      item("mid", "2026-10-01T08:00:00-03:00"),
    ]);
    expect(groups.map((g) => [g.month, g.items.map((i) => i.id)])).toEqual([
      ["2026-10", ["new", "mid"]],
      // 23:30 at the portal stays in September, whatever this machine's time zone makes of it.
      ["2026-09", ["old"]],
      [null, ["none"]],
    ]);
  });

  test("a date reads in the portal's own clock, never moved to this time zone", () => {
    const now = new Date(2026, 10, 13);
    expect(portalWhen("en", "2026-11-21T14:00:00-03:00", now)).toBe("Nov 21, 14:00");
    expect(portalWhen("en", "2027-01-02", now)).toBe("Jan 2, 2027");
    expect(portalWhen("en", "next week", now)).toBe("next week");
    expect(portalWhen("en", null, now)).toBeNull();
    expect(portalDayOf("2026-11-21T14:00:00-03:00")).toBe("2026-11-21");
    expect(portalTimeOf("2026-11-21T14:00:00-03:00")).toBe("14:00");
    expect(portalTimeOf("2026-11-21")).toBeNull();
    expect(portalSendDate("2026-11-21", "14:00")).toBe("2026-11-21T14:00");
  });

  test("a time can be confirmed only while it is still ahead", () => {
    const now = new Date(2026, 10, 13, 12, 0);
    expect(portalAhead("2026-11-13", "12:01", now)).toBe(true);
    expect(portalAhead("2026-11-13", "12:00", now)).toBe(false);
    expect(portalAhead("2026-11-12", "23:00", now)).toBe(false);
    expect(portalAhead(null, "12:30", now)).toBe(false);
    expect(portalAhead("2026-11-14", "", now)).toBe(false);
  });

  test("an approved post that was released waits for the publishing service, whatever date it carries", () => {
    expect(portalScheduling({ status: "approved", released: true })).toBe(true);
    // A proposed date alone is no release.
    expect(portalScheduling({ status: "approved", released: false })).toBe(false);
    expect(portalScheduling({ status: "scheduled", released: true })).toBe(false);
  });

  test("what can go up: a reel is one video with a picture as its cover, the rest pictures and videos", () => {
    const video = { name: "take.mp4" };
    const picture = { name: "capa.png" };
    expect(portalSendProblem("reel", [], null)).toBe("noFiles");
    expect(portalSendProblem("reel", [video], null)).toBeNull();
    expect(portalSendProblem("reel", [video], picture)).toBeNull();
    expect(portalSendProblem("reel", [video], video)).toBe("coverNotImage");
    expect(portalSendProblem("reel", [picture])).toBe("reelOneVideo");
    expect(portalSendProblem("reel", [video, video])).toBe("reelOneVideo");
    expect(portalSendProblem("carousel", [picture, video, picture])).toBeNull();
    expect(portalSendProblem("image", [{ name: "brief.pdf" }])).toBe("notMedia");
    expect(
      portalSendProblem(
        "carousel",
        Array.from({ length: 21 }, () => picture),
      ),
    ).toBe("tooMany");
  });

  test("a link is used only when it is a web address", () => {
    expect(portalLink("https://portal.example/acme/p1")).toBe("https://portal.example/acme/p1");
    expect(portalLink("javascript:alert(1)")).toBeNull();
    expect(portalLink(null)).toBeNull();
  });

  test("a refusal shows the portal's own words, the rest the app's", () => {
    expect(portalErrorText(t, new ApiError(400, "portal.refused", "This post isn't approved yet"))).toBe(
      "This post isn't approved yet",
    );
    expect(portalErrorText(t, new ApiError(502, "portal.unavailable", "Bad Gateway"))).toBe("portal.unavailable");
    expect(portalErrorText(t, new ApiError(404, "portal.off", "no portal"))).toBe("portal.off.title");
  });
});

describe("the strategic schedule (ADR 9001 §8)", () => {
  const planCard = (id: string, list: string | null, order: number, over: Partial<PlanCard> = {}): PlanCard => ({
    id,
    client: "acme",
    title: id,
    type: "reel",
    state: "todo",
    caption: "",
    date: null,
    editor: null,
    owner: null,
    note: "",
    files: [],
    produceOn: null,
    list,
    order,
    description: "",
    labels: [],
    members: [],
    checklist: [],
    comments: [],
    item: null,
    task: null,
    done: false,
    material: false,
    createdAt: 1,
    updatedAt: 1,
    stage: "todo",
    postOn: null,
    link: null,
    ...over,
  });
  const plan = (): PortalPlan => ({
    client: "acme",
    lists: [
      { id: "l1", name: "Week 1", kind: "plan", cards: [planCard("a", "l1", 1), planCard("b", "l1", 2)] },
      { id: "l2", name: "Week 2", kind: "plan", cards: [planCard("c", "l2", 1)] },
    ],
    unlisted: [planCard("d", null, 4)],
    loose: [],
    labels: [],
  });

  test("a card dropped between two takes the midpoint of their orders; at an end, one past it", () => {
    const cards = [{ order: 1 }, { order: 2 }, { order: 4 }];
    expect(portalOrderAt(cards, 0)).toBe(0);
    expect(portalOrderAt(cards, 1)).toBe(1.5);
    expect(portalOrderAt(cards, 2)).toBe(3);
    expect(portalOrderAt(cards, 3)).toBe(5);
    expect(portalOrderAt(cards, 99)).toBe(5);
    expect(portalOrderAt([], 0)).toBe(1);
  });

  test("a move shows at once: the card leaves its list and sits in the other, in order", () => {
    const moved = movedInPlan(plan(), "b", "l2", 0.5);
    expect(moved.lists.map((l) => l.cards.map((c) => c.id))).toEqual([["a"], ["b", "c"]]);
    expect(movedInPlan(plan(), "a", null, 9).unlisted.map((c) => c.id)).toEqual(["d", "a"]);
    expect(movedInPlan(plan(), "d", "l1", 1.5).lists[0]?.cards.map((c) => c.id)).toEqual(["a", "d", "b"]);
    expect(movedInPlan(plan(), "nope", "l1", 1)).toEqual(plan());
    expect(planCards(plan()).map((c) => c.id)).toEqual(["a", "b", "c", "d"]);
  });

  test("the calendar: cards on the day their post goes out with the posts no card stands for, or on the day they are made", () => {
    const p = plan();
    p.lists[0]?.cards.splice(
      0,
      2,
      planCard("a", "l1", 1, { postOn: "2026-11-20T18:00:00-03:00", produceOn: "2026-11-17" }),
    );
    p.loose = [
      { id: "p1", title: "Loose", status: "scheduled", scheduledFor: "2026-11-20T09:00:00-03:00", publishedAt: null },
    ] as PortalPlan["loose"];
    const byPost = portalCalendar(p, "post");
    expect(byPost.get("2026-11-20")?.map((e) => [e.kind, e.id, e.stage])).toEqual([
      ["card", "a", "todo"],
      ["item", "p1", "scheduled"],
    ]);
    const byProduce = portalCalendar(p, "produce");
    expect([...byProduce.keys()]).toEqual(["2026-11-17"]);
    expect(byProduce.get("2026-11-17")?.map((e) => e.id)).toEqual(["a"]);
  });

  test("a comment's web addresses come apart from its words, without the sentence's own full stop", () => {
    expect(portalTextParts("See https://a.example/x. Then <b>this</b>")).toEqual([
      { text: "See " },
      { text: "https://a.example/x", href: "https://a.example/x" },
      { text: ". Then <b>this</b>" },
    ]);
    expect(portalTextParts("no links")).toEqual([{ text: "no links" }]);
    expect(portalTextParts("javascript:alert(1)")).toEqual([{ text: "javascript:alert(1)" }]);
  });

  test("a checklist's progress, or none without one", () => {
    expect(portalChecks(planCard("a", null, 1))).toBeNull();
    expect(
      portalChecks(
        planCard("a", null, 1, {
          checklist: [
            { id: "1", text: "x", done: true },
            { id: "2", text: "y", done: false },
          ],
        }),
      ),
    ).toEqual({ done: 1, total: 2 });
  });
});

describe("the overview's pipeline (ADR 9001 §10)", () => {
  const entry = (over: Partial<PortalPipelineEntry> = {}): PortalPipelineEntry => ({
    client: "acme",
    kind: "card",
    id: "c-1",
    title: "Post",
    type: "reel",
    stage: "todo",
    members: [],
    produceOn: null,
    postOn: null,
    late: false,
    note: null,
    link: null,
    updatedAt: 0,
    ...over,
  });
  const many = (stage: PortalPipelineEntry["stage"], n: number) => Array.from({ length: n }, () => entry({ stage }));

  test("the tiles: what waits on the team counts an adjustment and late work once each", () => {
    const entries = [
      entry({ stage: "adjusting", late: true }),
      entry({ stage: "todo", late: true }),
      entry({ stage: "doing" }),
      entry({ stage: "approval" }),
      entry({ stage: "approved" }),
      entry({ stage: "scheduled" }),
      entry({ stage: "scheduled" }),
    ];
    expect(pipelineTiles(entries)).toMatchObject({
      you: 2,
      making: 2,
      client: 1,
      schedule: 1,
      adjusting: 1,
      late: 2,
      todo: 1,
      doing: 1,
      scheduled: 2,
    });
    expect(pipelineTiles([])).toMatchObject({ you: 0, making: 0, client: 0, schedule: 0 });
  });

  test("a client's one line, by priority", () => {
    const status = (...entries: PortalPipelineEntry[]) => pipelineClientStatus(entries);
    expect(status()).toEqual({ kind: "idle" });
    expect(status(entry({ stage: "scheduled" }))).toEqual({ kind: "clear" });
    expect(status(entry({ stage: "doing" }), entry({ stage: "scheduled" }))).toEqual({ kind: "making" });
    expect(status(entry({ stage: "approval" }), entry({ stage: "approval" }), entry())).toEqual({
      kind: "client",
      count: 2,
    });
    expect(status(entry({ stage: "approved" }), entry({ stage: "approval" }))).toEqual({ kind: "schedule", count: 1 });
    expect(status(entry({ late: true }), entry({ stage: "approved" }))).toEqual({ kind: "late", count: 1 });
    expect(status(entry({ stage: "adjusting" }), entry({ late: true }), entry({ late: true }))).toEqual({
      kind: "adjusting",
      count: 1,
    });
    expect(portalStatusWaits({ kind: "adjusting", count: 1 })).toBe(true);
    expect(portalStatusWaits({ kind: "late", count: 1 })).toBe(true);
    expect(portalStatusWaits({ kind: "schedule", count: 3 })).toBe(false);
  });

  test("a client's line: every stage in the pipeline's order, with how many sit at each", () => {
    expect(pipelineSteps([...many("doing", 3), ...many("todo", 1), ...many("scheduled", 60)])).toEqual([
      { stage: "todo", count: 1 },
      { stage: "doing", count: 3 },
      { stage: "approval", count: 0 },
      { stage: "adjusting", count: 0 },
      { stage: "approved", count: 0 },
      { stage: "scheduled", count: 60 },
    ]);
    // Nothing open: six empty stops, never fewer.
    expect(pipelineSteps([]).map((s) => s.count)).toEqual([0, 0, 0, 0, 0, 0]);
    expect(pipelineSteps([]).map((s) => s.stage)).toEqual([...PORTAL_PIPELINE_STAGES]);
  });

  test("a client's mark: its initials, and a hue that is always the same for it", () => {
    expect(portalClientInitials("acme-foods")).toBe("AF");
    expect(portalClientInitials("zeta")).toBe("Z");
    expect(portalClientInitials("norte-moveis-sul")).toBe("NM");
    expect(portalClientHue("acme")).toBe(portalClientHue("acme"));
    expect(portalClientHue("acme")).not.toBe(portalClientHue("zeta"));
    expect(portalClientHue("acme")).toBeGreaterThanOrEqual(0);
    expect(portalClientHue("acme")).toBeLessThan(360);
  });

  test("filters: by client, by person, by tile, together", () => {
    const entries = [
      entry({ id: "1", client: "acme", members: ["ana"], stage: "adjusting" }),
      entry({ id: "2", client: "acme", members: ["bia"], stage: "approved" }),
      entry({ id: "3", client: "zeta", members: ["ana", "bia"], stage: "doing", late: true }),
    ];
    const ids = (filter: Parameters<typeof filterPipeline>[1]) => filterPipeline(entries, filter).map((e) => e.id);
    expect(ids({})).toEqual(["1", "2", "3"]);
    expect(ids({ client: "acme" })).toEqual(["1", "2"]);
    expect(ids({ who: "ana" })).toEqual(["1", "3"]);
    expect(ids({ focus: "you" })).toEqual(["1", "3"]);
    expect(ids({ focus: "making" })).toEqual(["3"]);
    expect(ids({ focus: "schedule" })).toEqual(["2"]);
    expect(ids({ client: "acme", who: "ana", focus: "you" })).toEqual(["1"]);
    expect(ids({ client: "zeta", focus: "client" })).toEqual([]);
  });

  test("the clients' order, who is on a client's work, and its next post", () => {
    const entries = [
      entry({ client: "busy", members: ["ana", "bia"] }),
      entry({ client: "busy", members: ["bia"], postOn: "2026-11-20T10:00:00-03:00" }),
      entry({ client: "busy", members: ["bia", "caio"], postOn: "2026-11-18T09:00:00-03:00" }),
      entry({ client: "asked", stage: "adjusting", postOn: "2026-11-01T09:00:00-03:00" }),
      entry({ client: "ready", stage: "approved" }),
    ];
    const rows = pipelineClients(["quiet", "busy"], entries);
    // Who waits on the team first, then the busiest, then who has nothing open.
    expect(rows.map((r) => [r.client, r.status.kind])).toEqual([
      ["asked", "adjusting"],
      ["busy", "making"],
      ["ready", "schedule"],
      ["quiet", "idle"],
    ]);
    const busy = rows.find((r) => r.client === "busy")?.entries ?? [];
    expect(pipelinePeople(busy)).toEqual(["bia", "ana", "caio"]);
    expect(pipelineNextPost(busy, "2026-11-13")).toBe("2026-11-18T09:00:00-03:00");
    expect(pipelineNextPost(busy, "2026-11-19")).toBe("2026-11-20T10:00:00-03:00");
    // A day that passed is no "next".
    expect(pipelineNextPost(rows[0]?.entries ?? [], "2026-11-13")).toBeNull();
  });

  test("the list's order: by production day, work with none last either way", () => {
    const entries = [
      entry({ title: "none" }),
      entry({ title: "late", produceOn: "2026-11-10" }),
      entry({ title: "soon", produceOn: "2026-11-14" }),
    ];
    expect(sortPipelineByProduction(entries).map((e) => e.title)).toEqual(["late", "soon", "none"]);
    expect(sortPipelineByProduction(entries, true).map((e) => e.title)).toEqual(["soon", "late", "none"]);
  });
});

describe("a card is also a task (ADR 9001)", () => {
  test("the one responsible is the first member: whoever was first stays on the card, right after", () => {
    // An agent put first has the task (the server starts it on it); the person who had it stays on the card.
    expect(portalWithResponsible(["ana", "bia"], "agent-1")).toEqual(["agent-1", "ana", "bia"]);
    expect(portalWithResponsible(["ana", "agent-1", "bia"], "agent-1")).toEqual(["agent-1", "ana", "bia"]);
    expect(portalWithResponsible(["ana"], "ana")).toEqual(["ana"]);
    expect(portalWithResponsible([], "ana")).toEqual(["ana"]);
  });

  test("each card's task number, by the card", () => {
    const numbers = portalTaskNumbers([
      { cardId: "c-000001", number: 12 },
      { cardId: "c-000002", number: 31 },
    ]);
    expect(numbers.get("c-000001")).toBe(12);
    expect(numbers.get("c-000002")).toBe(31);
    expect(numbers.get("c-000003")).toBeUndefined();
    // Not read yet: no number to say.
    expect(portalTaskNumbers(undefined).size).toBe(0);
  });
});

describe("portalListAcross: where a card dropped on the other part's tab lands (ADR 9001 §20)", () => {
  const list = (id: string, name: string, kind: "plan" | "materials") => ({ id, name, kind, cards: [] });
  const plan = {
    lists: [
      list("l1", "MATERIAL APOIO", "plan"),
      list("l2", "Semana 1", "plan"),
      list("m1", "Acessos", "materials"),
      list("m2", " material apoio ", "materials"),
    ],
  };
  test("the list there named as the one it left, case and spaces aside, else the first there", () => {
    expect(portalListAcross(plan, "materials", "l1")?.id).toBe("m2");
    expect(portalListAcross(plan, "materials", "l2")?.id).toBe("m1");
    expect(portalListAcross(plan, "materials", null)?.id).toBe("m1");
    expect(portalListAcross(plan, "plan", "m1")?.id).toBe("l1");
  });
  test("none when that part has no list yet", () => {
    expect(portalListAcross({ lists: [list("l1", "A", "plan")] }, "materials", "l1")).toBeNull();
  });
});
