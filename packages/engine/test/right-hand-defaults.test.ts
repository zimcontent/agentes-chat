import { afterEach, describe, expect, test } from "bun:test";
import { and, eq, schema } from "@dougbot/db";
import {
  ensureRightHandRondas,
  ensureRightHandSkills,
  FIRST_TASK_JOB,
  getRonda,
  lodiSwitches,
  RIGHT_HAND,
  RIGHT_HAND_HOUSE_SKILLS,
  RIGHT_HAND_RESOLVE,
  rightHandPrompt,
  rightHandRondaBrief,
  saveOnboarding,
} from "../src";
import { dougSkills } from "../src/doug-team";
import { type Fixture, setup } from "./fixtures";

/*
 * What the right hand knows and does in every workspace by default (docs/adr/doug-0041-doug-defaults.md): its
 * "# How you resolve", its house skills, its ronda and its lanes, none of them hanging on the workspace's own
 * instructions or knowledge.
 */

let f: Fixture;
afterEach(async () => {
  const current = f;
  f = undefined as unknown as Fixture;
  await current?.close();
});

const lodiOf = async (fx: Fixture) => {
  const [lodi] = await fx.db
    .select()
    .from(schema.agents)
    .where(and(eq(schema.agents.orgId, fx.org.id), eq(schema.agents.builtin, RIGHT_HAND)));
  if (!lodi) throw new Error("no right hand");
  return lodi;
};

/** The right hand's skills that are on, by slug. */
const skillsOf = async (fx: Fixture, agentId: string) =>
  (
    await fx.db
      .select({ slug: schema.skills.slug, body: schema.skills.body })
      .from(schema.agentSkills)
      .innerJoin(schema.skills, eq(schema.skills.id, schema.agentSkills.skillId))
      .where(and(eq(schema.agentSkills.agentId, agentId), eq(schema.agentSkills.enabled, true)))
  ).sort((a, b) => (a.slug < b.slug ? -1 : 1));

/** The workspace as one made through the app is while its owner is still in the onboarding. */
const onboarding = (fx: Fixture) =>
  fx.db.update(schema.organizations).set({ onboardedAt: null }).where(eq(schema.organizations.id, fx.org.id));

describe("a new workspace's right hand", () => {
  test("ends its onboarding with its house skills, its lanes on, its ronda and the ask for a first task", async () => {
    f = await setup({ rightHand: true });
    const lodi = await lodiOf(f);
    // A workspace with no context and no instructions of its own: the defaults don't hang on either.
    await f.db.update(schema.organizations).set({ context: "" }).where(eq(schema.organizations.id, f.org.id));
    await onboarding(f);
    expect(await skillsOf(f, lodi.id)).toEqual([]);

    await saveOnboarding(f.db, f.owner.id, f.org.id, { finished: true });
    const house = dougSkills().get("resolver");
    expect(await skillsOf(f, lodi.id)).toEqual([{ slug: "resolver", body: house?.body ?? "" }]);
    expect(RIGHT_HAND_HOUSE_SKILLS.every((s) => dougSkills().has(s))).toBe(true);
    // Every lane of its own is on in a workspace that never saved a setting.
    expect(await lodiSwitches(f.db, f.org.id)).toEqual({ teamWatch: true, welcomePeople: true });
    // Its ronda, hourly, for the owner who just used it.
    await f.db
      .update(schema.organizationMembers)
      .set({ lastSeenAt: new Date() })
      .where(eq(schema.organizationMembers.orgId, f.org.id));
    expect(await ensureRightHandRondas(f.db)).toBe(1);
    expect((await getRonda(f.db, f.owner.id, f.org.id, lodi.id)).schedule).toBe("hourly");
    // The ask waits in the outbox, once.
    const jobs = await f.db.select().from(schema.outbox).where(eq(schema.outbox.kind, FIRST_TASK_JOB));
    expect(jobs.map((j) => j.dedupeKey)).toEqual([`${FIRST_TASK_JOB}:${f.org.id}:${f.owner.id}`]);
    // Ending it again changes nothing.
    await saveOnboarding(f.db, f.owner.id, f.org.id, { finished: true });
    expect(await f.db.select().from(schema.outbox).where(eq(schema.outbox.kind, FIRST_TASK_JOB))).toHaveLength(1);
    expect(await skillsOf(f, lodi.id)).toHaveLength(1);
  });

  test("its prompt resolves the same way in any workspace, and its ronda follows its own work", async () => {
    f = await setup({ rightHand: true });
    const lodi = await lodiOf(f);
    await f.db.update(schema.organizations).set({ context: "" }).where(eq(schema.organizations.id, f.org.id));
    for (const inDm of [true, false]) {
      const prompt = await rightHandPrompt({ db: f.db }, { orgId: f.org.id, agent: lodi, personId: f.owner.id, inDm });
      expect(prompt).toContain(RIGHT_HAND_RESOLVE);
    }
    expect(RIGHT_HAND_RESOLVE).toContain("at least two different ways");
    expect(RIGHT_HAND_RESOLVE).toContain("Deliver with proof");
    expect(RIGHT_HAND_RESOLVE).toContain("follow_up");
    for (const opening of [true, false])
      expect(rightHandRondaBrief({ who: "Ana", opening })).toContain("2. Your own work.");
  });
});

describe("the house skills of the right hands made before", () => {
  test("are given once; one the workspace deleted is never given again", async () => {
    f = await setup({ rightHand: true });
    const lodi = await lodiOf(f);
    expect(await skillsOf(f, lodi.id)).toEqual([]);
    expect(await ensureRightHandSkills(f.db)).toBe(1);
    expect((await skillsOf(f, lodi.id)).map((s) => s.slug)).toEqual(["resolver"]);
    expect(await ensureRightHandSkills(f.db)).toBe(0);

    // Deleted by the workspace: its row stays, and the sweep leaves it gone.
    await f.db
      .update(schema.skills)
      .set({ deletedAt: new Date() })
      .where(and(eq(schema.skills.orgId, f.org.id), eq(schema.skills.slug, "resolver")));
    expect(await ensureRightHandSkills(f.db)).toBe(0);
    const rows = await f.db.select().from(schema.skills).where(eq(schema.skills.orgId, f.org.id));
    expect(rows.map((r) => [r.slug, r.deletedAt !== null])).toEqual([["resolver", true]]);
  });

  test("a team skill of the same name the workspace wrote itself is kept as it is, and not given", async () => {
    f = await setup({ rightHand: true });
    const lodi = await lodiOf(f);
    await f.db.insert(schema.skills).values({
      orgId: f.org.id,
      slug: "resolver",
      name: "resolver",
      description: "Our own.",
      body: "Ours.",
      source: "manual",
      createdByUserId: f.owner.id,
    });
    expect(await ensureRightHandSkills(f.db)).toBe(0);
    expect(await skillsOf(f, lodi.id)).toEqual([]);
    const [own] = await f.db.select().from(schema.skills).where(eq(schema.skills.orgId, f.org.id));
    expect(own?.body).toBe("Ours.");
  });
});
