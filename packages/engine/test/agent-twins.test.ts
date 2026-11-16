import { afterEach, describe, expect, test } from "bun:test";
import { and, eq, schema } from "@agenteschat/db";
import {
  agentTwinView,
  autoLinkTwins,
  type CarryDeps,
  type ConnectorDeps,
  carryOver,
  createApiKeyConnection,
  createOrganization,
  enabledSkills,
  grantScopes,
  insertContextItem,
  joinInstructions,
  joinTwin,
  leaveTwin,
  listAgentScopes,
  mergeInstructions,
  saveSkill,
  setAgentSkills,
  syncTwins,
} from "../src";
import { type Fixture, setup } from "./fixtures";

let f: Fixture;
afterEach(() => f?.close());

const { agents, contextItems, skills } = schema;

const connectorsOf = (fx: Fixture): ConnectorDeps => ({
  db: fx.db,
  keyWrappers: [fx.keyWrapper],
  publicUrl: "https://chat.example.com",
  oauthApps: {},
});
const skillDeps = (fx: Fixture) => ({ db: fx.db, blobs: fx.artifactDeps.blobs });
const carryOf = (fx: Fixture): CarryDeps => ({ connectors: connectorsOf(fx), skills: () => skillDeps(fx) });
const twinDeps = (fx: Fixture) => ({ db: fx.db, carry: carryOf(fx) });

async function agentOf(fx: Fixture, id: string) {
  const [a] = await fx.db.select().from(agents).where(eq(agents.id, id));
  if (!a) throw new Error("no agent");
  return a;
}

const memoriesOf = (fx: Fixture, agentId: string) =>
  fx.db
    .select()
    .from(contextItems)
    .where(eq(contextItems.agentId, agentId))
    .then((rows) => rows.map((r) => [r.content, r.status]).sort());

async function syncAll(fx: Fixture, agentId: string) {
  const a = await agentOf(fx, agentId);
  if (!a.twinId) throw new Error("not linked");
  return syncTwins(twinDeps(fx), a.twinId);
}

/** The same agent made by hand in another of the owner's workspaces. */
async function sameAgentIn(fx: Fixture, orgId: string, instructions: string) {
  const [a] = await fx.db
    .insert(agents)
    .values({
      orgId,
      name: fx.agent.name,
      handle: fx.agent.handle,
      role: fx.agent.role,
      instructions,
      model: fx.agent.model,
      ownerUserId: fx.owner.id,
    })
    .returning();
  if (!a) throw new Error("no agent");
  return a;
}

describe("instructions merged by line", () => {
  test("joined: the newest text, plus what an older copy says that it doesn't; a reworded rule keeps the newer wording", () => {
    const older =
      "# Rosa\n- Editable file: Figma or the client's file, never HTML.\n- Orchestrate #dev when nobody is named.";
    const newer = "# Rosa\n- Editable file: Figma or HTML, as the client asks.\n## Learned\n- Cards for every copy.";
    const joined = joinInstructions([
      { text: older, at: 1 },
      { text: newer, at: 2 },
    ]);
    expect(joined).toBe(
      "# Rosa\n- Orchestrate #dev when nobody is named.\n- Editable file: Figma or HTML, as the client asks.\n## Learned\n- Cards for every copy.",
    );
  });

  test("two copies changed since the last sync: both changes are kept", () => {
    const base = "Rules:\n- one\n- two";
    const merged = mergeInstructions(base, [
      { text: "Rules:\n- one\n- two\n- three", at: 2 },
      { text: "Rules:\n- two\n- four", at: 1 },
      { text: base, at: 3 },
    ]);
    expect(merged).toBe("Rules:\n- two\n- four\n- three");
    expect(mergeInstructions(base, [{ text: base, at: 1 }])).toBe(base);
  });
});

describe("one agent in several workspaces (ADR doug-0013)", () => {
  test("an agent brought from another workspace stays one: what trains one copy reaches the other", async () => {
    f = await setup();
    const { organization: second } = await createOrganization(f.db, f.owner.id, { name: "Second" });
    const out = await carryOver(carryOf(f), f.owner.id, second.id, { agentIds: [f.agent.id] });
    const copyId = out.agents[0]?.id;
    if (!copyId) throw new Error("not brought");
    const copy = await agentOf(f, copyId);
    expect(copy.twinId).not.toBeNull();
    expect(copy.twinId).toBe((await agentOf(f, f.agent.id)).twinId);
    await syncAll(f, f.agent.id);

    // Trained in the second workspace: instructions, a memory, a skill, a tool.
    await f.db
      .update(agents)
      .set({ instructions: `${copy.instructions}\n- Every copy goes in a card.`, updatedAt: new Date() })
      .where(eq(agents.id, copy.id));
    await insertContextItem(f.db, {
      orgId: second.id,
      kind: "lesson",
      scopeType: "agent",
      scopeId: copy.id,
      agentId: copy.id,
      content: "Clients approve copy before design starts.",
      createdByKind: "person",
      createdById: f.owner.id,
    });
    // Read from a conversation of that workspace: it stays there.
    await insertContextItem(f.db, {
      orgId: second.id,
      kind: "note",
      scopeType: "agent",
      scopeId: copy.id,
      agentId: copy.id,
      content: "The launch date discussed in #board.",
      channelIds: [crypto.randomUUID()],
    });
    const skill = await saveSkill(skillDeps(f), f.owner.id, second.id, {
      name: "copy-cards",
      description: "How copy is shown",
      body: "One card per piece.",
      metadata: {},
      source: "manual",
      files: [{ path: "example.md", data: new TextEncoder().encode("# Card") }],
    });
    await setAgentSkills(f.db, f.owner.id, second.id, copy.id, [{ skillId: skill.id, enabled: true }]);
    await grantScopes(f.db, second.id, copy.id, [{ connectionId: null, scope: "wiki:read" }]);

    const result = await syncAll(f, copy.id);
    expect(result?.synced).toBe(true);
    const original = await agentOf(f, f.agent.id);
    expect(original.instructions.endsWith("- Every copy goes in a card.")).toBe(true);
    expect(await memoriesOf(f, f.agent.id)).toEqual([["Clients approve copy before design starts.", "active"]]);
    expect((await enabledSkills(f.db, f.org.id, f.agent.id)).map((s) => s.name)).toEqual(["copy-cards"]);
    const scopes = await listAgentScopes(f.db, f.org.id, f.agent.id);
    expect(scopes.some((s) => s.connectionId === null && s.scope === "wiki:read")).toBe(true);

    // Nothing changed: nothing to do.
    expect((await syncAll(f, copy.id))?.synced).toBe(false);

    // Forgotten in the first workspace: forgotten in the second.
    await f.db
      .update(contextItems)
      .set({ status: "archived", updatedAt: new Date(Date.now() + 1000) })
      .where(eq(contextItems.agentId, f.agent.id));
    await syncAll(f, f.agent.id);
    expect(await memoriesOf(f, copy.id)).toEqual([
      ["Clients approve copy before design starts.", "archived"],
      ["The launch date discussed in #board.", "active"],
    ]);

    // The skill improved in the first workspace: the second's takes the new text.
    const [mine] = await f.db
      .select()
      .from(skills)
      .where(and(eq(skills.orgId, f.org.id), eq(skills.slug, "copy-cards")));
    if (!mine) throw new Error("no skill");
    await saveSkill(skillDeps(f), f.owner.id, f.org.id, {
      name: "copy-cards",
      description: "How copy is shown",
      body: "One card per piece, with its funnel stage.",
      metadata: {},
      source: "manual",
    });
    await syncAll(f, f.agent.id);
    const [theirs] = await f.db
      .select()
      .from(skills)
      .where(and(eq(skills.orgId, second.id), eq(skills.slug, "copy-cards")));
    expect(theirs?.body).toBe("One card per piece, with its funnel stage.");
  });

  test("a connection one copy uses comes to the other copy's workspace", async () => {
    f = await setup();
    const { organization: second } = await createOrganization(f.db, f.owner.id, { name: "Second" });
    const out = await carryOver(carryOf(f), f.owner.id, second.id, { agentIds: [f.agent.id] });
    const copyId = out.agents[0]?.id as string;
    await syncAll(f, f.agent.id);
    const github = await createApiKeyConnection(connectorsOf(f), f.owner.id, f.org.id, {
      connector: "github",
      apiKey: "ghp_secret_123456",
    });
    await grantScopes(f.db, f.org.id, f.agent.id, [{ connectionId: github.id, scope: "github:pr.read" }]);
    await syncAll(f, f.agent.id);
    const theirs = await listAgentScopes(f.db, second.id, copyId);
    const brought = theirs.find((s) => s.scope === "github:pr.read");
    expect(brought?.connectionId).toBeTruthy();
    expect(brought?.connectionId).not.toBe(github.id);
  });

  test("the owner's agents of the same handle in their workspaces are joined on their own; taken out, they stay apart", async () => {
    f = await setup();
    const { organization: second } = await createOrganization(f.db, f.owner.id, { name: "Second" });
    await f.db.update(agents).set({ ownerUserId: f.owner.id }).where(eq(agents.id, f.agent.id));
    await f.db
      .update(agents)
      .set({ instructions: "- Answer in Portuguese.", updatedAt: new Date(Date.now() - 60_000) })
      .where(eq(agents.id, f.agent.id));
    const other = await sameAgentIn(
      f,
      second.id,
      "- Answer in Portuguese.\n- Deliver in the conversation of the request.",
    );
    await insertContextItem(f.db, {
      orgId: f.org.id,
      kind: "fact",
      scopeType: "agent",
      scopeId: f.agent.id,
      agentId: f.agent.id,
      content: "The client's brand color is lime.",
    });
    await insertContextItem(f.db, {
      orgId: second.id,
      kind: "fact",
      scopeType: "agent",
      scopeId: other.id,
      agentId: other.id,
      content: "The client's brand color is lime.",
    });

    expect(await autoLinkTwins(f.db)).toBe(1);
    expect(await autoLinkTwins(f.db)).toBe(0);
    await syncAll(f, f.agent.id);
    expect((await agentOf(f, f.agent.id)).instructions).toBe(
      "- Answer in Portuguese.\n- Deliver in the conversation of the request.",
    );
    // Known in both before: tied, not copied twice.
    expect(await memoriesOf(f, f.agent.id)).toEqual([["The client's brand color is lime.", "active"]]);
    expect(await memoriesOf(f, other.id)).toEqual([["The client's brand color is lime.", "active"]]);

    const view = await agentTwinView(f.db, f.owner.id, f.org.id, f.agent.id);
    expect(view.copies.map((c) => [c.orgName, c.handle])).toEqual([["Second", f.agent.handle]]);

    await leaveTwin(f.db, f.owner.id, second.id, other.id);
    expect((await agentOf(f, other.id)).twinId).toBeNull();
    expect((await agentOf(f, f.agent.id)).twinId).toBeNull();
    expect(await autoLinkTwins(f.db)).toBe(0);
    const apart = await agentTwinView(f.db, f.owner.id, second.id, other.id);
    expect(apart.off).toBe(true);
    expect(apart.candidates.map((c) => c.agentId)).toEqual([f.agent.id]);

    // Joined again by hand.
    const joined = await joinTwin(twinDeps(f), f.owner.id, second.id, other.id, f.agent.id);
    expect(joined.copies.map((c) => c.agentId)).toEqual([f.agent.id]);
  });
});
