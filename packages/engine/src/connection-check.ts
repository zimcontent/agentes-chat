import { and, type Executor, eq, schema } from "@dougbot/db";
import { enqueue } from "./outbox";

/**
 * The light half of "connect and continue" (docs/adr/doug-0039-connect-and-continue.md), kept apart from
 * `connection-requests.ts` so the connector and access code that changes what an agent holds can ask for a check
 * without importing the tools, the cards and the runs (an import cycle).
 */

/** The outbox job that settles a workspace's open connection requests (`settleConnectionRequests`). */
export const CONNECTION_CHECK_JOB = "connection.requests_check";

const PREFIX = "connection:";

/** A run's wait on a connection request: `connection:<request id>`. */
export const connectionWaitId = (requestId: string) => `${PREFIX}${requestId}`;

export const isConnectionWaitId = (id: string | null | undefined) => typeof id === "string" && id.startsWith(PREFIX);

/** The request a wait id names, or null. */
export const requestOfWait = (id: string) => (isConnectionWaitId(id) ? id.slice(PREFIX.length) : null);

/**
 * Something changed what an agent of the workspace may hold (a connection made or signed in again, access given): the
 * open requests are checked by a job, after the caller's transaction commits. Nothing is queued while none waits.
 */
export async function queueConnectionCheck(db: Executor, orgId: string) {
  const [open] = await db
    .select({ id: schema.connectionRequests.id })
    .from(schema.connectionRequests)
    .where(and(eq(schema.connectionRequests.orgId, orgId), eq(schema.connectionRequests.state, "waiting")))
    .limit(1);
  if (!open) return false;
  return enqueue(db, {
    orgId,
    kind: CONNECTION_CHECK_JOB,
    payload: { orgId },
    dedupeKey: `${CONNECTION_CHECK_JOB}:${orgId}:${Bun.randomUUIDv7()}`,
    maxAttempts: 4,
  });
}
