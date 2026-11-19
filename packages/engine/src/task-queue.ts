import type { PubSub } from "@agenteschat/adapters";
import { and, asc, type Database, eq, inArray, rowsOf, type SQL, schema, sql } from "@agenteschat/db";
import { recordAudit } from "./audit";
import { ForbiddenError, NotFoundError, ValidationError } from "./errors";
import { publishUserEvent } from "./events";
import { can, requireActiveMembership } from "./organizations";
import { membersWhoMaySql } from "./permissions";

const { issues } = schema;

/**
 * Each assignee's queue (ADR doug-0022): the open tasks on one person or agent, in the order they are to be done. A
 * task that gets an assignee goes to the end of that assignee's queue, so the queue starts as arrival order; owners
 * and administrators move tasks on Início's agenda. Positions are fractional: a move takes the middle of its new
 * neighbours and nothing else is written.
 */

/** The statuses a task holds its place in: what is still to do. */
export const QUEUE_STATUSES = ["todo", "in_progress", "in_review"] as const;

export type QueueAssignee = { type: "person" | "agent"; id: string };

/** Two neighbours closer than this: the queue is renumbered 1, 2, 3… before the move. */
const MIN_GAP = 1e-6;

const inQueue = (orgId: string, assignee: QueueAssignee) =>
  and(
    eq(issues.orgId, orgId),
    eq(issues.assigneeType, assignee.type),
    eq(issues.assigneeId, assignee.id),
    inArray(issues.status, [...QUEUE_STATUSES]),
  );

/**
 * The position after the last task of `assignee`'s queue, as SQL for an insert or an update: read in the same
 * statement, so a task never lands ahead of one that reached the queue before it.
 */
export function queueEndSql(orgId: string, assignee: QueueAssignee): SQL {
  return sql`(select coalesce(max(q.queue_position), 0) + 1 from ${issues} q
    where q.org_id = ${orgId}::uuid and q.assignee_type = ${assignee.type} and q.assignee_id = ${assignee.id}
      and q.status in ('todo', 'in_progress', 'in_review'))`;
}

/** The order the queue reads in: its position, then a task with none (one that predates the queue) by number. */
export const queueOrder = () => [sql`${issues.queuePosition} asc nulls last`, asc(issues.number)];

export interface QueueMove {
  /** The task that moves. */
  taskId: string;
  /** The task it goes right after, as the screen showed them; null: the top of the queue. */
  afterId: string | null;
}

/**
 * Moves one task of `assignee`'s queue to right after `afterId` (or to the top). Owners and administrators only, the
 * people who see the team agenda (ADR 0151). Audited, and every administrator's open screens hear `issue.queue`.
 * Returns the queue's task ids in their new order.
 */
export async function moveInQueue(
  deps: { db: Database; pubsub?: PubSub },
  userId: string,
  orgId: string,
  assignee: QueueAssignee,
  move: QueueMove,
): Promise<string[]> {
  const { db } = deps;
  const membership = await requireActiveMembership(db, userId, orgId);
  if (!can(membership, "administrator")) throw new ForbiddenError();
  if (move.afterId === move.taskId) throw new ValidationError("a task can't go after itself");
  const order = await db.transaction(async (tx) => {
    // One move at a time per workspace's queues: two people dragging at once each see the other's result.
    await tx.execute(
      sql`select pg_advisory_xact_lock(hashtext(${`task-queue:${orgId}:${assignee.type}:${assignee.id}`}))`,
    );
    const read = () =>
      tx
        .select({ id: issues.id, position: issues.queuePosition, number: issues.number })
        .from(issues)
        .where(inQueue(orgId, assignee))
        .orderBy(...queueOrder());
    let rows = await read();
    if (!rows.some((r) => r.id === move.taskId)) throw new NotFoundError("task not in this queue");
    if (move.afterId && !rows.some((r) => r.id === move.afterId)) throw new NotFoundError("task not in this queue");
    const rest = rows.filter((r) => r.id !== move.taskId);
    const at = move.afterId ? rest.findIndex((r) => r.id === move.afterId) + 1 : 0;
    const before = rest[at - 1];
    const after = rest[at];
    const tooClose = before?.position != null && after?.position != null && after.position - before.position < MIN_GAP;
    if (rows.some((r) => r.position === null) || tooClose) {
      // Renumber once: tasks with no place yet, or neighbours too close for another middle.
      for (const [i, r] of rows.entries()) {
        await tx
          .update(issues)
          .set({ queuePosition: i + 1 })
          .where(eq(issues.id, r.id));
      }
      rows = await read();
    }
    const now = rows.filter((r) => r.id !== move.taskId);
    const prev = now[at - 1]?.position ?? null;
    const next = now[at]?.position ?? null;
    const position =
      prev === null && next === null
        ? 1
        : prev === null
          ? (next as number) - 1
          : next === null
            ? prev + 1
            : (prev + next) / 2;
    await tx.update(issues).set({ queuePosition: position }).where(eq(issues.id, move.taskId));
    const from = rows.findIndex((r) => r.id === move.taskId);
    const moved = rows[from] as (typeof rows)[number];
    await recordAudit(tx, {
      orgId,
      actor: { type: "person", id: userId },
      action: "issue.queue_changed",
      target: { type: "issue", id: move.taskId },
      details: { number: moved.number, assignee, from: from + 1, to: at + 1 },
    });
    const ids = now.map((r) => r.id);
    ids.splice(at, 0, move.taskId);
    return ids;
  });
  await announceQueue(deps, orgId, assignee);
  return order;
}

/** Every administrator's screens read the agenda again: only who's queue moved goes out, never a task. */
async function announceQueue(deps: { db: Database; pubsub?: PubSub }, orgId: string, assignee: QueueAssignee) {
  if (!deps.pubsub) return;
  const admins = rowsOf<{ user_id: string }>(
    await deps.db.execute(membersWhoMaySql(sql`${orgId}::uuid`, "administrator")),
  ).map((r) => r.user_id);
  for (const userId of new Set(admins)) {
    await publishUserEvent(deps.pubsub, orgId, userId, { type: "issue.queue", assignee });
  }
}

/**
 * The places in `userId`'s queue of their tasks from the approval portal, by card id: "Your tasks" on Início lists
 * the cards in this order inside each day (ADR doug-0022).
 */
export async function portalQueueOf(db: Database, orgId: string, userId: string): Promise<Map<string, number>> {
  const rows = await db
    .select({ card: sql<string | null>`${issues.source}->>'cardId'`, position: issues.queuePosition })
    .from(issues)
    .where(and(inQueue(orgId, { type: "person", id: userId }), sql`${issues.source}->>'type' = 'portal'`));
  return new Map(rows.flatMap((r) => (r.card && r.position !== null ? [[r.card, r.position] as const] : [])));
}
