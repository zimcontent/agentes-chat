import type { KeyWrapper, PubSub } from "@agenteschat/adapters";
import { and, asc, type Database, eq, inArray, isNotNull, isNull, schema } from "@agenteschat/db";
import { linkTwins } from "./agent-twins";
import { type Agent, createAgent, NEW_AGENT_DEFAULTS, takenHandles } from "./agents";
import { recordAudit } from "./audit";
import { caches } from "./cache";
import {
  aadFor,
  type ConnectorConnection,
  type ConnectorDeps,
  freeLabel,
  freeToolPrefix,
  GITHUB_APP_AUTH,
  grantToEveryAgent,
  openConnectionSecret,
  prefixService,
  toolPrefixOfConnection,
} from "./connectors/connections";
import { CUSTOM_PREFIX, isCustom } from "./connectors/custom";
import { clientAad, serverKey } from "./connectors/oauth-mcp";
import { serverUrlShown } from "./connectors/presets";
import { createCredential, decryptCredential } from "./credentials";
import { openSecret, sealSecret } from "./crypto";
import type { EndpointNet } from "./endpoints";
import { ConflictError, ForbiddenError, ValidationError } from "./errors";
import { can, listMemberships, type Membership, requireChangePermission, requirePermission } from "./organizations";
import { isRightHand } from "./right-hand";
import { type SkillDeps, type SkillRow, saveSkill, skillFolderFiles } from "./skills";
import { closedRefusal, readRefusal } from "./standing";
import { grantScopes } from "./tools/scopes";

/**
 * Bringing connections and agents from a person's other workspaces (ADR 9002): what they connected once follows
 * them, so a new workspace starts with it instead of signing in to everything again.
 *
 * A connection is brought by whoever made it (or the owner of the workspace it is in) while they still manage
 * connectors there, into a workspace where they manage connectors too. A key gets a copy of its own. An OAuth
 * sign-in becomes one sign-in shared by the two workspaces (`connector_sign_ins`): its tokens are renewed once and
 * written to both (`refreshTokens` in connections.ts), since a provider that rotates the refresh token would refuse
 * the second workspace's. A service through Composio keeps Composio's account, under the Composio user it was made
 * for. GitHub through the app alone stays where it is: an installation belongs to one workspace.
 *
 * An agent comes as its profile (name, role, instructions, look), its skills and its access to the connections that
 * came with it. Never its conversations, memory, model key, computer or routines.
 */

const { connectorConnections, connectorSignIns, oauthClients, customTools, agents, agentScopes, agentSkills, skills } =
  schema;

/** How many of each one request brings. */
export const CARRY_LIMITS = { connections: 50, agents: 20, keys: 20 };

export interface CarryDeps {
  connectors: ConnectorDeps;
  /**
   * AI provider keys (addendum 2026-11-16): the wrapper that seals the copy, and how its check reaches the provider
   * or an endpoint. Absent: keys can't be brought here (`skipped` says so).
   */
  credentials?: { keyWrapper: KeyWrapper; fetch?: typeof fetch; net?: EndpointNet };
  /** Skills' storage, asked only when an agent's skills come along (a server without storage refuses those). */
  skills: () => SkillDeps;
  pubsub?: PubSub;
}

/** Why a connection can't be brought: GitHub through the app alone, or a sign-in that stopped working. */
export type CarryBlock = "github_app" | "needs_reconnect";

export interface CarrySourceConnection {
  id: string;
  connector: string;
  label: string;
  serverUrl: string;
  authType: string;
  accountLabel: string | null;
  icon: string | null;
  blocked: CarryBlock | null;
  /** The workspace asking already has it (brought before, or the same account connected there). */
  here: boolean;
}

export interface CarrySourceAgent {
  id: string;
  name: string;
  handle: string;
  role: string;
  appearance: Agent["appearance"];
  skills: string[];
  /** The connections it uses that would come with it. */
  connectionIds: string[];
  /** The workspace asking has an agent with this handle: it isn't brought again. */
  here: boolean;
}

/** An AI provider key of another workspace: its provider, name and the last characters it shows, never the key. */
export interface CarrySourceKey {
  id: string;
  provider: string;
  label: string;
  hint: string;
  /** The workspace asking has a live key of this provider with the same last characters (or endpoint address). */
  here: boolean;
}

export interface CarrySource {
  id: string;
  name: string;
  logo: string | null;
  connections: CarrySourceConnection[];
  agents: CarrySourceAgent[];
  keys: CarrySourceKey[];
}

export interface CarryResult {
  connections: { sourceId: string; id: string; label: string; outcome: "brought" | "here" }[];
  agents: { sourceId: string; id: string; name: string; handle: string }[];
  keys: { sourceId: string; id: string; label: string; outcome: "brought" | "here" }[];
  skills: number;
  skipped: { kind: "connection" | "agent" | "skill" | "key"; id: string; label: string; reason: string }[];
}

type KeyRow = typeof schema.providerCredentials.$inferSelect;

const liveKeys = (db: Database, orgIds: string[]) =>
  orgIds.length === 0
    ? Promise.resolve([] as KeyRow[])
    : db
        .select()
        .from(schema.providerCredentials)
        .where(and(inArray(schema.providerCredentials.orgId, orgIds), isNull(schema.providerCredentials.revokedAt)))
        .orderBy(asc(schema.providerCredentials.createdAt));

const endpointOf = (k: KeyRow) => (k.options as { endpoint?: { baseURL?: string } } | null)?.endpoint?.baseURL ?? null;

/** The live key of `target` that is `k` already: same provider and last characters (an endpoint: its address too). */
const keyTwinOf = (target: KeyRow[], k: KeyRow) =>
  target.find((t) => t.provider === k.provider && t.keyHint === k.keyHint && endpointOf(t) === endpointOf(k));

/** Who brings a workspace's AI keys: who manages them there (the owner always does). */
const mayBringKey = (m: Membership) => can(m, "manage_credentials");

const blockOf = (c: ConnectorConnection): CarryBlock | null =>
  c.authType === GITHUB_APP_AUTH ? "github_app" : c.status === "needs_reconnect" ? "needs_reconnect" : null;

/** The person brings what they connected; a workspace's owner, anything in it. */
const mayBring = (m: Membership, userId: string, c: ConnectorConnection) =>
  can(m, "manage_connectors") && (m.role === "owner" || c.createdByUserId === userId);

const mayBringAgent = (m: Membership, userId: string, a: Agent) => can(m, "manage_agents") || a.ownerUserId === userId;

/** The live connection of `target` that is `c` already: brought before, the same catalog connector or account. */
function twinOf(target: ConnectorConnection[], c: ConnectorConnection) {
  return target.find(
    (t) =>
      t.carriedFromId === c.id ||
      c.carriedFromId === t.id ||
      (c.signInId !== null && t.signInId === c.signInId) ||
      (isCustom(c)
        ? isCustom(t) &&
          serverKey(t.serverUrl) === serverKey(c.serverUrl) &&
          ((c.accountId !== null && t.accountId === c.accountId) ||
            (c.composioAccountId !== null && t.composioAccountId === c.composioAccountId) ||
            c.authType === "none")
        : t.connector === c.connector),
  );
}

const liveConnections = (db: Database, orgIds: string[]) =>
  orgIds.length === 0
    ? Promise.resolve([] as ConnectorConnection[])
    : db
        .select()
        .from(connectorConnections)
        .where(and(inArray(connectorConnections.orgId, orgIds), isNull(connectorConnections.revokedAt)))
        .orderBy(asc(connectorConnections.createdAt));

const liveAgents = (db: Database, orgIds: string[]) =>
  orgIds.length === 0
    ? Promise.resolve([] as Agent[])
    : db
        .select()
        .from(agents)
        .where(and(inArray(agents.orgId, orgIds), isNull(agents.archivedAt), isNull(agents.deletedAt)))
        .orderBy(asc(agents.createdAt));

/** The person's other workspaces they can read now: one suspended or being deleted gives nothing. */
async function sourceMemberships(db: Database, userId: string, targetOrgId: string) {
  const all = await listMemberships(db, userId);
  return all.filter((m) => m.orgId !== targetOrgId && !readRefusal(m.standing) && !closedRefusal(m.standing));
}

/**
 * What the person can bring into `targetOrgId` from their other workspaces, workspace by workspace: only ones with
 * something to bring. Names and accounts, never a secret.
 */
export async function carrySources(db: Database, userId: string, targetOrgId: string): Promise<CarrySource[]> {
  const membership = await requirePermission(db, userId, targetOrgId, "read");
  const keysHere = can(membership, "manage_credentials");
  if (!can(membership, "manage_connectors") && !can(membership, "create_agents") && !keysHere)
    throw new ForbiddenError();
  const sources = await sourceMemberships(db, userId, targetOrgId);
  const orgIds = sources.map((m) => m.orgId);
  const [connections, team, here, hereAgents, keys, hereKeys] = await Promise.all([
    liveConnections(db, orgIds),
    liveAgents(db, orgIds),
    liveConnections(db, [targetOrgId]),
    liveAgents(db, [targetOrgId]),
    keysHere ? liveKeys(db, orgIds) : Promise.resolve([] as KeyRow[]),
    keysHere ? liveKeys(db, [targetOrgId]) : Promise.resolve([] as KeyRow[]),
  ]);
  const agentIds = team.map((a) => a.id);
  const [grants, agentSkillRows] = await Promise.all([
    agentIds.length === 0
      ? []
      : db
          .select({ agentId: agentScopes.agentId, connectionId: agentScopes.connectionId })
          .from(agentScopes)
          .where(and(inArray(agentScopes.agentId, agentIds), isNotNull(agentScopes.connectionId))),
    agentIds.length === 0
      ? []
      : db
          .select({ agentId: agentSkills.agentId, name: skills.name })
          .from(agentSkills)
          .innerJoin(skills, eq(skills.id, agentSkills.skillId))
          .where(and(inArray(agentSkills.agentId, agentIds), eq(agentSkills.enabled, true), isNull(skills.deletedAt)))
          .orderBy(asc(skills.name)),
  ]);
  const handlesHere = new Set(hereAgents.map((a) => a.handle));
  return sources
    .map((m) => {
      const mine = connections.filter((c) => c.orgId === m.orgId && mayBring(m, userId, c));
      const bringable = new Set(mine.filter((c) => !blockOf(c)).map((c) => c.id));
      return {
        id: m.orgId,
        name: m.orgName,
        logo: m.orgLogo ?? null,
        connections: mine.map((c) => ({
          id: c.id,
          connector: c.connector,
          label: c.label,
          serverUrl: serverUrlShown(c.serverUrl),
          authType: c.authType,
          accountLabel: c.accountLabel,
          icon: c.icon,
          blocked: blockOf(c),
          here: Boolean(twinOf(here, c)),
        })),
        agents: team
          .filter((a) => a.orgId === m.orgId && !isRightHand(a) && mayBringAgent(m, userId, a))
          .map((a) => ({
            id: a.id,
            name: a.name,
            handle: a.handle,
            role: a.role,
            appearance: a.appearance,
            skills: agentSkillRows.filter((s) => s.agentId === a.id).map((s) => s.name),
            connectionIds: [
              ...new Set(
                grants
                  .filter((g) => g.agentId === a.id && g.connectionId && bringable.has(g.connectionId))
                  .map((g) => g.connectionId as string),
              ),
            ],
            here: handlesHere.has(a.handle),
          })),
        keys: mayBringKey(m)
          ? keys
              .filter((k) => k.orgId === m.orgId)
              .map((k) => ({
                id: k.id,
                provider: k.provider,
                label: k.label,
                hint: k.keyHint,
                here: Boolean(keyTwinOf(hereKeys, k)),
              }))
          : [],
      };
    })
    .filter((s) => s.connections.length > 0 || s.agents.length > 0 || s.keys.length > 0);
}

/**
 * The OAuth client a brought sign-in renews with, as a row of `targetOrgId`: the one it has for that issuer when it
 * is the same registration, else a copy (its secret sealed for the new row). A workspace that registered another
 * client with that issuer keeps it for its own sign-ins, and the brought one renews with the row it came from.
 */
async function carryOAuthClient(deps: ConnectorDeps, targetOrgId: string, clientRowId: string) {
  const [source] = await deps.db.select().from(oauthClients).where(eq(oauthClients.id, clientRowId));
  if (!source) return null;
  const own = () =>
    deps.db
      .select()
      .from(oauthClients)
      .where(and(eq(oauthClients.orgId, targetOrgId), eq(oauthClients.issuer, source.issuer)));
  const [existing] = await own();
  if (existing) return existing.clientId === source.clientId ? existing.id : source.id;
  const id = crypto.randomUUID();
  const wrapper = deps.keyWrappers[0];
  if (!wrapper) throw new Error("no key wrapper");
  const secret =
    source.secretCiphertext && source.wrappedDataKey && source.kekId
      ? await openSecret(
          deps.keyWrappers,
          { ciphertext: source.secretCiphertext, wrappedDataKey: source.wrappedDataKey, kekId: source.kekId },
          clientAad(source.orgId, source.id),
        )
      : null;
  const sealed = secret ? await sealSecret(wrapper, secret, clientAad(targetOrgId, id)) : null;
  const [row] = await deps.db
    .insert(oauthClients)
    .values({
      id,
      orgId: targetOrgId,
      issuer: source.issuer,
      authorizationEndpoint: source.authorizationEndpoint,
      tokenEndpoint: source.tokenEndpoint,
      clientId: source.clientId,
      secretCiphertext: sealed?.ciphertext ?? null,
      wrappedDataKey: sealed?.wrappedDataKey ?? null,
      kekId: sealed?.kekId ?? null,
      scope: source.scope,
      tokenAuthMethod: source.tokenAuthMethod,
    })
    .onConflictDoNothing()
    .returning();
  if (row) return row.id;
  // Registered here a moment ago by someone else's sign-in.
  const [raced] = await own();
  return raced?.clientId === source.clientId ? raced.id : source.id;
}

/**
 * Copies one connection into `target`. Under the source row's lock: a renewal in flight would leave the copy with
 * a refresh token the provider just spent, so it is refused for a moment (`connector.busy`), and from the lock on
 * every renewal of it is the shared sign-in's.
 */
async function carryConnection(
  deps: ConnectorDeps,
  actorId: string,
  target: Membership,
  source: Membership,
  sourceId: string,
): Promise<ConnectorConnection> {
  const wrapper = deps.keyWrappers[0];
  if (!wrapper) throw new Error("no key wrapper");
  const id = crypto.randomUUID();
  // The client its sign-in renews with, made before the lock: registering it is no part of the copy.
  const [peek] = await deps.db
    .select({ clientRowId: connectorConnections.oauthClientId })
    .from(connectorConnections)
    .where(eq(connectorConnections.id, sourceId));
  const oauthClientId = peek?.clientRowId ? await carryOAuthClient(deps, target.orgId, peek.clientRowId) : null;
  const row = await deps.db.transaction(async (tx) => {
    const [c] = await tx
      .select()
      .from(connectorConnections)
      .where(
        and(
          eq(connectorConnections.id, sourceId),
          eq(connectorConnections.orgId, source.orgId),
          isNull(connectorConnections.revokedAt),
        ),
      )
      .for("update");
    if (!c) throw new ConflictError("This connection is no longer there", "connector.gone");
    // Renewing right now, or signed in again since the read above.
    if ((c.refreshingUntil && c.refreshingUntil.getTime() > Date.now()) || c.oauthClientId !== peek?.clientRowId) {
      throw new ConflictError("This connection is renewing its sign-in. Try again in a moment", "connector.busy");
    }
    const secret = await openConnectionSecret(deps.keyWrappers, c);
    const sealed = secret ? await sealSecret(wrapper, JSON.stringify(secret), aadFor(target.orgId, id)) : null;
    // Tokens that get renewed are one sign-in for both workspaces from here on.
    let signInId = c.signInId;
    if (!signInId && secret?.refreshToken) {
      const [signIn] = await tx.insert(connectorSignIns).values({ userId: actorId }).returning();
      if (!signIn) throw new Error("sign-in insert returned nothing");
      signInId = signIn.id;
      await tx.update(connectorConnections).set({ signInId }).where(eq(connectorConnections.id, c.id));
    }
    const custom = isCustom(c);
    const [made] = await tx
      .insert(connectorConnections)
      .values({
        id,
        orgId: target.orgId,
        connector: custom ? `${CUSTOM_PREFIX}${id}` : c.connector,
        label: await freeLabel(tx, target.orgId, c.label),
        toolPrefix: custom
          ? await freeToolPrefix(tx, target.orgId, prefixService(toolPrefixOfConnection(c)), deps.oauthApps)
          : await freeToolPrefix(tx, target.orgId, c.connector, deps.oauthApps, c.connector),
        serverUrl: c.serverUrl,
        authType: c.authType,
        secretCiphertext: sealed?.ciphertext ?? null,
        wrappedDataKey: sealed?.wrappedDataKey ?? null,
        kekId: sealed?.kekId ?? null,
        tokenExpiresAt: c.tokenExpiresAt,
        accountLabel: c.accountLabel,
        accountId: c.accountId,
        reviewedAt: c.reviewedAt,
        oauthClientId,
        resource: c.resource,
        icon: c.icon,
        composioAccountId: c.composioAccountId,
        composioUserOrgId: c.composioAccountId ? (c.composioUserOrgId ?? c.orgId) : null,
        oauthScopes: c.oauthScopes,
        signInId,
        carriedFromId: c.id,
        createdByUserId: actorId,
      })
      .returning();
    if (!made) throw new Error("connection insert returned nothing");
    if (custom) {
      // How its tools were classified comes along: nothing to review again.
      const tools = await tx
        .select()
        .from(customTools)
        .where(and(eq(customTools.connectionId, c.id), isNull(customTools.removedAt)));
      if (tools.length > 0) {
        await tx.insert(customTools).values(
          tools.map(({ id: _id, firstSeenAt: _seen, ...tool }) => ({
            ...tool,
            orgId: target.orgId,
            connectionId: made.id,
          })),
        );
      }
    }
    const actor = { type: "person" as const, id: actorId };
    await recordAudit(tx, {
      orgId: target.orgId,
      actor,
      action: "connector.carried",
      target: { type: "connector", id: made.id },
      details: { connector: c.connector.split(":")[0], label: made.label, auth: c.authType, from: source.orgName },
    });
    await recordAudit(tx, {
      orgId: source.orgId,
      actor,
      action: "connector.carried_out",
      target: { type: "connector", id: c.id },
      details: { label: c.label, to: target.orgName, sharedSignIn: Boolean(signInId) },
    });
    await grantToEveryAgent(tx, target.orgId, actorId, made);
    return made;
  });
  for (const orgId of [target.orgId, source.orgId]) caches.connections.delete(`${orgId}:active`);
  caches.scopes.deletePrefix(`${target.orgId}:`);
  return row;
}

/**
 * One of the source's skills as `target`'s: the one it has by that name, else a copy with its files. `replace` (the
 * copies of one agent, ADR doug-0013): the one it has takes the source's text and files as a new version, as an edit
 * by hand would.
 */
export async function carrySkill(
  deps: SkillDeps,
  actorId: string,
  targetOrgId: string,
  s: SkillRow,
  options: { replace?: boolean } = {},
) {
  const [existing] = await deps.db
    .select()
    .from(skills)
    .where(
      and(eq(skills.orgId, targetOrgId), eq(skills.slug, s.slug), isNull(skills.deletedAt), isNull(skills.ownerUserId)),
    );
  if (existing && !options.replace) return { id: existing.id, copied: false };
  const files = await skillFolderFiles(deps, s);
  const saved = await saveSkill(deps, actorId, targetOrgId, {
    name: s.slug,
    description: s.description,
    body: s.body,
    metadata: s.metadata,
    ...(existing
      ? { source: "manual" as const, sourceUrl: existing.sourceUrl }
      : {
          source:
            s.source === "url" ? ("url" as const) : s.source === "manual" ? ("manual" as const) : ("upload" as const),
          sourceUrl: s.sourceUrl,
        }),
    files: files.map((f) => ({ path: f.path, data: f.data })),
  });
  return { id: saved.id, copied: !existing };
}

/**
 * `c`, a connection of another workspace, as `targetOrgId`'s (ADR doug-0013): the one there already (brought before,
 * the same account), else brought now by `actorId` as "Trazer de outro workspace" would. Null: it can't come (not
 * theirs to bring, blocked, no one to bring it).
 */
export async function connectionIn(
  deps: CarryDeps,
  actorId: string | null,
  targetOrgId: string,
  c: ConnectorConnection,
): Promise<string | null> {
  const here = twinOf(await liveConnections(deps.connectors.db, [targetOrgId]), c);
  if (here) return here.id;
  if (!actorId) return null;
  try {
    const result = await carryOver(deps, actorId, targetOrgId, { connectionIds: [c.id] });
    return result.connections[0]?.id ?? null;
  } catch (error) {
    if (error instanceof ForbiddenError || error instanceof ValidationError || error instanceof ConflictError)
      return null;
    throw error;
  }
}

/**
 * Brings connections and agents into `targetOrgId`. Each agent's own connections come with it. What can't come
 * (no longer the person's to bring, blocked, already here) is left out and named in `skipped`; one item failing
 * never undoes the others.
 */
export async function carryOver(
  deps: CarryDeps,
  actorId: string,
  targetOrgId: string,
  input: { connectionIds?: string[]; agentIds?: string[]; credentialIds?: string[] },
): Promise<CarryResult> {
  const { db } = deps.connectors;
  const connectionIds = [...new Set(input.connectionIds ?? [])];
  const agentIds = [...new Set(input.agentIds ?? [])];
  const credentialIds = [...new Set(input.credentialIds ?? [])];
  if (connectionIds.length + agentIds.length + credentialIds.length === 0)
    throw new ValidationError("Pick something to bring");
  if (
    connectionIds.length > CARRY_LIMITS.connections ||
    agentIds.length > CARRY_LIMITS.agents ||
    credentialIds.length > CARRY_LIMITS.keys
  ) {
    throw new ValidationError("Too many at once");
  }
  const target = await requireChangePermission(
    db,
    actorId,
    targetOrgId,
    agentIds.length > 0 ? "manage_agents" : "read",
  );
  if (agentIds.length > 0 && !can(target, "create_agents")) throw new ForbiddenError();
  const sources = new Map((await sourceMemberships(db, actorId, targetOrgId)).map((m) => [m.orgId, m]));
  const orgIds = [...sources.keys()];
  const result: CarryResult = { connections: [], agents: [], keys: [], skills: 0, skipped: [] };

  // AI provider keys: each a copy of its own here, sealed for this workspace, checked with its provider as any new
  // key is; one already here (same provider and last characters) is not copied again.
  if (credentialIds.length > 0) {
    if (!can(target, "manage_credentials")) throw new ForbiddenError();
    const candidates = (await liveKeys(db, orgIds)).filter((k) => credentialIds.includes(k.id));
    for (const id of credentialIds) {
      if (!candidates.some((k) => k.id === id)) result.skipped.push({ kind: "key", id, label: "", reason: "gone" });
    }
    for (const k of candidates) {
      const source = sources.get(k.orgId);
      if (!source || !mayBringKey(source)) {
        result.skipped.push({ kind: "key", id: k.id, label: k.label, reason: "not_yours" });
        continue;
      }
      const twin = keyTwinOf(await liveKeys(db, [targetOrgId]), k);
      if (twin) {
        result.keys.push({ sourceId: k.id, id: twin.id, label: twin.label, outcome: "here" });
        continue;
      }
      if (!deps.credentials) {
        result.skipped.push({ kind: "key", id: k.id, label: k.label, reason: "unavailable" });
        continue;
      }
      const open = await decryptCredential(db, deps.connectors.keyWrappers, k.orgId, k.id);
      if (!open) {
        result.skipped.push({ kind: "key", id: k.id, label: k.label, reason: "gone" });
        continue;
      }
      const endpoint = open.options?.endpoint;
      try {
        const made = await createCredential(
          db,
          deps.credentials.keyWrapper,
          actorId,
          targetOrgId,
          {
            provider: open.provider,
            label: k.label,
            apiKey: open.apiKey,
            workspaceId: open.workspaceId ?? null,
            organization: open.options?.organization ?? null,
            project: open.options?.project ?? null,
            ...(endpoint ? { endpoint } : {}),
          },
          {
            fetch: deps.credentials.fetch,
            net: deps.credentials.net,
            keyWrappers: deps.connectors.keyWrappers,
          },
        );
        await recordAudit(db, {
          orgId: targetOrgId,
          actor: { type: "person", id: actorId },
          action: "credential.carried",
          target: { type: "credential", id: made.id },
          details: { provider: k.provider, label: k.label, from: source.orgName },
        });
        result.keys.push({ sourceId: k.id, id: made.id, label: made.label, outcome: "brought" });
      } catch (error) {
        if (!(error instanceof ValidationError) && !(error instanceof ConflictError)) throw error;
        result.skipped.push({ kind: "key", id: k.id, label: k.label, reason: error.code });
      }
    }
  }

  const team = (await liveAgents(db, orgIds)).filter((a) => agentIds.includes(a.id));
  for (const id of agentIds) {
    if (!team.some((a) => a.id === id)) result.skipped.push({ kind: "agent", id, label: "", reason: "gone" });
  }
  // Each agent's own connections come with it.
  const grants =
    team.length === 0
      ? []
      : await db
          .select()
          .from(agentScopes)
          .where(
            and(
              inArray(
                agentScopes.agentId,
                team.map((a) => a.id),
              ),
              isNotNull(agentScopes.connectionId),
            ),
          );
  const wanted = new Set([...connectionIds, ...grants.map((g) => g.connectionId as string)]);
  const asked = new Set(connectionIds);

  // Source connection → the target's.
  const brought = new Map<string, ConnectorConnection>();
  if (wanted.size > 0) {
    if (!can(target, "manage_connectors")) throw new ForbiddenError();
    const candidates = (await liveConnections(db, orgIds)).filter((c) => wanted.has(c.id));
    for (const id of asked) {
      if (!candidates.some((c) => c.id === id)) {
        result.skipped.push({ kind: "connection", id, label: "", reason: "gone" });
      }
    }
    for (const c of candidates) {
      const source = sources.get(c.orgId);
      const reason = !source || !mayBring(source, actorId, c) ? "not_yours" : blockOf(c);
      if (!source || reason) {
        // An agent's connection the person can't bring stays behind silently only when nobody asked for it by name.
        if (asked.has(c.id) || reason !== "not_yours") {
          result.skipped.push({ kind: "connection", id: c.id, label: c.label, reason: reason ?? "not_yours" });
        }
        continue;
      }
      const twin = twinOf(await liveConnections(db, [targetOrgId]), c);
      if (twin) {
        brought.set(c.id, twin);
        result.connections.push({ sourceId: c.id, id: twin.id, label: twin.label, outcome: "here" });
        continue;
      }
      try {
        const made = await carryConnection(deps.connectors, actorId, target, source, c.id);
        brought.set(c.id, made);
        result.connections.push({ sourceId: c.id, id: made.id, label: made.label, outcome: "brought" });
      } catch (error) {
        if (!(error instanceof ConflictError)) throw error;
        result.skipped.push({ kind: "connection", id: c.id, label: c.label, reason: error.code });
      }
    }
  }

  for (const a of team) {
    const source = sources.get(a.orgId);
    if (!source || isRightHand(a) || !mayBringAgent(source, actorId, a)) {
      result.skipped.push({ kind: "agent", id: a.id, label: a.name, reason: "not_yours" });
      continue;
    }
    const taken = await takenHandles(db, targetOrgId);
    if (taken.has(a.handle)) {
      // The same agent is here already: from now on the two are trained as one (ADR doug-0013).
      const [there] = await db
        .select({ id: agents.id, builtin: agents.builtin })
        .from(agents)
        .where(and(eq(agents.orgId, targetOrgId), eq(agents.handle, a.handle), isNull(agents.deletedAt)));
      if (there && !there.builtin) {
        await linkTwins(db, actorId, [a.id, there.id]).catch((error) => {
          if (!(error instanceof ValidationError)) throw error;
        });
      }
      result.skipped.push({ kind: "agent", id: a.id, label: a.name, reason: "here" });
      continue;
    }
    const made = await createAgent(
      db,
      actorId,
      targetOrgId,
      {
        name: a.name,
        handle: a.handle,
        role: a.role,
        instructions: a.instructions,
        mediaReplies: a.mediaReplies,
        setup: { role: null },
      },
      NEW_AGENT_DEFAULTS,
      { pubsub: deps.pubsub },
    );
    if (a.appearance) {
      await db.update(agents).set({ appearance: a.appearance }).where(eq(agents.id, made.id));
      caches.agents.delete(`${targetOrgId}:team`);
    }
    // Its access to what came with it, at the level it had: a server's own scopes name the connection they are of.
    const access = grants.flatMap((g) => {
      const here = g.agentId === a.id && g.connectionId ? brought.get(g.connectionId) : undefined;
      return here ? [{ connectionId: here.id, scope: g.scope.replace(g.connectionId as string, here.id) }] : [];
    });
    await grantScopes(db, targetOrgId, made.id, access, actorId);
    const theirs = await db
      .select({ skill: skills })
      .from(agentSkills)
      .innerJoin(skills, eq(skills.id, agentSkills.skillId))
      .where(and(eq(agentSkills.agentId, a.id), eq(agentSkills.enabled, true), isNull(skills.deletedAt)))
      .orderBy(asc(skills.name));
    for (const { skill } of theirs) {
      try {
        const { id, copied } = await carrySkill(deps.skills(), actorId, targetOrgId, skill);
        await db
          .insert(agentSkills)
          .values({ orgId: targetOrgId, agentId: made.id, skillId: id, enabled: true })
          .onConflictDoUpdate({ target: [agentSkills.agentId, agentSkills.skillId], set: { enabled: true } });
        if (copied) result.skills++;
      } catch (error) {
        if (!(error instanceof ValidationError) && !(error instanceof ForbiddenError)) throw error;
        result.skipped.push({ kind: "skill", id: skill.id, label: skill.name, reason: error.code });
      }
    }
    await recordAudit(db, {
      orgId: targetOrgId,
      actor: { type: "person", id: actorId },
      action: "agent.carried",
      target: { type: "agent", id: made.id },
      details: { name: made.name, handle: made.handle, from: source.orgName, skills: theirs.length },
    });
    // From here on it is one agent in both workspaces, trained as one (ADR doug-0013).
    await linkTwins(db, actorId, [a.id, made.id]);
    result.agents.push({ sourceId: a.id, id: made.id, name: made.name, handle: made.handle });
  }
  caches.scopes.deletePrefix(`${targetOrgId}:`);
  return result;
}
