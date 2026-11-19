import { afterEach, describe, expect, test } from "bun:test";
import { and, eq, schema } from "@dougbot/db";
import { createAgent, makeRightHand, RIGHT_HAND, RIGHT_HAND_DEFAULTS, rightHandId } from "../src";
import { addMember, type Fixture, setup } from "./fixtures";

/** DougBot (ADR 0137 addendum 2026-11-13): the team's own chief becomes the right hand; the built-in one goes. */

let f: Fixture;
afterEach(async () => {
  const current = f;
  f = undefined as unknown as Fixture;
  await current?.close();
});

const row = async (id: string) => (await f.db.select().from(schema.agents).where(eq(schema.agents.id, id)))[0];

describe("makeRightHand", () => {
  test("the chief keeps its instructions, memory and skills; the built-in one is a tombstone; one right hand", async () => {
    f = await setup({ rightHand: true });
    const orgId = f.org.id;
    const before = (await rightHandId(f.db, orgId)) as string;
    expect((await row(before))?.name).toBe(RIGHT_HAND_DEFAULTS.name);
    const boss = await createAgent(
      f.db,
      f.owner.id,
      orgId,
      { name: "Doug BOSS", handle: "boss", role: "Chefe de operações", instructions: "Cobre prazos toda sexta." },
      { model: "auto" },
    );
    await f.db.insert(schema.contextItems).values({
      orgId,
      kind: "note",
      scopeType: "agent",
      scopeId: boss.id,
      agentId: boss.id,
      content: "Ana prefere áudio.",
    });
    // Someone answered to the old right hand.
    await f.db.update(schema.agents).set({ reportsToAgentId: before }).where(eq(schema.agents.id, f.agent.id));

    const old = await makeRightHand({ db: f.db, pubsub: f.pubsub }, f.owner.id, orgId, boss.id);
    expect(old).toBe(before);
    expect(await rightHandId(f.db, orgId)).toBe(boss.id);
    const chief = await row(boss.id);
    expect(chief?.builtin).toBe(RIGHT_HAND);
    expect(chief?.instructions).toBe("Cobre prazos toda sexta.");
    expect(chief?.handle).toBe("boss");
    const memory = await f.db
      .select()
      .from(schema.contextItems)
      .where(and(eq(schema.contextItems.orgId, orgId), eq(schema.contextItems.agentId, boss.id)));
    expect(memory.map((m) => m.content)).toEqual(["Ana prefere áudio."]);
    // The built-in one: a tombstone (ADR 0082), no longer built in; who reported to it reports to the chief.
    const gone = await row(before);
    expect(gone?.builtin).toBeNull();
    expect(gone?.deletedAt).not.toBeNull();
    expect((await row(f.agent.id))?.reportsToAgentId).toBe(boss.id);
    const marks = await f.db
      .select({ id: schema.agents.id })
      .from(schema.agents)
      .where(and(eq(schema.agents.orgId, orgId), eq(schema.agents.builtin, RIGHT_HAND)));
    expect(marks).toHaveLength(1);
    // Again: nothing to do.
    expect(await makeRightHand({ db: f.db, pubsub: f.pubsub }, f.owner.id, orgId, boss.id)).toBeNull();
  });

  test("only who configures the workspace", async () => {
    f = await setup({ rightHand: true });
    const boss = await createAgent(
      f.db,
      f.owner.id,
      f.org.id,
      { name: "Doug BOSS", handle: "boss", role: "Chefe", instructions: "x" },
      { model: "auto" },
    );
    const bob = await addMember(f.db, f.org.id, "member", "bob");
    await expect(makeRightHand({ db: f.db, pubsub: f.pubsub }, bob.id, f.org.id, boss.id)).rejects.toThrow();
  });
});
