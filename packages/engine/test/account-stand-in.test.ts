import { afterEach, expect, test } from "bun:test";
import { MACHINE_PROTOCOL_VERSION } from "@agenteschat/adapters";
import { eq, schema } from "@agenteschat/db";
import {
  type Brain,
  type BrainEvent,
  type BrainTurn,
  brainAccountFor,
  clearPlanLimits,
  createJobHandlers,
  drainOutbox,
  enableAccountStandIns,
  listMessages,
  type MachineStatus,
  notePlanLimit,
  postPersonMessage,
} from "../src";
import { addMember, type Fixture, setup } from "./fixtures";
import { pairMachine } from "./machine-fixtures";

/**
 * ADR doug-0003: while an agent's account is at its plan's limit, another signed-in account of the same person and
 * plan on the same computer thinks for it, only where the server turned that on.
 */

let f: Fixture;
afterEach(() => {
  enableAccountStandIns(false);
  clearPlanLimits();
  const fx: Fixture | undefined = f;
  f = undefined as unknown as Fixture;
  return fx?.close();
});

const RUNNER = {
  hostname: "box",
  os: "linux" as const,
  arch: "x64",
  version: "0.8.0",
  protocol: MACHINE_PROTOCOL_VERSION,
  workspace: "/home/agentes/agentes",
};

const statusOf = (machineId: string): MachineStatus => ({
  id: machineId,
  orgId: "org",
  name: "Box",
  online: true,
  execAllowed: true,
  os: "linux",
  protocol: MACHINE_PROTOCOL_VERSION,
  executors: { antigravity: { version: "1.5.9" }, detectedAt: new Date().toISOString() },
});

/** Dev thinks with its owner's first Gemini account on a computer that has a second one of theirs. */
async function twoAccounts(fx: Fixture, second: Partial<typeof schema.machineAccounts.$inferInsert> = {}) {
  const deps = { db: fx.db, pubsub: fx.pubsub, publicUrl: "https://agentes.chat" };
  const { machineId } = await pairMachine(deps, fx.owner.id, fx.org.id, { name: "Box", ...RUNNER, exec: true });
  const [a, b] = [crypto.randomUUID(), crypto.randomUUID()];
  const row = { orgId: fx.org.id, machineId, kind: "antigravity", createdBy: fx.owner.id };
  await fx.db.insert(schema.machineAccounts).values({ ...row, id: a, label: "Gemini", createdAt: new Date(1000) });
  await fx.db
    .insert(schema.machineAccounts)
    .values({ ...row, id: b, label: "Gemini 2", createdAt: new Date(2000), ...second });
  await fx.db
    .update(schema.agents)
    .set({ machineId, brain: "antigravity", brainAccountId: a })
    .where(eq(schema.agents.id, fx.agent.id));
  const [agent] = await fx.db.select().from(schema.agents).where(eq(schema.agents.id, fx.agent.id));
  if (!agent) throw new Error("no agent");
  return { machineId, a, b, agent };
}

test("off: the agent's own account, at its limit or not", async () => {
  f = await setup();
  const { machineId, a, agent } = await twoAccounts(f);
  notePlanLimit(machineId, "antigravity", undefined, Date.now(), a);
  expect((await brainAccountFor(f.db, agent, "antigravity", machineId))?.id).toBe(a);
});

test("on: the owner's other account while the agent's own is at its limit, and its own again after", async () => {
  f = await setup();
  enableAccountStandIns();
  const { machineId, a, b, agent } = await twoAccounts(f);
  expect((await brainAccountFor(f.db, agent, "antigravity", machineId))?.id).toBe(a);

  notePlanLimit(machineId, "antigravity", undefined, Date.now(), a);
  expect(await brainAccountFor(f.db, agent, "antigravity", machineId)).toEqual({
    id: b,
    label: "Gemini 2",
    status: "active",
    standsInFor: { id: a, label: "Gemini" },
  });

  // Both full: it waits on its own.
  notePlanLimit(machineId, "antigravity", undefined, Date.now(), b);
  expect((await brainAccountFor(f.db, agent, "antigravity", machineId))?.id).toBe(a);

  clearPlanLimits();
  expect((await brainAccountFor(f.db, agent, "antigravity", machineId))?.id).toBe(a);
});

test("never another person's account, another plan's, a signed-out one, or where each agent is its own user", async () => {
  f = await setup();
  enableAccountStandIns();
  const bruna = await addMember(f.db, f.org.id, "member", "Bruna");
  const { machineId, a, b, agent } = await twoAccounts(f, { createdBy: bruna.id });
  notePlanLimit(machineId, "antigravity", undefined, Date.now(), a);
  const own = async () => (await brainAccountFor(f.db, agent, "antigravity", machineId))?.id;
  const second = (set: Partial<typeof schema.machineAccounts.$inferInsert>) =>
    f.db.update(schema.machineAccounts).set(set).where(eq(schema.machineAccounts.id, b));
  expect(await own()).toBe(a);

  await second({ createdBy: f.owner.id, provider: "enterprise" });
  expect(await own()).toBe(a);

  await second({ provider: null, status: "signed_out" });
  expect(await own()).toBe(a);

  await second({ status: "active", serves: "owner" });
  expect(await own()).toBe(a);

  await second({ serves: "everyone" });
  expect(await own()).toBe(b);

  const [m] = await f.db.select().from(schema.machines).where(eq(schema.machines.id, machineId));
  await f.db
    .update(schema.machines)
    .set({ executors: { ...m?.executors, mode: "system" } })
    .where(eq(schema.machines.id, machineId));
  expect(await own()).toBe(a);
});

function scripted(script: (n: number) => BrainEvent[]) {
  const seen: BrainTurn[] = [];
  const brain: Brain = {
    kind: "antigravity",
    async *run(turn) {
      const n = seen.length;
      seen.push({ ...turn, system: "", messages: [] });
      yield* script(n);
    },
  };
  return { brain, seen };
}

const drive = async (fx: Fixture, brain: Brain) => {
  const handlers = createJobHandlers({
    ...fx.jobDeps,
    brains: { antigravity: () => brain },
    machines: { status: async (id) => statusOf(id) },
    planLimitGraceMs: 50,
  });
  await postPersonMessage({ db: fx.db, pubsub: fx.pubsub }, fx.owner.id, fx.org.id, fx.general.id, {
    body: "@dev faz o deploy",
  });
  await drainOutbox(fx.db, handlers);
  const [run] = await fx.db.select().from(schema.agentRuns);
  const notes = (await listMessages(fx.db, fx.owner.id, fx.org.id, fx.general.id, {})).filter((m) =>
    String(m.meta.bodyCode ?? "").startsWith("plan_limit"),
  );
  return { run, notes };
};

test("a turn the plan refuses goes again at once on the other account, with no wait and no note", async () => {
  f = await setup({ reply: () => ({ chunks: ["pela API"] }) });
  enableAccountStandIns();
  const { a, b } = await twoAccounts(f);
  const { brain, seen } = scripted((n) =>
    n === 0
      ? [{ type: "error", code: "plan_limit", message: "Weekly limit reached", worked: false }]
      : [{ type: "done", text: "Pronto." }],
  );
  const { run, notes } = await drive(f, brain);
  expect(seen.map((t) => t.account?.id)).toEqual([a, b]);
  expect(run?.status).toBe("done");
  expect(notes).toHaveLength(0);
  expect(f.provider.calls).toHaveLength(0);
});

test("a turn cut after it worked goes on there too, told what it already did", async () => {
  f = await setup({ reply: () => ({ chunks: ["pela API"] }) });
  enableAccountStandIns();
  const { a, b } = await twoAccounts(f);
  const { brain, seen } = scripted((n) =>
    n === 0
      ? [
          { type: "tool_call", id: "t1", name: "Bash", input: { command: "git push" }, executed: { content: "ok" } },
          { type: "error", code: "plan_limit", message: "Weekly limit reached", worked: true },
        ]
      : [{ type: "done", text: "Terminei." }],
  );
  const { run, notes } = await drive(f, brain);
  expect(seen.map((t) => t.account?.id)).toEqual([a, b]);
  expect(seen[1]?.trigger).toContain("Bash (git push)");
  expect(run?.status).toBe("done");
  expect(notes).toHaveLength(0);
});

test("off: the same refusal waits for the plan, as before", async () => {
  f = await setup({ reply: () => ({ chunks: ["pela API"] }) });
  const { a } = await twoAccounts(f);
  await f.db.update(schema.agents).set({ brainFallback: false }).where(eq(schema.agents.id, f.agent.id));
  const { brain, seen } = scripted(() => [
    { type: "error", code: "plan_limit", message: "Weekly limit reached", worked: false },
  ]);
  const { run } = await drive(f, brain);
  expect(seen.map((t) => t.account?.id)).toEqual([a]);
  expect(run?.status).toBe("waiting_input");
});
