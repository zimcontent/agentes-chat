import { describe, expect, test } from "bun:test";
import type { TeamAgendaTask } from "../src/api/types";
import {
  addDays,
  agendaByAssignee,
  agendaView,
  daysBetween,
  localDay,
  movedInAgenda,
  queueMoveFor,
  tasksByDay,
} from "../src/lib/team-agenda";

const task = (
  id: string,
  who: string,
  dueDate: string | null,
  type: "person" | "agent" = "person",
  status: TeamAgendaTask["status"] = "todo",
): TeamAgendaTask => ({
  id,
  number: Number(id),
  title: id,
  status,
  priority: "normal",
  dueDate,
  assignee: { type, id: who },
  project: null,
  blocked: false,
});

describe("team agenda", () => {
  test("by person, in their queue's order as sent, never by date; people with late or today's work first, agents last", () => {
    const people = agendaByAssignee(
      {
        from: "2026-11-16",
        to: "2026-11-22",
        tasks: [
          task("1", "ana", "2026-11-18"),
          task("2", "bot", "2026-11-16", "agent"),
          task("3", "ronny", "2026-11-17"),
          task("4", "ronny", "2026-11-14"),
          task("5", "ronny", "2026-11-16"),
          task("6", "ana", "2026-11-19"),
          task("7", "ronny", null, "person", "in_progress"),
          task("8", "ronny", "2026-11-16", "person", "in_review"),
        ],
      },
      (a) => a.id,
    );
    expect(people.map((p) => p.assignee.id)).toEqual(["ronny", "ana", "bot"]);
    // The server's order is the queue: a later date earlier in it stays earlier.
    expect(people[0]?.tasks.map((i) => i.task.id)).toEqual(["3", "4", "5", "7", "8"]);
    // What is under way reads as "now", whatever its date.
    expect(people[0]?.tasks.map((i) => i.kind)).toEqual(["day", "late", "day", "now", "now"]);
    expect(people[0]).toMatchObject({ count: 5, now: 2, late: 1 });
  });

  test("days are the person's own", () => {
    expect(localDay(new Date(2026, 10, 16, 23, 30))).toBe("2026-11-16");
    expect(daysBetween("2026-11-16", "2026-11-17")).toBe(1);
    expect(daysBetween("2026-10-31", "2026-11-01")).toBe(1);
  });
});

describe("one day, one week", () => {
  const people = agendaByAssignee(
    {
      from: "2026-11-15",
      to: "2026-11-28",
      tasks: [
        task("1", "ronny", "2026-11-14"),
        task("2", "ronny", "2026-11-16"),
        task("3", "ronny", "2026-11-17"),
        task("4", "ana", "2026-11-17"),
        task("5", "ana", "2026-11-24"),
        task("6", "ana", null, "person", "in_progress"),
        task("7", "ana", null),
      ],
    },
    (a) => a.id,
  );

  test("a day keeps that day's tasks; today's keeps what is under way and late too", () => {
    const tuesday = agendaView(people, { today: "2026-11-15", from: "2026-11-15", day: "2026-11-17" });
    expect(tuesday.map((p) => [p.assignee.id, p.tasks.map((i) => i.task.id), p.count])).toEqual([
      ["ronny", ["3"], 1],
      ["ana", ["4"], 1],
    ]);
    const monday = agendaView(people, { today: "2026-11-15", from: "2026-11-15", day: "2026-11-16" });
    expect(monday.map((p) => p.assignee.id)).toEqual(["ronny"]);
    const today = agendaView(people, { today: "2026-11-15", from: "2026-11-15", day: "2026-11-15" });
    expect(today.map((p) => [p.assignee.id, p.tasks.map((i) => i.kind)])).toEqual([
      ["ronny", ["late"]],
      ["ana", ["now"]],
    ]);
    // The week holds what has no date too, in its place in the queue.
    const week = agendaView(people, { today: "2026-11-15", from: "2026-11-15", day: null });
    expect(week.find((p) => p.assignee.id === "ana")?.tasks.map((i) => i.task.id)).toEqual(["4", "5", "6", "7"]);
  });

  test("the next week shows only its own days", () => {
    const next = agendaView(people, { today: "2026-11-15", from: "2026-11-22", day: null });
    expect(next.map((p) => [p.assignee.id, p.tasks.map((i) => i.task.id)])).toEqual([["ana", ["5"]]]);
    expect(tasksByDay(people).get("2026-11-17")).toBe(2);
    expect(addDays("2026-11-30", 1)).toBe("2026-12-01");
  });
});

describe("moving in a queue", () => {
  test("a drop goes right after the task shown before it, or at the top of what shows", () => {
    const queue = ["a", "b", "c", "d", "e"];
    expect(queueMoveFor(queue, queue, "d", 1)).toEqual({ afterId: "a" });
    expect(queueMoveFor(queue, queue, "d", 0)).toEqual({ afterId: null });
    expect(queueMoveFor(queue, queue, "a", 4)).toEqual({ afterId: "e" });
    // Dropped where it was: nothing moves.
    expect(queueMoveFor(queue, queue, "c", 2)).toBeUndefined();
    // One day shown (c, e): the top of it is right after what the queue has before c, never the queue's top.
    expect(queueMoveFor(queue, ["c", "e"], "e", 0)).toEqual({ afterId: "b" });
    expect(queueMoveFor(queue, ["a", "e"], "e", 0)).toEqual({ afterId: null });
  });

  test("the screen moves the task at once among its assignee's tasks only", () => {
    const tasks = [
      task("1", "ronny", null),
      task("2", "ana", null),
      task("3", "ronny", null),
      task("4", "ronny", null),
    ];
    const ronny = { type: "person" as const, id: "ronny" };
    const ids = (list: TeamAgendaTask[]) => list.map((t) => t.id);
    expect(ids(movedInAgenda(tasks, { assignee: ronny, taskId: "4", afterId: null }))).toEqual(["4", "2", "1", "3"]);
    expect(ids(movedInAgenda(tasks, { assignee: ronny, taskId: "1", afterId: "3" }))).toEqual(["3", "2", "1", "4"]);
    expect(ids(movedInAgenda(tasks, { assignee: ronny, taskId: "2", afterId: null }))).toEqual(["1", "2", "3", "4"]);
  });
});
