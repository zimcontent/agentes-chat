import type { ModelMessage } from "@dougbot/providers";

/**
 * A run a person asked for that reaches its step limit while its work still goes well continues by itself, as if
 * they had pressed Continuar (ADR 0097, addendum 2026-11-20): at most this many times per request. A Continuar a
 * person presses starts the count again, since they asked once more.
 */
export const AUTO_CONTINUE_MAX = 2;

/** The line the continuing run reads, in place of "[Ana asked you to continue from where you stopped.]". */
export const autoContinueLine = (n: number, max = AUTO_CONTINUE_MAX) =>
  `[You reached this run's limit of steps while your work was going well, so you go on by yourself (${n} of ${max}). Pick up exactly where you stopped; don't redo what is done.]`;

/**
 * Whether its last steps went well: the conversation ends on the results of its last tool calls, and none of them
 * failed. A run whose last call failed may be on a wrong path, so a person decides (Continuar).
 */
export function lastToolsSucceeded(messages: ModelMessage[]): boolean {
  const last = messages.at(-1);
  if (last?.role !== "user" || typeof last.content === "string") return false;
  const results = last.content.filter((b) => b.type === "tool_result");
  return results.length > 0 && results.every((b) => !(b as { isError?: boolean }).isError);
}

/** What decides whether a run may go on by itself at its step limit, read by the executor. */
export interface AutoContinueFacts {
  /** The most it may (the engine's setting, `AUTO_CONTINUE_MAX` by default; 0 turns it off). */
  max: number;
  /** How many times this request already went on by itself (`Transcript.autoContinued`). */
  done: number;
  /** A routine's or a background run: it ends at its cap as it always did (ADR 0053 §10). */
  background: boolean;
  /** Long work (ADR 0121) or a mission: they have their own way to go on. */
  workOrMission: boolean;
  /** Fired by a routine into a conversation. */
  viaRoutine: boolean;
  /** Only the model brain: a computer brain's tools run on the computer, out of this transcript. */
  modelBrain: boolean;
  /** Found going in circles (`stuck.ts`, ADR 0015). */
  stuck: boolean;
  /** A person is behind the request (who wrote it, or who pressed Continuar). */
  person: boolean;
}

/** Whether it may still go on by itself, before looking at its last steps and its budget. */
export const mayContinueAlone = (f: AutoContinueFacts) =>
  f.done < f.max && !f.background && !f.workOrMission && !f.viaRoutine && f.modelBrain && !f.stuck && f.person;

/**
 * Who asked for the request a run answers, read from its trigger as `runRequester` does in SQL: its author, or who
 * pressed Continuar on the reply it continues.
 */
export function triggerRequester(message: { authorUserId: string | null; meta: Record<string, unknown> } | null) {
  if (!message) return null;
  if (message.authorUserId) return message.authorUserId;
  for (const key of ["canceled", "stepLimit"] as const) {
    const by = (message.meta[key] as { continuedByUserId?: unknown } | undefined)?.continuedByUserId;
    if (typeof by === "string") return by;
  }
  return null;
}
