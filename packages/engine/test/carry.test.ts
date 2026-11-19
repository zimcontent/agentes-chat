import { afterEach, describe, expect, test } from "bun:test";
import { createHash } from "node:crypto";
import { and, eq, isNull, schema } from "@dougbot/db";
import {
  type CarryDeps,
  type ConnectorDeps,
  carryOver,
  carrySources,
  completeOAuth,
  connectionHeaders,
  connectorGrantValidator,
  createApiKeyConnection,
  createOrganization,
  decryptCredential,
  enabledSkills,
  ForbiddenError,
  listAgentScopes,
  revokeAtProvider,
  revokeConnection,
  saveSkill,
  setAgentScopes,
  setAgentSkills,
  skillFolderFiles,
  startOAuth,
} from "../src";
import { addMember, type Fixture, setup } from "./fixtures";

let f: Fixture;
afterEach(() => f?.close());

const { connectorConnections, connectorSignIns, customTools, agents, skills } = schema;

const connectorsOf = (fx: Fixture, extra: Partial<ConnectorDeps> = {}): ConnectorDeps => ({
  db: fx.db,
  keyWrappers: [fx.keyWrapper],
  publicUrl: "https://chat.example.com",
  oauthApps: { github: { clientId: "gh-client", clientSecret: "gh-secret" } },
  ...extra,
});
const skillDeps = (fx: Fixture) => ({ db: fx.db, blobs: fx.artifactDeps.blobs });
const depsOf = (fx: Fixture, extra: Partial<ConnectorDeps> = {}): CarryDeps => ({
  connectors: connectorsOf(fx, extra),
  skills: () => skillDeps(fx),
});

/** A second workspace of `userId`. */
async function otherWorkspace(fx: Fixture, userId: string, name = "Second") {
  const { organization } = await createOrganization(fx.db, userId, { name });
  return organization;
}

const live = (fx: Fixture, orgId: string) =>
  fx.db
    .select()
    .from(connectorConnections)
    .where(and(eq(connectorConnections.orgId, orgId), isNull(connectorConnections.revokedAt)));

/** A token endpoint that rotates the refresh token on every answer, as many providers do. */
function tokenEndpoint() {
  const seen: URLSearchParams[] = [];
  let challenge = "";
  let n = 0;
  const spent = new Set<string>();
  const http = (async (_url: string, init?: RequestInit) => {
    const form = new URLSearchParams(String(init?.body));
    seen.push(form);
    if (form.get("grant_type") === "authorization_code") {
      const ok =
        createHash("sha256")
          .update(form.get("code_verifier") ?? "")
          .digest("base64url") === challenge;
      if (!ok) return Response.json({ error: "invalid_grant" }, { status: 400 });
    } else {
      const old = form.get("refresh_token") ?? "";
      if (spent.has(old)) return Response.json({ error: "invalid_grant" }, { status: 400 });
      spent.add(old);
    }
    n++;
    return Response.json({ access_token: `gho_token_${n}`, refresh_token: `ghr_refresh_${n}`, expires_in: 3600 });
  }) as unknown as typeof fetch;
  return { http, seen, setChallenge: (c: string) => (challenge = c) };
}

describe("bringing connections from another workspace", () => {
  test("a key gets a copy of its own, sealed for the new workspace; again is the same connection", async () => {
    f = await setup();
    const second = await otherWorkspace(f, f.owner.id);
    const source = await createApiKeyConnection(connectorsOf(f), f.owner.id, f.org.id, {
      connector: "github",
      apiKey: "ghp_secret_123456",
    });

    const [listed] = await carrySources(f.db, f.owner.id, second.id);
    expect(listed?.name).toBe(f.org.name);
    expect(listed?.connections.map((c) => [c.id, c.blocked, c.here])).toEqual([[source.id, null, false]]);
    expect(JSON.stringify(listed)).not.toContain("ghp_secret");

    const out = await carryOver(depsOf(f), f.owner.id, second.id, { connectionIds: [source.id] });
    expect(out.connections.map((c) => c.outcome)).toEqual(["brought"]);
    const [copy] = await live(f, second.id);
    expect(copy?.id).not.toBe(source.id);
    expect(copy?.carriedFromId).toBe(source.id);
    // No tokens to renew: nothing shared.
    expect(copy?.signInId).toBeNull();
    expect(copy?.secretCiphertext).not.toBe(source.secretCiphertext);
    if (!copy) throw new Error("no copy");
    expect(await connectionHeaders(connectorsOf(f), copy)).toEqual({ authorization: "Bearer ghp_secret_123456" });

    const again = await carryOver(depsOf(f), f.owner.id, second.id, { connectionIds: [source.id] });
    expect(again.connections).toEqual([{ sourceId: source.id, id: copy.id, label: copy.label, outcome: "here" }]);
    expect(await live(f, second.id)).toHaveLength(1);
    expect((await carrySources(f.db, f.owner.id, second.id))[0]?.connections[0]?.here).toBe(true);

    // Disconnected where it came from, the copy still works.
    await revokeConnection(f.db, f.owner.id, f.org.id, source.id);
    expect(await connectionHeaders(connectorsOf(f), copy)).toEqual({ authorization: "Bearer ghp_secret_123456" });
  });

  test("only whoever connected it, or the owner of its workspace, brings it", async () => {
    f = await setup();
    const admin = await addMember(f.db, f.org.id, "admin");
    const member = await addMember(f.db, f.org.id, "member");
    const theirs = await otherWorkspace(f, admin.id, "Admin's");
    const source = await createApiKeyConnection(connectorsOf(f), f.owner.id, f.org.id, {
      connector: "github",
      apiKey: "ghp_secret_123456",
    });
    // An admin who didn't connect it isn't offered it (the agents they manage, yes), and naming it brings nothing.
    expect((await carrySources(f.db, admin.id, theirs.id)).flatMap((s) => s.connections)).toEqual([]);
    const out = await carryOver(depsOf(f), admin.id, theirs.id, { connectionIds: [source.id] });
    expect(out.connections).toEqual([]);
    expect(out.skipped).toEqual([{ kind: "connection", id: source.id, label: source.label, reason: "not_yours" }]);
    expect(await live(f, theirs.id)).toEqual([]);

    // Into a workspace where they don't manage connectors: refused.
    const members = await otherWorkspace(f, member.id, "Member's");
    await expect(carryOver(depsOf(f), f.owner.id, members.id, { connectionIds: [source.id] })).rejects.toBeInstanceOf(
      ForbiddenError,
    );
  });

  test("an OAuth sign-in is shared: one renewal writes both workspaces' tokens", async () => {
    f = await setup();
    const second = await otherWorkspace(f, f.owner.id);
    const token = tokenEndpoint();
    const deps = connectorsOf(f, { http: token.http });
    const { authorizeUrl, state } = await startOAuth(deps, f.owner.id, f.org.id, "github");
    token.setChallenge(new URL(authorizeUrl).searchParams.get("code_challenge") ?? "");
    const { connection: source } = await completeOAuth(deps, { id: f.owner.id }, { state, code: "good-code" });

    await carryOver(depsOf(f, { http: token.http }), f.owner.id, second.id, { connectionIds: [source.id] });
    const [copy] = await live(f, second.id);
    const [shared] = await f.db.select().from(connectorSignIns);
    if (!copy || !shared) throw new Error("nothing brought");
    expect(copy.signInId).toBe(shared.id);
    expect((await live(f, f.org.id))[0]?.signInId).toBe(shared.id);
    expect(await connectionHeaders(deps, copy)).toEqual({ authorization: "Bearer gho_token_1" });

    // The new workspace renews first: the old refresh token is spent at the provider.
    const soon = connectorsOf(f, { http: token.http, now: () => new Date(Date.now() + 3590_000) });
    expect(await connectionHeaders(soon, copy)).toEqual({ authorization: "Bearer gho_token_2" });
    const renewals = token.seen.filter((s) => s.get("grant_type") === "refresh_token");
    expect(renewals.map((s) => s.get("refresh_token"))).toEqual(["ghr_refresh_1"]);

    // The workspace it came from got the new tokens too: it calls with them, and asks the provider for nothing.
    const [after] = await live(f, f.org.id);
    if (!after) throw new Error("source gone");
    expect(after.secretCiphertext).not.toBe(source.secretCiphertext);
    expect(await connectionHeaders(deps, after)).toEqual({ authorization: "Bearer gho_token_2" });
    expect(token.seen.filter((s) => s.get("grant_type") === "refresh_token")).toHaveLength(1);

    // And its own renewal later uses the rotated refresh token, and writes the copy's.
    const later = connectorsOf(f, { http: token.http, now: () => new Date(Date.now() + 2 * 3590_000) });
    expect(await connectionHeaders(later, after)).toEqual({ authorization: "Bearer gho_token_3" });
    expect(token.seen.at(-1)?.get("refresh_token")).toBe("ghr_refresh_2");
    const [copyNow] = await live(f, second.id);
    if (!copyNow) throw new Error("copy gone");
    expect(await connectionHeaders(deps, copyNow)).toEqual({ authorization: "Bearer gho_token_3" });

    // Disconnecting one never revokes the token the other still uses.
    expect(await revokeAtProvider(deps, f.org.id, source.id)).toBe(false);
  });

  test("a server by address comes with how its tools were classified", async () => {
    f = await setup();
    const second = await otherWorkspace(f, f.owner.id);
    const id = crypto.randomUUID();
    await f.db.insert(connectorConnections).values({
      id,
      orgId: f.org.id,
      connector: `custom:${id}`,
      label: "Acme tools",
      toolPrefix: "acme_tools",
      serverUrl: "https://mcp.acme.test/mcp",
      authType: "none",
      reviewedAt: new Date(),
      createdByUserId: f.owner.id,
    });
    await f.db.insert(customTools).values({
      orgId: f.org.id,
      connectionId: id,
      name: "list_orders",
      access: "read",
      label: "List orders",
    });
    await carryOver(depsOf(f), f.owner.id, second.id, { connectionIds: [id] });
    const [copy] = await live(f, second.id);
    expect(copy?.connector).toBe(`custom:${copy?.id}`);
    expect(copy?.toolPrefix).toBe("acme_tools");
    expect(copy?.reviewedAt).not.toBeNull();
    const tools = await f.db
      .select()
      .from(customTools)
      .where(eq(customTools.connectionId, copy?.id ?? ""));
    expect(tools.map((t) => [t.orgId, t.name, t.access])).toEqual([[second.id, "list_orders", "read"]]);
  });
});

describe("bringing an agent", () => {
  test("its profile, skills and access to its connections come; nothing else", async () => {
    f = await setup();
    const second = await otherWorkspace(f, f.owner.id);
    const source = await createApiKeyConnection(connectorsOf(f), f.owner.id, f.org.id, {
      connector: "github",
      apiKey: "ghp_secret_123456",
    });
    await setAgentScopes(
      f.db,
      f.owner.id,
      f.org.id,
      f.agent.id,
      [{ connectionId: source.id, scope: "github:pr.read" }],
      connectorGrantValidator,
    );
    const skill = await saveSkill(skillDeps(f), f.owner.id, f.org.id, {
      name: "triage",
      description: "How we triage bugs",
      body: "Read the report first.",
      metadata: {},
      source: "manual",
      files: [{ path: "reference.md", data: new TextEncoder().encode("# Severity levels") }],
    });
    await setAgentSkills(f.db, f.owner.id, f.org.id, f.agent.id, [{ skillId: skill.id, enabled: true }]);

    const [listed] = await carrySources(f.db, f.owner.id, second.id);
    const offered = listed?.agents.find((a) => a.id === f.agent.id);
    expect(offered).toMatchObject({
      handle: f.agent.handle,
      skills: ["triage"],
      connectionIds: [source.id],
      here: false,
    });

    // Only the agent is picked: its connection comes with it.
    const out = await carryOver(depsOf(f), f.owner.id, second.id, { agentIds: [f.agent.id] });
    expect(out.agents).toHaveLength(1);
    expect(out.connections.map((c) => c.outcome)).toEqual(["brought"]);
    expect(out.skills).toBe(1);
    expect(out.skipped).toEqual([]);

    const [made] = await f.db
      .select()
      .from(agents)
      .where(and(eq(agents.orgId, second.id), eq(agents.handle, f.agent.handle)));
    if (!made) throw new Error("no agent");
    expect(made.id).not.toBe(f.agent.id);
    expect([made.name, made.role, made.instructions]).toEqual([f.agent.name, f.agent.role, f.agent.instructions]);
    // Its model key stays behind.
    expect(made.credentialId).toBeNull();

    const [copy] = await live(f, second.id);
    const scopes = await listAgentScopes(f.db, second.id, made.id);
    expect(scopes.filter((s) => s.connectionId === copy?.id).map((s) => s.scope)).toEqual(["github:pr.read"]);

    expect((await enabledSkills(f.db, second.id, made.id)).map((s) => s.name)).toEqual(["triage"]);
    const [copied] = await f.db
      .select()
      .from(skills)
      .where(and(eq(skills.orgId, second.id), eq(skills.slug, "triage")));
    if (!copied) throw new Error("no skill");
    const files = await skillFolderFiles(skillDeps(f), copied);
    expect(files.map((x) => [x.path, new TextDecoder().decode(x.data)])).toEqual([
      ["reference.md", "# Severity levels"],
    ]);

    // Again: the agent is already there, and nothing is made twice.
    const again = await carryOver(depsOf(f), f.owner.id, second.id, { agentIds: [f.agent.id] });
    expect(again.agents).toEqual([]);
    expect(again.skipped).toEqual([{ kind: "agent", id: f.agent.id, label: f.agent.name, reason: "here" }]);
    expect(await live(f, second.id)).toHaveLength(1);
  });
});

describe("AI keys (ADR 9002 addendum 2026-11-16)", () => {
  test("the owner brings a workspace's AI key: a copy sealed for the other workspace, listed by its ending, never twice", async () => {
    f = await setup();
    const second = await otherWorkspace(f, f.owner.id);
    const deps: CarryDeps = { ...depsOf(f), credentials: { keyWrapper: f.keyWrapper } };
    const [source] = await carrySources(f.db, f.owner.id, second.id);
    const key = source?.keys.find((k) => k.id === f.credential.id);
    expect(key).toMatchObject({ provider: "anthropic", here: false });
    expect(JSON.stringify(source)).not.toContain("sk-ant-test-key");

    const out = await carryOver(deps, f.owner.id, second.id, { credentialIds: [f.credential.id] });
    expect(out.keys.map((k) => k.outcome)).toEqual(["brought"]);
    const copy = await decryptCredential(f.db, [f.keyWrapper], second.id, out.keys[0]?.id ?? "");
    expect(copy).toMatchObject({ provider: "anthropic", apiKey: "sk-ant-test-key-1234" });

    // Brought once: the next time it is here already.
    const [after] = await carrySources(f.db, f.owner.id, second.id);
    expect(after?.keys.find((k) => k.id === f.credential.id)?.here).toBe(true);
    const again = await carryOver(deps, f.owner.id, second.id, { credentialIds: [f.credential.id] });
    expect(again.keys.map((k) => k.outcome)).toEqual(["here"]);
  });

  test("someone who doesn't manage keys where it comes from neither sees nor brings them", async () => {
    f = await setup();
    const bia = await addMember(f.db, f.org.id, "member", "bia");
    const theirs = await otherWorkspace(f, bia.id, "Bia's");
    const sources = await carrySources(f.db, bia.id, theirs.id);
    expect(sources.flatMap((s) => s.keys)).toEqual([]);
    const out = await carryOver({ ...depsOf(f), credentials: { keyWrapper: f.keyWrapper } }, bia.id, theirs.id, {
      credentialIds: [f.credential.id],
    });
    expect(out.keys).toEqual([]);
    expect(out.skipped.map((s) => [s.kind, s.reason])).toEqual([["key", "not_yours"]]);
  });
});
