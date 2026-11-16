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
  /** `late`, or the day (`YYYY-MM-DD`). */
  key: string;
  late: boolean;
  tasks: TeamAgendaTask[];
}

export interface AgendaPerson {
  assignee: TeamAgendaTask["assignee"];
  /** Late ones first, then each day that has something, in order. Days with nothing don't show. */
  days: AgendaDay[];
  count: number;
  late: number;
}

/**
 * The agenda by who has to do it: a person or agent, then late, then each day. Everyone with something late or due
 * today comes first (the most of it first), the rest by how much they have; `name` breaks ties so the order holds.
 */
export function agendaByAssignee(agenda: TeamAgenda, name: (a: TeamAgendaTask["assignee"]) => string): AgendaPerson[] {
  const byKey = new Map<string, AgendaPerson>();
  for (const task of agenda.tasks) {
    const who = `${task.assignee.type}:${task.assignee.id}`;
    let person = byKey.get(who);
    if (!person) {
      person = { assignee: task.assignee, days: [], count: 0, late: 0 };
      byKey.set(who, person);
    }
    const late = task.dueDate < agenda.from;
    const key = late ? "late" : task.dueDate;
    let day = person.days.find((d) => d.key === key);
    if (!day) {
      day = { key, late, tasks: [] };
      person.days.push(day);
    }
    day.tasks.push(task);
    person.count += 1;
    if (late) person.late += 1;
  }
  const urgent = (p: AgendaPerson) =>
    p.days.filter((d) => d.late || d.key === agenda.from).reduce((n, d) => n + d.tasks.length, 0);
  const people = [...byKey.values()];
  for (const p of people) p.days.sort((a, b) => (a.late ? -1 : b.late ? 1 : a.key.localeCompare(b.key)));
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
