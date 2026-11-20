import { afterEach, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import path from "node:path";
import { type BrainTurnRequest, parseBrainEvent, type WireBrainEvent } from "@dougbot/adapters/machine-protocol";
import { BrainManager, type BrainManagerOptions, ClaudeStreamParser } from "../../runner/brain";
import {
  CLAUDE_SILENCE,
  type ClaudeSilence,
  silenceLimit,
  stalledAgainMessage,
  stallLabel,
  stallNote,
  stallWords,
} from "../../runner/brain-silence";
import { McpBridge } from "../../runner/mcp";
import { agentWorkspace } from "../../runner/paths";
import { removeDirs, tempDir } from "./helpers";

const dirs: string[] = [];
const managers: BrainManager[] = [];
afterEach(() => {
  for (const m of managers.splice(0)) m.close();
  removeDirs(dirs);
});

const posix = process.platform !== "win32";
const AGENT = { id: "0193aaaa-bbbb-7ccc-8ddd-eeeeffff0000", handle: "dev" };
const SESSION = "0193aaaa-0000-7000-8000-000000000001";
const RUN = (n: number) => `0193bbbb-0000-7000-8000-${String(n).padStart(12, "0")}`;
const FAKE = path.join(import.meta.dir, "fake-claude.mjs");
const line = (o: unknown) => JSON.stringify(o);

/** Short limits: a quiet model or tool stalls in a few hundred milliseconds. */
const QUICK: ClaudeSilence = {
  modelMs: 300,
  compactingMs: 3000,
  toolMs: 300,
  commandGraceMs: 100,
  subagentMs: 3000,
  checkMs: 25,
};

// ── The limits ───────────────────────────────────────────────────────────────

const tool = (name: string, input: unknown = {}) => ({ name, input, since: 0 });

test("silence: the model's answer, a compaction, its own tools and a command by its own timeout each have a limit", () => {
  const at = (s: Parameters<typeof silenceLimit>[0]) => silenceLimit(s, CLAUDE_SILENCE);
  expect(at({ tools: [], compacting: false, bridgeCalls: 0 })).toEqual({ phase: "model", ms: 6 * 60_000 });
  expect(at({ tools: [], compacting: true, bridgeCalls: 0 })).toEqual({ phase: "compacting", ms: 15 * 60_000 });
  expect(at({ tools: [tool("Edit", { file_path: "a.ts" })], compacting: false, bridgeCalls: 0 })).toMatchObject({
    phase: "tool",
    ms: 6 * 60_000,
    tool: { name: "Edit" },
  });
  // A command: its own timeout (else the CLI's default, 2 min, or what its env sets) plus 3 min.
  expect(at({ tools: [tool("Bash", { command: "make" })], compacting: false, bridgeCalls: 0 })?.ms).toBe(5 * 60_000);
  expect(
    at({ tools: [tool("Bash", { command: "make", timeout: 600_000 })], compacting: false, bridgeCalls: 0 })?.ms,
  ).toBe(13 * 60_000);
  expect(at({ tools: [tool("Bash")], compacting: false, bridgeCalls: 0, bashDefaultMs: 60_000 })?.ms).toBe(4 * 60_000);
  // Sent to the background it answers at once; a subagent prints its own steps.
  expect(at({ tools: [tool("Bash", { run_in_background: true })], compacting: false, bridgeCalls: 0 })?.ms).toBe(
    6 * 60_000,
  );
  expect(at({ tools: [tool("Task")], compacting: false, bridgeCalls: 0 })?.ms).toBe(20 * 60_000);
  // Several at once: the one that may run longest decides.
  expect(
    at({ tools: [tool("Read"), tool("Bash", { timeout: 300_000 })], compacting: false, bridgeCalls: 0 }),
  ).toMatchObject({ ms: 8 * 60_000, tool: { name: "Bash" } });
});

test("silence: nothing is timed while a call of ours runs, or the model called an MCP server's tool", () => {
  const at = (s: Parameters<typeof silenceLimit>[0]) => silenceLimit(s, CLAUDE_SILENCE);
  expect(at({ tools: [], compacting: false, bridgeCalls: 1 })).toBeNull();
  expect(at({ tools: [tool("Bash")], compacting: false, bridgeCalls: 1 })).toBeNull();
  expect(at({ tools: [tool("mcp__agentes__browser_do")], compacting: false, bridgeCalls: 0 })).toBeNull();
  expect(at({ tools: [tool("Read"), tool("mcp__github__list_issues")], compacting: false, bridgeCalls: 0 })).toBeNull();
});

test("silence: a stalled call in one line, and the words for the log, the model and the conversation", () => {
  expect(stallLabel(tool("Bash", { command: "  npm run build -- --mode production\necho done" }))).toBe(
    "Bash (npm run build -- --mode production)",
  );
  expect(stallLabel(tool("Edit", { file_path: "src/app.ts" }))).toBe("Edit (src/app.ts)");
  expect(stallLabel(tool("Grep", { pattern: "TODO" }))).toBe("Grep (TODO)");
  expect(stallLabel(tool("ToolSearch"))).toBe("ToolSearch");
  expect(stallLabel(tool("Bash", { command: "x".repeat(300) }))).toHaveLength("Bash ()".length + 120);
  const inTool = { phase: "tool" as const, tool: "Bash", label: "Bash (make test)", silentMs: 6 * 60_000 + 20_000 };
  expect(stallWords(inTool)).toBe("6 minutes while it ran Bash (make test)");
  expect(stallWords({ phase: "model", silentMs: 40_000 })).toBe("1 minute while it waited for the model's answer");
  expect(stallNote(inTool)).toContain("stopped responding (nothing came from it for 6 minutes while it ran Bash");
  expect(stallNote(inTool)).toContain("Check what is already done before repeating anything");
  // The conversation reads the tool, never what it ran on.
  expect(stalledAgainMessage(inTool)).toBe("it stopped responding twice: nothing for 6 minutes while it ran Bash");
});

test("parser: calls in flight until their result, a compaction while the CLI says so, a retry's announced wait", () => {
  const p = new ClaudeStreamParser();
  p.beginTurn();
  p.push(
    line({
      type: "assistant",
      message: { content: [{ type: "tool_use", id: "b1", name: "Bash", input: { command: "make" } }] },
      parent_tool_use_id: null,
    }),
  );
  expect(p.inFlight()).toEqual([{ name: "Bash", input: { command: "make" }, since: expect.any(Number) }]);
  p.push(
    line({
      type: "user",
      message: { content: [{ type: "tool_result", tool_use_id: "b1", content: "ok" }] },
      parent_tool_use_id: null,
    }),
  );
  expect(p.inFlight()).toEqual([]);
  p.push(line({ type: "system", subtype: "status", status: "compacting", parent_tool_use_id: null }));
  expect(p.compacting).toBe(true);
  p.push(line({ type: "system", subtype: "compact_boundary", parent_tool_use_id: null }));
  expect(p.compacting).toBe(false);
  expect(p.push(line({ type: "system", subtype: "api_retry", retry_delay_ms: 4000, error: "overloaded" }))).toEqual({
    events: [],
    retryInMs: 4000,
  });
});

test("protocol: a stalled event travels with where it was; an unknown phase is dropped", () => {
  expect(
    parseBrainEvent({ type: "stalled", phase: "tool", tool: "Bash", label: "Bash (make)", silentMs: 12.6, resumed: 1 }),
  ).toEqual({ type: "stalled", phase: "tool", tool: "Bash", label: "Bash (make)", silentMs: 13, resumed: false });
  expect(parseBrainEvent({ type: "stalled", phase: "sleeping", silentMs: 5, resumed: true })).toBeNull();
});

// ── Turns on the fake CLI ────────────────────────────────────────────────────

function setup(over: Partial<BrainManagerOptions> = {}) {
  const ws = tempDir("silence-ws-");
  const home = tempDir("silence-home-");
  dirs.push(ws, home);
  const logFile = path.join(home, "spawns.log");
  process.env.FAKE_CLAUDE_LOG = logFile;
  const m = new BrainManager({
    root: path.join(home, "brains"),
    claudeCommand: [process.execPath, FAKE],
    claudeHome: path.join(home, "no-claude-home"),
    mcp: { socketPath: path.join(home, "mcp.sock"), command: ["node", "runner.mjs"] },
    deltaMs: 5,
    silence: QUICK,
    ...over,
  });
  managers.push(m);
  const spawns = () => {
    try {
      return readFileSync(logFile, "utf8")
        .trim()
        .split("\n")
        .filter(Boolean)
        .map((l) => JSON.parse(l) as { args: string[] });
    } catch {
      return [];
    }
  };
  const turn = async (n: number, prompt: string, extra: Partial<BrainTurnRequest> = {}) => {
    const folder = await agentWorkspace(ws, AGENT);
    const events: WireBrainEvent[] = [];
    const final = await m.turn(
      {
        runId: RUN(n),
        kind: "claude_code",
        session: { id: SESSION, resume: false },
        cwd: "",
        system: "You are dev.",
        prompt,
        mcp: { token: `agr_${"t".repeat(24)}${n}` },
        ...extra,
      },
      { agent: AGENT, folder, emit: (e) => events.push(e) },
    );
    return { final, events };
  };
  return { m, spawns, turn };
}

const stalls = (events: WireBrainEvent[]) => events.filter((e) => e.type === "stalled");

test.if(posix)(
  "a turn quiet while it waits for the model: stopped, then the same turn on the resumed session, told why",
  async () => {
    const { m, spawns, turn } = setup();
    const r = await turn(1, "HANGMODEL please");
    expect(stalls(r.events)).toEqual([
      { type: "stalled", phase: "model", silentMs: expect.any(Number), resumed: true },
    ]);
    const silent = stalls(r.events)[0];
    expect(silent?.type === "stalled" && silent.silentMs).toBeGreaterThanOrEqual(QUICK.modelMs);
    // The resumed process read the note first, then the same request.
    expect(r.final).toMatchObject({ type: "done" });
    const text = r.final.type === "done" ? r.final.text : "";
    expect(text).toContain("Your previous attempt at this request stopped responding");
    expect(text).toContain("while it waited for the model's answer");
    expect(text).toContain("HANGMODEL please");
    const all = spawns();
    expect(all).toHaveLength(2);
    expect(all[1]?.args.slice(-2)).toEqual(["--resume", SESSION]);
    expect(m.size).toBe(0);
  },
);

test.if(posix)("a command that outlives its own timeout: the turn says which, and goes on resumed", async () => {
  const { turn } = setup();
  const r = await turn(1, "HANGTOOL please");
  expect(stalls(r.events)).toEqual([
    {
      type: "stalled",
      phase: "tool",
      tool: "Bash",
      label: "Bash (sleep 999)",
      silentMs: expect.any(Number),
      resumed: true,
    },
  ]);
  const silent = stalls(r.events)[0];
  // Its 50 ms timeout plus the grace, not the model's limit.
  expect(silent?.type === "stalled" && silent.silentMs).toBeGreaterThanOrEqual(50 + QUICK.commandGraceMs);
  expect(silent?.type === "stalled" && silent.silentMs).toBeLessThan(QUICK.modelMs);
  expect(r.final).toMatchObject({ type: "done" });
  expect(r.final.type === "done" && r.final.text).toContain("while it ran Bash (sleep 999)");
});

test.if(posix)("quiet again on the resumed session: the turn ends as brain_stalled", async () => {
  const { spawns, turn } = setup();
  const r = await turn(1, "HANGEVER please");
  expect(stalls(r.events).map((e) => e.type === "stalled" && e.resumed)).toEqual([true, false]);
  expect(r.final).toEqual({
    type: "error",
    code: "brain_stalled",
    message: "it stopped responding twice: nothing for 1 minute",
    retryable: false,
  });
  expect(spawns()).toHaveLength(2);
});

test.if(posix)(
  "a long call of ours, a retry the CLI announced and a call the bridge relays are no silence",
  async () => {
    const { m, spawns, turn } = setup();
    for (const [n, prompt] of [
      [1, "OURTOOLWAIT please"],
      [2, "RETRYWAIT please"],
    ] as const) {
      const r = await turn(n, prompt);
      expect(stalls(r.events)).toEqual([]);
      expect(r.final).toMatchObject({ type: "done" });
    }
    // Quiet longer than the model's limit while the bridge relays a call of the process (a permission prompt).
    const pending = turn(3, "QUIETWAIT please");
    // The process's bridge id is its folder's name, where its MCP config lives.
    const args = spawns()[0]?.args ?? [];
    const id = path.basename(path.dirname(args[args.indexOf("--mcp-config") + 1] ?? ""));
    expect(id).not.toBe("");
    m.bridgeCall(id, 1);
    const r = await pending;
    m.bridgeCall(id, -1);
    expect(stalls(r.events)).toEqual([]);
    expect(r.final).toMatchObject({ type: "done", text: "echo 3: QUIETWAIT please" });
    expect(spawns()).toHaveLength(1);
  },
);

test("the bridge says when it relays a call of a process, and when its answer came", async () => {
  const home = tempDir("silence-bridge-");
  dirs.push(home);
  const calls: string[] = [];
  const bridge = new McpBridge({
    socketPath: path.join(home, "mcp.sock"),
    task: () => ({ token: "tok", missionId: "", running: true, runId: RUN(1), serverToken: `agr_${"t".repeat(25)}` }),
    onCall: (taskId, delta) => calls.push(`${taskId}:${delta}`),
  });
  bridge.attach((frame) => {
    if (frame.type === "mcp.call") {
      expect(calls).toEqual(["p1:1"]);
      setTimeout(() => bridge.result({ type: "mcp.result", callId: frame.callId, ok: true, text: "ok" }), 10);
    }
  });
  const reply = await bridge.handle({ kind: "call", taskId: "p1", token: "tok", tool: "search_context", args: {} });
  expect(reply).toMatchObject({ ok: true, text: "ok" });
  expect(calls).toEqual(["p1:1", "p1:-1"]);
});
