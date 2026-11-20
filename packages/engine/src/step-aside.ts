import type { PubSub } from "@dougbot/adapters";
import { type Database, eq, schema } from "@dougbot/db";
import type { ContextDeps } from "./context/summaries";
import { publishDelivery } from "./delivery";
import { deliverLive, returnToInbox } from "./live-steer";
import { handOnTaken, takeForHandOn } from "./run-inbox";
import { deliverNoticeToRun } from "./run-resume";
import { type AgentRun, addRunStep, computerWaitOf } from "./runs";
import { movedNote, queuedNote } from "./work-tools";
import { moveToBackground, WORK_LIMITS, workEligible } from "./works";

const { agentRuns } = schema;

export interface StepAsideDeps {
  db: Database;
  pubsub?: PubSub;
  /** Names the work after the conversation when no person titled its thread (`nameConversation`). */
  context?: ContextDeps;
}

/**
 * Moves a run still in its conversation to background work by itself (ADR 0121 §1): the safety net after a few
 * minutes of work, and a person's quick question or separate request while it works (`stepAsideFor`). The run moves
 * (`moveToBackground`, `how: "auto"`, its anchor worded by the apps), `onMoved` runs at once (the executor holding the
 * run adopts the move there), its trail notes it, and its brain hears it like a check-in: live on a steerable turn,
 * else at its next step. Null: it isn't running, may not leave its conversation (`workEligible`), already moved, or,
 * with `onlyIfRoom`, would wait in line behind the agent's other work.
 */
export async function moveRunAside(
  deps: StepAsideDeps,
  runId: string,
  options: { onlyIfRoom?: boolean; onMoved?: () => Promise<void> } = {},
) {
  const { db } = deps;
  const [current] = await db.select().from(agentRuns).where(eq(agentRuns.id, runId));
  if (current?.status !== "running" || !(await workEligible(db, current))) return null;
  // No title given: a person's for its thread, else a short name the cheap model gives the conversation.
  const moved = await moveToBackground(deps, runId, {
    how: "auto",
    title: "",
    nextUpdateMin: WORK_LIMITS.nextDefault,
    ...(options.onlyIfRoom ? { onlyIfRoom: true } : {}),
  });
  if (!moved) return null;
  await options.onMoved?.();
  // As it is now: asked in a main timeline, it answers in its anchor's thread from here on.
  const [run] = await db.select().from(agentRuns).where(eq(agentRuns.id, runId));
  if (!run) return moved;
  await addRunStep(db, run, "context", { work: { id: moved.work.id, how: "auto" } }).catch(() => {});
  const delivered = await db.transaction((tx) =>
    deliverNoticeToRun(tx, run, {
      kind: "work_check_in",
      text: moved.queued ? queuedNote : movedNote(WORK_LIMITS.nextDefault),
      refs: { workId: moved.work.id, kind: "moved" },
    }),
  );
  await publishDelivery(deps.pubsub, delivered).catch(() => {});
  if (deps.pubsub)
    await deliverLive({ db, pubsub: deps.pubsub }, run, { messageId: delivered.message.id, urgent: false }).catch(
      () => false,
    );
  return moved;
}

/**
 * A person's quick question or separate request to an agent at work (the triage's `answer` or `queue`, ADR 0121
 * addendum of 2026-11-19): the task steps out of the conversation into background work and keeps going, and the
 * message gets a turn of its own, where the agent itself answers it with what the work is doing in front of it
 * ("# Your background work here") and passes on what is for the work (`steer_work`). Every brain alike: it is an
 * ordinary turn. The message leaves the run's inbox first, so the task never reads it too; when the run doesn't step
 * aside (not working, not eligible, its work would wait in line) it goes back to the front of the inbox, as if nothing
 * happened. False then, and when the run read it already.
 */
export async function stepAsideFor(deps: StepAsideDeps, run: AgentRun, messageId: string): Promise<boolean> {
  // Asking from its computer's line it isn't at work yet: it reads the message with its first turn.
  if (run.status !== "running" || run.background || run.workId || computerWaitOf(run)) return false;
  const taken = await takeForHandOn(deps.db, run, [messageId]);
  if (taken.length === 0) return false;
  const moved = await moveRunAside(deps, run.id, { onlyIfRoom: true }).catch(() => null);
  if (!moved) {
    await returnToInbox(deps.db, deps.pubsub, run, taken);
    return false;
  }
  // A person's message never goes to background work at work (`workTakesPersonMessage`): this starts a turn of its own.
  // None started (the agent was archived meanwhile, the message deleted): the work reads it rather than nobody.
  if (!(await handOnTaken(deps.db, deps.pubsub, run, taken, "aside").catch(() => null)))
    await returnToInbox(deps.db, deps.pubsub, run, taken);
  return true;
}
