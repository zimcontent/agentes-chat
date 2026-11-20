import { afterEach, describe, expect, test } from "bun:test";
import { and, eq, schema } from "@dougbot/db";
import {
  addRunStep,
  afterTurnDone,
  announceLearned,
  cadenceOf,
  createSkillAsAgent,
  getBlockState,
  insertMessage,
  LEARNED_LINE_JOB,
  type LearnedDeps,
  meaningfulChange,
  recordAgentActions,
  runBlockAct,
  type SectorCardDeps,
} from "../src";
import { type Fixture, setup } from "./fixtures";

let f: Fixture;
afterEach(async () => {
  const current = f;
  f = undefined as unknown as Fixture;
  await current?.close();
});

const deps = (): LearnedDeps & SectorCardDeps => ({ ...f.artifactDeps, pubsub: f.pubsub });

/** A finished run of the agent answering the owner's `ask` in general, with its reply unless `silent`. */
async function answeredRun(ask: string, options: { silent?: boolean } = {}) {
  const msg = await insertMessage(f.db, {
    orgId: f.org.id,
    channelId: f.general.id,
    author: { type: "person", userId: f.owner.id },
    body: ask,
  });
  const [run] = await f.db
    .insert(schema.agentRuns)
    .values({
      orgId: f.org.id,
      agentId: f.agent.id,
      channelId: f.general.id,
      threadRootId: msg.id,
      triggerMessageId: msg.id,
      trigger: "mention",
      hop: 1,
      status: "running",
    })
    .returning();
  if (!run) throw new Error("no run");
  const ctx = {
    db: f.db,
    orgId: f.org.id,
    agentId: f.agent.id,
    runId: run.id,
    channelId: f.general.id,
    triggerMessageId: msg.id,
  };
  const finish = async () => {
    const reply = options.silent
      ? null
      : await insertMessage(f.db, {
          orgId: f.org.id,
          channelId: f.general.id,
          author: { type: "agent", agentId: f.agent.id, runId: run.id, hop: 1 },
          body: "Pronto: o relatório está no Drive.",
        });
    await f.db
      .update(schema.agentRuns)
      .set({ status: "done", replyMessageId: reply?.id ?? null, finishedAt: new Date() })
      .where(eq(schema.agentRuns.id, run.id));
    return reply;
  };
  return { run, ctx, finish };
}

const SKILL = {
  name: "meta-ads-report",
  description: "Puxar o relatório semanal do Meta Ads",
  body: "# Relatório do Meta Ads\n1. Abra o Ads Manager.\n2. Exporte a semana.\n\n## Armadilhas\n- O fuso é o da conta.",
};

const learnedLines = () =>
  f.db
    .select()
    .from(schema.messages)
    .where(and(eq(schema.messages.orgId, f.org.id), eq(schema.messages.authorAgentId, f.agent.id)))
    .then((rows) => rows.filter((m) => m.meta.learned));

/** The offer's block under a line. */
const blockOf = (line: { meta: Record<string, unknown> } | undefined) => {
  const id = (line?.meta.artifacts as { id: string }[] | undefined)?.[0]?.id;
  if (!id) throw new Error("no offer under the line");
  return id;
};

describe("reading a cadence and a real change (ADR 0120, addendum 2026-11-20)", () => {
  test("only plain recurring forms are a cadence", () => {
    expect(cadenceOf("puxa o relatório do Meta Ads toda segunda às 9h")).toEqual({
      kind: "weekly",
      weekday: "MO",
      time: "09:00",
    });
    expect(cadenceOf("faz isso todo dia às 8h30")).toEqual({ kind: "daily", time: "08:30" });
    expect(cadenceOf("dias úteis às 18:00")).toEqual({ kind: "weekdays", time: "18:00" });
    expect(cadenceOf("every friday at 5pm")).toEqual({ kind: "weekly", weekday: "FR", time: "17:00" });
    expect(cadenceOf("todo dia 5 manda o boleto")).toEqual({ kind: "monthly", day: 5, time: "09:00" });
    expect(cadenceOf("manda na segunda")).toBeNull();
    expect(cadenceOf("semana que vem a gente vê")).toBeNull();
    expect(cadenceOf("puxa o relatório às 10h")).toBeNull();
  });

  test("a typo or a reworded line is not a change worth saying; new steps or a file are", () => {
    const before = SKILL.body;
    expect(meaningfulChange(before, before.replace("Exporte", "Exporta"))).toBe(false);
    expect(meaningfulChange(before, `${before}\n- Confira o total.`)).toBe(false);
    expect(
      meaningfulChange(
        before,
        `${before}\n3. Filtre só as campanhas ativas antes de exportar.\n4. Some o investimento por campanha e mande no #marketing.`,
      ),
    ).toBe(true);
    expect(meaningfulChange(before, before, ["scripts/pull.sh"])).toBe(true);
  });
});

describe("Aprendi a fazer isso", () => {
  test("a skill made in the run: one silent line under the answer, once per skill", async () => {
    f = await setup();
    const { run, ctx, finish } = await answeredRun("@dev transforma isso numa skill");
    const skill = await createSkillAsAgent({ db: f.db }, ctx, SKILL);
    // Still running: the job comes back later.
    expect(await announceLearned(deps(), { orgId: f.org.id, runId: run.id })).toEqual({ skipped: "running" });
    const reply = await finish();

    const out = await announceLearned(deps(), { orgId: f.org.id, runId: run.id });
    expect(out).toMatchObject({ skillId: skill.id, how: "created", offered: false });
    const [line] = await learnedLines();
    expect(line?.body).toBe("Aprendi a fazer isso. Da próxima vez, leva segundos.");
    expect(line?.agentRunId).toBe(run.id);
    expect(line?.channelId).toBe(reply?.channelId as string);
    expect(line?.meta.learned).toEqual({ skillId: skill.id, how: "created" });
    // Silent: nobody is notified of it.
    const notices = await f.db
      .select()
      .from(schema.outbox)
      .where(
        and(
          eq(schema.outbox.kind, "notifications.message"),
          eq(schema.outbox.dedupeKey, `notifications.message:${line?.id}`),
        ),
      );
    expect(notices).toEqual([]);

    // Again (the learning job's moment, a retry): said already.
    expect(await announceLearned(deps(), { orgId: f.org.id, runId: run.id })).toEqual({ skipped: "said" });
    expect(await learnedLines()).toHaveLength(1);
  });

  test("nothing for a run that taught no skill, a trivial edit, an undone skill, or a run that said nothing", async () => {
    f = await setup();
    const plain = await answeredRun("@dev quanto gastamos ontem?");
    await plain.finish();
    expect(await announceLearned(deps(), { orgId: f.org.id, runId: plain.run.id })).toEqual({ skipped: "nothing" });

    const edited = await answeredRun("@dev puxa o relatório");
    const skill = await createSkillAsAgent({ db: f.db }, edited.ctx, SKILL);
    await f.db.update(schema.skills).set({ learnedSaidAt: new Date() }).where(eq(schema.skills.id, skill.id));
    const later = await answeredRun("@dev puxa de novo");
    await recordAgentActions(f.db, later.ctx, [
      {
        kind: "skill.updated",
        target: { type: "skill", id: skill.id, title: skill.name },
        params: { name: skill.name },
        before: { body: SKILL.body },
        after: { body: SKILL.body.replace("Exporte", "Exporta") },
      },
    ]);
    await later.finish();
    await f.db.update(schema.skills).set({ learnedSaidAt: null }).where(eq(schema.skills.id, skill.id));
    expect(await announceLearned(deps(), { orgId: f.org.id, runId: later.run.id })).toEqual({ skipped: "trivial" });

    const quiet = await answeredRun("@dev aprende isso", { silent: true });
    await createSkillAsAgent({ db: f.db }, quiet.ctx, { ...SKILL, name: "quiet-skill" });
    await quiet.finish();
    expect(await announceLearned(deps(), { orgId: f.org.id, runId: quiet.run.id })).toEqual({ skipped: "silent" });

    const undone = await answeredRun("@dev faz uma skill");
    await createSkillAsAgent({ db: f.db }, undone.ctx, { ...SKILL, name: "undone-skill" });
    await f.db
      .update(schema.agentActions)
      .set({ undoneAt: new Date() })
      .where(eq(schema.agentActions.runId, undone.run.id));
    await undone.finish();
    expect(await announceLearned(deps(), { orgId: f.org.id, runId: undone.run.id })).toEqual({ skipped: "nothing" });
    expect(await learnedLines()).toEqual([]);
  });

  test("a meaningful change to a skill reads as a better way", async () => {
    f = await setup();
    const first = await answeredRun("@dev puxa o relatório");
    const skill = await createSkillAsAgent({ db: f.db }, first.ctx, SKILL);
    await f.db.update(schema.skills).set({ learnedSaidAt: null }).where(eq(schema.skills.id, skill.id));
    await f.db.delete(schema.agentActions).where(eq(schema.agentActions.runId, first.run.id));
    const next = await answeredRun("@dev puxa de novo");
    await recordAgentActions(f.db, next.ctx, [
      {
        kind: "skill.updated",
        target: { type: "skill", id: skill.id, title: skill.name },
        params: { name: skill.name },
        before: { body: SKILL.body },
        after: {
          body: `${SKILL.body}\n3. Filtre só as campanhas ativas antes de exportar.\n4. Some o investimento por campanha.`,
        },
      },
    ]);
    await next.finish();
    expect(await announceLearned(deps(), { orgId: f.org.id, runId: next.run.id })).toMatchObject({ how: "updated" });
    const [line] = await learnedLines();
    expect(line?.body).toBe("Aprendi um jeito melhor de fazer isso. Da próxima vez, vai mais rápido.");
  });

  test("a turn that wrote a skill queues the line", async () => {
    f = await setup();
    const { run } = await answeredRun("@dev transforma isso numa skill");
    await addRunStep(f.db, run, "tool_call", { toolUseId: "t1", name: "create_skill", input: {} });
    await addRunStep(f.db, run, "tool_result", { toolUseId: "t1", name: "create_skill", content: "ok" });
    await afterTurnDone({ db: f.db }, run, { judged: false });
    const jobs = await f.db.select().from(schema.outbox).where(eq(schema.outbox.kind, LEARNED_LINE_JOB));
    expect(jobs.map((j) => j.payload)).toEqual([{ runId: run.id }]);
  });
});

describe("the offer to make it a routine", () => {
  test("a cadence in the request: one tap makes the routine, in this conversation, on that schedule", async () => {
    f = await setup();
    const { run, ctx, finish } = await answeredRun("@dev puxa o relatório do Meta Ads toda segunda às 9h");
    await createSkillAsAgent({ db: f.db }, ctx, SKILL);
    await finish();
    const out = await announceLearned(deps(), { orgId: f.org.id, runId: run.id });
    expect(out).toMatchObject({ offered: true, cadence: { kind: "weekly", weekday: "MO", time: "09:00" } });
    const [line] = await learnedLines();
    expect(line?.body).toBe(
      "Aprendi a fazer isso. Da próxima vez, leva segundos. Quer que eu faça isso toda segunda às 9h?",
    );
    const block = blockOf(line);
    const acts = await f.db.select().from(schema.blockActions).where(eq(schema.blockActions.artifactId, block));
    expect(acts.map((a) => [a.act, a.kind, a.forUserId])).toEqual([
      ["yes", "make_routine", f.owner.id],
      ["skip", "skip_routine", f.owner.id],
    ]);

    await runBlockAct(deps(), f.owner.id, f.org.id, block, "yes");
    const [routine] = await f.db.select().from(schema.routines).where(eq(schema.routines.agentId, f.agent.id));
    expect(routine?.prompt).toContain("meta-ads-report");
    expect(routine?.prompt).toContain("toda segunda às 9h");
    expect(routine?.target).toMatchObject({ type: "conversation", channelId: f.general.id });
    expect(routine?.rule).toMatchObject({ freq: "weekly", byWeekday: ["MO"], times: ["09:00"] });
    expect(routine?.createdByUserId).toBe(f.owner.id);
    // One choice: "Agora não" is taken with it, and the card says what became of it.
    await expect(runBlockAct(deps(), f.owner.id, f.org.id, block, "skip")).rejects.toThrow("already done");
    const state = await getBlockState(f.artifactDeps, f.owner.id, f.org.id, block, 1);
    expect(state.state._acted).toEqual({ yes: "done" });
  });

  test("work that came back without a cadence: one question, a button per cadence", async () => {
    f = await setup();
    const { run, ctx, finish } = await answeredRun("@dev puxa o relatório do Meta Ads");
    const skill = await createSkillAsAgent({ db: f.db }, ctx, SKILL);
    // Loaded in earlier runs: the same kind of request already came twice.
    await f.db.update(schema.skills).set({ useCount: 2 }).where(eq(schema.skills.id, skill.id));
    await finish();
    expect(await announceLearned(deps(), { orgId: f.org.id, runId: run.id })).toMatchObject({
      offered: true,
      cadence: null,
    });
    const [line] = await learnedLines();
    expect(line?.body).toEndWith("Quer que eu faça isso sozinho, com frequência?");
    const block = blockOf(line);
    const acts = await f.db.select().from(schema.blockActions).where(eq(schema.blockActions.artifactId, block));
    expect(acts.map((a) => a.act).sort()).toEqual(["monthly", "skip", "weekdays", "weekly"]);
    await runBlockAct(deps(), f.owner.id, f.org.id, block, "monthly");
    const [routine] = await f.db.select().from(schema.routines).where(eq(schema.routines.agentId, f.agent.id));
    expect(routine?.rule).toMatchObject({ freq: "monthly", byMonthDay: [1], times: ["09:00"] });
  });

  test("no offer for one-off work, nor when a routine already uses the skill", async () => {
    f = await setup();
    const once = await answeredRun("@dev puxa o relatório do Meta Ads");
    await createSkillAsAgent({ db: f.db }, once.ctx, SKILL);
    await once.finish();
    expect(await announceLearned(deps(), { orgId: f.org.id, runId: once.run.id })).toMatchObject({ offered: false });

    const again = await answeredRun("@dev puxa o relatório de vendas toda segunda");
    await createSkillAsAgent({ db: f.db }, again.ctx, { ...SKILL, name: "sales-report" });
    await f.db.insert(schema.routines).values({
      orgId: f.org.id,
      agentId: f.agent.id,
      name: "Vendas",
      prompt: "Use a skill sales-report toda segunda",
      target: { type: "dm" },
      triggerType: "schedule",
      createdByUserId: f.owner.id,
    });
    await again.finish();
    expect(await announceLearned(deps(), { orgId: f.org.id, runId: again.run.id })).toMatchObject({ offered: false });
  });
});
