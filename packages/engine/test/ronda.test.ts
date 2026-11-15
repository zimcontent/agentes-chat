import { afterEach, expect, test } from "bun:test";
import { eq, schema } from "@agenteschat/db";
import type { ModelRequest } from "@agenteschat/providers";
import { drainOutbox, getRonda, RONDA_CRON, RONDA_PROMPT, rondaChanges, setRonda } from "../src";
import { addMember, type Fixture, setup } from "./fixtures";
import { fire, minutesFromNow, routineRow } from "./routine-fixtures";

let f: Fixture;
afterEach(async () => {
  await f?.close();
  f = undefined as unknown as Fixture;
});

const deps = () => ({ db: f.db, pubsub: f.pubsub });
const said = async (body: string, at = new Date(Date.now() - 60_000)) => {
  await f.db.insert(schema.messages).values({
    orgId: f.org.id,
    channelId: f.general.id,
    authorType: "person",
    authorUserId: f.owner.id,
    body,
    createdAt: at,
  });
};
const judged = () =>
  (f.context.judge as unknown as { calls: { kind: string }[] }).calls.filter((c) => c.kind === "ronda_worth");
const runs = () => f.db.select().from(schema.agentRuns);

test("turning the ronda on makes one routine of the agent's, marked, in the person's DM; off keeps it inactive", async () => {
  f = await setup();
  const on = await setRonda(deps(), f.owner.id, f.org.id, f.agent.id, "three_daily", "America/Sao_Paulo");
  expect(on.schedule).toBe("three_daily");
  expect(on.personId).toBe(f.owner.id);
  expect(on.nextRunAt).not.toBeNull();
  const row = await routineRow(f, on.routineId ?? "");
  expect(row).toMatchObject({
    agentId: f.agent.id,
    name: "Ronda",
    prompt: RONDA_PROMPT,
    target: { type: "dm", ronda: true },
    cron: RONDA_CRON.three_daily,
    report: "when_new",
    active: true,
  });

  // Changing when it passes keeps the same routine.
  const hourly = await setRonda(deps(), f.owner.id, f.org.id, f.agent.id, "hourly", "America/Sao_Paulo");
  expect(hourly.routineId).toBe(on.routineId);
  expect((await routineRow(f, on.routineId ?? "")).cron).toBe(RONDA_CRON.hourly);

  const off = await setRonda(deps(), f.owner.id, f.org.id, f.agent.id, "off", "America/Sao_Paulo");
  expect(off).toMatchObject({ schedule: "off", routineId: on.routineId, nextRunAt: null });
  expect((await routineRow(f, on.routineId ?? "")).active).toBe(false);
  expect((await getRonda(f.db, f.owner.id, f.org.id, f.agent.id)).schedule).toBe("off");
});

test("only who manages agents, or the agent's owner, turns it on", async () => {
  f = await setup();
  const someone = await addMember(f.db, f.org.id, "member", "bia");
  await expect(setRonda(deps(), someone.id, f.org.id, f.agent.id, "daily", "UTC")).rejects.toThrow();
  await f.db.update(schema.agents).set({ ownerUserId: someone.id }).where(eq(schema.agents.id, f.agent.id));
  expect((await setRonda(deps(), someone.id, f.org.id, f.agent.id, "daily", "UTC")).schedule).toBe("daily");
});

test("nothing changed: the slot passes with no judge and no model", async () => {
  f = await setup();
  const { routineId } = await setRonda(deps(), f.owner.id, f.org.id, f.agent.id, "daily", "UTC");
  const slot = await fire(f, routineId ?? "", minutesFromNow(-1), "schedule");
  expect(slot).toMatchObject({ status: "skipped", code: "ronda_nothing" });
  expect(judged()).toEqual([]);
  expect(await runs()).toEqual([]);
});

test("something changed but the judge finds nothing worth it: the slot passes quietly, and that window is spent", async () => {
  f = await setup(); // the fake judge says 0
  const { routineId } = await setRonda(deps(), f.owner.id, f.org.id, f.agent.id, "daily", "UTC");
  await said("bom dia, pessoal!");
  const slot = await fire(f, routineId ?? "", minutesFromNow(-1), "schedule");
  expect(slot).toMatchObject({ status: "skipped", code: "ronda_quiet" });
  expect(judged()).toHaveLength(1);
  expect(await runs()).toEqual([]);
  // The next ronda looks only after this one: the same greeting is not news again.
  const next = await fire(f, routineId ?? "", minutesFromNow(0), "schedule");
  expect(next).toMatchObject({ status: "skipped", code: "ronda_nothing" });
  expect(judged()).toHaveLength(1);
});

test("worth a run: the agent works in the background on what changed, read as data", async () => {
  const requests: ModelRequest[] = [];
  f = await setup({
    judge: (kind) => (kind === "ronda_worth" ? 0.9 : undefined),
    reply: (req) => {
      requests.push(req);
      return { chunks: ["Conferi: nada a fazer."] };
    },
  });
  const { routineId } = await setRonda(deps(), f.owner.id, f.org.id, f.agent.id, "daily", "UTC");
  await said("o checkout do site caiu de novo, alguém olha?");
  const slot = await fire(f, routineId ?? "", minutesFromNow(-1), "schedule");
  expect(slot.status).not.toBe("skipped");
  expect(slot.event).toMatchObject({ type: "ronda.changes", summary: "1 new messages in 1 conversations" });
  const [run] = await runs();
  expect(run).toMatchObject({ background: true });
  await drainOutbox(f.db, f.handlers);
  const seen = JSON.stringify(requests.at(-1)?.messages ?? []) + JSON.stringify(requests.at(-1)?.system ?? "");
  expect(seen).toContain("What changed since your last ronda");
  expect(seen).toContain("o checkout do site caiu de novo");
});

test("a person's Run now runs even with nothing new, without asking the judge", async () => {
  f = await setup();
  const { routineId } = await setRonda(deps(), f.owner.id, f.org.id, f.agent.id, "daily", "UTC");
  const slot = await fire(f, routineId ?? "", new Date(), "manual");
  expect(slot.status).not.toBe("skipped");
  expect(judged()).toEqual([]);
  expect(await runs()).toHaveLength(1);
});

test("what changed is what the person sees: a private channel they don't read stays out", async () => {
  f = await setup();
  const someone = await addMember(f.db, f.org.id, "member", "bia");
  const [secret] = await f.db
    .insert(schema.channels)
    .values({ orgId: f.org.id, name: "diretoria", visibility: "private", kind: "channel" })
    .returning();
  if (!secret) throw new Error("no channel");
  await f.db.insert(schema.channelMembers).values([
    { orgId: f.org.id, channelId: secret.id, agentId: f.agent.id },
    { orgId: f.org.id, channelId: secret.id, userId: f.owner.id },
  ]);
  await f.db.insert(schema.messages).values({
    orgId: f.org.id,
    channelId: secret.id,
    authorType: "person",
    authorUserId: f.owner.id,
    body: "salários de novembro",
    createdAt: new Date(Date.now() - 60_000),
  });
  const since = new Date(Date.now() - 3_600_000);
  const forOwner = await rondaChanges(f.db, { orgId: f.org.id, agentId: f.agent.id, personId: f.owner.id, since });
  const forBia = await rondaChanges(f.db, { orgId: f.org.id, agentId: f.agent.id, personId: someone.id, since });
  expect(forOwner.text).toContain("salários de novembro");
  expect(forBia.text).not.toContain("salários");
  expect(forBia.count).toBe(0);
});
