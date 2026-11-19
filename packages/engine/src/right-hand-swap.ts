import { and, eq, isNull, schema } from "@dougbot/db";
import { type AgentDeletionDeps, deleteAgent } from "./agent-deletion";
import { invalidateOrg } from "./cache";
import { NotFoundError } from "./errors";
import { requirePermission } from "./organizations";
import { RIGHT_HAND, rightHandPermanent } from "./right-hand";

const { agents } = schema;

/**
 * DougBot (ADR 0137 addendum 2026-11-13): an agent of the team becomes the workspace's right hand, keeping its
 * instructions, memories, skills, scopes and connections (they are its row's), and the built-in one it replaces goes
 * the normal way of a deleted agent (ADR 0082: a tombstone with its name). One transaction moves the mark (the old one
 * loses it first: `agents_one_right_hand` allows one per workspace) and who reported to the old one; the deletion
 * follows. Owners and admins (`configure`). Returns the old right hand's id, or null when `agentId` already is it.
 */
export async function makeRightHand(deps: AgentDeletionDeps, actorId: string, orgId: string, agentId: string) {
  const { db } = deps;
  await requirePermission(db, actorId, orgId, "configure");
  const old = await db.transaction(async (tx) => {
    const [next] = await tx
      .select({ id: agents.id, builtin: agents.builtin })
      .from(agents)
      .where(and(eq(agents.id, agentId), eq(agents.orgId, orgId), isNull(agents.archivedAt), isNull(agents.deletedAt)));
    if (!next) throw new NotFoundError("Agent not found");
    if (next.builtin === RIGHT_HAND) return null;
    // Another built-in agent never takes the mark (only the team's own agents do).
    if (next.builtin) throw rightHandPermanent("given to another built-in agent");
    const [current] = await tx
      .select({ id: agents.id })
      .from(agents)
      .where(and(eq(agents.orgId, orgId), eq(agents.builtin, RIGHT_HAND)));
    if (current) await tx.update(agents).set({ builtin: null, updatedAt: new Date() }).where(eq(agents.id, current.id));
    await tx.update(agents).set({ builtin: RIGHT_HAND, updatedAt: new Date() }).where(eq(agents.id, agentId));
    if (current)
      await tx
        .update(agents)
        .set({ reportsToAgentId: agentId })
        .where(and(eq(agents.orgId, orgId), eq(agents.reportsToAgentId, current.id)));
    return current?.id ?? null;
  });
  invalidateOrg(orgId);
  if (old) await deleteAgent(deps, actorId, orgId, old);
  return old;
}
