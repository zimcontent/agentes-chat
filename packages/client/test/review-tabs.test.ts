import { expect, test } from "bun:test";
import { filterReviews, firstTab, mixedIn, reviewTabsByWho, teamPeople } from "../src/video-reviews/tabs";

const ME = "me";
const rony = { id: "rony", name: "Rony Lima" };
const rows = [
  { id: "a1", status: "in_review", medium: "video" as const, sender: null },
  { id: "a2", status: "approved", medium: "design" as const, sender: null },
  { id: "t1", status: "in_review", medium: "video" as const, sender: rony },
  { id: "t2", status: "changes", medium: "design" as const, sender: rony },
  { id: "m1", status: "changes", medium: "video" as const, sender: { id: ME, name: "Eu" } },
];

test("tabs by who made it: Agentes and Equipe always, Meus ajustes once I sent work", () => {
  expect(reviewTabsByWho(rows, ME)).toEqual([
    { key: "mine", waiting: 1 },
    { key: "agents", waiting: 1 },
    { key: "team", waiting: 1 },
  ]);
  // Nothing from people yet: Equipe is still there, empty, so the team knows where their work goes.
  expect(reviewTabsByWho([rows[0] as (typeof rows)[number]], ME)).toEqual([
    { key: "agents", waiting: 1 },
    { key: "team", waiting: 0 },
  ]);
});

test("it opens where something waits: my changes first, then the agents', then the team's", () => {
  expect(firstTab(reviewTabsByWho(rows, ME))).toBe("mine");
  expect(
    firstTab([
      { key: "agents", waiting: 0 },
      { key: "team", waiting: 2 },
    ]),
  ).toBe("team");
  expect(
    firstTab([
      { key: "agents", waiting: 0 },
      { key: "team", waiting: 0 },
    ]),
  ).toBe("agents");
});

test("Equipe's people leave out who is looking, each with what waits on review", () => {
  expect(teamPeople(rows, ME)).toEqual([{ id: "rony", name: "Rony Lima", waiting: 1 }]);
});

test("each tab shows its own work, by person and by kind", () => {
  const ids = (f: Parameters<typeof filterReviews>[1]) => filterReviews(rows, f, ME).map((r) => r.id);
  expect(ids({ who: "agents", person: null, medium: "all", status: "open" })).toEqual(["a1"]);
  expect(ids({ who: "agents", person: null, medium: "all", status: "all" })).toEqual(["a1", "a2"]);
  expect(ids({ who: "team", person: null, medium: "all", status: "all" })).toEqual(["t1", "t2", "m1"]);
  expect(ids({ who: "team", person: "rony", medium: "design", status: "all" })).toEqual(["t2"]);
  expect(ids({ who: "mine", person: null, medium: "all", status: "open" })).toEqual(["m1"]);
  expect(mixedIn(rows, "agents", ME)).toBe(true);
  expect(mixedIn(rows, "mine", ME)).toBe(false);
});
