import { and, type Database, eq, inArray, isNull, lte, or, schema, sql } from "@agenteschat/db";
import { ForbiddenError, ValidationError } from "./errors";
import { can, requireActiveMembership } from "./organizations";
import { queueOrder } from "./task-queue";

const { issues, issueProjects } = schema;

/** How many days ahead the agenda may reach, today included. */
export const TEAM_AGENDA_DAYS_MAX = 14;
/** Open tasks read at most: a team's next two weeks fit many times over. */
const TASKS_MAX = 500;

const DAY = /^\d{4}-\d{2}-\d{2}$/;

export interface TeamAgendaTask {
  id: string;
  number: number;
  title: string;
  status: "todo" | "in_progress" | "in_review";
  priority: "low" | "normal" | "high";
  /** `YYYY-MM-DD`; before `from` when it is late; null when it has no date. */
  dueDate: string | null;
  assignee: { type: "person" | "agent"; id: string };
  project: { name: string; color: string } | null;
  blocked: boolean;
}

export interface TeamAgenda {
  from: string;
  to: string;
  tasks: TeamAgendaTask[];
}

/** `from` plus `days - 1`, as a calendar date (no time zone: the day the person asked for). */
export function agendaEnd(from: string, days: number): string {
  const d = new Date(`${from}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days - 1);
  return d.toISOString().slice(0, 10);
}

/**
 * What each person and agent of the workspace is doing now and has to do from `from` (the asker's today) through the
 * next `days`, and what is already late: every open task with an assignee that is under way (in progress or in
 * review, with or without a date), due by the last day, or with no date at all. Owners and administrators
 * only, who see every task (ADR 0151), so the read needs no audience filter. The portal's cards are tasks too (their
 * production day is the due date), so they show here as well. In each assignee's queue order (ADR doug-0022), never
 * by date: the order is the team's priority, the date stays on each task.
 */
export async function teamAgenda(
  db: Database,
  userId: string,
  orgId: string,
  query: { from: string; days?: number },
): Promise<TeamAgenda> {
  const membership = await requireActiveMembership(db, userId, orgId);
  if (!can(membership, "administrator")) throw new ForbiddenError();
  if (!DAY.test(query.from) || Number.isNaN(Date.parse(`${query.from}T00:00:00Z`))) {
    throw new ValidationError("from must be a date (YYYY-MM-DD)");
  }
  const days = Math.min(TEAM_AGENDA_DAYS_MAX, Math.max(1, Math.trunc(query.days ?? 7)));
  const to = agendaEnd(query.from, days);
  const rows = await db
    .select({
      id: issues.id,
      number: issues.number,
      title: issues.title,
      status: issues.status,
      priority: issues.priority,
      dueDate: issues.dueDate,
      assigneeType: issues.assigneeType,
      assigneeId: issues.assigneeId,
      blocked: issues.blocked,
      projectName: issueProjects.name,
      projectColor: issueProjects.color,
    })
    .from(issues)
    .leftJoin(issueProjects, eq(issueProjects.id, issues.projectId))
    .where(
      and(
        eq(issues.orgId, orgId),
        inArray(issues.status, ["todo", "in_progress", "in_review"]),
        inArray(issues.assigneeType, ["person", "agent"]),
        sql`${issues.assigneeId} is not null`,
        or(lte(issues.dueDate, to), isNull(issues.dueDate), inArray(issues.status, ["in_progress", "in_review"])),
      ),
    )
    .orderBy(...queueOrder())
    .limit(TASKS_MAX);
  return {
    from: query.from,
    to,
    tasks: rows.map((r) => ({
      id: r.id,
      number: r.number,
      title: r.title,
      status: r.status as TeamAgendaTask["status"],
      priority: r.priority,
      dueDate: r.dueDate,
      assignee: { type: r.assigneeType as "person" | "agent", id: r.assigneeId as string },
      project: r.projectName ? { name: r.projectName, color: r.projectColor ?? "graphite" } : null,
      blocked: r.blocked !== null,
    })),
  };
}
