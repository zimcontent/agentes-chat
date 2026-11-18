import type { Issue, TeamAgenda } from "@agenteschat/client";

/*
 * Tarefas' "Equipe" view (and "Minhas tarefas" for who doesn't administer): one lane per person or agent with what
 * they are doing now and what comes next in their queue. Pure, so the order and the grouping are unit-tested.
 */

/** A task as the lanes read it, from the team agenda (owners and admins) or from the person's own task list. */
export interface LaneTask {
  id: string;
  number: number;
  title: string;
  status: "todo" | "in_progress" | "in_review";
  /** `YYYY-MM-DD` or none. */
  dueDate: string | null;
  assignee: { type: "person" | "agent"; id: string } | null;
  project: { name: string; color: string } | null;
  blocked: boolean;
}

export type LaneRange = "today" | "week";
export type LaneWho = "all" | "people" | "agents";

export interface Lane {
  key: string;
  assignee: { type: "person" | "agent"; id: string };
  /** Under way (in progress or in review), in queue order. */
  doing: LaneTask[];
  /** Still to start, in queue order. */
  next: LaneTask[];
  late: number;
  blocked: number;
}

/** How many of the queue a closed lane shows before "+N". */
export const NEXT_SHOWN = 3;
/** How many days "Semana" covers, today included. */
export const WEEK_DAYS = 7;

const UNDER_WAY = new Set(["in_progress", "in_review"]);
const OPEN = new Set(["todo", "in_progress", "in_review"]);

/** `day` (`YYYY-MM-DD`) plus `n` days, as a calendar date. */
export function plusDays(day: string, n: number): string {
  const d = new Date(`${day}T00:00:00Z`);
  if (Number.isNaN(d.getTime())) return day;
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

/** Whether a task is late on `today`: its date passed and it is still open. */
export const laneLate = (task: Pick<LaneTask, "dueDate" | "status">, today: string) =>
  !!task.dueDate && task.dueDate < today && OPEN.has(task.status);

/**
 * Whether a task belongs in the range: under way, late, blocked or due by its last day. "Semana" also keeps a task
 * with no date waiting in the queue (only the person's own list has those: the agenda never sends one).
 */
export function inRange(task: LaneTask, today: string, range: LaneRange): boolean {
  if (UNDER_WAY.has(task.status) || task.blocked) return true;
  if (!task.dueDate) return range === "week";
  const last = range === "today" ? today : plusDays(today, WEEK_DAYS - 1);
  return task.dueDate <= last;
}

/** 0: something late or blocked; 1: working on something; 2: the rest. */
export const laneRank = (lane: Pick<Lane, "late" | "blocked" | "doing">) =>
  lane.late + lane.blocked > 0 ? 0 : lane.doing.length > 0 ? 1 : 2;

/**
 * The lanes: tasks grouped by who has them, each lane's tasks in the order they came (the server's queue order, never
 * sorted again by date). Lanes with something late or blocked first (the most first), then those working, then the
 * rest; people before agents within a rank, then by name so the order holds. A task with no one on it is left out.
 */
export function teamLanes(
  tasks: readonly LaneTask[],
  opts: { today: string; range: LaneRange; who?: LaneWho; name?: (a: Lane["assignee"]) => string },
): Lane[] {
  const who = opts.who ?? "all";
  const byKey = new Map<string, Lane>();
  for (const task of tasks) {
    const a = task.assignee;
    if (!a?.id || !OPEN.has(task.status)) continue;
    if ((who === "people" && a.type !== "person") || (who === "agents" && a.type !== "agent")) continue;
    if (!inRange(task, opts.today, opts.range)) continue;
    const key = `${a.type}:${a.id}`;
    let lane = byKey.get(key);
    if (!lane) {
      lane = { key, assignee: { type: a.type, id: a.id }, doing: [], next: [], late: 0, blocked: 0 };
      byKey.set(key, lane);
    }
    (UNDER_WAY.has(task.status) ? lane.doing : lane.next).push(task);
    if (laneLate(task, opts.today)) lane.late += 1;
    if (task.blocked) lane.blocked += 1;
  }
  const name = opts.name ?? ((a: Lane["assignee"]) => a.id);
  return [...byKey.values()].sort(
    (a, b) =>
      laneRank(a) - laneRank(b) ||
      b.late + b.blocked - (a.late + a.blocked) ||
      Number(a.assignee.type === "agent") - Number(b.assignee.type === "agent") ||
      name(a.assignee).localeCompare(name(b.assignee)),
  );
}

/** What a closed lane shows of its queue: the next few, and how many more wait. */
export function queuePreview<T>(next: readonly T[], shown = NEXT_SHOWN): { items: T[]; more: number } {
  return { items: next.slice(0, shown), more: Math.max(0, next.length - shown) };
}

/** The team's numbers over the lanes: who is working, and how many tasks are late or blocked. */
export function laneTotals(lanes: readonly Lane[]) {
  return lanes.reduce(
    (n, l) => ({
      working: n.working + (l.doing.length > 0 ? 1 : 0),
      late: n.late + l.late,
      blocked: n.blocked + l.blocked,
    }),
    { working: 0, late: 0, blocked: 0 },
  );
}

/** The agenda's tasks as lanes read them. */
export const agendaTasks = (agenda: TeamAgenda | null | undefined): LaneTask[] =>
  (agenda?.tasks ?? []).map((t) => ({
    id: t.id,
    number: t.number,
    title: t.title,
    status: t.status,
    dueDate: t.dueDate ?? null,
    assignee: t.assignee?.id ? t.assignee : null,
    project: t.project ?? null,
    blocked: !!t.blocked,
  }));

/** The person's own open tasks (their queue, as the list holds them), for who can't read the team's agenda. */
export function myLaneTasks(issues: readonly Issue[] | null | undefined, meId: string | null | undefined): LaneTask[] {
  if (!meId) return [];
  const out: LaneTask[] = [];
  for (const i of issues ?? []) {
    if (i.assignee?.type !== "person" || i.assignee.id !== meId || !OPEN.has(i.status)) continue;
    out.push({
      id: i.id,
      number: i.number,
      title: i.title,
      status: i.status as LaneTask["status"],
      dueDate: i.dueDate ?? null,
      assignee: { type: "person", id: meId },
      project: i.project ? { name: i.project.name, color: i.project.color ?? "graphite" } : null,
      blocked: !!i.blocked,
    });
  }
  return out;
}
