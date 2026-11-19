import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import type { Issue, TeamAgenda } from "@dougbot/client";
import {
  agendaTasks,
  inRange,
  type LaneTask,
  laneLate,
  laneTotals,
  myLaneTasks,
  plusDays,
  queuePreview,
  teamLanes,
} from "../../src/features/issues/team-board";

const TODAY = "2026-11-18";
let n = 0;
const task = (over: Partial<LaneTask> & Pick<LaneTask, "assignee">): LaneTask => {
  n += 1;
  return {
    id: `t${n}`,
    number: n,
    title: `Task ${n}`,
    status: "todo",
    dueDate: TODAY,
    project: null,
    blocked: false,
    ...over,
  };
};
const ana = { type: "person" as const, id: "ana" };
const bia = { type: "person" as const, id: "bia" };
const rosa = { type: "agent" as const, id: "rosa" };
const sony = { type: "agent" as const, id: "sony" };
const names: Record<string, string> = { ana: "Ana", bia: "Bia", rosa: "ROSA", sony: "SONY" };
const name = (a: { id: string }) => names[a.id] ?? a.id;

describe("team lanes", () => {
  test("keeps each person's tasks in the order they came (the queue), never by date", () => {
    const a = task({ assignee: ana, dueDate: "2026-11-22", title: "first in queue" });
    const b = task({ assignee: ana, dueDate: "2026-11-19", title: "second" });
    const c = task({ assignee: ana, dueDate: null, status: "in_progress", title: "doing" });
    const [lane] = teamLanes([a, b, c], { today: TODAY, range: "week", name });
    expect(lane?.doing.map((t) => t.title)).toEqual(["doing"]);
    expect(lane?.next.map((t) => t.title)).toEqual(["first in queue", "second"]);
  });

  test("late or blocked first, then working, then the rest; people before agents within a rank", () => {
    const tasks = [
      task({ assignee: sony }), // rest (agent)
      task({ assignee: bia }), // rest (person)
      task({ assignee: rosa, status: "in_progress" }), // working
      task({ assignee: ana, status: "in_review", dueDate: null }), // working
      task({ assignee: sony, dueDate: "2026-11-10" }), // late → sony moves up
    ];
    const order = teamLanes(tasks, { today: TODAY, range: "week", name }).map((l) => l.assignee.id);
    expect(order).toEqual(["sony", "ana", "rosa", "bia"]);
  });

  test("more late or blocked comes first, a blocked task counts as a mark", () => {
    const tasks = [
      task({ assignee: ana, dueDate: "2026-11-01" }),
      task({ assignee: bia, blocked: true }),
      task({ assignee: bia, dueDate: "2026-11-02" }),
    ];
    const lanes = teamLanes(tasks, { today: TODAY, range: "today", name });
    expect(lanes.map((l) => [l.assignee.id, l.late, l.blocked])).toEqual([
      ["bia", 1, 1],
      ["ana", 1, 0],
    ]);
    expect(laneTotals(lanes)).toEqual({ working: 0, late: 2, blocked: 1 });
  });

  test("Hoje keeps what is under way, late, blocked or due today; Semana the next 7 days and undated ones", () => {
    const later = task({ assignee: ana, dueDate: plusDays(TODAY, 3) });
    const far = task({ assignee: ana, dueDate: plusDays(TODAY, 7) });
    const undated = task({ assignee: ana, dueDate: null });
    const doing = task({ assignee: ana, status: "in_progress", dueDate: plusDays(TODAY, 20) });
    const blocked = task({ assignee: ana, blocked: true, dueDate: plusDays(TODAY, 20) });
    expect([later, far, undated, doing, blocked].map((t) => inRange(t, TODAY, "today"))).toEqual([
      false,
      false,
      false,
      true,
      true,
    ]);
    expect([later, far, undated, doing, blocked].map((t) => inRange(t, TODAY, "week"))).toEqual([
      true,
      false,
      true,
      true,
      true,
    ]);
  });

  test("filters people or agents, and leaves out tasks with no one or closed", () => {
    const tasks = [
      task({ assignee: ana }),
      task({ assignee: rosa }),
      task({ assignee: null }),
      { ...task({ assignee: bia }), status: "done" as unknown as LaneTask["status"] },
    ];
    expect(teamLanes(tasks, { today: TODAY, range: "week", who: "people" }).map((l) => l.assignee.id)).toEqual(["ana"]);
    expect(teamLanes(tasks, { today: TODAY, range: "week", who: "agents" }).map((l) => l.assignee.id)).toEqual([
      "rosa",
    ]);
    expect(teamLanes(tasks, { today: TODAY, range: "week" })).toHaveLength(2);
  });

  test("a closed lane shows the next 3 and how many more", () => {
    expect(queuePreview([1, 2, 3, 4, 5, 6])).toEqual({ items: [1, 2, 3], more: 3 });
    expect(queuePreview([1, 2])).toEqual({ items: [1, 2], more: 0 });
  });

  test("late only while open and past its day", () => {
    expect(laneLate({ dueDate: "2026-11-17", status: "todo" }, TODAY)).toBe(true);
    expect(laneLate({ dueDate: TODAY, status: "todo" }, TODAY)).toBe(false);
    expect(laneLate({ dueDate: null, status: "todo" }, TODAY)).toBe(false);
  });

  test("the agenda's tasks map whole, a missing project or assignee stays null", () => {
    const agenda = {
      from: TODAY,
      to: plusDays(TODAY, 6),
      tasks: [
        {
          id: "x",
          number: 9,
          title: "Capa",
          status: "in_progress",
          priority: "normal",
          dueDate: null,
          assignee: { type: "agent", id: "rosa" },
          project: null,
          blocked: false,
        },
        {
          id: "y",
          number: 10,
          title: "Sem dono",
          status: "todo",
          priority: "normal",
          dueDate: TODAY,
          assignee: null,
          project: { name: "Fontes", color: "rose" },
          blocked: true,
        },
      ],
    } as unknown as TeamAgenda;
    const out = agendaTasks(agenda);
    expect(out[0]?.project).toBeNull();
    expect(out[1]?.assignee).toBeNull();
    expect(out[1]?.blocked).toBe(true);
    expect(agendaTasks(undefined)).toEqual([]);
  });

  test("Minhas: only the person's own open tasks, in the list's order", () => {
    const issue = (over: Partial<Issue>) =>
      ({ id: "i", number: 1, title: "t", status: "todo", dueDate: null, ...over }) as Issue;
    const list = [
      issue({ id: "a", assignee: { type: "person", id: "me" }, status: "in_progress" }),
      issue({ id: "b", assignee: { type: "person", id: "other" } }),
      issue({ id: "c", assignee: { type: "person", id: "me" }, status: "done" }),
      issue({ id: "d", assignee: null }),
      issue({ id: "e", assignee: { type: "person", id: "me" }, blocked: { reason: "x", since: TODAY } }),
    ];
    const mine = myLaneTasks(list, "me");
    expect(mine.map((t) => t.id)).toEqual(["a", "e"]);
    expect(mine[1]?.blocked).toBe(true);
    expect(myLaneTasks(list, null)).toEqual([]);
  });
});

describe("Tarefas opens on Equipe", () => {
  const screen = readFileSync(join(import.meta.dir, "../../src/features/issues/IssuesScreen.tsx"), "utf8");
  test("the first view is the team's, and only admins ask for the agenda", () => {
    expect(screen).toContain('useState<TaskView>("team")');
    expect(screen).toContain("useTeamAgenda(orgId, today, WEEK_DAYS, admin)");
  });
  test("no box shadow on the lanes", () => {
    const lanes = readFileSync(join(import.meta.dir, "../../src/features/issues/TeamLanes.tsx"), "utf8");
    expect(lanes).not.toContain("boxShadow");
  });
});
