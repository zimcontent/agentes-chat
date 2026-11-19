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

/** Where a task stands on the agenda: under way, late, due on a day, or with no date. */
export type AgendaKind = "now" | "late" | "day" | "undated";

export interface AgendaItem {
  task: TeamAgendaTask;
  kind: AgendaKind;
}

export interface AgendaPerson {
  assignee: TeamAgendaTask["assignee"];
  /** Their queue (ADR doug-0022): the order they are to do things in, the team's priority. Never sorted by date. */
  tasks: AgendaItem[];
  count: number;
  now: number;
  late: number;
}

const UNDER_WAY = new Set(["in_progress", "in_review"]);

export function agendaKind(task: TeamAgendaTask, from: string): AgendaKind {
  if (UNDER_WAY.has(task.status)) return "now";
  if (!task.dueDate) return "undated";
  return task.dueDate < from ? "late" : "day";
}

const tally = (p: Omit<AgendaPerson, "count" | "now" | "late">): AgendaPerson => ({
  ...p,
  count: p.tasks.length,
  now: p.tasks.filter((i) => i.kind === "now").length,
  late: p.tasks.filter((i) => i.kind === "late").length,
});

/**
 * The agenda by who has to do it: a person or agent, then their tasks in their queue's order, as the server sends
 * them. People come before agents; among them, the most late and due today first, then the most in all; `name` breaks
 * ties so the order holds.
 */
export function agendaByAssignee(agenda: TeamAgenda, name: (a: TeamAgendaTask["assignee"]) => string): AgendaPerson[] {
  const byKey = new Map<string, { assignee: TeamAgendaTask["assignee"]; tasks: AgendaItem[] }>();
  for (const task of agenda.tasks) {
    const who = `${task.assignee.type}:${task.assignee.id}`;
    let person = byKey.get(who);
    if (!person) {
      person = { assignee: task.assignee, tasks: [] };
      byKey.set(who, person);
    }
    person.tasks.push({ task, kind: agendaKind(task, agenda.from) });
  }
  const people = [...byKey.values()].map(tally);
  const urgent = (p: AgendaPerson) => p.tasks.filter((i) => i.kind === "late" || i.task.dueDate === agenda.from).length;
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

/** `day` (`YYYY-MM-DD`) plus `n` days. */
export function addDays(day: string, n: number): string {
  const d = new Date(`${day}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

/**
 * One week of the agenda, seen from `from`: a week ahead of today shows only its own days (what is under way, late or
 * undated belongs to this week's), and a chosen `day` keeps only that day's tasks (today's with what is under way and
 * late). Each one's tasks stay in their queue's order. People with nothing left drop out.
 */
export function agendaView(people: AgendaPerson[], view: { today: string; from: string; day: string | null }) {
  const thisWeek = view.from === view.today;
  return people.flatMap((p) => {
    const tasks = p.tasks.filter(({ task, kind }) => {
      if (kind === "day") return view.day === null ? (task.dueDate as string) >= view.from : task.dueDate === view.day;
      if (kind === "undated") return thisWeek && view.day === null;
      return thisWeek && (view.day === null || view.day === view.today);
    });
    return tasks.length === 0 ? [] : [tally({ assignee: p.assignee, tasks })];
  });
}

/** How many tasks each day of the week holds, for the day picker. */
export function tasksByDay(people: AgendaPerson[]): Map<string, number> {
  const out = new Map<string, number>();
  for (const p of people)
    for (const { task, kind } of p.tasks)
      if (kind === "day" && task.dueDate) out.set(task.dueDate, (out.get(task.dueDate) ?? 0) + 1);
  return out;
}

/**
 * The move a drop makes (ADR doug-0022): `id` put at `index` among the `shown` tasks (the others, in order) of a lane
 * whose whole loaded queue is `queue`. Right after the shown task before it, or, at the top of what shows, right after
 * the task the queue has before the first shown one (null: the top of the queue). Undefined: nothing moves.
 */
export function queueMoveFor(
  queue: readonly string[],
  shown: readonly string[],
  id: string,
  index: number,
): { afterId: string | null } | undefined {
  const others = shown.filter((x) => x !== id);
  if (others.length === shown.length || others.length === 0) return undefined;
  const at = Math.max(0, Math.min(index, others.length));
  const next = [...others];
  next.splice(at, 0, id);
  if (next.join() === shown.join()) return undefined;
  if (at > 0) return { afterId: others[at - 1] as string };
  const rest = queue.filter((x) => x !== id);
  const first = rest.indexOf(others[0] as string);
  return { afterId: first > 0 ? (rest[first - 1] as string) : null };
}

/** The agenda's tasks with one moved in its assignee's queue, as the server will have them: for the screen at once. */
export function movedInAgenda(
  tasks: readonly TeamAgendaTask[],
  move: { assignee: TeamAgendaTask["assignee"]; taskId: string; afterId: string | null },
): TeamAgendaTask[] {
  const mine = (t: TeamAgendaTask) => t.assignee.type === move.assignee.type && t.assignee.id === move.assignee.id;
  const lane = tasks.filter(mine);
  const moving = lane.find((t) => t.id === move.taskId);
  if (!moving) return [...tasks];
  const rest = lane.filter((t) => t.id !== move.taskId);
  const at = move.afterId ? rest.findIndex((t) => t.id === move.afterId) + 1 : 0;
  if (move.afterId && at === 0) return [...tasks];
  rest.splice(at, 0, moving);
  let k = 0;
  return tasks.map((t) => (mine(t) ? (rest[k++] as TeamAgendaTask) : t));
}
