import { afterEach, expect, test } from "bun:test";
import { and, asc, eq, schema, sql } from "@agenteschat/db";
import { createFakeJudge, createJobHandlers, drainOutbox, postPersonMessage } from "../src";
import { ackLanguage, asksForWork, isSmallTalk, pickAckLine } from "../src/quick-ack";
import { type Fixture, setup } from "./fixtures";

let f: Fixture;
afterEach(async () => {
  const current = f;
  f = undefined as unknown as Fixture;
  await current?.close();
});

const judgeKinds = () => (f.context.judge as ReturnType<typeof createFakeJudge>).calls.map((c) => c.kind);

const agentMessages = () =>
  f.db
    .select()
    .from(schema.messages)
    .where(and(eq(schema.messages.orgId, f.org.id), eq(schema.messages.authorType, "agent")))
    .orderBy(asc(schema.messages.createdAt));

/** A run on `body` with the first words on; the fake judge says how much `body` asks for work. */
async function runOn(body: string, work: number) {
  f = await setup({
    contextTools: true,
    // The burst wait gives the judge's line time to go out before the first call, as on a server.
    quietMs: 300,
    judge: (kind) => (kind === "quick_ack" ? work : undefined),
    reply: () => ({ chunks: ["Pronto: o relatório de ontem está no Drive."] }),
  });
  const handlers = createJobHandlers({ ...f.jobDeps, quickAck: true });
  await postPersonMessage({ db: f.db, pubsub: f.pubsub }, f.owner.id, f.org.id, f.general.id, { body });
  await drainOutbox(f.db, handlers);
}

test("small talk: greetings, thanks, an ok or emoji alone; never a request or a file", () => {
  for (const s of ["oi", "Oi!", "bom dia", "valeu!!", "obrigado", "ok", "👍", "kkkk", "thanks", "tudo bem?", "@dev oi"])
    expect(isSmallTalk(s)).toBe(true);
  for (const s of ["oi, monta o relatório de ontem", "qual o status do pedido 123?", "abre o site da Acme"])
    expect(isSmallTalk(s)).toBe(false);
  expect(isSmallTalk("ok", { artifacts: [{ id: "a" }] })).toBe(false);
});

test("the line's language: the person's app language, else what the message looks like", () => {
  expect(ackLanguage("pt-BR", "check the logs")).toBe("pt");
  expect(ackLanguage("en", "olha os logs")).toBe("en");
  expect(ackLanguage(null, "você pode olhar os logs?")).toBe("pt");
  expect(ackLanguage(null, "can you check the logs?")).toBe("en");
});

test("an agent never says the same line twice in a row", () => {
  const lines = Array.from({ length: 40 }, () => pickAckLine("agent-1", "pt"));
  for (let i = 1; i < lines.length; i++) expect(lines[i]).not.toBe(lines[i - 1]);
});

test("the judge: a yes at 0.6 or more; a late answer or a failure is a no", async () => {
  const input = { orgId: "o", agentId: "a", runId: "r", agent: { name: "Dev", role: "" }, message: "x", recent: [] };
  expect(
    await asksForWork(
      createFakeJudge(() => 0.6),
      input,
    ),
  ).toBe(true);
  expect(
    await asksForWork(
      createFakeJudge(() => 0.5),
      input,
    ),
  ).toBe(false);
  const slow = {
    name: "slow",
    ask: () => new Promise<never>(() => {}),
  };
  expect(await asksForWork(slow, { ...input, timeoutMs: 20 })).toBe(false);
  const broken = { name: "broken", ask: () => Promise.reject(new Error("off")) };
  expect(await asksForWork(broken, input)).toBe(false);
});

test("work: the agent's line goes out first, silent, then the answer; the run knows it already said it", async () => {
  await runOn("@dev monta o relatório de vendas de ontem e salva no Drive", 0.9);
  const [ack, answer, ...rest] = await agentMessages();
  expect(rest).toHaveLength(0);
  expect((ack?.meta as { ack?: { runId?: string } } | undefined)?.ack?.runId).toBe(answer?.agentRunId ?? "");
  expect(ack?.agentRunId).toBe(answer?.agentRunId ?? null);
  expect(answer?.body).toContain("relatório de ontem");
  // Silent: no notification and no routing for the line, only for the answer.
  const jobs = await f.db
    .select({ kind: schema.outbox.kind })
    .from(schema.outbox)
    .where(sql`${schema.outbox.payload}->>'messageId' = ${ack?.id ?? ""}`);
  expect(jobs.map((j) => j.kind)).not.toContain("notifications.message");
  // The model reads the line as said (a note of the turn), not as its own message in the history.
  const request = JSON.stringify(f.provider.calls[0]?.request);
  expect(request).toContain("You already answered");
  expect(request).toContain(ack?.body ?? "-");
  const history = JSON.stringify(f.provider.calls[0]?.request.messages);
  expect(history).not.toContain(`"${ack?.body}"`);
});

test("conversation: no line when the judge doesn't see work", async () => {
  await runOn("@dev o que você acha do nome Atlas?", 0.2);
  const messages = await agentMessages();
  expect(messages).toHaveLength(1);
  expect(JSON.stringify(f.provider.calls[0]?.request)).not.toContain("You already answered");
});

test("small talk asks no judge at all: no line, no tool groups, no work to size", async () => {
  await runOn("@dev oi", 1);
  expect(await agentMessages()).toHaveLength(1);
  expect(judgeKinds()).not.toContain("quick_ack");
  expect(judgeKinds()).not.toContain("tool_groups");
});
