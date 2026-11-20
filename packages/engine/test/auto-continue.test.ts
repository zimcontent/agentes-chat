import { afterEach, describe, expect, setDefaultTimeout, test } from "bun:test";
import { schema } from "@dougbot/db";
import type { ModelRequest } from "@dougbot/providers";
import {
  AUTO_CONTINUE_MAX,
  autoContinueLine,
  continueRun,
  createAgent,
  createAgentRuns,
  createJobHandlers,
  drainOutbox,
  insertMessage,
  lastToolsSucceeded,
  mayContinueAlone,
  postPersonMessage,
  type ToolSource,
  type Transcript,
  WRAP_UP_REPLY_NOTE,
} from "../src";
import { type Fixture, setup } from "./fixtures";

/**
 * A person's request at its step limit while its work goes well goes on by itself, at most twice, as if they had
 * pressed Continuar (ADR 0097, addendum 2026-11-20); anything else keeps the Continuar for the person.
 */

// PGlite setup on a slow machine.
setDefaultTimeout(60_000);

let f: Fixture;
afterEach(async () => {
  const current = f;
  f = undefined as unknown as Fixture;
  await current?.close();
});

const deps = () => ({ db: f.db, pubsub: f.pubsub });
const ask = (body: string) => postPersonMessage(deps(), f.owner.id, f.org.id, f.general.id, { body });
const runsInOrder = async () =>
  (await f.db.select().from(schema.agentRuns)).sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime());
const agentMessages = async (runId: string) =>
  (await f.db.select().from(schema.messages)).filter((m) => m.agentRunId === runId);
const lastText = (req: ModelRequest) => JSON.stringify(req.messages.at(-1)?.content ?? "");
const autoCount = (run: { transcript: unknown } | undefined) => (run?.transcript as Transcript | null)?.autoContinued;
const handlers = (maxToolTurns: number, autoContinue?: number) =>
  createJobHandlers({ ...f.jobDeps, maxToolTurns, ...(autoContinue !== undefined ? { autoContinue } : {}) });

/** A read tool that works, and one that fails. */
function workTools(): ToolSource {
  const schemaless = { type: "object", properties: {} };
  return {
    name: "work",
    tools: async () => [
      {
        name: "look",
        description: "Look at the open pull requests",
        scope: "context:read",
        inputSchema: schemaless,
        execute: async () => ({ content: "3 PRs open" }),
      },
      {
        name: "deploy_check",
        description: "Check the deploy",
        scope: "context:read",
        inputSchema: schemaless,
        execute: async () => ({ content: "deploy API refused", isError: true }),
      },
    ],
  };
}

const looks = { chunks: [], toolUses: [{ name: "look", input: {} }] };

describe("a person's request at its step limit while its work goes well", () => {
  test("goes on by itself twice, in the same conversation, then leaves Continuar to the person", async () => {
    f = await setup({ toolSources: [workTools()], reply: () => looks });
    await ask("@dev revisa os PRs");
    await drainOutbox(f.db, handlers(3));

    const runs = await runsInOrder();
    expect(runs).toHaveLength(1 + AUTO_CONTINUE_MAX);
    expect(runs.map((r) => r.status)).toEqual(["done", "done", "done"]);
    expect(f.provider.calls).toHaveLength(9);
    // One conversation: every continuation answers where the first run did, as Continuar does.
    const posted = (await f.db.select().from(schema.messages)).filter((m) => m.agentRunId);
    expect(new Set(posted.map((m) => `${m.channelId}/${m.threadId}`)).size).toBe(1);
    // Each run posted only the step-limit line Continuar already shows.
    const replies = await Promise.all(runs.map(async (r) => (await agentMessages(r.id)).map((m) => m.meta.bodyCode)));
    expect(replies).toEqual([["step_limit"], ["step_limit"], ["step_limit"]]);

    const [first, second, third] = runs;
    const [firstReply] = await agentMessages(first?.id ?? "");
    expect(firstReply?.meta.stepLimit).toEqual({
      continuedRunId: second?.id,
      continuedByUserId: f.owner.id,
      auto: true,
    });
    expect(second?.triggerMessageId).toBe(firstReply?.id ?? "");
    // Same stretch: nobody new asked (ADR 0089).
    expect(second).toMatchObject({ hop: first?.hop, stretchId: first?.stretchId });
    expect(autoCount(second)).toBe(1);
    expect(autoCount(third)).toBe(2);
    // The last one has no continuation left: its reply keeps Continuar for the person.
    const [lastReply] = await agentMessages(third?.id ?? "");
    expect(lastReply?.meta.stepLimit).toEqual({});

    const requests = f.provider.calls.map((c) => c.request);
    // With continuations left it is never told to wrap up; the last run is, as before.
    expect(requests.slice(0, 6).some((r) => lastText(r).includes(WRAP_UP_REPLY_NOTE))).toBe(false);
    expect(requests.slice(6).some((r) => lastText(r).includes(WRAP_UP_REPLY_NOTE))).toBe(true);
    expect(lastText(requests[3] as ModelRequest)).toContain(autoContinueLine(1).slice(1, -1));
    expect(lastText(requests[6] as ModelRequest)).toContain(autoContinueLine(2).slice(1, -1));

    // Audited as the system's, for the person who asked.
    const audits = (await f.db.select().from(schema.auditLog)).filter((a) => a.action === "run.continued");
    expect(audits.map((a) => [a.actorType, a.details])).toEqual([
      ["system", { agentId: f.agent.id, continues: first?.id, auto: 1 }],
      ["system", { agentId: f.agent.id, continues: second?.id, auto: 2 }],
    ]);
  });

  test("a Continuar the person presses afterwards gives the request its two again", async () => {
    f = await setup({ toolSources: [workTools()], reply: () => looks });
    await ask("@dev revisa os PRs");
    await drainOutbox(f.db, handlers(2));
    const third = (await runsInOrder()).at(-1);
    const { runId } = await continueRun(deps(), f.owner.id, f.org.id, third?.id ?? "");
    await drainOutbox(f.db, handlers(2));

    const runs = await runsInOrder();
    expect(runs).toHaveLength(6);
    expect(runs[3]?.id).toBe(runId);
    expect(autoCount(runs[3])).toBeUndefined();
    expect(autoCount(runs[5])).toBe(2);
  });

  test("its last tool call failed: it stops at the cap and the person decides", async () => {
    f = await setup({
      toolSources: [workTools()],
      reply: (_req, n) => (n < 3 ? looks : { chunks: [], toolUses: [{ name: "deploy_check", input: {} }] }),
    });
    await ask("@dev revisa os PRs e o deploy");
    await drainOutbox(f.db, handlers(3));

    const runs = await runsInOrder();
    expect(runs).toHaveLength(1);
    const [reply] = await agentMessages(runs[0]?.id ?? "");
    expect(reply?.meta).toMatchObject({ bodyCode: "step_limit", stepLimit: {} });
  });

  test("turned off (0): it ends at the cap with Continuar, told to wrap up first, as before", async () => {
    f = await setup({ toolSources: [workTools()], reply: () => looks });
    await ask("@dev revisa os PRs");
    await drainOutbox(f.db, handlers(3, 0));

    expect(await runsInOrder()).toHaveLength(1);
    expect(f.provider.calls.some((c) => lastText(c.request).includes(WRAP_UP_REPLY_NOTE))).toBe(true);
  });

  test("a run another agent woke, with nobody behind its request, doesn't go on by itself", async () => {
    f = await setup({ toolSources: [workTools()], reply: () => looks });
    const theo = await createAgent(
      f.db,
      f.owner.id,
      f.org.id,
      { name: "Theo", handle: "theo", role: "QA", credentialId: f.credential.id },
      { model: "claude-sonnet-5-5" },
    );
    await f.db.insert(schema.channelMembers).values({ orgId: f.org.id, channelId: f.general.id, agentId: theo.id });
    const said = await insertMessage(f.db, {
      orgId: f.org.id,
      channelId: f.general.id,
      author: { type: "agent", agentId: theo.id, runId: Bun.randomUUIDv7(), hop: 1 },
      body: "@dev revisa o #42",
    });
    await f.db.transaction((tx) => createAgentRuns(tx, said, [f.agent.id], "mention"));
    await drainOutbox(f.db, handlers(2));

    const runs = (await runsInOrder()).filter((r) => r.agentId === f.agent.id);
    expect(runs).toHaveLength(1);
  });
});

describe("the rule", () => {
  const facts = {
    max: 2,
    done: 0,
    background: false,
    workOrMission: false,
    viaRoutine: false,
    modelBrain: true,
    stuck: false,
    person: true,
  };

  test("only a person's conversation run on the model brain, not stuck, with continuations left", () => {
    expect(mayContinueAlone(facts)).toBe(true);
    expect(mayContinueAlone({ ...facts, done: 2 })).toBe(false);
    expect(mayContinueAlone({ ...facts, max: 0 })).toBe(false);
    for (const k of ["background", "workOrMission", "viaRoutine", "stuck"] as const)
      expect(mayContinueAlone({ ...facts, [k]: true })).toBe(false);
    for (const k of ["modelBrain", "person"] as const) expect(mayContinueAlone({ ...facts, [k]: false })).toBe(false);
  });

  test("its last steps went well only when it ends on tool results and none failed", () => {
    const result = (isError?: boolean) => ({
      type: "tool_result" as const,
      toolUseId: "t1",
      content: "ok",
      ...(isError ? { isError } : {}),
    });
    expect(lastToolsSucceeded([{ role: "user", content: [result()] }])).toBe(true);
    expect(lastToolsSucceeded([{ role: "user", content: [result(), result(true)] }])).toBe(false);
    expect(lastToolsSucceeded([{ role: "user", content: "continue" }])).toBe(false);
    expect(lastToolsSucceeded([{ role: "assistant", content: [{ type: "text", text: "Feito." }] }])).toBe(false);
    expect(lastToolsSucceeded([])).toBe(false);
  });
});
