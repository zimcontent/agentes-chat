import { describe, expect, test } from "bun:test";
import type { TeamAgendaTask } from "../src/api/types";
import { addDays, agendaByAssignee, agendaView, daysBetween, localDay, tasksByDay } from "../src/lib/team-agenda";

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
  test("by person: late first, then each day in order; people with late or today's work first, agents last", () => {
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
    // What is under way goes in "now" only, whatever its date.
    expect(people[0]?.days.map((d) => d.key)).toEqual(["now", "late", "2026-11-16", "2026-11-17"]);
    expect(people[0]?.days[0]?.tasks.map((x) => x.id)).toEqual(["7", "8"]);
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
      ],
    },
    (a) => a.id,
  );

  test("a day keeps that day's tasks; today's keeps what is under way and late too", () => {
    const tuesday = agendaView(people, { today: "2026-11-15", from: "2026-11-15", day: "2026-11-17" });
    expect(tuesday.map((p) => [p.assignee.id, p.days.map((d) => d.key), p.count])).toEqual([
      ["ronny", ["2026-11-17"], 1],
      ["ana", ["2026-11-17"], 1],
    ]);
    const monday = agendaView(people, { today: "2026-11-15", from: "2026-11-15", day: "2026-11-16" });
    expect(monday.map((p) => p.assignee.id)).toEqual(["ronny"]);
    const today = agendaView(people, { today: "2026-11-15", from: "2026-11-15", day: "2026-11-15" });
    expect(today.map((p) => [p.assignee.id, p.days.map((d) => d.key)])).toEqual([
      ["ronny", ["late"]],
      ["ana", ["now"]],
    ]);
  });

  test("the next week shows only its own days", () => {
    const next = agendaView(people, { today: "2026-11-15", from: "2026-11-22", day: null });
    expect(next.map((p) => [p.assignee.id, p.days.map((d) => d.key)])).toEqual([["ana", ["2026-11-24"]]]);
    expect(tasksByDay(people).get("2026-11-17")).toBe(2);
    expect(addDays("2026-11-30", 1)).toBe("2026-12-01");
  });
});
