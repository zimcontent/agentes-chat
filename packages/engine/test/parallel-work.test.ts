import { afterEach, describe, expect, test } from "bun:test";
import { eq, schema } from "@dougbot/db";
import {
  type Judge,
  type JudgeAnswer,
  type JudgeRequest,
  openDm,
  postPersonMessage,
  STEER_SURE,
  type SteerHandling,
  steerTriage,
  stopChecksSettled,
  type TalkerInput,
} from "../src";
import {
  activeHere,
  alongsideHere,
  MAX_PARALLEL_RUNS,
  PARALLEL_AFTER_MS,
  parallelRule,
  siblingRuns,
} from "../src/parallel-work";
import { othersHere, takeInbox } from "../src/run-inbox";
import { type AgentRun, addRunStep } from "../src/runs";
import { type Fixture, setup } from "./fixtures";

/**
 * Parallel work (docs/adr/doug-0038-parallel-work.md): while an agent works a long task, a person's new, separate
 * request in the same conversation starts a second run beside it; what is about the task stays with the task.
 */

let f: Fixture;
afterEach(async () => {
  const current = f;
  f = undefined as unknown as Fixture;
  await current?.close();
});

describe("the rules before the judge", () => {
  const rule = (text: string, extra: { now?: boolean; quotedOwn?: boolean } = {}) =>
    parallelRule({ text, now: extra.now ?? false, quotedOwn: extra.quotedOwn ?? false });

  test("a stop, a go-on, a status question, thanks or a short line are about the task", () => {
    for (const text of [
      "para",
      "@doug para tudo agora",
      "e aí, como tá indo?",
      "como está o relatório?",
      "valeu!",
      "ok",
      "continua daí",
      "how is it going?",
      "thanks, keep going",
      "nessa planilha, inclui também a coluna de região por favor",
    ])
      expect(rule(text).verdict).toBe("task");
  });

  test("Parar e mandar, or a quote of the task's own reply, is about the task", () => {
    const text = "monta também a proposta para o cliente da Bahia";
    expect(rule(text, { now: true })).toEqual({ verdict: "task", reason: "now" });
    expect(rule(text, { quotedOwn: true })).toEqual({ verdict: "task", reason: "quoted" });
  });

  test("anything else goes to the judge, a long line starting with ok included", () => {
    for (const text of [
      "monta também a proposta para o cliente da Bahia",
      "@doug pesquisa hotéis em Recife para o evento de março",
      "ok, e depois de tudo monta também um resumo das vendas de outubro por região",
      "Para o cliente X, prepara uma proposta comercial nova",
    ])
      expect(rule(text)).toEqual({ verdict: "judge", reason: null });
  });
});

describe("steerTriage", () => {
  const input = { orgId: "o", text: "inclui a coluna de região", agentName: "Dev", task: "Proposta da Bahia" };

  function asking(answer: JudgeAnswer | undefined) {
    const seen: JudgeRequest[] = [];
    const judge: Judge = {
      name: "fake",
      ask: async (request): Promise<Record<string, JudgeAnswer>> => {
        seen.push(request);
        return answer ? { handling: answer } : {};
      },
    };
    return { judge, seen };
  }

  test("with other runs at work it may say the message is one of theirs, in the same one judgment", async () => {
    const others = [{ runId: "r-1", task: "Relatório de outubro" }];
    const sure = asking({ choice: "other_task_1", probabilities: { other_task_1: 0.8, add: 0.2 } });
    expect(await steerTriage(sure.judge, { ...input, others })).toEqual({ handling: "add", otherRunId: "r-1" });
    expect(sure.seen).toHaveLength(1);
    expect(sure.seen[0]?.state).toMatchObject({ other_task_1: "Relatório de outubro" });
    const criteria =
      (sure.seen[0]?.questions.handling as { criteria?: Record<string, string> } | undefined)?.criteria ?? {};
    expect(Object.keys(criteria)).toEqual(["stop", "interrupt", "add", "answer", "queue", "other_task_1"]);
    // Not sure enough: the run it went into reads it, as before.
    const unsure = asking({ choice: "other_task_1", probabilities: { other_task_1: STEER_SURE - 0.1 } });
    expect(await steerTriage(unsure.judge, { ...input, others })).toEqual({ handling: "add" });
  });

  test("without other runs the question is the one it always was", async () => {
    const plain = asking({ choice: "queue", probabilities: { queue: 0.9 } });
    expect(await steerTriage(plain.judge, input)).toEqual({ handling: "queue" });
    const criteria =
      (plain.seen[0]?.questions.handling as { criteria?: Record<string, string> } | undefined)?.criteria ?? {};
    expect(Object.keys(criteria)).toEqual(["stop", "interrupt", "add", "answer", "queue"]);
    // An answer naming a run that isn't offered is no answer.
    const stray = asking({ choice: "other_task_1", probabilities: { other_task_1: 0.99 } });
    expect(await steerTriage(stray.judge, input)).toEqual({ handling: "add" });
  });
});

describe("a message sent while the agent works a long task", () => {
  const deps = () => ({ db: f.db, pubsub: f.pubsub });
  const runs = () => f.db.select().from(schema.agentRuns);
  const runById = async (id: string) => (await runs()).find((r) => r.id === id) as AgentRun;

  /** The triage as the judge says it, by the message's words; `failing`: the judge throws. */
  const triage = (by: Record<string, SteerHandling | `other_task_${number}`>, failing = false): Judge => ({
    name: "fake",
    ask: async (request): Promise<Record<string, JudgeAnswer>> => {
      if (failing) throw new Error("judge down");
      const way = request.kind === "steer_triage" ? by[String(request.state.message)] : undefined;
      return way ? { handling: { choice: way, probabilities: { [way]: 0.9 } } } : {};
    },
  });

  /** The agent at work on a person's request for `ageMs` already (it called a tool); its thread takes what comes next. */
  async function working(ageMs = PARALLEL_AFTER_MS + 30_000) {
    f = await setup();
    const question = await postPersonMessage(deps(), f.owner.id, f.org.id, f.general.id, {
      body: "@dev monta o relatório de outubro",
    });
    const [run] = await runs();
    if (!run) throw new Error("no run");
    await f.db
      .update(schema.agentRuns)
      .set({ status: "running", startedAt: new Date(Date.now() - ageMs) })
      .where(eq(schema.agentRuns.id, run.id));
    await addRunStep(f.db, run, "tool_call", { toolUseId: "c-1", name: "run_code", input: {} });
    return { run, threadId: question.id };
  }

  async function send(threadId: string, body: string, judge: Judge, extra: { replyTo?: string } = {}) {
    const talked: TalkerInput[] = [];
    const sent = await postPersonMessage(
      { ...deps(), judge, talker: { consider: async (input) => void talked.push(input) } },
      f.owner.id,
      f.org.id,
      f.general.id,
      { body, threadId, ...extra },
    );
    await stopChecksSettled();
    return { sent, talked };
  }

  test("a new request starts a second run beside the task, which answers it itself", async () => {
    const { run, threadId } = await working();
    const events = f.listen(f.general.id);
    const body = "pesquisa hotéis em Recife para o evento de março";
    const { sent, talked } = await send(threadId, body, triage({ [body]: "queue" }));
    const all = await runs();
    expect(all).toHaveLength(2);
    const beside = all.find((r) => r.id !== run.id) as AgentRun;
    // Its own run, on its own message, in the same conversation; a session of its own once it thinks.
    expect(beside).toMatchObject({
      agentId: f.agent.id,
      channelId: f.general.id,
      threadRootId: threadId,
      triggerMessageId: sent.id,
      trigger: "mention",
      status: "queued",
      brainSessionId: null,
    });
    const jobs = await f.db.select().from(schema.outbox).where(eq(schema.outbox.kind, "agent_run.execute"));
    expect(jobs.some((j) => j.payload.runId === beside.id)).toBe(true);
    // The task never reads it, nor does it wait for its end; nothing answers in its place meanwhile.
    const task = await runById(run.id);
    expect(task.status).toBe("running");
    expect(task.pendingMessageIds).not.toContain(sent.id);
    expect(task.afterMessageIds).toEqual([]);
    expect(await takeInbox(f.db, run.id)).toEqual([]);
    expect(talked).toEqual([]);
    // Receipts and the router read it as the new run's.
    const [stored] = await f.db.select().from(schema.messages).where(eq(schema.messages.id, sent.id));
    expect(stored?.meta.steeredRunIds).toEqual([beside.id]);
    expect(events).toContainEqual(
      expect.objectContaining({ type: "agent.run.redispatched", runId: run.id, newRunId: beside.id }),
    );
    expect(events).toContainEqual(expect.objectContaining({ type: "agent.thinking", runId: beside.id }));
    // Each knows what the other works on.
    expect(await alongsideHere(f.db, beside)).toContain("monta o relatório de outubro");
    expect(await alongsideHere(f.db, task)).toContain(body);
    // The run's context reads its siblings with what its other runs hold, in one statement (`othersHere`).
    const read = await othersHere(f.db, task);
    expect(read.held).toBeNull();
    expect(read.runs.map((r) => r.id)).toEqual([beside.id]);
    expect(await alongsideHere(f.db, task, read.runs)).toBe(await alongsideHere(f.db, task));
  });

  test("in a DM too: the second run answers in the main timeline beside the first", async () => {
    f = await setup();
    const dm = await openDm(f.db, f.owner.id, f.org.id, { agentId: f.agent.id });
    await postPersonMessage(deps(), f.owner.id, f.org.id, dm.id, { body: "monta o relatório de outubro" });
    const [run] = await runs();
    if (!run) throw new Error("no run");
    await f.db
      .update(schema.agentRuns)
      .set({ status: "running", startedAt: new Date(Date.now() - 2 * PARALLEL_AFTER_MS) })
      .where(eq(schema.agentRuns.id, run.id));
    await addRunStep(f.db, run, "tool_call", { toolUseId: "c-1", name: "run_code", input: {} });
    const body = "pesquisa hotéis em Recife para o evento";
    const sent = await postPersonMessage(
      { ...deps(), judge: triage({ [body]: "queue" }) },
      f.owner.id,
      f.org.id,
      dm.id,
      {
        body,
      },
    );
    await stopChecksSettled();
    const beside = (await runs()).find((r) => r.id !== run.id);
    expect(beside).toMatchObject({ trigger: "dm", triggerMessageId: sent.id, threadRootId: sent.id });
    expect(await activeHere(f.db, run)).toBe(2);
  });

  test("a young task keeps today's way: the request waits for its end", async () => {
    const { run, threadId } = await working(5_000);
    const body = "pesquisa hotéis em Recife para o evento de março";
    const { sent, talked } = await send(threadId, body, triage({ [body]: "queue" }));
    expect(await runs()).toHaveLength(1);
    expect((await runById(run.id)).afterMessageIds).toEqual([sent.id]);
    expect(talked.map((t) => t.handling)).toEqual(["queue"]);
  });

  test("about the task, or a judge that fails: the task's inbox, as before", async () => {
    const { run, threadId } = await working();
    const add = "inclui também o gráfico por região no relatório";
    const first = await send(threadId, add, triage({ [add]: "add" }));
    const down = "pesquisa hotéis em Recife para o evento de março";
    const second = await send(threadId, down, triage({}, true));
    expect(await runs()).toHaveLength(1);
    expect((await runById(run.id)).pendingMessageIds).toEqual([first.sent.id, second.sent.id]);
  });

  test("the rules keep a short or status line in the task, whatever the judge says", async () => {
    const { run, threadId } = await working();
    const body = "e aí, como tá?";
    const { sent } = await send(threadId, body, triage({ [body]: "queue" }));
    expect(await runs()).toHaveLength(1);
    // A separate request it may be, but never one that starts beside the task: it waits for the end.
    expect((await runById(run.id)).afterMessageIds).toEqual([sent.id]);
  });

  test(`at most ${MAX_PARALLEL_RUNS} runs at once here: past it, the request waits for the task's end`, async () => {
    const { run, threadId } = await working();
    const asks = [
      "pesquisa hotéis em Recife para o evento",
      "faz a lista de convidados do evento",
      "cota o buffet do evento",
    ];
    const judge = triage(Object.fromEntries(asks.map((a) => [a, "queue" as const])));
    for (const body of asks) {
      await send(threadId, body, judge);
      // Each new run is young: the next request goes into it (the newest) and would wait there. Age them all.
      await f.db
        .update(schema.agentRuns)
        .set({ status: "running", startedAt: new Date(Date.now() - 2 * PARALLEL_AFTER_MS) })
        .where(eq(schema.agentRuns.agentId, f.agent.id));
      for (const r of await runs())
        await addRunStep(f.db, r, "tool_call", { toolUseId: `c-${r.id}`, name: "run_code", input: {} });
    }
    const all = await runs();
    expect(all).toHaveLength(MAX_PARALLEL_RUNS);
    expect(await activeHere(f.db, run)).toBe(MAX_PARALLEL_RUNS);
    const last = asks.at(-1) as string;
    const [lastSent] = await f.db.select().from(schema.messages).where(eq(schema.messages.body, last));
    const holder = all.find((r) => r.afterMessageIds.includes(lastSent?.id ?? ""));
    expect(holder).toBeDefined();
  });

  test("a message about the other run's task moves to that run: by the judge, or by quoting it", async () => {
    const { run, threadId } = await working();
    const body = "pesquisa hotéis em Recife para o evento de março";
    await send(threadId, body, triage({ [body]: "queue" }));
    const beside = (await runs()).find((r) => r.id !== run.id) as AgentRun;
    await f.db.update(schema.agentRuns).set({ status: "running" }).where(eq(schema.agentRuns.id, beside.id));
    expect((await siblingRuns(f.db, beside)).map((s) => s.run.id)).toEqual([run.id]);
    // Into the newest run (the hotels'), about the report: the judge says the other task.
    const about = "no relatório, usa os números de setembro também";
    const asked: JudgeRequest[] = [];
    const judge: Judge = {
      name: "fake",
      ask: async (request) => {
        asked.push(request);
        return { handling: { choice: "other_task_1", probabilities: { other_task_1: 0.85 } } };
      },
    };
    const moved = await send(threadId, about, judge);
    expect(asked[0]?.state).toMatchObject({ other_task_1: "@dev monta o relatório de outubro" });
    expect((await runById(run.id)).pendingMessageIds).toContain(moved.sent.id);
    expect((await runById(beside.id)).pendingMessageIds).not.toContain(moved.sent.id);
    const [stored] = await f.db.select().from(schema.messages).where(eq(schema.messages.id, moved.sent.id));
    expect(stored?.meta.steeredRunIds).toEqual([run.id]);
    expect(await runs()).toHaveLength(2);
    // A quote of what the report's run was asked goes to it without asking the judge.
    const silent: JudgeRequest[] = [];
    const quoting = await send(
      threadId,
      "esse aqui, usa só as lojas do Nordeste",
      {
        name: "fake",
        ask: async (r) => {
          silent.push(r);
          return {};
        },
      },
      { replyTo: threadId },
    );
    expect((await runById(run.id)).pendingMessageIds).toContain(quoting.sent.id);
    expect((await runById(beside.id)).pendingMessageIds).not.toContain(quoting.sent.id);
    expect(silent).toEqual([]);
  });

  test("alone, a run hears of no other work", async () => {
    const { run } = await working();
    expect(await alongsideHere(f.db, run)).toBeNull();
  });
});
