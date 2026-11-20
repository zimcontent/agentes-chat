import { afterEach, expect, test } from "bun:test";
import { MACHINE_PROTOCOL_VERSION } from "@dougbot/adapters";
import { asc, eq, schema } from "@dougbot/db";
import {
  type Brain,
  createJobHandlers,
  drainOutbox,
  type MachineStatus,
  operatorRunTrace,
  postPersonMessage,
} from "../src";
import { type Fixture, SECRET, setup } from "./fixtures";
import { pairMachine } from "./machine-fixtures";

/**
 * A computer brain's own calls and its stalls on the run's trail: each call it ran itself as a `computerTool` step
 * (name, how long, whether it failed; nothing that reads tool steps counts it), and the computer stopping its CLI for
 * its silence as a `brain_stalled` error step, both read by the operator's trace.
 */

let f: Fixture;
afterEach(() => f?.close());

const onComputer = async (brain: Brain) => {
  f = await setup({ contextTools: true });
  const deps = { db: f.db, pubsub: f.pubsub, publicUrl: "https://agentes.chat" };
  const paired = await pairMachine(deps, f.owner.id, f.org.id, {
    name: "MacBook",
    hostname: "mac",
    os: "darwin",
    arch: "arm64",
    version: "0.8.0",
    protocol: MACHINE_PROTOCOL_VERSION,
    workspace: "/Users/w/agentes",
    exec: true,
  });
  await f.db
    .update(schema.agents)
    .set({ machineId: paired.machineId, brain: "claude_code" })
    .where(eq(schema.agents.id, f.agent.id));
  return createJobHandlers({
    ...f.jobDeps,
    brains: { claude_code: () => brain },
    machines: {
      status: async (id): Promise<MachineStatus> => ({
        id,
        orgId: f.org.id,
        name: "MacBook",
        online: true,
        execAllowed: true,
        os: "darwin",
        protocol: 8,
        executors: { claude: { version: "2.1.300", loggedIn: true }, detectedAt: new Date().toISOString() },
      }),
    },
  });
};

test("its own calls and a stall the computer recovered from are kept on the trail; ours are the bridge's", async () => {
  const brain: Brain = {
    kind: "claude_code",
    async *run(_turn, io) {
      yield { type: "tool_started", id: "b1", name: "Bash" };
      await new Promise((r) => setTimeout(r, 30));
      yield {
        type: "tool_call",
        id: "b1",
        name: "Bash",
        input: { command: "npm run build -- --mode production" },
        executed: { content: "exit 1", isError: true },
      };
      // The computer stopped its quiet CLI and sent the turn again on the resumed session.
      yield {
        type: "stalled",
        phase: "tool",
        tool: "Bash",
        label: "Bash (npm run build -- --mode production)",
        silentMs: 420_000,
        resumed: true,
      };
      const input = { query: "release notes" };
      const result = await io.executeTool({ id: "s1", name: "search_context", input });
      yield { type: "tool_call", id: "s1", name: "search_context", input, executed: result };
      // A brain that tells its call only once it ended: no time of its own.
      yield {
        type: "tool_call",
        id: "w1",
        name: "Write",
        input: { file_path: "notes.md" },
        executed: { content: "ok" },
      };
      yield { type: "text_delta", text: "Notas da versão prontas." };
      yield { type: "done", text: "Notas da versão prontas." };
    },
  };
  const handlers = await onComputer(brain);
  await postPersonMessage({ db: f.db, pubsub: f.pubsub }, f.owner.id, f.org.id, f.general.id, {
    body: "@dev prepara as notas da versão?",
  });
  await drainOutbox(f.db, handlers);

  const [run] = await f.db.select().from(schema.agentRuns);
  if (!run) throw new Error("no run");
  expect(run.status).toBe("done");
  const steps = await f.db
    .select()
    .from(schema.agentRunSteps)
    .where(eq(schema.agentRunSteps.runId, run.id))
    .orderBy(asc(schema.agentRunSteps.seq));
  const own = steps.filter((s) => s.kind === "context" && s.data.computerTool).map((s) => s.data.computerTool);
  expect(own).toEqual([
    { id: "b1", name: "Bash", ms: expect.any(Number), isError: true },
    { id: "w1", name: "Write", ms: null },
  ]);
  expect((own[0] as { ms: number }).ms).toBeGreaterThanOrEqual(25);
  // What it ran on and what came back stay off the trail; ours are the bridge's tool steps, not kept twice.
  expect(JSON.stringify(own)).not.toContain("npm run build");
  expect(own.some((c) => (c as { name: string }).name === "search_context")).toBe(false);
  const stalled = steps.filter((s) => s.kind === "error" && s.data.reason === "brain_stalled");
  expect(stalled.map((s) => s.data)).toEqual([
    {
      reason: "brain_stalled",
      code: "tool",
      tool: "Bash",
      label: "Bash (npm run build -- --mode production)",
      silentMs: 420_000,
      resumed: true,
    },
  ]);

  // The operator reads which tool, how long and whether it failed; never what it ran on.
  const trail = (await operatorRunTrace(f.db, run.id, { limit: 200, secret: SECRET }))?.steps ?? [];
  const kept = trail.filter((s) => s.records.includes("computerTool"));
  expect(kept.map(({ tool, isError, durationMs }) => ({ tool, isError, durationMs }))).toEqual([
    { tool: "Bash", isError: true, durationMs: expect.any(Number) },
    { tool: "Write", isError: false, durationMs: null },
  ]);
  const stall = trail.find((s) => s.kind === "error" && s.reason === "brain_stalled");
  expect(stall).toMatchObject({ code: "tool", tool: "Bash", durationMs: 420_000 });
  expect(JSON.stringify(trail)).not.toContain("npm run build");
});
