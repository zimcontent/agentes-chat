import { describe, expect, test } from "bun:test";
import type { TeamAgendaTask } from "../src/api/types";
import { agendaByAssignee, daysBetween, localDay } from "../src/lib/team-agenda";

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
