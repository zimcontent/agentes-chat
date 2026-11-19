import { afterEach, expect, test } from "bun:test";
import { eq, schema } from "@dougbot/db";
import type { ModelRequest } from "@dougbot/providers";
import {
  drainOutbox,
  ensureRightHand,
  ensureRightHandRondas,
  getRonda,
  RIGHT_HAND,
  RONDA_CRON,
  RONDA_PROMPT,
  rondaChanges,
  setRonda,
} from "../src";
import { addMember, type Fixture, setup } from "./fixtures";
import { giveMail, imapAccount, mailSetup } from "./mail-fixtures";
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

test("the ronda's own model: its run thinks with it on the workspace's key, the agent's other runs keep theirs", async () => {
  const requests: ModelRequest[] = [];
  f = await setup({
    reply: (req) => {
      requests.push(req);
      return { chunks: ["Conferi."] };
    },
  });
  await expect(setRonda(deps(), f.owner.id, f.org.id, f.agent.id, "daily", "UTC", "no-such-model")).rejects.toThrow();
  const on = await setRonda(deps(), f.owner.id, f.org.id, f.agent.id, "daily", "UTC", "claude-haiku-5-5");
  expect(on.model).toBe("claude-haiku-5-5");
  // Changing when it passes keeps the model; null goes back to the agent's own AI.
  expect((await setRonda(deps(), f.owner.id, f.org.id, f.agent.id, "hourly", "UTC")).model).toBe("claude-haiku-5-5");
  await fire(f, on.routineId ?? "", new Date(), "manual");
  await drainOutbox(f.db, f.handlers);
  expect(requests.map((r) => r.model)).toContain("claude-haiku-5-5");
  expect(requests.map((r) => r.model)).not.toContain("claude-sonnet-5-5");
  expect((await setRonda(deps(), f.owner.id, f.org.id, f.agent.id, "hourly", "UTC", null)).model).toBeNull();
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

// ── The right hand's ronda (ADR 9005) ───────────────────────────────────────

async function rightHandOf(fx: Fixture) {
  await ensureRightHand(fx.db, fx.org.id);
  const [lodi] = await fx.db.select().from(schema.agents).where(eq(schema.agents.builtin, RIGHT_HAND));
  if (!lodi) throw new Error("no right hand");
  return lodi;
}

test("the right hand: each person who talks to it turns on their own ronda, in their own DM", async () => {
  f = await setup();
  const lodi = await rightHandOf(f);
  const bia = await addMember(f.db, f.org.id, "member", "bia");
  const mine = await setRonda(deps(), f.owner.id, f.org.id, lodi.id, "daily", "America/Sao_Paulo");
  const hers = await setRonda(deps(), bia.id, f.org.id, lodi.id, "hourly", "America/Sao_Paulo");
  expect(hers.routineId).not.toBe(mine.routineId);
  expect(hers.personId).toBe(bia.id);
  expect((await getRonda(f.db, f.owner.id, f.org.id, lodi.id)).schedule).toBe("daily");
  expect((await getRonda(f.db, bia.id, f.org.id, lodi.id)).schedule).toBe("hourly");
  // Switching hers off leaves his.
  await setRonda(deps(), bia.id, f.org.id, lodi.id, "off", "America/Sao_Paulo");
  expect((await routineRow(f, mine.routineId ?? "")).active).toBe(true);
});

test("the right hand's ronda is on for everyone who used the workspace lately; one switched off stays off", async () => {
  f = await setup();
  const lodi = await rightHandOf(f);
  const bia = await addMember(f.db, f.org.id, "member", "bia");
  const away = await addMember(f.db, f.org.id, "member", "carlos");
  const members = schema.organizationMembers;
  await f.db.update(members).set({ lastSeenAt: new Date() }).where(eq(members.orgId, f.org.id));
  await f.db
    .update(members)
    .set({ lastSeenAt: new Date(Date.now() - 40 * 24 * 3_600_000) })
    .where(eq(members.userId, away.id));
  await f.db.update(members).set({ timezone: "America/Sao_Paulo" }).where(eq(members.userId, bia.id));
  // The owner had one and switched it off: that is their choice, never undone.
  await setRonda(deps(), f.owner.id, f.org.id, lodi.id, "daily", "UTC");
  await setRonda(deps(), f.owner.id, f.org.id, lodi.id, "off", "UTC");

  expect(await ensureRightHandRondas(f.db)).toBe(1);
  const hers = await getRonda(f.db, bia.id, f.org.id, lodi.id);
  expect(hers.schedule).toBe("hourly");
  expect(hers.personId).toBe(bia.id);
  const row = await routineRow(f, hers.routineId ?? "");
  expect(row.timezone).toBe("America/Sao_Paulo");
  expect(row.target).toEqual({ type: "dm", ronda: true });
  expect((await getRonda(f.db, f.owner.id, f.org.id, lodi.id)).schedule).toBe("off");
  expect((await getRonda(f.db, away.id, f.org.id, lodi.id)).routineId).toBeNull();
  // Any other agent never gets one on its own; and a second sweep makes nothing.
  expect((await getRonda(f.db, f.owner.id, f.org.id, f.agent.id)).routineId).toBeNull();
  expect(await ensureRightHandRondas(f.db)).toBe(0);
  // Switched off, then swept again: still off.
  await setRonda(deps(), bia.id, f.org.id, lodi.id, "off", "UTC");
  expect(await ensureRightHandRondas(f.db)).toBe(0);
  expect((await getRonda(f.db, bia.id, f.org.id, lodi.id)).schedule).toBe("off");
});

test("the right hand's first ronda of the day opens it: it runs with nothing new, on its own AI, told to resolve and bring an idea", async () => {
  const requests: ModelRequest[] = [];
  f = await setup({
    reply: (req) => {
      requests.push(req);
      return { chunks: ["Bom dia."] };
    },
  });
  const lodi = await rightHandOf(f);
  const { routineId } = await setRonda(deps(), f.owner.id, f.org.id, lodi.id, "hourly", "UTC", "claude-haiku-5-5");
  const opening = await fire(f, routineId ?? "", minutesFromNow(-2), "schedule");
  expect(opening.status).not.toBe("skipped");
  expect(opening.event).toMatchObject({ type: "ronda.changes", opening: true });
  expect(judged()).toEqual([]);
  await drainOutbox(f.db, f.handlers);
  const last = requests.at(-1);
  const seen = JSON.stringify(last?.messages ?? []) + JSON.stringify(last?.system ?? "");
  expect(seen).toContain("This is the day's opening ronda");
  expect(seen).toContain("Your second brain first");
  expect(last?.model).not.toBe("claude-haiku-5-5");
  // Later the same day, nothing new: the slot passes as any ronda's.
  const later = await fire(f, routineId ?? "", minutesFromNow(-1), "schedule");
  expect(later).toMatchObject({ status: "skipped", code: "ronda_nothing" });
});

test("an agent that isn't the right hand has no opening: nothing new still passes", async () => {
  f = await setup();
  const { routineId } = await setRonda(deps(), f.owner.id, f.org.id, f.agent.id, "hourly", "UTC");
  const slot = await fire(f, routineId ?? "", minutesFromNow(-1), "schedule");
  expect(slot).toMatchObject({ status: "skipped", code: "ronda_nothing" });
});

test("new mail in the person's own mailboxes the agent reads is news; another person's mailbox never is", async () => {
  const m = await mailSetup();
  f = m.f;
  const account = await imapAccount(m);
  const since = new Date(Date.now() - 3_600_000);
  m.box.add({ id: "m1", subject: "Contrato para assinar até sexta", date: new Date().toISOString(), unread: true });
  m.box.add({ id: "m0", subject: "Antigo", date: new Date(Date.now() - 86_400_000).toISOString() });
  const read = (personId: string) =>
    rondaChanges(f.db, {
      orgId: f.org.id,
      agentId: f.agent.id,
      personId,
      since,
      mail: { keyWrappers: m.deps.keyWrappers, mail: m.mail, publicUrl: "" },
    });
  // The agent can't read it yet: nothing.
  expect((await read(f.owner.id)).count).toBe(0);
  await giveMail(m, account.id, "read");
  const mine = await read(f.owner.id);
  expect(mine.headline).toContain("1 new emails");
  expect(mine.text).toContain("Contrato para assinar até sexta");
  expect(mine.text).not.toContain("Antigo");
  const bia = await addMember(f.db, f.org.id, "member", "bia");
  expect((await read(bia.id)).text).not.toContain("Contrato");
});
