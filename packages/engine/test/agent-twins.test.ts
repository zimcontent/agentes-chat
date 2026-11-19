import { afterEach, describe, expect, test } from "bun:test";
import { and, eq, schema } from "@dougbot/db";
import {
  agentTwinView,
  autoLinkTwins,
  type CarryDeps,
  type ConnectorDeps,
  carryOver,
  createApiKeyConnection,
  createOrganization,
  editContextItem,
  enabledSkills,
  getSeparateOperation,
  grantScopes,
  insertContextItem,
  joinInstructions,
  joinTwin,
  leaveTwin,
  listAgentScopes,
  mergeInstructions,
  saveSkill,
  setAgentSkills,
  setSeparateOperation,
  syncTwins,
} from "../src";
import { addMember, type Fixture, setup } from "./fixtures";

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

  test("a connection one copy uses never goes to the other workspace on its own: the scope maps to that workspace's own", async () => {
    f = await setup();
    const { organization: second } = await createOrganization(f.db, f.owner.id, { name: "Second" });
    const out = await carryOver(carryOf(f), f.owner.id, second.id, { agentIds: [f.agent.id] });
    const copyId = out.agents[0]?.id as string;
    await syncAll(f, f.agent.id);
    const github = await createApiKeyConnection(connectorsOf(f), f.owner.id, f.org.id, {
      connector: "github",
      apiKey: "ghp_secret_123456",
    });
    const liveIn = (orgId: string) =>
      f.db
        .select()
        .from(schema.connectorConnections)
        .where(eq(schema.connectorConnections.orgId, orgId))
        .then((rows) => rows.filter((r) => r.revokedAt === null));
    await grantScopes(f.db, f.org.id, f.agent.id, [{ connectionId: github.id, scope: "github:pr.read" }]);
    await syncAll(f, f.agent.id);
    // The first workspace's GitHub stays there: the copy lacks it, and its page says so.
    expect(await liveIn(second.id)).toEqual([]);
    expect((await listAgentScopes(f.db, second.id, copyId)).some((s) => s.scope === "github:pr.read")).toBe(false);
    const view = await agentTwinView(f.db, f.owner.id, second.id, copyId);
    expect(view.missing.map((m) => m.kind)).toEqual(["connection"]);

    // The second workspace has its own GitHub: a scope given in one copy names it in the other.
    const theirs = await createApiKeyConnection(connectorsOf(f), f.owner.id, second.id, {
      connector: "github",
      apiKey: "ghp_other_654321",
    });
    await grantScopes(f.db, f.org.id, f.agent.id, [{ connectionId: github.id, scope: "github:issues.read" }]);
    await syncAll(f, f.agent.id);
    const given = (await listAgentScopes(f.db, second.id, copyId)).find((s) => s.scope === "github:issues.read");
    expect(given?.connectionId).toBe(theirs.id);
    expect((await liveIn(second.id)).length).toBe(1);
  });

  test("the craft goes to every copy, the business stays in its workspace (addendum 2026-11-19)", async () => {
    f = await setup();
    const { organization: second } = await createOrganization(f.db, f.owner.id, { name: "Second" });
    const out = await carryOver(carryOf(f), f.owner.id, second.id, { agentIds: [f.agent.id] });
    const copyId = out.agents[0]?.id as string;
    await syncAll(f, f.agent.id);
    const learn = (kind: "fact" | "lesson" | "decision" | "preference", content: string, more = {}) =>
      insertContextItem(f.db, {
        orgId: f.org.id,
        kind,
        scopeType: "agent",
        scopeId: f.agent.id,
        agentId: f.agent.id,
        content,
        sourceIds: [crypto.randomUUID()],
        createdByKind: "person",
        createdById: f.owner.id,
        ...more,
      });
    await learn("lesson", "Cut on a silence, never mid-word.");
    await learn("preference", "Gabriel wants drafts before noon.");
    const client = await learn("fact", "Lexeer's launch is on the 3rd.");
    await learn("decision", "We dropped the green palette.");
    await learn("fact", "Rough cuts go in the shared review folder.", { reach: "all" });
    await learn("lesson", "This client signs off on Fridays only.", { reach: "here" });
    await syncAll(f, f.agent.id);
    expect(await memoriesOf(f, copyId)).toEqual([
      ["Cut on a silence, never mid-word.", "active"],
      ["Gabriel wants drafts before noon.", "active"],
      ["Rough cuts go in the shared review folder.", "active"],
    ]);

    // A copy made before the rule (as the sync used to): archived, the first workspace keeps its own.
    const [old] = await f.db
      .insert(contextItems)
      .values({
        orgId: second.id,
        kind: "fact",
        scopeType: "agent",
        scopeId: copyId,
        agentId: copyId,
        content: client.content,
        subjectKey: client.subjectKey,
        twinKey: client.id,
      })
      .returning();
    await f.db.update(contextItems).set({ twinKey: client.id }).where(eq(contextItems.id, client.id));
    await f.db.update(agents).set({ updatedAt: new Date() }).where(eq(agents.id, copyId));
    await syncAll(f, f.agent.id);
    const [after] = await f.db
      .select()
      .from(contextItems)
      .where(eq(contextItems.id, old?.id as string));
    expect(after?.status).toBe("archived");
    const [kept] = await f.db.select().from(contextItems).where(eq(contextItems.id, client.id));
    expect(kept?.status).toBe("active");

    // A person keeps a lesson here: its copy in the other workspace is archived; taken to all again, it comes back.
    const [lesson] = await f.db
      .select()
      .from(contextItems)
      .where(and(eq(contextItems.agentId, f.agent.id), eq(contextItems.content, "Cut on a silence, never mid-word.")));
    if (!lesson) throw new Error("no lesson");
    await editContextItem(f.db, f.owner.id, f.org.id, lesson.id, { reach: "here" });
    await syncAll(f, f.agent.id);
    expect(await memoriesOf(f, copyId)).toContainEqual(["Cut on a silence, never mid-word.", "archived"]);
    await editContextItem(f.db, f.owner.id, f.org.id, lesson.id, { reach: "all" });
    await syncAll(f, f.agent.id);
    expect(await memoriesOf(f, copyId)).toContainEqual(["Cut on a silence, never mid-word.", "active"]);
    expect(await memoriesOf(f, f.agent.id)).toContainEqual(["Cut on a silence, never mid-word.", "active"]);

    // Kept here from the other workspace, where it was learned too (tied by saying the same): each workspace keeps
    // its own, and neither travels back.
    await insertContextItem(f.db, {
      orgId: second.id,
      kind: "lesson",
      scopeType: "agent",
      scopeId: copyId,
      agentId: copyId,
      content: "Export captions as SRT.",
      sourceIds: [crypto.randomUUID()],
    });
    await learn("lesson", "Export captions as SRT.");
    await syncAll(f, f.agent.id);
    const [theirs] = await f.db
      .select()
      .from(contextItems)
      .where(and(eq(contextItems.agentId, copyId), eq(contextItems.content, "Export captions as SRT.")));
    if (!theirs) throw new Error("no lesson there");
    await editContextItem(f.db, f.owner.id, second.id, theirs.id, { reach: "here" });
    await syncAll(f, f.agent.id);
    // Something else learned later: the next sync looks at every memory again.
    await learn("lesson", "Name files by date first.");
    await syncAll(f, f.agent.id);
    const srt = async (agentId: string) =>
      (await memoriesOf(f, agentId)).filter(([content]) => content === "Export captions as SRT.");
    expect(await srt(copyId)).toEqual([["Export captions as SRT.", "active"]]);
    expect(await srt(f.agent.id)).toEqual([["Export captions as SRT.", "active"]]);
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
    // Known in both before, one workspace's business in each: neither copied to the other.
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

describe("a separate operation: employees of two companies (ADR doug-0035)", () => {
  const lesson = (fx: Fixture, orgId: string, agentId: string, kind: "lesson" | "fact" | "rule", content: string) =>
    insertContextItem(fx.db, {
      orgId,
      kind,
      scopeType: "agent",
      scopeId: agentId,
      agentId,
      content,
      createdByKind: "person",
      createdById: fx.owner.id,
    });
  const skillIn = async (fx: Fixture, orgId: string, agentId: string, name: string, body: string) => {
    const skill = await saveSkill(skillDeps(fx), fx.owner.id, orgId, {
      name,
      description: `How to do ${name}`,
      body,
      metadata: {},
      source: "manual",
    });
    const current = (await enabledSkills(fx.db, orgId, agentId)).map((k) => ({ skillId: k.id, enabled: true }));
    await setAgentSkills(fx.db, fx.owner.id, orgId, agentId, [...current, { skillId: skill.id, enabled: true }]);
  };
  const activeOf = async (fx: Fixture, agentId: string) =>
    (await memoriesOf(fx, agentId)).filter(([, status]) => status === "active").map(([content]) => content);
  const skillNames = async (fx: Fixture, orgId: string, agentId: string) =>
    (await enabledSkills(fx.db, orgId, agentId)).map((k) => k.name).sort();

  test("only the craft crosses, both ways; what crossed before goes back to its company", async () => {
    f = await setup();
    const zim = f.org.id;
    await f.db
      .update(agents)
      .set({
        instructions: "# Doug\n- Deliver in the conversation of the request.\n- Lexeer: formal tone, short captions.",
      })
      .where(eq(agents.id, f.agent.id));
    const { organization: unbuilt } = await createOrganization(f.db, f.owner.id, { name: "Unbuilt" });
    const out = await carryOver(carryOf(f), f.owner.id, unbuilt.id, { agentIds: [f.agent.id] });
    const copyId = out.agents[0]?.id as string;
    await syncAll(f, f.agent.id);

    // Before the companies are told apart, all the craft crosses, even what names the other company: the leak.
    // A fact stays where it was learned all the same (ADR doug-0013, addendum 2026-11-19).
    await setSeparateOperation(f.db, f.owner.id, zim, { names: ["Lexeer"] });
    await lesson(f, zim, f.agent.id, "fact", "The posting day is Tuesday.");
    await lesson(f, zim, f.agent.id, "lesson", "Always deliver the master in 4K.");
    await lesson(f, zim, f.agent.id, "lesson", "At Lexeer the captions stay under two lines.");
    await skillIn(f, zim, f.agent.id, "masters", "Export the master, then the light copy.");
    await skillIn(f, zim, f.agent.id, "lexeer-captions", "Captions for Lexeer: formal, two lines.");
    await syncAll(f, f.agent.id);
    expect((await activeOf(f, copyId)).sort()).toEqual([
      "Always deliver the master in 4K.",
      "At Lexeer the captions stay under two lines.",
    ]);
    expect(await skillNames(f, unbuilt.id, copyId)).toEqual(["lexeer-captions", "masters"]);

    // Unbuilt becomes a separate operation: what came from Zim's company goes back, the craft stays.
    const admin = await addMember(f.db, unbuilt.id, "admin", "messi");
    await expect(setSeparateOperation(f.db, admin.id, unbuilt.id, { on: true })).rejects.toThrow();
    const view = await setSeparateOperation(f.db, f.owner.id, unbuilt.id, { on: true, names: ["Senna", "Senna"] });
    expect(view).toMatchObject({ on: true, names: ["Senna"], canEdit: true });
    await syncAll(f, copyId);
    expect(await activeOf(f, copyId)).toEqual(["Always deliver the master in 4K."]);
    expect((await agentOf(f, copyId)).instructions).toBe("# Doug\n- Deliver in the conversation of the request.");
    expect(await skillNames(f, unbuilt.id, copyId)).toEqual(["masters"]);
    // Zim keeps all of its own.
    expect((await activeOf(f, f.agent.id)).length).toBe(3);
    expect((await agentOf(f, f.agent.id)).instructions).toContain("- Lexeer: formal tone, short captions.");
    expect(await skillNames(f, zim, f.agent.id)).toEqual(["lexeer-captions", "masters"]);

    // Learned in Unbuilt: the craft reaches Zim, Unbuilt's own stays.
    const copy = await agentOf(f, copyId);
    await f.db
      .update(agents)
      .set({
        instructions: `${copy.instructions}\n- Senna Tower: realism first.\n- Show each take with a caption.`,
        updatedAt: new Date(Date.now() + 1000),
      })
      .where(eq(agents.id, copyId));
    await lesson(f, unbuilt.id, copyId, "lesson", "Quote the cost before generating a video.");
    await lesson(f, unbuilt.id, copyId, "fact", "The film has fourteen scenes.");
    await lesson(f, unbuilt.id, copyId, "rule", "Senna scenes keep the same boy in every shot.");
    await syncAll(f, copyId);
    const zimMemory = await activeOf(f, f.agent.id);
    expect(zimMemory).toContain("Quote the cost before generating a video.");
    expect(zimMemory).not.toContain("The film has fourteen scenes.");
    expect(zimMemory).not.toContain("Senna scenes keep the same boy in every shot.");
    const zimText = (await agentOf(f, f.agent.id)).instructions;
    expect(zimText).toContain("- Show each take with a caption.");
    expect(zimText).toContain("- Lexeer: formal tone, short captions.");
    expect(zimText).not.toContain("Senna");
    const unbuiltText = (await agentOf(f, copyId)).instructions;
    expect(unbuiltText).toContain("- Senna Tower: realism first.");
    expect(unbuiltText).not.toContain("Lexeer");

    // Forgotten in Unbuilt, a crossing lesson is forgotten in Zim too; a company's own fact isn't tied.
    await f.db
      .update(contextItems)
      .set({ status: "archived", updatedAt: new Date(Date.now() + 5000) })
      .where(and(eq(contextItems.agentId, copyId), eq(contextItems.content, "Always deliver the master in 4K.")));
    await syncAll(f, copyId);
    expect(await activeOf(f, f.agent.id)).not.toContain("Always deliver the master in 4K.");

    // A connection given in Zim isn't brought to Unbuilt.
    const github = await createApiKeyConnection(connectorsOf(f), f.owner.id, zim, {
      connector: "github",
      apiKey: "ghp_secret_123456",
    });
    await grantScopes(f.db, zim, f.agent.id, [{ connectionId: github.id, scope: "github:pr.read" }]);
    await grantScopes(f.db, zim, f.agent.id, [{ connectionId: null, scope: "wiki:read" }]);
    await syncAll(f, f.agent.id);
    const theirs = await listAgentScopes(f.db, unbuilt.id, copyId);
    expect(theirs.some((g) => g.scope === "github:pr.read")).toBe(false);
    expect(theirs.some((g) => g.connectionId === null && g.scope === "wiki:read")).toBe(true);

    expect(await getSeparateOperation(f.db, f.owner.id, unbuilt.id)).toMatchObject({ on: true, sharedSignIns: [] });
    await expect(getSeparateOperation(f.db, admin.id, unbuilt.id)).resolves.toMatchObject({ canEdit: false });
  });
});
