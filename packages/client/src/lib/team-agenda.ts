import type { TeamAgenda, TeamAgendaTask } from "../api/types";

/** How many days Home's team agenda covers, today included. */
export const TEAM_AGENDA_DAYS = 7;

/** A date as the person's own calendar day (`YYYY-MM-DD`), never UTC's: "today" is theirs. */
export function localDay(date: Date): string {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, "0");
  const d = String(date.getDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}

export interface AgendaDay {
  /** `now` (under way), `late`, or the day (`YYYY-MM-DD`). */
  key: string;
  kind: "now" | "late" | "day";
  tasks: TeamAgendaTask[];
}

export interface AgendaPerson {
  assignee: TeamAgendaTask["assignee"];
  /** What they are doing now, then late ones, then each day that has something, in order. Empty days don't show. */
  days: AgendaDay[];
  count: number;
  now: number;
  late: number;
}

const KIND_ORDER = { now: 0, late: 1, day: 2 } as const;
const UNDER_WAY = new Set(["in_progress", "in_review"]);

/**
 * The agenda by who has to do it: a person or agent, then what they are doing now (a task in progress or in review,
 * whatever its date), late, then each day. People come before agents; among them, the most late and due today first,
 * then the most in all; `name` breaks ties so the order holds.
 */
export function agendaByAssignee(agenda: TeamAgenda, name: (a: TeamAgendaTask["assignee"]) => string): AgendaPerson[] {
  const byKey = new Map<string, AgendaPerson>();
  for (const task of agenda.tasks) {
    const who = `${task.assignee.type}:${task.assignee.id}`;
    let person = byKey.get(who);
    if (!person) {
      person = { assignee: task.assignee, days: [], count: 0, now: 0, late: 0 };
      byKey.set(who, person);
    }
    const kind: AgendaDay["kind"] = UNDER_WAY.has(task.status)
      ? "now"
      : task.dueDate && task.dueDate < agenda.from
        ? "late"
        : "day";
    if (kind === "day" && !task.dueDate) continue;
    const key = kind === "day" ? (task.dueDate as string) : kind;
    let day = person.days.find((d) => d.key === key);
    if (!day) {
      day = { key, kind, tasks: [] };
      person.days.push(day);
    }
    day.tasks.push(task);
    person.count += 1;
    if (kind === "now") person.now += 1;
    if (kind === "late") person.late += 1;
  }
  const urgent = (p: AgendaPerson) =>
    p.days.filter((d) => d.kind === "late" || d.key === agenda.from).reduce((n, d) => n + d.tasks.length, 0);
  const people = [...byKey.values()];
  for (const p of people) {
    p.days.sort((a, b) => KIND_ORDER[a.kind] - KIND_ORDER[b.kind] || a.key.localeCompare(b.key));
  }
  return people.sort(
    (a, b) =>
      // People before agents: the team's own day is what the agenda is for.
      Number(a.assignee.type === "agent") - Number(b.assignee.type === "agent") ||
      urgent(b) - urgent(a) ||
      b.count - a.count ||
      name(a.assignee).localeCompare(name(b.assignee)),
  );
}

/** Days between two calendar days (`YYYY-MM-DD`), `to` minus `from`. */
export function daysBetween(from: string, to: string): number {
  return Math.round((Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / 86_400_000);
}
