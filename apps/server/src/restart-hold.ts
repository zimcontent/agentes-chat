import type { Logger } from "./logger";

/**
 * A restart announced ahead (ADR doug-0005). The deploy says "about to restart" (SIGUSR2) before it stops the server:
 * from then on no long job starts here (agents' runs, routines), and each run executing here stops at its next step,
 * between two turns, checkpointed and handed back to the queue. `/api/health` says `restart: "ready"` once nothing
 * long runs here, and the deploy swaps the server then: nothing is cut mid-turn, and the next instance picks the runs
 * up where they stopped. A hold nobody follows with a restart lets go by itself after `RESTART_HOLD_MAX_MS`.
 */
export const RESTART_HOLD_MAX_MS = 30 * 60_000;

export type RestartState = "waiting" | "ready";

export interface RestartHoldDeps {
  /** Long jobs running in this process now (`Workers.longInFlight`). */
  longInFlight: () => number;
  /** Runs executing in this process now (`activeRunCount`). */
  runsHere: () => number;
  /** Tells the runs executing here to stop at their next step (`holdRunsForRestart`). */
  holdRuns: (on: boolean) => void;
  log: Logger;
  maxMs?: number;
}

export function createRestartHold(deps: RestartHoldDeps) {
  let since: number | null = null;
  let timer: ReturnType<typeof setTimeout> | null = null;
  let saidReady = false;
  const release = (why: string) => {
    if (since === null) return;
    since = null;
    if (timer) clearTimeout(timer);
    timer = null;
    deps.holdRuns(false);
    deps.log.warn("restart hold let go: agents' work starts here again", { why });
  };
  const state = (): RestartState | null => {
    if (since === null) return null;
    const ready = deps.longInFlight() === 0 && deps.runsHere() === 0;
    if (ready && !saidReady) {
      saidReady = true;
      deps.log.info("restart hold: nothing runs here, ready to restart", { waitedMs: Date.now() - since });
    }
    return ready ? "ready" : "waiting";
  };
  return {
    /** Starts holding (again: nothing more), until a restart or `RESTART_HOLD_MAX_MS`. */
    hold() {
      if (since !== null) return;
      since = Date.now();
      saidReady = false;
      deps.holdRuns(true);
      const maxMs = deps.maxMs ?? RESTART_HOLD_MAX_MS;
      timer = setTimeout(() => release(`no restart came in ${Math.round(maxMs / 60_000)} min`), maxMs);
      timer.unref?.();
      deps.log.info("restart announced: runs stop at their next step, no new long job starts here", {
        runs: deps.runsHere(),
        longJobs: deps.longInFlight(),
      });
    },
    release,
    held: () => since !== null,
    /** Null when no restart was announced; else whether something long still runs here. */
    state,
  };
}

export type RestartHold = ReturnType<typeof createRestartHold>;
