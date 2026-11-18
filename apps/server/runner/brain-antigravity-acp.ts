import { type ChildProcess, spawn } from "node:child_process";
import type { EventEmitter } from "node:events";
import type { CommandProfile } from "@agenteschat/adapters/command-policy";
import type { BrainSteerReply } from "@agenteschat/adapters/machine-protocol";
import { ACP_METHOD_NOT_FOUND, ACP_PROTOCOL_VERSION, AcpConnection, AcpError } from "./acp";
import { AGY_NETWORK_COMMANDS } from "./agy-home";
import {
  type AntigravityTurnInput,
  type AntigravityTurnOptions,
  agyDenied,
  agyDeniedNudge,
  agyEffort,
  antigravityProblem,
  isOurAgyTool,
  parseAgyError,
} from "./brain-antigravity";
import type { CodexBrainEvent } from "./brain-codex";
import { cursorPrompt } from "./brain-cursor";
import { killTree } from "./exec";
import { AGY_BIN, resolveCommand } from "./executors";
import { CODEX_MCP_SERVER, redactDeep } from "./mcp";

/**
 * An Antigravity turn over the Agent Client Protocol (`agy acp`, `acp.ts`), so a person's messages reach the turn
 * while it works, as Claude Code's do (ADR 0143, addendum 2026-11-18). `agy -p` takes nothing mid-turn, so a message
 * sent while the agent worked waited out the whole turn. Everything the `-p` turn sets up (the account's home, its
 * settings, our server, the sandbox note, the env) is the same; what differs, as Antigravity CLI 1.5.10 behaves
 * (tried 2026-11-18):
 *
 * - Steering: a `session/prompt` sent while one runs is taken at the turn's next step; the earlier prompt answers
 *   `end_turn` at once and the new one carries the turn on. `brain.steer` sends one (urgent or not), read
 *   (`steer_read`) once every prompt sent before it has answered.
 * - A command the model sends to the background (`WaitMsBeforeAsync`, 10 s at most in the foreground) outlives the
 *   prompt: the prompt answers, the command ends later and the CLI wakes by itself and goes on with no prompt open
 *   (`agy -p` waits for all of it). The turn ends only once no prompt is open, no tool runs and a wake that began has
 *   ended (`AGY_WAKE_WAIT_MS`, `AGY_WAKE_SETTLE_MS`).
 * - Permissions: over ACP the settings' allow rules aren't read and the CLI asks (`session/request_permission`). Our
 *   server's tools are allowed; a `work` turn's command that leaves the sandbox only as `AGY_NETWORK_COMMANDS` allow
 *   it (`agyNetworkCommand`); anything else is refused, and a turn that said nothing because of it goes on once, told
 *   why (`agyDeniedNudge`), as the `-p` turn does.
 * - Model, thinking level and mode are the session's (`session/set_model`, `thought_level`, `accept-edits` for work).
 * - A tool of the CLI's own says its step as it starts (`tool_started`) and goes on the transcript once it ended.
 * - Setup that fails (an older CLI with no `acp`, an answer it doesn't give) hands the turn back to `agy -p`
 *   (`"fallback"`); once the prompt went out, a failure is the turn's.
 * - The team's right hand (`chat`) stays on `agy -p`, whose `init` lists the tools the chat guard checks.
 */

/** How long each step of starting (initialize, the session, the model, the mode) may take. */
const SETUP_TIMEOUT_MS = 60_000;
/** After asking the CLI to stop, how long the turn waits for it before the process is killed. */
const STOP_WAIT_MS = 8000;
/** After the turn, how long the process may take to exit by itself (its input closed) before it is killed. */
const EXIT_GRACE_MS = 3000;
/** How long a process told to end has to go before the turn stops waiting for it. */
const KILL_WAIT_MS = 2000;
/** A prompt open and no tool running, and nothing heard this long: the turn stops (a limit it waits out, a hang). */
export const AGY_ACP_SILENCE_MS = 6 * 60_000;
/** Every prompt answered, a command still running in the background, nothing heard this long: the turn ends there. */
export const AGY_BACKGROUND_MAX_MS = 30 * 60_000;
/** A command that ended with no prompt open: how long the CLI has to wake and go on before the turn ends. */
export const AGY_WAKE_WAIT_MS = 60_000;
/** A wake's model call ended (`usage_update`) and nothing came after it this long: the wake is over. */
export const AGY_WAKE_SETTLE_MS = 2500;

const isRecord = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v);
const str = (v: unknown) => (typeof v === "string" ? v : "");
const num = (v: unknown) => (typeof v === "number" && Number.isFinite(v) && v > 0 ? Math.round(v) : 0);

/**
 * Whether a command the model asked to run outside the sandbox (`BypassSandbox`) is one a `work` turn may: each part
 * joined by `&&` is `cd` or one of `programs`, at least one of them, with no other way to chain or nest commands
 * (`;`, `|`, a lone `&`, backticks, `$(`, a new line). A shell or an interpreter would lift the sandbox for anything.
 */
export function agyNetworkCommand(line: string, programs: readonly string[] = AGY_NETWORK_COMMANDS): boolean {
  const parts = line.split("&&").map((p) => p.trim());
  if (parts.some((p) => !p)) return false;
  if (parts.some((p) => /[;|&`\n\r]|\$\(|<\(/.test(p))) return false;
  const first = parts.map((p) => p.split(/\s+/)[0] ?? "");
  return first.every((w) => w === "cd" || programs.includes(w)) && first.some((w) => programs.includes(w));
}

/** Whether a permission the CLI asks for is one this turn gives: our server's tools, a work turn's network command. */
export function agyAcpAllows(call: Record<string, unknown>, profile: CommandProfile): boolean {
  const name = str(call.name);
  const args = isRecord(call.args) ? call.args : isRecord(call.rawInput) ? call.rawInput : {};
  if (isOurAgyTool(name)) return true;
  if (name === "call_mcp_tool") return args.ServerName === CODEX_MCP_SERVER;
  if (name === "run_command" && args.BypassSandbox === true) {
    return profile === "work" && agyNetworkCommand(str(args.CommandLine));
  }
  return false;
}

/** A call of our server, either way the CLI makes it (named, or through `call_mcp_tool`). */
const isOurCall = (name: string, args: Record<string, unknown>) =>
  isOurAgyTool(name) || (name === "call_mcp_tool" && args.ServerName === CODEX_MCP_SERVER);

/** What a tool of the CLI's own said, as its update carries it. */
function outputOf(update: Record<string, unknown>): string {
  const raw = isRecord(update.rawOutput) ? update.rawOutput : {};
  if (typeof raw.output === "string") return raw.output;
  const parts = Array.isArray(update.content) ? update.content.filter(isRecord) : [];
  return parts
    .map((p) => (isRecord(p.content) ? str(p.content.text) : p.type === "diff" ? `${str(p.path)} changed` : ""))
    .filter(Boolean)
    .join("\n");
}

type SteerMessage = { uuid: string; text: string; urgent?: boolean };

/** A live Antigravity turn that `brain.steer` can reach, by run. */
interface LiveTurn {
  agentId: string;
  session: string;
  steer(messages: SteerMessage[]): Promise<BrainSteerReply>;
}
const liveTurns = new Map<string, LiveTurn>();
/** Runs whose ACP session is still starting: `no_turn` for now, as the turn may yet take messages. */
const starting = new Set<string>();

/**
 * `brain.steer` for an Antigravity turn of `runId` running over ACP (the request's agent's, that session's), or null
 * when none runs here (not started yet, over `agy -p`, or ended).
 */
export function steerAntigravityTurn(
  agentId: string,
  req: { runId: string; session: string; messages: SteerMessage[] },
): Promise<BrainSteerReply> | null {
  const live = liveTurns.get(req.runId);
  if (!live) return starting.has(req.runId) ? Promise.resolve({ status: "no_turn" }) : null;
  if (live.agentId !== agentId || live.session !== req.session) return Promise.resolve({ status: "no_turn" });
  return live.steer(req.messages);
}

/** `p`, or a rejection after `ms` (the timer cleared either way). */
function within<T>(p: Promise<T>, ms: number, message: string): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  return Promise.race([
    p,
    new Promise<never>((_, reject) => {
      timer = setTimeout(() => reject(new Error(message)), ms);
    }),
  ]).finally(() => clearTimeout(timer));
}

const goneWithin = (exited: Promise<unknown>, ms: number) =>
  within(
    exited.then(() => true),
    ms,
    "",
  ).catch(() => false);

/** What `runAntigravityTurn` already set up for the turn. */
export interface AgyAcpSetup {
  input: AntigravityTurnInput;
  opts: AntigravityTurnOptions;
  env: NodeJS.ProcessEnv;
  /** The context a new chat leads with (the sandbox note first). */
  system: string;
  chatKey: string;
  profile: CommandProfile;
  clean: (text: string) => string;
  /** Streamed text holds back this many characters (the longest secret − 1). */
  hold: number;
  /** Tests: the timings. */
  timing?: { wakeWaitMs?: number; wakeSettleMs?: number; silenceMs?: number; exitGraceMs?: number };
}

/**
 * Runs one Antigravity turn over ACP and emits its events, ending with exactly one `done` or `error`; or emits nothing
 * and answers `"fallback"` when the CLI couldn't start a session, for the turn to run as `agy -p`. Never throws.
 */
export async function runAntigravityAcpTurn(t: AgyAcpSetup): Promise<"fallback" | "ended"> {
  const { input, opts, clean } = t;
  const wakeWaitMs = t.timing?.wakeWaitMs ?? AGY_WAKE_WAIT_MS;
  const wakeSettleMs = t.timing?.wakeSettleMs ?? AGY_WAKE_SETTLE_MS;
  const silenceMs = t.timing?.silenceMs ?? AGY_ACP_SILENCE_MS;
  let ended = false;
  const emit = (event: CodexBrainEvent) => {
    if (ended) return;
    if (event.type === "done" || event.type === "error") ended = true;
    opts.emit(event);
  };
  const fail = (code: string, message: string, retryable?: boolean) =>
    emit({ type: "error", code, message, ...(retryable ? { retryable } : {}) });

  starting.add(input.runId);
  let child: ChildProcess;
  try {
    child = (opts.spawn ?? spawn)(resolveCommand(opts.bin ?? AGY_BIN, t.env.PATH), ["acp"], {
      cwd: input.cwd,
      env: t.env,
      stdio: ["pipe", "pipe", "pipe"],
      detached: true,
    });
  } catch {
    starting.delete(input.runId);
    return "fallback";
  }
  let stderr = "";
  child.stderr?.on("data", (c: Buffer) => {
    stderr = (stderr + c.toString("utf8")).slice(-4000);
  });

  const s = {
    sessionId: null as string | null,
    admitted: false,
    /** The first prompt went out: from here a failure is the turn's, never a fallback. */
    prompted: false,
    stopping: null as "canceled" | "silence" | null,
    killTimer: undefined as ReturnType<typeof setTimeout> | undefined,
    /** The turn is over: no prompt open, no tool running, no wake going on. */
    over: false,
    nudged: false,
  };
  let tail = "";
  let text = "";
  let worked = false;
  const flush = (chunk: string, whole: boolean) => {
    const out = clean(tail + chunk);
    const at = whole ? out.length : Math.max(0, out.length - t.hold);
    tail = out.slice(at);
    if (at > 0) {
      text += out.slice(0, at);
      emit({ type: "text_delta", text: out.slice(0, at) });
    }
  };
  /** The CLI's own tools still running (started, not ended), by id. */
  const running = new Map<string, { name: string; args: Record<string, unknown>; told: boolean }>();
  /** What was refused (a permission the CLI asked for), for the nudge and the turn's error. */
  const refused: { action: string; display_name: string }[] = [];
  const used = { input: 0, output: 0, cacheRead: 0 };
  let lastHeard = Date.now();
  let model = input.model;
  /** Prompts sent, and answered. */
  let sent = 0;
  let answered = 0;
  let promptError: unknown = null;
  /** A command ended with no prompt open: the CLI wakes and goes on (`active` once it does, `settledAt` its call's end). */
  let wake: { since: number; active: boolean; settledAt: number | null } | null = null;
  /** Messages handed with `brain.steer` and not read yet: read once the prompts sent before them answered. */
  const steered: { uuids: string[]; after: number }[] = [];
  const readSteered = (all: boolean) => {
    const read = steered.filter((m) => all || answered >= m.after);
    if (!read.length) return;
    steered.splice(0, steered.length, ...steered.filter((m) => !read.includes(m)));
    emit({ type: "steer_read", uuids: read.flatMap((m) => m.uuids) });
  };
  let settle: () => void = () => {};
  const finished = new Promise<void>((resolve) => {
    settle = () => {
      if (s.over) return;
      s.over = true;
      resolve();
    };
  });
  const check = () => {
    if (s.over || !s.prompted) return;
    if (s.stopping) return settle();
    if (sent > answered || running.size > 0) return;
    if (wake) {
      const now = Date.now();
      if (!wake.active && now - wake.since < wakeWaitMs) return;
      if (wake.active && (wake.settledAt === null || now - wake.settledAt < wakeSettleMs)) return;
    }
    settle();
  };
  /** Anything the CLI does after a command ended with no prompt open: the wake is going on. */
  const woke = () => {
    if (!wake) return;
    wake.active = true;
    wake.settledAt = null;
  };

  const update = (u: Record<string, unknown>) => {
    const kind = str(u.sessionUpdate);
    if (kind === "agent_message_chunk") {
      woke();
      const c = isRecord(u.content) ? u.content : {};
      if (c.type === "text" && str(c.text)) flush(str(c.text), false);
      return;
    }
    if (kind === "agent_thought_chunk") return woke();
    if (kind === "usage_update") {
      if (wake?.active) wake.settledAt = Date.now();
      return;
    }
    if (kind !== "tool_call" && kind !== "tool_call_update") return;
    const id = str(u.toolCallId);
    if (!id) return;
    const known = running.get(id);
    const name = str(u.name) || known?.name || "tool";
    const args = isRecord(u.args) ? u.args : isRecord(u.rawInput) ? u.rawInput : (known?.args ?? {});
    const status = str(u.status);
    if (status === "completed" || status === "failed") {
      running.delete(id);
      worked = true;
      // Ended with no prompt open: a command the model sent to the background; the CLI goes on by itself.
      if (sent === answered) wake = { since: Date.now(), active: false, settledAt: null };
      if (isOurCall(name, args)) return;
      flush("", true);
      emit({
        type: "tool_call",
        id: `${s.sessionId ?? "agy"}:${id}`,
        name,
        input: redactDeep(args, clean),
        executed: { content: clean(outputOf(u).slice(0, 20_000)), ...(status === "failed" ? { isError: true } : {}) },
      });
      return;
    }
    woke();
    if (!known) running.set(id, { name, args, told: false });
    const entry = running.get(id);
    // Its own tools say their step as they start; ours say theirs through the bridge.
    if (entry && !entry.told && !isOurCall(name, args)) {
      entry.told = true;
      flush("", true);
      emit({ type: "tool_started", id: `${s.sessionId ?? "agy"}:${id}`, name });
    }
  };

  const conn = new AcpConnection(
    child.stdin as NonNullable<ChildProcess["stdin"]>,
    child.stdout as NonNullable<ChildProcess["stdout"]>,
    {
      onNotification(method, params) {
        if (method !== "session/update" || !isRecord(params) || params.sessionId !== s.sessionId) return;
        lastHeard = Date.now();
        if (!s.admitted && s.sessionId && s.prompted) {
          s.admitted = true;
          opts.chats.set(t.chatKey, s.sessionId);
        }
        if (isRecord(params.update)) update(params.update);
        readSteered(false);
        check();
      },
      onRequest(method, params) {
        if (method !== "session/request_permission") {
          throw new AcpError(ACP_METHOD_NOT_FOUND, `Method not found: ${method}`);
        }
        const p = isRecord(params) ? params : {};
        const call = isRecord(p.toolCall) ? p.toolCall : {};
        const options = Array.isArray(p.options) ? p.options.filter(isRecord) : [];
        const allow =
          options.find((o) => str(o.kind) === "allow_once") ?? options.find((o) => str(o.kind).startsWith("allow"));
        if (allow && agyAcpAllows(call, t.profile)) {
          return { outcome: { outcome: "selected", optionId: str(allow.optionId) } };
        }
        const args = isRecord(call.args) ? call.args : {};
        refused.push({
          action: str(call.name) === "run_command" ? "command" : "tool",
          display_name: (str(args.CommandLine) || str(call.title) || str(call.name) || "a tool").slice(0, 40),
        });
        const reject = options.find((o) => str(o.kind).startsWith("reject"));
        return reject
          ? { outcome: { outcome: "selected", optionId: str(reject.optionId) } }
          : { outcome: { outcome: "cancelled" } };
      },
    },
  );

  const exited = new Promise<{ code: number | null; error?: Error }>((resolve) => {
    const proc = child as unknown as EventEmitter;
    proc.on("error", (error: Error) => resolve({ code: null, error }));
    proc.on("close", (code: number | null) => resolve({ code }));
  });
  let exit: { code: number | null; error?: Error } | null = null;
  void exited.then((e) => {
    exit = e;
    conn.close(new Error(e.error?.message ?? `The Antigravity CLI exited with code ${e.code ?? "?"}`));
    settle();
  });

  function stop(why: "canceled" | "silence") {
    if (s.stopping) return;
    s.stopping = why;
    if (s.sessionId) conn.notify("session/cancel", { sessionId: s.sessionId });
    s.killTimer = setTimeout(() => killTree(child, "SIGKILL"), STOP_WAIT_MS);
    check();
  }
  const onAbort = () => stop("canceled");
  if (opts.signal.aborted) onAbort();
  else opts.signal.addEventListener("abort", onAbort, { once: true });
  const ticker = setInterval(
    () => {
      const quiet = Date.now() - lastHeard;
      if (s.prompted && !s.stopping) {
        if (sent > answered && running.size === 0 && quiet > silenceMs) stop("silence");
        // Every prompt answered and a background command never heard from again (a server it left running).
        else if (sent === answered && running.size > 0 && quiet > AGY_BACKGROUND_MAX_MS) running.clear();
      }
      check();
    },
    Math.min(500, Math.max(20, wakeSettleMs / 4)),
  );

  const prompt = (blocks: { type: "text"; text: string }[]) => {
    sent++;
    s.prompted = true;
    const sessionId = s.sessionId;
    conn.request<Record<string, unknown> | null>("session/prompt", { sessionId, prompt: blocks }).then(
      (result) => {
        answered++;
        const u = isRecord(result?.usage) ? result.usage : {};
        const cacheRead = num(u.cachedReadTokens);
        used.input += num(u.inputTokens) + cacheRead;
        used.output += num(u.outputTokens) + num(u.thoughtTokens);
        used.cacheRead += cacheRead;
        readSteered(false);
        check();
      },
      (err: unknown) => {
        answered++;
        promptError ??= err;
        readSteered(false);
        check();
      },
    );
  };

  const cleanup = async () => {
    starting.delete(input.runId);
    liveTurns.delete(input.runId);
    clearInterval(ticker);
    clearTimeout(s.killTimer);
    opts.signal.removeEventListener("abort", onAbort);
    conn.close();
    child.stdin?.end();
    if (!(await goneWithin(exited, t.timing?.exitGraceMs ?? EXIT_GRACE_MS))) {
      killTree(child, "SIGTERM");
      if (!(await goneWithin(exited, KILL_WAIT_MS))) {
        killTree(child, "SIGKILL");
        await goneWithin(exited, KILL_WAIT_MS);
      }
    }
  };

  // Setup: anything that fails here hands the turn to `agy -p`.
  let fresh = true;
  try {
    const setup = <T>(p: Promise<T>) => within(p, SETUP_TIMEOUT_MS, "The Antigravity CLI took too long to start");
    await setup(
      conn.request("initialize", {
        protocolVersion: ACP_PROTOCOL_VERSION,
        clientCapabilities: { fs: { readTextFile: false, writeTextFile: false }, terminal: false },
        clientInfo: { name: "agentes-runner", version: "1" },
      }),
    );
    const stored = opts.chats.get(t.chatKey);
    if (stored && !s.stopping) {
      const resumed = await setup(
        conn.request("session/resume", { sessionId: stored, cwd: input.cwd, mcpServers: [] }),
      ).then(
        () => true,
        () => false,
      );
      if (resumed) {
        s.sessionId = stored;
        s.admitted = true;
        fresh = false;
      } else opts.chats.delete(t.chatKey);
    }
    if (!s.sessionId && !s.stopping) {
      const opened = await setup(
        conn.request<Record<string, unknown> | null>("session/new", { cwd: input.cwd, mcpServers: [] }),
      );
      s.sessionId = str(opened?.sessionId) || null;
      if (!s.sessionId) throw new Error("The Antigravity CLI didn't start a session");
    }
    const sessionId = s.sessionId;
    if (sessionId && !s.stopping) {
      // A model or level it doesn't offer keeps its default, as `agy -p --model` does.
      if (input.model) {
        await setup(conn.request("session/set_model", { sessionId, modelId: input.model })).catch(() => {
          model = undefined;
        });
      }
      const effort = agyEffort(input.effort, input.model);
      if (effort) {
        await setup(
          conn.request("session/set_config_option", { sessionId, configId: "thought_level", value: effort }),
        ).catch(() => undefined);
      }
      await setup(
        conn.request("session/set_mode", { sessionId, modeId: t.profile === "plan" ? "default" : "accept-edits" }),
      );
    }
  } catch {
    if (!s.stopping) {
      await cleanup();
      return "fallback";
    }
  }

  try {
    if (s.stopping || !s.sessionId) {
      fail("canceled", "The turn was canceled.");
      return "ended";
    }
    liveTurns.set(input.runId, {
      agentId: input.agentId ?? "",
      session: input.sessionId,
      steer: async (messages) => {
        if (s.over || s.stopping || ended || conn.closed) return { status: "no_turn" };
        const uuids = messages.map((m) => m.uuid);
        steered.push({ uuids, after: sent });
        prompt(messages.map((m) => ({ type: "text" as const, text: m.text })));
        return { status: "accepted", accepted: uuids };
      },
    });
    starting.delete(input.runId);
    prompt([{ type: "text", text: cursorPrompt(t.system, input.prompt, fresh) }]);

    for (;;) {
      await finished;
      if (s.stopping || exit) break;
      flush("", true);
      // Nothing said because a permission it needed was refused: once, the same session goes on, told why.
      if (!text.trim() && refused.length && !s.nudged && !promptError) {
        s.nudged = true;
        s.over = false;
        const again = new Promise<void>((resolve) => {
          settle = () => {
            if (s.over) return;
            s.over = true;
            resolve();
          };
        });
        prompt([
          {
            type: "text",
            text: agyDeniedNudge({ denied_actions: refused }, t.profile === "work" ? AGY_NETWORK_COMMANDS : []),
          },
        ]);
        await again;
        if (s.stopping || exit) break;
      }
      break;
    }
    liveTurns.delete(input.runId);
    flush("", true);
    if (s.stopping === "canceled") {
      fail("canceled", "The turn was canceled.");
      return "ended";
    }
    if (s.stopping === "silence") {
      fail(
        "antigravity_failed",
        `The Antigravity CLI said nothing for ${Math.round(silenceMs / 60_000)} minutes with no tool running (its plan may be refusing it, as at a usage limit), so the turn stopped.`,
        true,
      );
      return "ended";
    }
    if (used.input || used.output) {
      emit({
        type: "usage",
        input: used.input,
        output: used.output,
        source: "plan",
        ...(model ? { model } : {}),
        ...(used.cacheRead ? { cacheRead: used.cacheRead } : {}),
      });
    }
    const said = text.trimEnd();
    const closedEarly = exit !== null && sent > answered;
    if ((promptError || closedEarly) && !said) {
      const agyError = parseAgyError(stderr);
      const e = promptError instanceof AcpError ? promptError.message : promptError ? String(promptError) : "";
      const why =
        agyError?.message ??
        (e ||
          `The Antigravity CLI exited with code ${(exit as { code: number | null } | null)?.code ?? "?"}${stderr.trim() ? `: ${stderr.trim().slice(-500)}` : ""}`);
      for (const event of antigravityProblem(clean(why), {
        worked,
        limit: agyError?.limit ?? false,
        auth: agyError?.auth ?? false,
        ...(opts.now ? { now: opts.now() } : {}),
      }))
        emit(event);
      return "ended";
    }
    if (!said && refused.length) {
      const denied = agyDenied({ denied_actions: refused });
      if (denied) {
        fail("antigravity_failed", denied, false);
        return "ended";
      }
    }
    readSteered(true);
    emit({ type: "done", text: said, session: { id: input.sessionId } });
    return "ended";
  } finally {
    await cleanup();
    if (!ended) fail("antigravity_failed", "The Antigravity CLI ended without an answer.", true);
  }
}
