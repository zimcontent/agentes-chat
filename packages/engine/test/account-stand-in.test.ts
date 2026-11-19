import { afterEach, expect, test } from "bun:test";
import { MACHINE_PROTOCOL_VERSION } from "@dougbot/adapters";
import { eq, schema } from "@dougbot/db";
import {
  type Brain,
  type BrainEvent,
  type BrainTurn,
  brainAccountFor,
  chainStandIn,
  clearPlanLimits,
  clearUnlocked,
  createJobHandlers,
  drainOutbox,
  enableAccountStandIns,
  listMessages,
  type MachineStatus,
  notePlanLimit,
  postPersonMessage,
  setStandInOrder,
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
  clearUnlocked();
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

/** A stored reading of `used` percent on the week's window, read now. */
/** A stored reading of `used` percent on the week's window, read now. */
const reading = (used: number) => ({
  windows: [
    { kind: "seven_day" as const, usedPercent: used, resetsAt: new Date(Date.now() + 86_400_000).toISOString() },
  ],
  source: "probe" as const,
  at: new Date().toISOString(),
});

test("on: at 90% of a window the other account thinks, before any limit or pause", async () => {
  f = await setup();
  enableAccountStandIns();
  const { machineId, a, b, agent } = await twoAccounts(f);
  const set = (id: string, used: number) =>
    f.db
      .update(schema.machineAccounts)
      .set({ usage: reading(used) })
      .where(eq(schema.machineAccounts.id, id));
  const thinks = async () => (await brainAccountFor(f.db, agent, "antigravity", machineId))?.id;

  await set(a, 89);
  expect(await thinks()).toBe(a);
  await set(a, 90);
  await set(b, 20);
  expect(await thinks()).toBe(b);

  // Both past the line, neither at its limit: its own goes on.
  await set(b, 93);
  expect(await thinks()).toBe(a);

  // Its own at its very limit: the other one still has room, so it thinks.
  notePlanLimit(machineId, "antigravity", undefined, Date.now(), a);
  expect(await thinks()).toBe(b);
});

/**
 * Dev on Claude Code with the owner's second Claude account, beside their first one, a ChatGPT and a Gemini account on
 * the same computer.
 */
async function chain(fx: Fixture) {
  const deps = { db: fx.db, pubsub: fx.pubsub, publicUrl: "https://agentes.chat" };
  const { machineId } = await pairMachine(deps, fx.owner.id, fx.org.id, { name: "Box", ...RUNNER, exec: true });
  const ids = {
    claude: crypto.randomUUID(),
    claude2: crypto.randomUUID(),
    gpt: crypto.randomUUID(),
    gemini: crypto.randomUUID(),
  };
  const row = { orgId: fx.org.id, machineId, createdBy: fx.owner.id, serves: "everyone" as const };
  await fx.db.insert(schema.machineAccounts).values([
    { ...row, id: ids.claude, kind: "claude_code", label: "Claude", createdAt: new Date(1000) },
    { ...row, id: ids.claude2, kind: "claude_code", label: "Claude 2", createdAt: new Date(2000) },
    { ...row, id: ids.gpt, kind: "codex", label: "ChatGPT", createdAt: new Date(3000) },
    { ...row, id: ids.gemini, kind: "antigravity", label: "Gemini", createdAt: new Date(4000) },
  ]);
  await fx.db
    .update(schema.agents)
    .set({ machineId, brain: "claude_code", brainModel: "opus", brainAccountId: ids.claude2 })
    .where(eq(schema.agents.id, fx.agent.id));
  const [agent] = await fx.db.select().from(schema.agents).where(eq(schema.agents.id, fx.agent.id));
  if (!agent) throw new Error("no agent");
  const set = (id: string, used: number) =>
    fx.db
      .update(schema.machineAccounts)
      .set({ usage: reading(used) })
      .where(eq(schema.machineAccounts.id, id));
  return { machineId, ids, agent, set };
}

test("the owner's order: Claude, Claude 2, Gemini, past 90% each, with no server switch", async () => {
  f = await setup();
  const { machineId, ids, agent, set } = await chain(f);
  const next = async () => {
    const account = await brainAccountFor(f.db, agent, "claude_code", machineId);
    const other = await chainStandIn(f.db, f.org.id, "claude_code", machineId, account);
    return other ? `${other.kind}:${other.model ?? ""}:${other.account.id}` : `own:${account?.id}`;
  };

  // No order: its own, even at 99%.
  await set(ids.claude2, 99);
  expect(await next()).toBe(`own:${ids.claude2}`);

  await setStandInOrder(f, f.owner.id, f.org.id, [ids.claude, ids.claude2, ids.gemini]);
  expect(await next()).toBe(`claude_code::${ids.claude}`);
  const first = await chainStandIn(
    f.db,
    f.org.id,
    "claude_code",
    machineId,
    await brainAccountFor(f.db, agent, "claude_code", machineId),
  );
  expect(first?.account.standsInFor).toEqual({ id: ids.claude2, label: "Claude 2" });

  // ChatGPT isn't in the order: Gemini's Hydrogen after both Claudes.
  await set(ids.claude, 95);
  expect(await next()).toBe(`antigravity:gemini-4-hydrogen-medium:${ids.gemini}`);

  // All past the line: its own goes on (and the API key after its limit).
  await set(ids.gemini, 90);
  expect(await next()).toBe(`own:${ids.claude2}`);

  // A window reset: Claude 2 under the line thinks again by itself.
  await set(ids.claude2, 10);
  expect(await next()).toBe(`own:${ids.claude2}`);
});

test("an order holds only the caller's own accounts", async () => {
  f = await setup();
  const { ids } = await chain(f);
  const bruna = await addMember(f.db, f.org.id, "member", "Bruna");
  await expect(setStandInOrder(f, bruna.id, f.org.id, [ids.claude])).rejects.toThrow();
  await expect(setStandInOrder(f, f.owner.id, f.org.id, [ids.claude, ids.claude])).rejects.toThrow();
  expect(await setStandInOrder(f, f.owner.id, f.org.id, [ids.gpt])).toEqual({ accountIds: [ids.gpt] });
  await setStandInOrder(f, f.owner.id, f.org.id, []);
  const ranks = await f.db.select({ rank: schema.machineAccounts.standInRank }).from(schema.machineAccounts);
  expect(ranks.every((r) => r.rank === null)).toBe(true);
});

test("a run whose Claude accounts are past 90% thinks on ChatGPT's GPT-6.1, its brain recorded", async () => {
  f = await setup({ reply: () => ({ chunks: ["pela API"] }) });
  const { ids, set } = await chain(f);
  await setStandInOrder(f, f.owner.id, f.org.id, [ids.claude, ids.gpt, ids.gemini]);
  await set(ids.claude, 96);
  await set(ids.claude2, 99);
  const seen: BrainTurn[] = [];
  const codex: Brain = {
    kind: "codex",
    async *run(turn) {
      seen.push({ ...turn, system: "", messages: [] });
      yield { type: "done", text: "Pronto pelo GPT." };
    },
  };
  const claude: Brain = {
    kind: "claude_code",
    // biome-ignore lint/correctness/useYield: it must never be asked
    async *run() {
      throw new Error("Claude must not think");
    },
  };
  const handlers = createJobHandlers({
    ...f.jobDeps,
    brains: { codex: () => codex, claude_code: () => claude },
    machines: {
      status: async (id) => ({
        ...statusOf(id),
        executors: { codex: { version: "9.9.9" }, detectedAt: new Date().toISOString() },
      }),
    },
  });
  await postPersonMessage({ db: f.db, pubsub: f.pubsub }, f.owner.id, f.org.id, f.general.id, {
    body: "@dev publica o post",
  });
  await drainOutbox(f.db, handlers);
  const [run] = await f.db.select().from(schema.agentRuns);
  expect(seen.map((t) => [t.account?.id, t.model])).toEqual([[ids.gpt, "gpt-6.1-sol"]]);
  expect(run?.brain).toBe("codex");
  expect(run?.status).toBe("done");
  expect(f.provider.calls).toHaveLength(0);
});

/**
 * Addendum 2026-11-15: the right hand in a group thinks with the workspace's account, and at its limit the next one of
 * its owner's order thinks, as for any agent, but only an account that may answer the person who asked.
 */
async function rightHandAtLimit(serves: "everyone" | "owner") {
  f = await setup({ reply: () => ({ chunks: ["pela API"] }) });
  const { ids, set } = await chain(f);
  await f.db.update(schema.agents).set({ builtin: "right_hand" }).where(eq(schema.agents.id, f.agent.id));
  await f.db.update(schema.machineAccounts).set({ serves }).where(eq(schema.machineAccounts.id, ids.claude));
  await setStandInOrder(f, f.owner.id, f.org.id, [ids.claude2, ids.claude]);
  await set(ids.claude2, 100);
  await set(ids.claude, 40);
  const seen: BrainTurn[] = [];
  const claude: Brain = {
    kind: "claude_code",
    async *run(turn) {
      seen.push({ ...turn, system: "", messages: [] });
      yield { type: "done", text: "Pronto." };
    },
  };
  const handlers = createJobHandlers({
    ...f.jobDeps,
    brains: { claude_code: () => claude },
    machines: {
      status: async (id) => ({
        ...statusOf(id),
        executors: { claude: { version: "9.9.9", loggedIn: true }, detectedAt: new Date().toISOString() },
      }),
    },
  });
  const bruna = await addMember(f.db, f.org.id, "member", "Bruna");
  await f.db
    .insert(schema.channelMembers)
    .values({ orgId: f.org.id, channelId: f.general.id, userId: bruna.id })
    .onConflictDoNothing();
  await postPersonMessage({ db: f.db, pubsub: f.pubsub }, bruna.id, f.org.id, f.general.id, {
    body: `@${f.agent.handle} vê o Trello`,
  });
  await drainOutbox(f.db, handlers);
  const [run] = await f.db.select().from(schema.agentRuns);
  return { ids, seen, run };
}

test("the right hand in a group goes on the owner's next account when its own is at its limit", async () => {
  const { ids, seen, run } = await rightHandAtLimit("everyone");
  expect(seen.map((t) => t.account?.id)).toEqual([ids.claude]);
  expect(run?.status).toBe("done");
});

test("the right hand never stands in on an account kept to its owner for someone else", async () => {
  const { seen, run } = await rightHandAtLimit("owner");
  expect(seen).toHaveLength(0);
  expect(run?.status).not.toBe("done");
});

/**
 * Addendum 2026-11-17: a CLI that doesn't keep the right hand to our tools never stands in for it. On 2026-11-17 Doug's
 * Claude passed 90%, the order's next was Gemini, and every one of its turns stopped with "não ficou só nas
 * ferramentas do DougBot" while Claude 2 had room.
 */
async function rightHandOrder(order: (ids: Awaited<ReturnType<typeof chain>>["ids"]) => string[], brains: Brain[]) {
  f = await setup({ reply: () => ({ chunks: ["pela API"] }) });
  const { ids, set, machineId, agent } = await chain(f);
  await f.db.update(schema.agents).set({ builtin: "right_hand" }).where(eq(schema.agents.id, f.agent.id));
  await setStandInOrder(f, f.owner.id, f.org.id, order(ids));
  await set(ids.claude2, 91);
  await set(ids.gemini, 9);
  await set(ids.gpt, 5);
  await set(ids.claude, 2);
  const handlers = createJobHandlers({
    ...f.jobDeps,
    brains: Object.fromEntries(brains.map((b) => [b.kind, () => b])),
    machines: {
      status: async (id) => ({
        ...statusOf(id),
        executors: {
          claude: { version: "9.9.9", loggedIn: true },
          codex: { version: "9.9.9" },
          antigravity: { version: "1.5.10" },
          detectedAt: new Date().toISOString(),
        },
      }),
    },
  });
  await postPersonMessage({ db: f.db, pubsub: f.pubsub }, f.owner.id, f.org.id, f.general.id, {
    body: `@${f.agent.handle} o que o Ronny fez essa semana?`,
  });
  await drainOutbox(f.db, handlers);
  const [run] = await f.db.select().from(schema.agentRuns);
  return { ids, run, machineId, agent: { ...agent, builtin: "right_hand" } };
}

const answering = (kind: Brain["kind"], seen: (string | undefined)[]): Brain => ({
  kind,
  async *run(turn) {
    seen.push(turn.account?.id);
    yield { type: "done", text: "O Ronny fechou os três reels." };
  },
});

test("the right hand skips Gemini in its order and thinks on the next Claude", async () => {
  const seen: (string | undefined)[] = [];
  const gemini: Brain = {
    kind: "antigravity",
    // biome-ignore lint/correctness/useYield: it must never be asked
    async *run() {
      throw new Error("Gemini must not think for the right hand");
    },
  };
  const { ids, run, machineId, agent } = await rightHandOrder(
    (ids) => [ids.claude2, ids.gemini, ids.claude],
    [answering("claude_code", seen), gemini],
  );
  expect(seen).toEqual([ids.claude]);
  expect(run?.brain).toBe("claude_code");
  expect(run?.status).toBe("done");
  const account = await brainAccountFor(f.db, agent, "claude_code", machineId);
  const next = await chainStandIn(f.db, f.org.id, "claude_code", machineId, account, Date.now(), {
    person: f.owner.id,
  });
  expect(next?.account.id).toBe(ids.claude);
  // Any other agent keeps the owner's order as it is: Gemini next.
  const other = await chainStandIn(f.db, f.org.id, "claude_code", machineId, account);
  expect(other?.account.id).toBe(ids.gemini);
});

test("a CLI that broke the lock in the turn: the same run goes on with the next account, and it stands in no more", async () => {
  const seen: (string | undefined)[] = [];
  const tried: (string | undefined)[] = [];
  const codex: Brain = {
    kind: "codex",
    async *run(turn) {
      tried.push(turn.account?.id);
      yield { type: "error", code: "tools_not_locked", message: "Codex offers tools of its own", retryable: false };
    },
  };
  const { ids, run, machineId, agent } = await rightHandOrder(
    (ids) => [ids.claude2, ids.gpt, ids.claude],
    [answering("claude_code", seen), codex],
  );
  expect(tried).toEqual([ids.gpt]);
  expect(seen).toEqual([ids.claude]);
  expect(run?.brain).toBe("claude_code");
  expect(run?.status).toBe("done");
  const said = await f.db
    .select()
    .from(schema.messages)
    .where(eq(schema.messages.agentRunId, run?.id ?? ""));
  expect(said.some((m) => m.meta.bodyCode === "no_ai")).toBe(false);
  const account = await brainAccountFor(f.db, agent, "claude_code", machineId);
  const next = await chainStandIn(f.db, f.org.id, "claude_code", machineId, account, Date.now(), {
    person: f.owner.id,
  });
  expect(next?.account.id).toBe(ids.claude);
});
