import type { BrainStallPhase } from "@dougbot/adapters/machine-protocol";

/**
 * A Claude Code turn that stopped answering (`brain.ts`, "Silence"): how long the CLI may print nothing in each
 * phase of a turn before the turn counts as stalled.
 *
 * Every line it prints counts as a sign of life: with partial messages the model's answer streams token by token
 * (its thinking and a tool's input too), a retry says `api_retry`, and a subagent prints its own steps. What may run
 * long without a line has its own limit: one of its own tools (a shell command for as long as its timeout), the
 * conversation being compacted, and nothing at all while a call of ours runs (a permission prompt may wait for a
 * person; our tools have their own timeouts, and so does the CLI's wait for any MCP server's).
 */

export interface ClaudeSilence {
  /** No tool runs: the turn waits for the model's answer. */
  modelMs: number;
  /** The CLI said it is compacting the conversation (`system/status`). */
  compactingMs: number;
  /** One of its own tools that isn't a shell command or a subagent (a read, an edit, a search). */
  toolMs: number;
  /** A shell command (`Bash`): its own timeout (its `timeout`, else the CLI's default) plus this. */
  commandGraceMs: number;
  /** A subagent (`Task`, `Agent`): its own steps print lines, but one long answer of its may not. */
  subagentMs: number;
  /** How often a turn looks. */
  checkMs: number;
}

export const CLAUDE_SILENCE: ClaudeSilence = {
  modelMs: 6 * 60_000,
  compactingMs: 15 * 60_000,
  toolMs: 6 * 60_000,
  commandGraceMs: 3 * 60_000,
  subagentMs: 20 * 60_000,
  checkMs: 15_000,
};

/** Claude Code's own shell timeout when the call sets none (its `BASH_DEFAULT_TIMEOUT_MS`). */
export const BASH_DEFAULT_MS = 120_000;

/** After a stalled CLI is told to end, how long the turn waits for it to go before ending anyway. */
export const STALL_EXIT_WAIT_MS = 5_000;

/** Where a stalled turn was: waiting for the model, while the CLI compacted, or in one of its own tools. */
export type SilencePhase = BrainStallPhase;

/** A tool the model called that hasn't answered yet, as the stream said it (`ClaudeStreamParser.inFlight`). */
export interface InFlightTool {
  name: string;
  input: unknown;
  /** When its call came in the stream. */
  since: number;
}

/** A turn stopped for its silence: where it was, the tool that ran (and on what), and how long nothing came. */
export interface StallInfo {
  phase: SilencePhase;
  tool?: string;
  /** What the tool ran on (`Bash (make test)`, `Edit (src/app.ts)`), its secrets masked. */
  label?: string;
  silentMs: number;
}

const isObj = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v);
const text = (v: unknown) => (typeof v === "string" ? v : "");

/** A shell command's own timeout: what the call says (the CLI caps it), else the CLI's default. */
function commandTimeoutMs(input: unknown, defaultMs: number) {
  const t = isObj(input) ? input.timeout : undefined;
  return typeof t === "number" && Number.isFinite(t) && t > 0 ? t : defaultMs;
}

/** How long one tool may run without a line, or null when it isn't the CLI's own (ours or an MCP server's). */
function toolLimit(tool: InFlightTool, limits: ClaudeSilence, bashDefaultMs: number): number | null {
  if (tool.name.startsWith("mcp__")) return null;
  if (tool.name === "Task" || tool.name === "Agent") return limits.subagentMs;
  if (tool.name === "Bash") {
    // Sent to the background, it answers at once: a quick call like any other.
    if (isObj(tool.input) && tool.input.run_in_background === true) return limits.toolMs;
    return commandTimeoutMs(tool.input, bashDefaultMs) + limits.commandGraceMs;
  }
  return limits.toolMs;
}

/**
 * What a quiet turn waits on and how long it may stay quiet; null while nothing should be timed: a call of ours runs
 * (`bridgeCalls`: the bridge relays it, a permission prompt among them), or the model called a tool of an MCP server
 * (ours run through the bridge; another server's wait is the CLI's to bound). With several of its own tools at once,
 * the one that may run longest decides.
 */
export function silenceLimit(
  state: { tools: InFlightTool[]; compacting: boolean; bridgeCalls: number; bashDefaultMs?: number },
  limits: ClaudeSilence,
): { phase: SilencePhase; ms: number; tool?: InFlightTool } | null {
  if (state.bridgeCalls > 0) return null;
  if (state.tools.length === 0) {
    return state.compacting ? { phase: "compacting", ms: limits.compactingMs } : { phase: "model", ms: limits.modelMs };
  }
  let longest: { tool: InFlightTool; ms: number } | null = null;
  for (const tool of state.tools) {
    const ms = toolLimit(tool, limits, state.bashDefaultMs ?? BASH_DEFAULT_MS);
    if (ms === null) return null;
    if (!longest || ms > longest.ms) longest = { tool, ms };
  }
  return longest ? { phase: "tool", ms: longest.ms, tool: longest.tool } : null;
}

const firstLine = (s: string) => s.trim().split("\n")[0]?.trim() ?? "";

/** A tool call as one short line: the command's first line, the path or the pattern it was on (`Bash (make test)`). */
export function stallLabel(tool: Pick<InFlightTool, "name" | "input">): string {
  const i = isObj(tool.input) ? tool.input : {};
  const what =
    firstLine(text(i.command)) ||
    text(i.file_path) ||
    text(i.notebook_path) ||
    text(i.path) ||
    text(i.pattern) ||
    text(i.url) ||
    firstLine(text(i.description));
  const head = what.replace(/\s+/g, " ").trim();
  if (!head) return tool.name;
  return `${tool.name} (${head.length > 120 ? `${head.slice(0, 119)}…` : head})`;
}

/** The stall in words, for a log line and for the model: "6 minutes while it ran Bash (make test)". */
export function stallWords(s: StallInfo): string {
  const minutes = Math.max(1, Math.round(s.silentMs / 60_000));
  const span = `${minutes} minute${minutes === 1 ? "" : "s"}`;
  const where =
    s.phase === "compacting"
      ? "the conversation was being compacted"
      : s.phase === "tool"
        ? `it ran ${s.label ?? s.tool ?? "one of its tools"}`
        : "it waited for the model's answer";
  return `${span} while ${where}`;
}

/**
 * Leads the same turn sent again on a resumed session after a stall: what happened, so the model checks what it
 * already did instead of starting over, and doesn't run the step that hung the same way.
 */
export function stallNote(s: StallInfo): string {
  return `Your previous attempt at this request stopped responding (nothing came from it for ${stallWords(s)}), so it was stopped and this is the same request again. Check what is already done before repeating anything, and if that step is what hung, do it another way.`;
}

/**
 * The turn's end after it stalled again on its resumed session, as the conversation reads it after "Claude Code stopped
 * before finishing": the tool's name, never what it ran on.
 */
export function stalledAgainMessage(s: StallInfo): string {
  const minutes = Math.max(1, Math.round(s.silentMs / 60_000));
  const where = s.phase === "tool" ? ` while it ran ${s.tool ?? "one of its tools"}` : "";
  return `it stopped responding twice: nothing for ${minutes} minute${minutes === 1 ? "" : "s"}${where}`;
}
