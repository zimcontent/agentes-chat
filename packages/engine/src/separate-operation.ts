/**
 * A separate operation (docs/adr/doug-0035-separate-operation.md): a workspace whose agents also work in the owner's
 * other workspaces, like people employed by two companies. Each copy of such an agent carries its craft to the
 * others (how it works: instructions, skills, lessons, rules, preferences), never what it saw in one company (facts,
 * decisions, notes, its clients, its connections). The rule holds both ways, for every copy of a group with a
 * separate workspace in it: `syncTwins` asks the fence here what may cross.
 *
 * What names a company is read in code, never by a model: the workspace's name, the names its owners keep there
 * (`organization_settings.kept_names`) and the entities its context knows as a client, project, company or person
 * (`entity_profile`). A text crosses into a workspace unless it names something of another workspace of the group
 * that this one doesn't know as well.
 */
import { and, type Database, eq, inArray, isNull, rowsOf, schema, sql } from "@dougbot/db";
import { recordAudit } from "./audit";
import { CRAFT_KINDS } from "./context/items";
import { ForbiddenError, NotFoundError, ValidationError } from "./errors";
import { can, getMembership } from "./organizations";

const { organizations, organizationSettings, organizationMembers, users, agents, contextItems, agentTwins } = schema;
const { connectorConnections } = schema;

/** The memory that crosses between a separate operation's copies: how the agent works, not what it saw (`CRAFT_KINDS`). */
export const CRAFT_SET: ReadonlySet<string> = new Set(CRAFT_KINDS);

/** An entity the context knows (`entity_profile`, titled "Name (type)") that names a company's own: kept there. */
const OWN_ENTITY =
  /\b(client|cliente|customer|company|empresa|project|projeto|brand|marca|person|pessoa|people|account|conta|partner|parceir|lead|prospect|job)/i;

/** How many names one workspace keeps at most, and how long one is. */
export const KEPT_NAMES_MAX = 300;
const KEPT_NAME_MAX = 80;
/** A name shorter than this says too little to tell companies apart ("FG" is kept by hand, not from the context). */
const MIN_NAME = 3;

/** Lower case, no accents, words split by single spaces: names are found as whole words. */
export function fold(text: string): string {
  return ` ${text
    .normalize("NFD")
    .replace(/\p{M}+/gu, "")
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .trim()} `;
}

export interface Fence {
  /** Whether a group's copies are fenced at all: a group without a separate workspace shares everything. */
  readonly on: boolean;
  /**
   * Whether `text` names something of another workspace of the group that `toOrgId` doesn't know: it doesn't cross
   * into `toOrgId`, and found there, it came from elsewhere.
   */
  foreignTo(text: string, toOrgId: string): boolean;
  /** Whether a person is a member of `orgId` (a memory about someone crosses only where they are). */
  memberOf(userId: string, orgId: string): boolean;
}

const OPEN: Fence = { on: false, foreignTo: () => false, memberOf: () => true };

interface OrgNames {
  /** What names this workspace's own: never crosses where it isn't known. */
  own: Set<string>;
  /** What this workspace knows (its own names, its people and agents): a text naming it may come in. */
  known: Set<string>;
  members: Set<string>;
}

/** A kept name as the owners wrote it, cleaned: a word or a few, no line breaks. */
export function cleanKeptNames(names: readonly string[]): string[] {
  const out: string[] = [];
  const seen = new Set<string>();
  for (const raw of names) {
    const name = raw.replace(/\s+/g, " ").trim().slice(0, KEPT_NAME_MAX);
    const key = fold(name).trim();
    if (!key || seen.has(key)) continue;
    seen.add(key);
    out.push(name);
    if (out.length >= KEPT_NAMES_MAX) break;
  }
  return out;
}

/** The workspaces of `orgIds` that are separate operations. */
export async function separateOrgs(db: Database, orgIds: readonly string[]): Promise<Set<string>> {
  if (orgIds.length === 0) return new Set();
  const rows = await db
    .select({ orgId: organizationSettings.orgId })
    .from(organizationSettings)
    .where(and(inArray(organizationSettings.orgId, [...orgIds]), eq(organizationSettings.separateOperation, true)));
  return new Set(rows.map((r) => r.orgId));
}

async function namesOf(db: Database, orgIds: string[]): Promise<Map<string, OrgNames>> {
  const out = new Map<string, OrgNames>(
    orgIds.map((id) => [id, { own: new Set(), known: new Set(), members: new Set() }]),
  );
  const own = (orgId: string, name: string, minimum = MIN_NAME) => {
    const f = fold(name).trim();
    if (f.length < minimum) return;
    out.get(orgId)?.own.add(f);
    out.get(orgId)?.known.add(f);
  };
  const known = (orgId: string, name: string | null) => {
    const f = fold(name ?? "").trim();
    if (f) out.get(orgId)?.known.add(f);
  };
  const orgs = await db
    .select({ id: organizations.id, name: organizations.name, kept: organizationSettings.keptNames })
    .from(organizations)
    .leftJoin(organizationSettings, eq(organizationSettings.orgId, organizations.id))
    .where(inArray(organizations.id, orgIds));
  for (const o of orgs) {
    own(o.id, o.name);
    // Kept by hand: a person wrote it, so a short one ("FG") counts.
    for (const name of o.kept ?? []) own(o.id, name, 1);
  }
  const entities = await db
    .select({ orgId: contextItems.orgId, title: contextItems.title })
    .from(contextItems)
    .where(
      and(
        inArray(contextItems.orgId, orgIds),
        eq(contextItems.kind, "entity_profile"),
        eq(contextItems.status, "active"),
        isNull(contextItems.supersededBy),
      ),
    );
  for (const e of entities) {
    const m = /^(.*)\(([^()]*)\)\s*$/.exec(e.title);
    const name = (m?.[1] ?? e.title).trim();
    if (m && OWN_ENTITY.test(m[2] ?? "")) own(e.orgId, name);
    else known(e.orgId, name);
  }
  const people = await db
    .select({ orgId: organizationMembers.orgId, userId: users.id, name: users.name })
    .from(organizationMembers)
    .innerJoin(users, eq(users.id, organizationMembers.userId))
    .where(inArray(organizationMembers.orgId, orgIds));
  for (const p of people) {
    out.get(p.orgId)?.members.add(p.userId);
    known(p.orgId, p.name);
    // A person is known by their first name too.
    known(p.orgId, (p.name ?? "").split(/\s+/)[0] ?? "");
  }
  const team = await db
    .select({ orgId: agents.orgId, name: agents.name, handle: agents.handle })
    .from(agents)
    .where(and(inArray(agents.orgId, orgIds), isNull(agents.deletedAt)));
  for (const a of team) {
    known(a.orgId, a.name);
    known(a.orgId, a.handle);
  }
  return out;
}

/** What may cross between the workspaces of one group of copies (`orgIds`), read once per sync. */
export async function fenceFor(db: Database, orgIds: readonly string[]): Promise<Fence> {
  const ids = [...new Set(orgIds)];
  if ((await separateOrgs(db, ids)).size === 0) return OPEN;
  const names = await namesOf(db, ids);
  const cache = new Map<string, boolean>();
  return {
    on: true,
    foreignTo(text, toOrgId) {
      const key = `${toOrgId}\u0000${text}`;
      const hit = cache.get(key);
      if (hit !== undefined) return hit;
      const folded = fold(text);
      const here = names.get(toOrgId);
      let foreign = false;
      for (const [orgId, n] of names) {
        if (orgId === toOrgId) continue;
        for (const name of n.own) {
          if (here?.known.has(name)) continue;
          if (folded.includes(` ${name} `)) {
            foreign = true;
            break;
          }
        }
        if (foreign) break;
      }
      cache.set(key, foreign);
      return foreign;
    },
    memberOf(userId, orgId) {
      return names.get(orgId)?.members.has(userId) ?? false;
    },
  };
}

// ── The setting ─────────────────────────────────────────────────────────────

export interface SeparateOperationView {
  on: boolean;
  /** The names kept here by hand. */
  names: string[];
  /** Whether the person may change it (the workspace's owners). */
  canEdit: boolean;
  /**
   * Connections here signed in with an account another workspace also uses: they reach what that account reaches,
   * whatever this setting says. Each should be connected again with this operation's own account.
   */
  sharedSignIns: { id: string; label: string; workspaces: string[] }[];
}

export async function getSeparateOperation(
  db: Database,
  userId: string,
  orgId: string,
): Promise<SeparateOperationView> {
  const membership = await getMembership(db, userId, orgId);
  if (!membership) throw new NotFoundError("Organization not found");
  if (!can(membership, "configure")) throw new ForbiddenError("You can't see this workspace's settings");
  const [row] = await db
    .select({ on: organizationSettings.separateOperation, names: organizationSettings.keptNames })
    .from(organizationSettings)
    .where(eq(organizationSettings.orgId, orgId));
  return {
    on: row?.on ?? false,
    names: row?.names ?? [],
    canEdit: can(membership, "manage_owners"),
    sharedSignIns: await sharedSignInsOf(db, orgId),
  };
}

async function sharedSignInsOf(db: Database, orgId: string) {
  const rows = rowsOf<{ id: string; label: string; workspaces: string[] }>(
    await db.execute(sql`
      select c.id, c.label, array_agg(distinct o.name order by o.name) as workspaces
      from ${connectorConnections} c
      join ${connectorConnections} other
        on other.id <> c.id and other.org_id <> c.org_id and other.revoked_at is null
       and ((c.sign_in_id is not null and other.sign_in_id = c.sign_in_id)
         or (c.composio_account_id is not null and other.composio_account_id = c.composio_account_id))
      join ${organizations} o on o.id = other.org_id
      where c.org_id = ${orgId} and c.revoked_at is null
      group by c.id, c.label
      order by c.label
    `),
  );
  return rows.map((r) => ({ id: r.id, label: r.label, workspaces: r.workspaces }));
}

/**
 * Turns a workspace into a separate operation (or back), or changes the names it keeps. Only its owners: it decides
 * what its agents carry to and from the owner's other workspaces. Every group of copies with one here is synced again
 * at the workers' next tick, which also takes back what already crossed (`syncTwins`).
 */
export async function setSeparateOperation(
  db: Database,
  userId: string,
  orgId: string,
  input: { on?: boolean; names?: string[] },
): Promise<SeparateOperationView> {
  const membership = await getMembership(db, userId, orgId);
  if (!membership) throw new NotFoundError("Organization not found");
  if (!can(membership, "manage_owners"))
    throw new ForbiddenError("Only the workspace's owners decide what its agents carry elsewhere");
  if (input.names && input.names.length > KEPT_NAMES_MAX * 2) throw new ValidationError("Too many names");
  const names = input.names ? cleanKeptNames(input.names) : undefined;
  const set = {
    ...(input.on !== undefined ? { separateOperation: input.on } : {}),
    ...(names ? { keptNames: names } : {}),
    updatedAt: new Date(),
  };
  await db
    .insert(organizationSettings)
    .values({ orgId, ...set })
    .onConflictDoUpdate({ target: organizationSettings.orgId, set });
  // Every group with a copy here reads the fence again at its next sync.
  await db
    .update(agentTwins)
    .set({ fingerprint: null })
    .where(
      inArray(
        agentTwins.id,
        db
          .select({ id: agents.twinId })
          .from(agents)
          .where(and(eq(agents.orgId, orgId), sql`${agents.twinId} is not null`)),
      ),
    );
  await recordAudit(db, {
    orgId,
    actor: { type: "person", id: userId },
    action: "organization.separate_operation_changed",
    target: { type: "organization", id: orgId },
    details: {
      ...(input.on !== undefined ? { on: input.on } : {}),
      ...(names ? { names: names.length } : {}),
    },
  });
  return getSeparateOperation(db, userId, orgId);
}
