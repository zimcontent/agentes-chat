/**
 * An agent hunting for a tool it doesn't have (ADR 0015 addendum 2026-11-17). On a model brain every tool past the
 * core ones is found with `find_tools`, and the directory always answers with its closest matches, so a tool that
 * isn't there reads as "not found yet": some models search again and again, then go looking for it on the computer
 * (its files, its processes, the server it runs on) until the run's limit of steps. Those runs never repeat a call,
 * so `stuck.ts` doesn't see them. Here a search counts as in vain when none of the tools it listed gets used before
 * the next search (or the run asks `use_tool` for a name that doesn't exist); at `TOOL_HUNT.note` the agent reads
 * `TOOL_HUNT_NOTE` once, at `TOOL_HUNT.end` the run ends as a stuck one does, saying where it stands.
 */

export const TOOL_HUNT = { note: 3, end: 6 } as const;

export interface ToolHuntState {
  /** Searches (and requests for a missing tool) that led to no tool used. */
  vain: number;
  /** The tools the last search listed, while none of them has been used; null when there is no open search. */
  listed: string[] | null;
  /** It read `TOOL_HUNT_NOTE`. */
  noted?: boolean;
}

/** What an agent that keeps searching for a tool reads once. */
export const TOOL_HUNT_NOTE =
  "You have searched your tools several times without finding the one you need. If find_tools doesn't list it, you don't have it: don't look for it on the computer, in files, in processes or by any other way. Do what you can with the tools you have, ask a colleague who has it (ask_agent) or the person, or say plainly what is missing and stop.";

const FIND = /(^|_)find_tools$/;
const USE = /(^|_)use_tool$/;
const MISSING = /^(No (?:[\w -]+ )?tool named |Unknown tool )/;

/** The exact names a `find_tools` answer lists, one per "- name…" line. */
export function listedTools(content: string): string[] {
  return [...content.matchAll(/^- ([A-Za-z0-9_.-]+)/gm)].map((m) => m[1] as string);
}

const isRecord = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null;

/** Takes one step's calls, in order, and says whether the agent should read the note now or the run should end. */
export function noteToolHunt(
  state: ToolHuntState | undefined,
  calls: { name: string; input: unknown; content: string; isError: boolean }[],
): { state: ToolHuntState; action: "note" | "end" | null } {
  const next: ToolHuntState = { vain: state?.vain ?? 0, listed: state?.listed ?? null, noted: state?.noted };
  for (const call of calls) {
    if (FIND.test(call.name)) {
      if (next.listed) next.vain++;
      next.listed = call.isError ? null : listedTools(call.content);
      continue;
    }
    const use = USE.test(call.name);
    const tool = use && isRecord(call.input) ? String(call.input.tool ?? "") : call.name;
    if (use && call.isError && MISSING.test(call.content)) {
      next.vain++;
      next.listed = null;
      continue;
    }
    if (next.listed && !call.isError && next.listed.includes(tool)) next.listed = null;
  }
  const action = next.vain >= TOOL_HUNT.end ? "end" : next.vain >= TOOL_HUNT.note && !next.noted ? "note" : null;
  if (action === "note") next.noted = true;
  if (next.noted === undefined) delete next.noted;
  return { state: next, action };
}
