/**
 * One agent in several workspaces (ADR doug-0013). Its copies, one per workspace, share an `agent_twins` row: whatever
 * trains it in one of them (its instructions and what it learned there, its memory, its skills and what it may use)
 * reaches every other copy within a minute, by code (`syncTwins`), never by a model. What makes it work in a workspace
 * stays that workspace's own: its model and key, brain and computer, budget, audience, routines and conversations.
 *
 * Copies are joined by a person (the agent's page), by bringing an agent from another workspace (`carryOver`), and on
 * their own for a person who owns several workspaces: their agents of the same handle there (`autoLinkTwins`).
 */
import { createHash } from "node:crypto";
import type { PubSub } from "@dougbot/adapters";
import { and, type Database, eq, inArray, isNull, lt, or, rowsOf, schema, sql } from "@dougbot/db";
import { insertAnchored, joinInstructions, mergeInstructions } from "./agent-twins-merge";
import { recordAudit } from "./audit";
import { invalidateOrg } from "./cache";
import { type CarryDeps, carrySkill, connectionIn } from "./carry";
import { insertContextItem, isAccess, memoryReach, normalizeSubject } from "./context/items";
import { ConflictError, ForbiddenError, NotFoundError, ValidationError } from "./errors";
import { publishAgentsChanged } from "./events";
import { can, getMembership, listMemberships } from "./organizations";
import { enqueueIndex } from "./search";
import { CRAFT_SET, type Fence, fenceFor, separateOrgs } from "./separate-operation";
import { openOrg } from "./standing";
import { grantScopes } from "./tools/scopes";

const { agents, agentTwins, organizations, organizationMembers, contextItems, agentSkills, skills, agentScopes } =
  schema;
const { connectorConnections } = schema;

type AgentRow = typeof agents.$inferSelect;
type ItemRow = typeof contextItems.$inferSelect;
type SkillRow = typeof skills.$inferSelect;

/** What a copy's profile carries to the others; every other column is its workspace's. */
export const TWIN_PROFILE = [
  "name",
  "role",
  "instructions",
  "appearance",
  "voice",
  "liveCallNotes",
  "mediaReplies",
] as const;
type ProfileField = (typeof TWIN_PROFILE)[number];

/**
 * The memory that may travel: what the agent knows and was taught, about its work or a person. Summaries of one
 * workspace's conversations, open questions and who holds what there stay, and so does anything read from a channel
 * (`channel_ids`): only that workspace's members may read it, and the channel isn't in the others. Of these, only the
 * craft goes (`memoryReach`, addendum 2026-11-19): a workspace's facts, decisions and people stay in it.
 */
export const TWIN_MEMORY_KINDS = [
  "fact",
  "decision",
  "preference",
  "note",
  "lesson",
  "rule",
  "entity_profile",
] as const;

/**
 * How far a memory goes among the agent's copies, for the agent's page: `all` or `here`, or null for one that never
 * leaves its workspace whatever it says (read from a channel, a summary, the team's, who holds what).
 */
export function twinReachOf(item: ItemRow): "all" | "here" | null {
  const kinds: readonly string[] = TWIN_MEMORY_KINDS;
  if (!item.agentId || !kinds.includes(item.kind) || item.channelIds.length > 0) return null;
  if (item.scopeType !== "agent" && item.scopeType !== "person") return null;
  return isAccess(item) ? null : memoryReach(item);
}

/** How many memories one sync copies at most: the rest come with the next one. */
const COPIES_PER_SYNC = 2000;
/** How long one worker holds a group while it syncs it. */
const SYNC_LEASE_MS = 5 * 60_000;

/** What the copies held at the last sync (`agent_twins.base`). */
export interface TwinBase {
  /** The shared profile. Absent: never synced, or a copy just joined (its text is joined, not taken as a change). */
  profile?: Partial<Record<ProfileField, unknown>>;
  /** Each copy's skills (by name). A copy with none here has only additions. */
  skills?: Record<string, string[]>;
  /** Each skill's text (a hash) as the copies agreed on it. */
  skillText?: Record<string, string>;
  /** Each copy's access: `<connection id or "">|<scope>`. */
  scopes?: Record<string, string[]>;
  /** What couldn't reach a copy (a connection or a skill its workspace can't get), for its page. */
  missing?: { agentId: string; kind: "connection" | "skill"; label: string }[];
}

export interface TwinDeps {
  db: Database;
  pubsub?: PubSub;
  /** Brings a missing connection or skill into a copy's workspace; absent: those are listed as missing. */
  carry?: CarryDeps;
}

export interface TwinSyncResult {
  synced: boolean;
  profile: number;
  memories: number;
  skills: number;
  scopes: number;
}

// ── Joining ─────────────────────────────────────────────────────────────────

/**
 * Puts these agents (each of another workspace) in one group: the group one of them is in already, else a new one.
 * The profile is joined again at the next sync (`base.profile` cleared), so a copy that comes in adds what it knows
 * instead of being overwritten. No permission check: the callers check.
 */
export async function linkTwins(db: Database, actorId: string | null, agentIds: string[]): Promise<string | null> {
  const ids = [...new Set(agentIds)];
  if (ids.length < 2) return null;
  return db.transaction(async (tx) => {
    const rows = await tx
      .select({ id: agents.id, orgId: agents.orgId, twinId: agents.twinId, builtin: agents.builtin })
      .from(agents)
      .where(and(inArray(agents.id, ids), isNull(agents.deletedAt)))
      .for("update");
    if (rows.some((r) => r.builtin)) throw new ValidationError("The right hand is each workspace's own");
    if (new Set(rows.map((r) => r.orgId)).size !== rows.length)
      throw new ValidationError("One copy per workspace: these agents share a workspace");
    const groups = [...new Set(rows.map((r) => r.twinId).filter((id): id is string => !!id))];
    let twinId = groups[0];
    if (!twinId) {
      const [made] = await tx.insert(agentTwins).values({ createdByUserId: actorId }).returning({ id: agentTwins.id });
      if (!made) throw new Error("agent_twins insert returned nothing");
      twinId = made.id;
    }
    const others = groups.slice(1);
    if (others.length > 0) {
      // A copy already in another group brings that group's other copies along: one workspace, one copy.
      const members = await tx
        .select({ id: agents.id, orgId: agents.orgId })
        .from(agents)
        .where(and(inArray(agents.twinId, [twinId, ...others]), isNull(agents.deletedAt)));
      const all = [...new Map([...members, ...rows].map((m) => [m.id, m])).values()];
      if (new Set(all.map((m) => m.orgId)).size !== all.length)
        throw new ValidationError("One copy per workspace: these groups share a workspace");
      await tx.update(agents).set({ twinId }).where(inArray(agents.twinId, others));
      await tx.delete(agentTwins).where(inArray(agentTwins.id, others));
    } else {
      const members = await tx
        .select({ id: agents.id, orgId: agents.orgId })
        .from(agents)
        .where(and(eq(agents.twinId, twinId), isNull(agents.deletedAt)));
      const outside = rows.filter((r) => !members.some((m) => m.id === r.id));
      const orgs = new Set(members.map((m) => m.orgId));
      if (outside.some((r) => orgs.has(r.orgId)))
        throw new ValidationError("One copy per workspace: this workspace has a copy already");
    }
    await tx.update(agents).set({ twinId, twinOff: false }).where(inArray(agents.id, ids));
    const [twin] = await tx.select().from(agentTwins).where(eq(agentTwins.id, twinId));
    const { profile: _joinedAgain, ...base } = (twin?.base ?? {}) as TwinBase;
    await tx
      .update(agentTwins)
      .set({ base: base as Record<string, unknown>, fingerprint: null })
      .where(eq(agentTwins.id, twinId));
    for (const r of rows) {
      await recordAudit(tx, {
        orgId: r.orgId,
        actor: actorId ? { type: "person", id: actorId } : { type: "system", id: null },
        action: "agent.twin_linked",
        target: { type: "agent", id: r.id },
        details: { twinId, copies: ids.length },
      });
    }
    return twinId;
  });
}

/**
 * Agents of the same handle in workspaces one person owns, owned by that person too, are one agent (ADR doug-0013 §2):
 * joined unless someone took one out (`twin_off`). Returns how many groups changed.
 */
export async function autoLinkTwins(db: Database): Promise<number> {
  const owned = await db
    .select({ userId: organizationMembers.userId, orgId: organizationMembers.orgId })
    .from(organizationMembers)
    .innerJoin(organizations, eq(organizations.id, organizationMembers.orgId))
    .where(and(eq(organizationMembers.role, "owner"), openOrg));
  const orgsOf = new Map<string, string[]>();
  for (const o of owned) orgsOf.set(o.userId, [...(orgsOf.get(o.userId) ?? []), o.orgId]);
  let changed = 0;
  for (const [userId, orgIds] of orgsOf) {
    if (orgIds.length < 2) continue;
    const team = await db
      .select({ id: agents.id, orgId: agents.orgId, handle: agents.handle, twinId: agents.twinId })
      .from(agents)
      .where(
        and(
          inArray(agents.orgId, orgIds),
          eq(agents.ownerUserId, userId),
          eq(agents.twinOff, false),
          isNull(agents.builtin),
          isNull(agents.archivedAt),
          isNull(agents.deletedAt),
        ),
      );
    const byHandle = new Map<string, typeof team>();
    for (const a of team) byHandle.set(a.handle, [...(byHandle.get(a.handle) ?? []), a]);
    for (const same of byHandle.values()) {
      if (new Set(same.map((a) => a.orgId)).size < 2) continue;
      const first = same[0]?.twinId;
      if (first && same.every((a) => a.twinId === first)) continue;
      // One per workspace (a handle is unique in one): the group a copy is in already decides for that workspace.
      try {
        await linkTwins(
          db,
          userId,
          same.map((a) => a.id),
        );
        changed++;
      } catch (error) {
        if (!(error instanceof ValidationError)) throw error;
      }
    }
  }
  return changed;
}

/** Takes an agent out of its group for good (`twin_off`); a group left with one copy is gone. */
export async function unlinkTwin(db: Database, actorId: string | null, agentId: string) {
  await db.transaction(async (tx) => {
    const [a] = await tx
      .select({ id: agents.id, orgId: agents.orgId, twinId: agents.twinId })
      .from(agents)
      .where(eq(agents.id, agentId))
      .for("update");
    if (!a) throw new NotFoundError("Agent not found");
    await tx.update(agents).set({ twinId: null, twinOff: true }).where(eq(agents.id, agentId));
    if (!a.twinId) return;
    const rest = await tx
      .select({ id: agents.id })
      .from(agents)
      .where(and(eq(agents.twinId, a.twinId), isNull(agents.deletedAt)));
    if (rest.length < 2) {
      await tx.update(agents).set({ twinId: null }).where(eq(agents.twinId, a.twinId));
      await tx.delete(agentTwins).where(eq(agentTwins.id, a.twinId));
    } else {
      const [twin] = await tx.select().from(agentTwins).where(eq(agentTwins.id, a.twinId));
      const base = (twin?.base ?? {}) as TwinBase;
      delete base.skills?.[agentId];
      delete base.scopes?.[agentId];
      await tx
        .update(agentTwins)
        .set({ base: base as Record<string, unknown>, fingerprint: null })
        .where(eq(agentTwins.id, a.twinId));
    }
    await recordAudit(tx, {
      orgId: a.orgId,
      actor: actorId ? { type: "person", id: actorId } : { type: "system", id: null },
      action: "agent.twin_unlinked",
      target: { type: "agent", id: agentId },
      details: { twinId: a.twinId },
    });
  });
}

// ── What a person sees and does ─────────────────────────────────────────────

export interface TwinCopy {
  agentId: string;
  orgId: string;
  orgName: string;
  name: string;
  handle: string;
}

export interface TwinView {
  /** The other copies, in the person's other workspaces they are a member of. */
  copies: TwinCopy[];
  /** Copies in workspaces the person isn't in (named by count only). */
  hidden: number;
  /** Agents of the same handle in the person's other workspaces that could join (they manage agents in both). */
  candidates: TwinCopy[];
  /** It was taken out on purpose: it isn't joined on its own again. */
  off: boolean;
  syncedAt: Date | null;
  missing: { orgName: string; kind: "connection" | "skill"; label: string }[];
  /** A separate operation among its workspaces (docs/adr/doug-0035): only the craft crosses. */
  craftOnly: boolean;
}

const mayManage = (m: Awaited<ReturnType<typeof getMembership>>, a: Pick<AgentRow, "ownerUserId">, userId: string) =>
  !!m && (can(m, "manage_agents") || a.ownerUserId === userId);

async function agentFor(db: Database, orgId: string, agentId: string) {
  const [a] = await db
    .select()
    .from(agents)
    .where(and(eq(agents.id, agentId), eq(agents.orgId, orgId), isNull(agents.deletedAt)));
  if (!a) throw new NotFoundError("Agent not found");
  return a;
}

/** The agent's copies in other workspaces and the ones that could join, as `userId` may see them. */
export async function agentTwinView(db: Database, userId: string, orgId: string, agentId: string): Promise<TwinView> {
  const here = await getMembership(db, userId, orgId);
  if (!here) throw new ForbiddenError();
  const a = await agentFor(db, orgId, agentId);
  const mine = (await listMemberships(db, userId)).filter((m) => m.orgId !== orgId);
  const names = new Map(mine.map((m) => [m.orgId, m.orgName]));
  const group = a.twinId
    ? await db
        .select({ agent: agents, orgName: organizations.name })
        .from(agents)
        .innerJoin(organizations, eq(organizations.id, agents.orgId))
        .where(and(eq(agents.twinId, a.twinId), isNull(agents.deletedAt), isNull(agents.archivedAt)))
    : [];
  const others = group.filter((g) => g.agent.id !== a.id);
  const copyOf = (r: { agent: AgentRow; orgName: string }): TwinCopy => ({
    agentId: r.agent.id,
    orgId: r.agent.orgId,
    orgName: r.orgName,
    name: r.agent.name,
    handle: r.agent.handle,
  });
  const copies = others.filter((g) => names.has(g.agent.orgId)).map(copyOf);
  const taken = new Set(group.map((g) => g.agent.orgId));
  const managing = mine.filter((m) => !taken.has(m.orgId) && can(m, "manage_agents"));
  const candidates =
    !isRightHandRow(a) && mayManage(here, a, userId) && managing.length > 0
      ? (
          await db
            .select({ agent: agents, orgName: organizations.name })
            .from(agents)
            .innerJoin(organizations, eq(organizations.id, agents.orgId))
            .where(
              and(
                inArray(
                  agents.orgId,
                  managing.map((m) => m.orgId),
                ),
                eq(agents.handle, a.handle),
                isNull(agents.builtin),
                isNull(agents.archivedAt),
                isNull(agents.deletedAt),
                openOrg,
              ),
            )
        ).map(copyOf)
      : [];
  const [twin] = a.twinId ? await db.select().from(agentTwins).where(eq(agentTwins.id, a.twinId)) : [];
  const orgOfAgent = new Map(group.map((g) => [g.agent.id, g.orgName]));
  const missing = ((twin?.base ?? {}) as TwinBase).missing ?? [];
  return {
    copies,
    hidden: others.length - copies.length,
    candidates,
    off: a.twinOff,
    syncedAt: twin?.syncedAt ?? null,
    missing: missing
      .filter((m) => orgOfAgent.has(m.agentId))
      .map((m) => ({ orgName: orgOfAgent.get(m.agentId) as string, kind: m.kind, label: m.label })),
    craftOnly: group.length > 1 && (await separateOrgs(db, [...new Set(group.map((g) => g.agent.orgId))])).size > 0,
  };
}

const isRightHandRow = (a: Pick<AgentRow, "builtin">) => a.builtin === "right_hand";

/** Joins this agent with the same agent in another of the person's workspaces (they manage agents in both). */
export async function joinTwin(
  deps: TwinDeps,
  userId: string,
  orgId: string,
  agentId: string,
  otherAgentId: string,
): Promise<TwinView> {
  const { db } = deps;
  const a = await agentFor(db, orgId, agentId);
  const here = await getMembership(db, userId, orgId);
  if (!mayManage(here, a, userId)) throw new ForbiddenError();
  const [other] = await db
    .select()
    .from(agents)
    .where(and(eq(agents.id, otherAgentId), isNull(agents.deletedAt), isNull(agents.archivedAt)));
  if (!other || other.orgId === orgId) throw new NotFoundError("Agent not found");
  const there = await getMembership(db, userId, other.orgId);
  if (!mayManage(there, other, userId)) throw new ForbiddenError();
  if (isRightHandRow(a) || isRightHandRow(other)) throw new ValidationError("The right hand is each workspace's own");
  await linkTwins(db, userId, [a.id, other.id]);
  await syncAgentTwins(deps, a.id).catch(() => undefined);
  return agentTwinView(db, userId, orgId, agentId);
}

/** Takes this copy out of its group: from now on it is trained here alone. */
export async function leaveTwin(db: Database, userId: string, orgId: string, agentId: string): Promise<TwinView> {
  const a = await agentFor(db, orgId, agentId);
  if (!mayManage(await getMembership(db, userId, orgId), a, userId)) throw new ForbiddenError();
  await unlinkTwin(db, userId, agentId);
  return agentTwinView(db, userId, orgId, agentId);
}

// ── Syncing ─────────────────────────────────────────────────────────────────

const hash = (text: string) => createHash("sha256").update(text).digest("hex").slice(0, 32);
const skillText = (s: Pick<SkillRow, "description" | "body">) => hash(`${s.description}\n${s.body}`);
const same = (a: unknown, b: unknown) => JSON.stringify(a ?? null) === JSON.stringify(b ?? null);

async function membersOf(db: Database, twinId: string) {
  return db
    .select({ agent: agents, orgName: organizations.name })
    .from(agents)
    .innerJoin(organizations, eq(organizations.id, agents.orgId))
    .where(and(eq(agents.twinId, twinId), isNull(agents.archivedAt), isNull(agents.deletedAt), openOrg));
}

/** Whether anything a sync reads changed: the profiles, the memories, the skills (and their versions), the access. */
async function fingerprintOf(db: Database, ids: string[]): Promise<string> {
  const list = sql.join(
    ids.map((id) => sql`${id}::uuid`),
    sql`, `,
  );
  const rows = rowsOf<{ f: string }>(
    await db.execute(sql`
    select md5(coalesce(string_agg(x, ',' order by x), '')) as f from (
      -- The rules' version: a group syncs once again when what travels changes (addendum 2026-11-19).
      select 'v2' as x
      union all
      select a.id::text || md5(a.name || '|' || a.role || '|' || a.instructions || '|' || coalesce(a.appearance::text, '')
        || '|' || coalesce(a.voice, '') || '|' || coalesce(a.live_call_notes, '') || '|' || a.media_replies::text) as x
        from agents a where a.id in (${list})
      union all
      select 'm' || ci.agent_id::text || count(*)::text || max(ci.updated_at)::text || max(ci.created_at)::text
        from context_items ci where ci.agent_id in (${list}) group by ci.agent_id
      union all
      select 's' || s.agent_id::text || string_agg(k.id::text || ':' || k.version::text || ':' || s.enabled::text, ',' order by k.id)
        from agent_skills s join skills k on k.id = s.skill_id where s.agent_id in (${list}) group by s.agent_id
      union all
      select 'p' || g.agent_id::text || string_agg(g.id::text, ',' order by g.id)
        from agent_scopes g where g.agent_id in (${list}) group by g.agent_id
    ) t`),
  );
  return rows[0]?.f ?? "";
}

/** Syncs the group `agentId` is in, if any (after a person changed it, so they see it right away). */
export async function syncAgentTwins(deps: TwinDeps, agentId: string) {
  const [a] = await deps.db.select({ twinId: agents.twinId }).from(agents).where(eq(agents.id, agentId));
  return a?.twinId ? syncTwins(deps, a.twinId) : null;
}

/** Every group with something new since its last sync (the workers' tick). */
export async function syncAllTwins(deps: TwinDeps): Promise<number> {
  const groups = await deps.db.select({ id: agentTwins.id }).from(agentTwins);
  let synced = 0;
  for (const g of groups) if ((await syncTwins(deps, g.id))?.synced) synced++;
  return synced;
}

/**
 * Brings every copy of one group to the same training. Under a lease (one worker at a time, on any replica); skipped
 * when nothing changed since the last sync.
 */
export async function syncTwins(deps: TwinDeps, twinId: string): Promise<TwinSyncResult | null> {
  const { db } = deps;
  const now = new Date();
  const [twin] = await db
    .update(agentTwins)
    .set({ syncingUntil: new Date(now.getTime() + SYNC_LEASE_MS) })
    .where(and(eq(agentTwins.id, twinId), or(isNull(agentTwins.syncingUntil), lt(agentTwins.syncingUntil, now))))
    .returning();
  if (!twin) return null;
  const result: TwinSyncResult = { synced: false, profile: 0, memories: 0, skills: 0, scopes: 0 };
  try {
    const members = await membersOf(db, twinId);
    if (members.length < 2) return result;
    const ids = members.map((m) => m.agent.id);
    const before = await fingerprintOf(db, ids);
    if (twin.fingerprint === before && twin.base && "profile" in (twin.base as TwinBase)) return result;
    const base = { ...(twin.base as TwinBase) };
    const actor = twin.createdByUserId;
    const touched = new Set<string>();
    const missing: TwinBase["missing"] = [];

    // A separate operation among the copies: only the craft crosses, both ways (docs/adr/doug-0035).
    const fence = await fenceFor(
      db,
      members.map((m) => m.agent.orgId),
    );

    // 1. The profile.
    const profile = syncedProfile(base.profile, members, fence);
    for (const m of members) {
      const patch: Partial<Record<ProfileField, unknown>> = {};
      for (const field of profileFields(fence)) {
        const want =
          field === "instructions" && fence.on
            ? fencedInstructions(String(profile.instructions ?? ""), m, members, fence)
            : profile[field];
        if (!same(m.agent[field], want)) patch[field] = want;
      }
      if (Object.keys(patch).length === 0) continue;
      await db
        .update(agents)
        .set({ ...(patch as Partial<AgentRow>), updatedAt: new Date() })
        .where(eq(agents.id, m.agent.id));
      result.profile++;
      touched.add(m.agent.orgId);
    }
    base.profile = profile;

    // 2. Memory.
    const memory = await syncMemory(db, members, fence, twin.createdAt);
    result.memories = memory.changed;
    if (memory.changed > 0) for (const m of members) touched.add(m.agent.orgId);

    // 3. Skills.
    const skillSync = await syncSkills(deps, actor, members, base, missing, fence);
    result.skills = skillSync.changed;
    base.skills = skillSync.sets;
    base.skillText = skillSync.text;
    if (skillSync.changed > 0) for (const m of members) touched.add(m.agent.orgId);

    // 4. What it may use.
    const scopeSync = await syncScopes(deps, actor, members, base, missing, fence);
    result.scopes = scopeSync.changed;
    base.scopes = scopeSync.sets;
    if (scopeSync.changed > 0) for (const m of members) touched.add(m.agent.orgId);

    base.missing = missing;
    for (const orgId of touched) {
      invalidateOrg(orgId);
      await publishAgentsChanged(deps.pubsub, orgId);
    }
    // Copies left for the next tick: no fingerprint, so it doesn't read as done.
    const after = memory.more ? null : await fingerprintOf(db, ids);
    await db
      .update(agentTwins)
      .set({ base: base as Record<string, unknown>, fingerprint: after, syncedAt: new Date() })
      .where(eq(agentTwins.id, twinId));
    result.synced = true;
    return result;
  } finally {
    await db.update(agentTwins).set({ syncingUntil: null }).where(eq(agentTwins.id, twinId));
  }
}

type Member = Awaited<ReturnType<typeof membersOf>>[number];

/** The profile fields that cross: with a separate operation, an agent's notes for calls stay each company's. */
const profileFields = (fence: Fence) => (fence.on ? TWIN_PROFILE.filter((f) => f !== "liveCallNotes") : TWIN_PROFILE);

/**
 * The profile every copy gets: one change is everyone's; several, the newest (the instructions merged by line). With
 * a separate operation the instructions here are only the lines that cross (`craftLines`); each copy keeps its own
 * on top (`fencedInstructions`).
 */
function syncedProfile(base: TwinBase["profile"], members: Member[], fence: Fence): Record<ProfileField, unknown> {
  const out = {} as Record<ProfileField, unknown>;
  const at = (m: Member) => m.agent.updatedAt.getTime();
  for (const field of TWIN_PROFILE) {
    if (field === "liveCallNotes" && fence.on) {
      out[field] = base?.[field];
      continue;
    }
    if (field === "instructions") {
      const versions = members.map((m) => ({
        text: fence.on ? craftLines(m, members, fence).join("\n") : m.agent.instructions,
        at: at(m),
      }));
      out.instructions =
        base && typeof base.instructions === "string"
          ? mergeInstructions(base.instructions, versions)
          : joinInstructions(versions);
      continue;
    }
    const changed = base && field in base ? members.filter((m) => !same(m.agent[field], base[field])) : members;
    if (changed.length === 0) {
      out[field] = base?.[field];
      continue;
    }
    const newest = [...changed].sort((a, b) => at(b) - at(a))[0] as Member;
    out[field] = newest.agent[field];
  }
  return out;
}

/** Whether a line of a copy's instructions names something another copy's workspace doesn't know: it stays here. */
const staysIn = (line: string, m: Member, members: Member[], fence: Fence) =>
  members.some((o) => o.agent.orgId !== m.agent.orgId && fence.foreignTo(line, o.agent.orgId));

/** A copy's lines that cross to every other copy (what names another company's, that came here before, is left out). */
function craftLines(m: Member, members: Member[], fence: Fence): string[] {
  return m.agent.instructions
    .split("\n")
    .filter((line) => !fence.foreignTo(line, m.agent.orgId) && !staysIn(line, m, members, fence));
}

/**
 * A copy's instructions under a separate operation: the lines every copy shares, plus its own lines that name its
 * company, each back after the line it followed. A line naming another company that came here before is dropped.
 */
function fencedInstructions(shared: string, m: Member, members: Member[], fence: Fence): string {
  const mine = m.agent.instructions.split("\n").filter((line) => !fence.foreignTo(line, m.agent.orgId));
  const out = shared.split("\n");
  mine.forEach((line, i) => {
    const key = line.trim();
    if (!key || !staysIn(line, m, members, fence)) return;
    if (out.some((l) => l.trim() === key)) return;
    insertAnchored(out, mine, i, line);
  });
  return out.join("\n");
}

/** A memory as another copy's: its own agent and workspace, without the sources and links only its workspace has. */
async function copyMemory(db: Database, item: ItemRow, to: AgentRow, twinKey: string) {
  const made = await insertContextItem(db, {
    orgId: to.orgId,
    kind: item.kind,
    scopeType: item.scopeType as "agent" | "person",
    scopeId: item.scopeType === "agent" && item.scopeId === item.agentId ? to.id : item.scopeId,
    agentId: to.id,
    subject: item.subjectKey || undefined,
    title: item.title,
    content: item.content,
    trust: item.trust,
    evidence: item.evidence,
    confidence: item.confidence,
    pinned: item.pinned,
    createdByKind: item.createdByKind as "job" | "agent" | "person",
    createdById: item.createdById,
    disputed: item.disputed,
    reach: item.reach,
  });
  await db
    .update(contextItems)
    .set({ twinKey, verified: item.verified, version: item.version })
    .where(eq(contextItems.id, made.id));
}

/**
 * Every copy holds the same memories: one learned in one copy is copied to the others (`twin_key` ties them), and one
 * archived (forgotten, replaced by a newer version) or brought back in one is so in all. Memories the copies already
 * shared before they were joined are tied, not copied again.
 *
 * With a separate operation among them (docs/adr/doug-0035) only the craft crosses: a lesson, rule or preference that
 * names nothing the other company doesn't know, about a person who is there. The copies of anything else already made
 * since the group was joined are taken back (the original stays where it was learned), and what each copy knew on its
 * own is untied, so forgetting it in one company doesn't touch the other.
 */
async function syncMemory(
  db: Database,
  members: Member[],
  fence: Fence,
  since: Date,
): Promise<{ changed: number; more: boolean }> {
  const ids = members.map((m) => m.agent.id);
  const copyOf = new Map(members.map((m) => [m.agent.id, m]));
  let rows = (
    await db
      .select()
      .from(contextItems)
      .where(
        and(
          inArray(contextItems.agentId, ids),
          inArray(contextItems.kind, [...TWIN_MEMORY_KINDS]),
          inArray(contextItems.scopeType, ["agent", "person"]),
          sql`cardinality(${contextItems.channelIds}) = 0`,
        ),
      )
  ).filter((r) => !isAccess(r));
  const textOf = (r: ItemRow) => `${r.title}\n${r.content}`;
  /** Whether `r` may be held by copy `to`: always, unless a separate operation keeps it in its company. */
  const mayCross = (r: ItemRow, to: Member | undefined) =>
    !fence.on ||
    (to !== undefined &&
      CRAFT_SET.has(r.kind) &&
      !fence.foreignTo(textOf(r), to.agent.orgId) &&
      (r.scopeType !== "person" || !r.scopeId || fence.memberOf(r.scopeId, to.agent.orgId)));
  let changed = 0;

  if (fence.on) {
    const families = new Map<string, ItemRow[]>();
    for (const r of rows) if (r.twinKey) families.set(r.twinKey, [...(families.get(r.twinKey) ?? []), r]);
    const takeBack: ItemRow[] = [];
    const untie: ItemRow[] = [];
    for (const list of families.values()) {
      const first = [...list].sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime())[0] as ItemRow;
      for (const r of list) {
        if (r.id === first.id) continue;
        const copied = r.orgId !== first.orgId && r.createdAt.getTime() >= since.getTime();
        if (copied && !mayCross(first, copyOf.get(r.agentId ?? ""))) takeBack.push(r);
      }
      if (!CRAFT_SET.has(first.kind)) for (const r of list) if (!takeBack.includes(r)) untie.push(r);
    }
    if (takeBack.length > 0) {
      await db.delete(contextItems).where(
        inArray(
          contextItems.id,
          takeBack.map((r) => r.id),
        ),
      );
      for (const r of takeBack) await enqueueIndex(db, { orgId: r.orgId, kind: "context_item", sourceId: r.id });
      changed += takeBack.length;
    }
    if (untie.length > 0) {
      await db
        .update(contextItems)
        .set({ twinKey: null })
        .where(
          inArray(
            contextItems.id,
            untie.map((r) => r.id),
          ),
        );
    }
    const gone = new Set(takeBack.map((r) => r.id));
    const loose = new Set(untie.map((r) => r.id));
    rows = rows
      .filter((r) => !gone.has(r.id))
      .map((r) => (loose.has(r.id) ? { ...r, twinKey: null } : r))
      // What a company keeps is neither tied nor copied; an archived memory is never tied again.
      .filter((r) => CRAFT_SET.has(r.kind) && (r.twinKey !== null || r.status === "active"));
  }

  // Tie the untied ones that say what a row of another copy says.
  const sayKey = (r: ItemRow) => `${r.kind}|${r.scopeType}|${normalizeSubject(r.content)}`;
  const bySaying = new Map<string, ItemRow[]>();
  for (const r of rows) {
    if (memoryReach(r) === "all") bySaying.set(sayKey(r), [...(bySaying.get(sayKey(r)) ?? []), r]);
  }
  for (const list of bySaying.values()) {
    if (new Set(list.map((r) => r.agentId)).size < 2) continue;
    if (fence.on && list.some((r) => list.some((o) => !mayCross(o, copyOf.get(r.agentId ?? ""))))) continue;
    const key = list.find((r) => r.twinKey)?.twinKey ?? list[0]?.id;
    if (!key) continue;
    const untied = list.filter((r) => !r.twinKey);
    if (untied.length === 0) continue;
    await db
      .update(contextItems)
      .set({ twinKey: key })
      .where(
        inArray(
          contextItems.id,
          untied.map((r) => r.id),
        ),
      );
    for (const r of untied) r.twinKey = key;
  }
  const families = new Map<string, ItemRow[]>();
  for (const r of rows) {
    const key = r.twinKey ?? r.id;
    families.set(key, [...(families.get(key) ?? []), r]);
  }
  let copies = 0;
  let more = false;
  for (const [key, list] of families) {
    const newest = [...list].sort((a, b) => b.updatedAt.getTime() - a.updatedAt.getTime())[0] as ItemRow;
    if (memoryReach(newest) === "here") {
      changed += await keepHere(db, key, list, newest);
      continue;
    }
    // Archived or brought back, pinned or not, kept here or for all: as the copy that changed last.
    for (const r of list) {
      const reach = memoryReach(r) === "all" ? r.reach : newest.reach;
      if (r.status === newest.status && r.pinned === newest.pinned && reach === r.reach) continue;
      if (!mayCross(newest, copyOf.get(r.agentId ?? ""))) continue;
      await db
        .update(contextItems)
        .set({ status: newest.status, pinned: newest.pinned, reach })
        .where(eq(contextItems.id, r.id));
      await enqueueIndex(db, { orgId: r.orgId, kind: "context_item", sourceId: r.id });
      changed++;
    }
    if (newest.status !== "active") continue;
    const holders = new Set(list.map((r) => r.agentId));
    const lacking = members.filter((m) => !holders.has(m.agent.id) && mayCross(newest, m));
    if (lacking.length === 0) continue;
    if (copies >= COPIES_PER_SYNC) {
      more = true;
      continue;
    }
    const untied = list.filter((r) => !r.twinKey);
    if (untied.length > 0) {
      await db
        .update(contextItems)
        .set({ twinKey: key })
        .where(
          inArray(
            contextItems.id,
            untied.map((r) => r.id),
          ),
        );
    }
    for (const m of lacking) {
      try {
        await copyMemory(db, newest, m.agent, key);
        copies++;
        changed++;
      } catch (error) {
        // A memory its checks refuse now (it reads like a secret) stays where it is.
        if (!(error instanceof ValidationError)) throw error;
      }
    }
  }
  return { changed, more };
}

/**
 * A memory that is one workspace's business (addendum 2026-11-19): it stays with the copy that holds it, the one a
 * person just kept here or, by its kind, the one that learned it, and the copies the sync made elsewhere are archived
 * (a person can bring one back on the agent's page). A row that was learned in its own workspace (it has sources) and
 * was only tied by saying the same is untied and stays, kept in that workspace too, so it doesn't travel back on its
 * own. Neither keeps a new `updated_at`, so the copy that holds it stays the newest.
 */
async function keepHere(db: Database, key: string, list: ItemRow[], newest: ItemRow): Promise<number> {
  const active = list.filter((r) => r.status === "active");
  const keeper =
    newest.reach === "here" && newest.status === "active"
      ? newest
      : (active.find((r) => r.id === key) ??
        [...active].sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime())[0]);
  let changed = 0;
  for (const r of active) {
    if (r.id === keeper?.id) continue;
    const own = r.sourceIds.length > 0;
    await db
      .update(contextItems)
      .set(own ? { twinKey: null, reach: "here" } : { status: "archived" })
      .where(eq(contextItems.id, r.id));
    await enqueueIndex(db, { orgId: r.orgId, kind: "context_item", sourceId: r.id });
    changed++;
  }
  return changed;
}

/** Each copy's set, the base's set for it, and what every copy added and removed since. */
function setChanges(current: Map<string, Set<string>>, base: Record<string, string[]> | undefined) {
  const changes = new Map<string, { added: string[]; removed: string[] }>();
  for (const [agentId, now] of current) {
    const was = base?.[agentId];
    if (!was) {
      changes.set(agentId, { added: [...now], removed: [] });
      continue;
    }
    const before = new Set(was);
    changes.set(agentId, {
      added: [...now].filter((k) => !before.has(k)),
      removed: [...before].filter((k) => !now.has(k)),
    });
  }
  return changes;
}

/**
 * The same skills on in every copy (one turned on or off in one copy is in all; on a join, every copy's), each with the
 * same text: one copy's edit of a skill (by a person, or the agent improving it) is written to the others'. A skill
 * another workspace lacks is copied there with its files, as bringing an agent does. Personal skills stay their
 * person's.
 *
 * With a separate operation (docs/adr/doug-0035) a skill crosses only when its text names nothing another company
 * doesn't know; one that names a company's own stays there, apart from the others' sets. One that came from
 * another company before is turned off for that copy, and leaves the workspace's library when no agent there uses it.
 */
async function syncSkills(
  deps: TwinDeps,
  actor: string | null,
  members: Member[],
  base: TwinBase,
  missing: NonNullable<TwinBase["missing"]>,
  fence: Fence,
) {
  const { db } = deps;
  const ids = members.map((m) => m.agent.id);
  const rows = await db
    .select({ agentId: agentSkills.agentId, skill: skills })
    .from(agentSkills)
    .innerJoin(skills, eq(skills.id, agentSkills.skillId))
    .where(
      and(
        inArray(agentSkills.agentId, ids),
        eq(agentSkills.enabled, true),
        isNull(skills.deletedAt),
        isNull(skills.ownerUserId),
      ),
    );
  const copyOf = new Map(members.map((m) => [m.agent.id, m]));
  const textOf = (k: SkillRow) => `${k.name}\n${k.description}\n${k.body}`;
  let kept = rows;
  let changed = 0;
  if (fence.on) {
    // Came from another company: off for this copy (its own company's skills it keeps).
    const foreign = rows.filter((r) => {
      const m = copyOf.get(r.agentId);
      return m !== undefined && fence.foreignTo(textOf(r.skill), m.agent.orgId);
    });
    for (const r of foreign) {
      await db
        .update(agentSkills)
        .set({ enabled: false })
        .where(and(eq(agentSkills.agentId, r.agentId), eq(agentSkills.skillId, r.skill.id)));
      changed++;
      const [used] = await db
        .select({ id: agentSkills.agentId })
        .from(agentSkills)
        .where(and(eq(agentSkills.skillId, r.skill.id), eq(agentSkills.enabled, true)))
        .limit(1);
      if (!used) await db.update(skills).set({ deletedAt: new Date() }).where(eq(skills.id, r.skill.id));
    }
    // What crosses: a skill whose text every other copy's company may read, in every copy that has it.
    const staying = new Set(
      rows
        .filter((r) => members.some((o) => o.agent.id !== r.agentId && fence.foreignTo(textOf(r.skill), o.agent.orgId)))
        .map((r) => r.skill.slug),
    );
    kept = rows.filter((r) => !foreign.includes(r) && !staying.has(r.skill.slug));
  }
  const crosses = new Set(kept.map((r) => r.skill.slug));
  const current = new Map<string, Set<string>>(ids.map((id) => [id, new Set<string>()]));
  const bySlug = new Map<string, { agentId: string; skill: SkillRow }[]>();
  for (const r of kept) {
    current.get(r.agentId)?.add(r.skill.slug);
    bySlug.set(r.skill.slug, [...(bySlug.get(r.skill.slug) ?? []), r]);
  }
  // A company's own skill is outside the sets: off or on in one copy, it never reads as a change for the others.
  const known = fence.on
    ? Object.fromEntries(
        Object.entries(base.skills ?? {}).map(([id, slugs]) => [
          id,
          slugs.filter((slug) => crosses.has(slug) || !rows.some((r) => r.skill.slug === slug)),
        ]),
      )
    : base.skills;
  const changes = setChanges(current, known);
  const added = new Set([...changes.values()].flatMap((c) => c.added));
  const removed = new Set([...changes.values()].flatMap((c) => c.removed));
  for (const slug of added) removed.delete(slug);
  const text: Record<string, string> = {};
  // Each skill's text: one copy changed it since the last sync (or, at a join, the newest), the others take it.
  for (const [slug, list] of bySlug) {
    const agreed = base.skillText?.[slug];
    const edited = list.filter((r) => skillText(r.skill) !== agreed);
    const winner = [...(edited.length > 0 ? edited : list)].sort(
      (a, b) => b.skill.updatedAt.getTime() - a.skill.updatedAt.getTime(),
    )[0];
    if (!winner) continue;
    text[slug] = skillText(winner.skill);
    for (const r of list) {
      if (r.skill.id === winner.skill.id || skillText(r.skill) === text[slug]) continue;
      // Both read from the same link: each updates from it by itself.
      if (r.skill.source === "url" && winner.skill.source === "url" && r.skill.sourceUrl === winner.skill.sourceUrl)
        continue;
      if (!(await writeSkillText(deps, actor, r.skill, winner.skill))) continue;
      changed++;
    }
  }
  for (const m of members) {
    const has = current.get(m.agent.id) ?? new Set<string>();
    for (const slug of added) {
      if (has.has(slug)) continue;
      const from = bySlug.get(slug)?.[0]?.skill;
      if (!from) continue;
      const id = await skillIn(deps, actor, m.agent.orgId, from);
      if (!id) {
        missing.push({ agentId: m.agent.id, kind: "skill", label: from.name });
        continue;
      }
      await db
        .insert(agentSkills)
        .values({ orgId: m.agent.orgId, agentId: m.agent.id, skillId: id, enabled: true })
        .onConflictDoUpdate({ target: [agentSkills.agentId, agentSkills.skillId], set: { enabled: true } });
      has.add(slug);
      changed++;
    }
    for (const slug of removed) {
      if (!has.has(slug)) continue;
      const mine = bySlug.get(slug)?.find((r) => r.agentId === m.agent.id);
      if (!mine) continue;
      await db
        .update(agentSkills)
        .set({ enabled: false })
        .where(and(eq(agentSkills.agentId, m.agent.id), eq(agentSkills.skillId, mine.skill.id)));
      has.delete(slug);
      changed++;
    }
  }
  const sets: Record<string, string[]> = {};
  for (const m of members) sets[m.agent.id] = [...(current.get(m.agent.id) ?? [])].sort();
  return { changed, sets, text };
}

/** `from` (a skill of another workspace) as `orgId`'s: the one of that name there, else a copy. Null: it can't come. */
async function skillIn(deps: TwinDeps, actor: string | null, orgId: string, from: SkillRow): Promise<string | null> {
  const [here] = await deps.db
    .select({ id: skills.id })
    .from(skills)
    .where(
      and(eq(skills.orgId, orgId), eq(skills.slug, from.slug), isNull(skills.deletedAt), isNull(skills.ownerUserId)),
    );
  if (here) return here.id;
  if (!actor || !deps.carry) return null;
  try {
    return (await carrySkill(deps.carry.skills(), actor, orgId, from)).id;
  } catch (error) {
    if (isRefusal(error)) return null;
    throw error;
  }
}

/** Writes `winner`'s text and files as a new version of `target` (another workspace's skill of that name). */
async function writeSkillText(deps: TwinDeps, actor: string | null, target: SkillRow, winner: SkillRow) {
  if (!actor || !deps.carry) return false;
  try {
    await carrySkill(deps.carry.skills(), actor, target.orgId, winner, { replace: true });
    return true;
  } catch (error) {
    if (isRefusal(error)) return false;
    throw error;
  }
}

const isRefusal = (error: unknown) =>
  error instanceof ForbiddenError ||
  error instanceof ValidationError ||
  error instanceof ConflictError ||
  error instanceof NotFoundError ||
  (error instanceof Error && error.message === "storage is not configured on this server");

/**
 * The same access in every copy: a tool or a connection's scope given or taken in one copy is in all (on a join,
 * every copy's). A connection's scope names that connection in its workspace: in another it names the same
 * account's connection there; a workspace without one gets none (addendum 2026-11-19) and the agent's page lists it.
 * Mailboxes and databases keep their own per-agent rules (ADR 9002 §6). With a separate operation (docs/adr/doug-0035)
 * only the built-in tools cross: each company gives its connections, never brought from another.
 */
async function syncScopes(
  deps: TwinDeps,
  actor: string | null,
  members: Member[],
  base: TwinBase,
  missing: NonNullable<TwinBase["missing"]>,
  fence: Fence,
) {
  const { db } = deps;
  const ids = members.map((m) => m.agent.id);
  const grants = await db
    .select({ grant: agentScopes, connection: connectorConnections })
    .from(agentScopes)
    .leftJoin(connectorConnections, eq(connectorConnections.id, agentScopes.connectionId))
    .where(inArray(agentScopes.agentId, ids));
  const usable = grants.filter((g) =>
    fence.on
      ? g.grant.connectionId === null
      : g.grant.connectionId === null || (g.connection !== null && g.connection.revokedAt === null),
  );
  const keyOf = (connectionId: string | null, scope: string) => `${connectionId ?? ""}|${scope}`;
  const current = new Map<string, Set<string>>(ids.map((id) => [id, new Set<string>()]));
  const connections = new Map<string, NonNullable<(typeof usable)[number]["connection"]>>();
  for (const g of usable) {
    current.get(g.grant.agentId)?.add(keyOf(g.grant.connectionId, g.grant.scope));
    if (g.connection) connections.set(g.connection.id, g.connection);
  }
  const builtIn = (keys: string[]) => keys.filter((k) => k.startsWith("|"));
  const changes = setChanges(
    current,
    fence.on && base.scopes
      ? Object.fromEntries(Object.entries(base.scopes).map(([id, keys]) => [id, builtIn(keys)]))
      : base.scopes,
  );
  let changed = 0;
  // A connection of one workspace as another's (null: it can't come), asked once per sync.
  const mapped = new Map<string, string | null>();
  const connectionFor = async (connectionId: string, orgId: string) => {
    const k = `${connectionId}|${orgId}`;
    if (!mapped.has(k)) {
      const c = connections.get(connectionId);
      // Only the same account's connection already there: a workspace's connections never go to another on their own
      // (addendum 2026-11-19); a person brings one with "Trazer de outro workspace".
      mapped.set(k, c && deps.carry ? await connectionIn(deps.carry, null, orgId, c) : null);
    }
    return mapped.get(k) ?? null;
  };
  const translate = async (key: string, to: Member) => {
    const [connectionId, ...rest] = key.split("|");
    const scope = rest.join("|");
    if (!connectionId) return { connectionId: null, scope };
    const c = connections.get(connectionId);
    if (c && c.orgId === to.agent.orgId) return { connectionId, scope };
    const there = await connectionFor(connectionId, to.agent.orgId);
    if (!there) {
      if (c && !missing.some((x) => x.agentId === to.agent.id && x.label === c.label))
        missing.push({ agentId: to.agent.id, kind: "connection", label: c.label });
      return null;
    }
    return { connectionId: there, scope: scope.replaceAll(connectionId, there) };
  };
  for (const [from, change] of changes) {
    for (const to of members) {
      if (to.agent.id === from) continue;
      const has = current.get(to.agent.id) ?? new Set<string>();
      const give: { connectionId: string | null; scope: string }[] = [];
      for (const key of change.added) {
        const g = await translate(key, to);
        if (g && !has.has(keyOf(g.connectionId, g.scope))) give.push(g);
      }
      if (give.length > 0) {
        await grantScopes(db, to.agent.orgId, to.agent.id, give, actor);
        for (const g of give) has.add(keyOf(g.connectionId, g.scope));
        changed += give.length;
      }
      for (const key of change.removed) {
        // Taken in one copy: taken in the others, unless another copy gave it since.
        if ([...changes.values()].some((c) => c.added.includes(key))) continue;
        const g = await translate(key, to);
        if (!g || !has.has(keyOf(g.connectionId, g.scope))) continue;
        await db
          .delete(agentScopes)
          .where(
            and(
              eq(agentScopes.agentId, to.agent.id),
              eq(agentScopes.scope, g.scope),
              g.connectionId === null ? isNull(agentScopes.connectionId) : eq(agentScopes.connectionId, g.connectionId),
            ),
          );
        has.delete(keyOf(g.connectionId, g.scope));
        changed++;
      }
    }
  }
  // What each copy holds now: the next sync's base.
  const after = await db
    .select({ agentId: agentScopes.agentId, connectionId: agentScopes.connectionId, scope: agentScopes.scope })
    .from(agentScopes)
    .leftJoin(connectorConnections, eq(connectorConnections.id, agentScopes.connectionId))
    .where(
      and(
        inArray(agentScopes.agentId, ids),
        or(isNull(agentScopes.connectionId), isNull(connectorConnections.revokedAt)),
        or(isNull(agentScopes.connectionId), sql`${connectorConnections.id} is not null`),
      ),
    );
  const sets: Record<string, string[]> = {};
  for (const id of ids) sets[id] = [];
  for (const r of after)
    if (!fence.on || r.connectionId === null) sets[r.agentId]?.push(keyOf(r.connectionId, r.scope));
  for (const id of ids) sets[id]?.sort();
  return { changed, sets };
}
