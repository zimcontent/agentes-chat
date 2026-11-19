import type { LiveActivityMessage, LiveActivitySender } from "@dougbot/adapters";
import { and, asc, type Database, eq, inArray, isNull, lt, ne, rowsOf, schema, sql } from "@dougbot/db";
import { ForbiddenError, NotFoundError } from "./errors";
import { getMembership } from "./organizations";
import { pushLocale, pushStrings } from "./push-messages";
import { type AgentRun, computerWaitOf, usageWaitOf } from "./runs";

const { liveActivities, agentRuns, agents, messages, issues } = schema;

/**
 * Live Activities on iPhones (docs/adr/doug-0021-lock-screen.md). When a person sends work to an agent, the app starts
 * one on the lock screen and in the Dynamic Island and registers its push token here (`registerLiveActivity`). The
 * workers' tick (`syncLiveActivities`) reads each open one's run, as `runs.ts` has it, and sends what changed straight
 * to Apple (`apns-push-type: liveactivity`): who waits on whom, how far it is, and its end with the run. Only with the
 * server's own APNs key: through the push relay there is no sender, and the app is told so before it starts one.
 */

/** Apple ends an activity after eight hours: one still open by then is ended here too. */
export const LIVE_ACTIVITY_MAX_MS = 8 * 3600_000;
/** An activity whose run ended this fast leaves at once (the person likely saw the answer already). */
export const LIVE_ACTIVITY_QUICK_MS = 30_000;
/** How long an ended activity stays on the lock screen. */
export const LIVE_ACTIVITY_LINGER_MS = 4 * 60_000;
/** Without an update by then, the system shows it as out of date. */
export const LIVE_ACTIVITY_STALE_MS = 15 * 60_000;
/** Activities read per tick. */
const SYNC_BATCH = 200;
/** The words of what was asked, on the activity. */
export const LIVE_TITLE_MAX = 40;

/** Where the work is, as the widget draws it (its colors and its end). */
export type LivePhase = "queued" | "work" | "wait" | "done" | "stopped" | "failed";

/**
 * The activity's content state, exactly as the widget's Swift `ContentState` decodes it
 * (apps/mobile/targets/live-activity/DougActivityAttributes.swift): change both together.
 */
export interface LiveState {
  title: string;
  line: string;
  progress: number;
  phase: LivePhase;
}

const clip = (s: string, max: number) => {
  const one = s.replace(/\s+/g, " ").trim();
  return one.length > max ? `${one.slice(0, max - 1).trimEnd()}…` : one;
};

/** What was asked, in a few words: the task's title, else the message without its leading mentions. */
export function liveTitle(input: { issueTitle?: string | null; body?: string | null }): string {
  if (input.issueTitle?.trim()) return clip(input.issueTitle, LIVE_TITLE_MAX);
  return clip((input.body ?? "").replace(/^(\s*@[\w.-]+[,:]?)+/, ""), LIVE_TITLE_MAX);
}

/** A run's progress, from how many model calls it made: it climbs fast, then slowly, and never reaches the end alone. */
export function liveProgress(turns: number): number {
  const p = 0.1 + 0.8 * (1 - Math.exp(-Math.max(0, turns) / 5));
  return Math.round(Math.min(0.9, p) * 100) / 100;
}

type RunFacts = Pick<AgentRun, "status" | "turns" | "waitingMachineId" | "transcript">;

/** What the activity shows for a run now, in the phone's language. */
export function liveStateOf(run: RunFacts, title: string, locale: string): LiveState {
  const s = pushStrings(pushLocale(locale));
  const line = (...parts: string[]) => parts.join(" · ");
  switch (run.status) {
    case "queued":
      return { title, line: line(s.liveYouWait, s.liveQueued), progress: 0.04, phase: "queued" };
    case "waiting_approval":
      return { title, line: s.liveWaitsOnYou, progress: liveProgress(run.turns), phase: "wait" };
    case "waiting_input": {
      // Its computer or its plan holds it, not the person: it is still the person who waits.
      if (computerWaitOf(run) || usageWaitOf(run))
        return { title, line: line(s.liveYouWait, s.liveQueued), progress: liveProgress(run.turns), phase: "queued" };
      return { title, line: s.liveWaitsOnYou, progress: liveProgress(run.turns), phase: "wait" };
    }
    case "running": {
      const progress = liveProgress(run.turns);
      const stage = run.turns <= 1 ? s.liveStarting : progress >= 0.7 ? s.liveAlmost : s.liveWorking;
      return { title, line: line(s.liveYouWait, stage), progress, phase: "work" };
    }
    case "done":
      return { title, line: s.liveDone, progress: 1, phase: "done" };
    case "canceled":
      return { title, line: s.liveStopped, progress: liveProgress(run.turns), phase: "stopped" };
    default:
      return { title, line: s.liveFailed, progress: liveProgress(run.turns), phase: "failed" };
  }
}

const ENDED = new Set(["done", "failed", "canceled"]);

/** The run a person's message started, with what its activity starts showing; null: no run (or not theirs). */
export interface LiveActivityStart {
  runId: string;
  agentId: string;
  agentName: string;
  agentHandle: string;
  state: LiveState;
}

/**
 * What the app needs to start an activity for a message the person just sent: the run it started (the first agent's,
 * a person's own work only, never a routine's), the agent, and the first state. Null when it started none, or ended.
 */
export async function liveActivityStartFor(
  db: Database,
  userId: string,
  orgId: string,
  messageId: string,
  locale: string,
): Promise<LiveActivityStart | null> {
  if (!(await getMembership(db, userId, orgId))) throw new ForbiddenError();
  const [message] = await db
    .select({ authorUserId: messages.authorUserId, body: messages.body })
    .from(messages)
    .where(and(eq(messages.orgId, orgId), eq(messages.id, messageId)));
  if (!message) throw new NotFoundError("Message not found");
  if (message.authorUserId !== userId) throw new ForbiddenError();
  const [found] = await db
    .select({ run: agentRuns, agentName: agents.name, agentHandle: agents.handle, issueTitle: issues.title })
    .from(agentRuns)
    .innerJoin(agents, and(eq(agents.orgId, agentRuns.orgId), eq(agents.id, agentRuns.agentId)))
    .leftJoin(issues, and(eq(issues.orgId, agentRuns.orgId), eq(issues.id, agentRuns.issueId)))
    .where(and(eq(agentRuns.orgId, orgId), eq(agentRuns.triggerMessageId, messageId), eq(agentRuns.background, false)))
    .orderBy(asc(agentRuns.createdAt))
    .limit(1);
  if (!found || ENDED.has(found.run.status)) return null;
  const title = liveTitle({ issueTitle: found.issueTitle, body: message.body });
  return {
    runId: found.run.id,
    agentId: found.run.agentId,
    agentName: found.agentName,
    agentHandle: found.agentHandle,
    state: liveStateOf(found.run, title, locale),
  };
}

export interface LiveActivityInput {
  runId: string;
  /** The activity's push token (hex). */
  token: string;
  appId?: string | null;
  sandbox?: boolean;
  locale: string;
}

/**
 * Registers an activity's push token for a run of the person's own message. A new token of the same activity (Apple
 * may give another) takes the place of the old one. Returns the row's id.
 */
export async function registerLiveActivity(
  db: Database,
  userId: string,
  orgId: string,
  input: LiveActivityInput,
  now = new Date(),
): Promise<string> {
  if (!(await getMembership(db, userId, orgId))) throw new ForbiddenError();
  const [found] = await db
    .select({ agentId: agentRuns.agentId, authorUserId: messages.authorUserId, status: agentRuns.status })
    .from(agentRuns)
    .innerJoin(messages, and(eq(messages.orgId, agentRuns.orgId), eq(messages.id, agentRuns.triggerMessageId)))
    .where(and(eq(agentRuns.orgId, orgId), eq(agentRuns.id, input.runId)));
  if (!found) throw new NotFoundError("Run not found");
  if (found.authorUserId !== userId) throw new ForbiddenError();
  const values = {
    orgId,
    userId,
    runId: input.runId,
    agentId: found.agentId,
    token: input.token,
    appId: input.appId ?? null,
    apnsSandbox: input.sandbox === true,
    locale: input.locale,
  };
  return db.transaction(async (tx) => {
    // The same activity's earlier token: one row per activity, the newest token.
    await tx
      .update(liveActivities)
      .set({ endedAt: now })
      .where(
        and(
          eq(liveActivities.userId, userId),
          eq(liveActivities.runId, input.runId),
          ne(liveActivities.token, input.token),
          isNull(liveActivities.endedAt),
        ),
      );
    const [row] = await tx
      .insert(liveActivities)
      .values({ ...values, createdAt: now })
      .onConflictDoUpdate({ target: liveActivities.token, set: { ...values, endedAt: null } })
      .returning({ id: liveActivities.id });
    if (!row) throw new NotFoundError("Run not found");
    return row.id;
  });
}

/** The person ended an activity on the phone (or the app found it gone): nothing more is sent to it. */
export async function endLiveActivity(db: Database, userId: string, token: string, now = new Date()) {
  const rows = await db
    .update(liveActivities)
    .set({ endedAt: now })
    .where(and(eq(liveActivities.userId, userId), eq(liveActivities.token, token), isNull(liveActivities.endedAt)))
    .returning({ id: liveActivities.id });
  return rows.length > 0;
}

export interface LiveSyncDeps {
  db: Database;
  /** Straight to Apple (`createApnsPushSender().liveActivities`); absent: nothing is sent, nothing ends here. */
  sender?: LiveActivitySender | null;
  now?: () => Date;
}

/** Field by field: the database keeps a JSON object's keys in its own order. */
const sameState = (a: Record<string, unknown> | null, b: LiveState) =>
  a !== null && (Object.keys(b) as (keyof LiveState)[]).every((k) => a[k] === b[k]);

/**
 * One pass over the open activities: each run read once, an update sent where what it shows changed, and its end
 * with the run's (gone at once after a quick answer, else after a few minutes). An activity Apple says is gone, or
 * one past Apple's eight hours, is ended. Returns how many pushes went.
 */
export async function syncLiveActivities(deps: LiveSyncDeps): Promise<number> {
  const { sender } = deps;
  if (!sender) return 0;
  // One replica at a time: another one's pass would send the same change twice.
  return deps.db.transaction(async (db) => {
    const lock = rowsOf<{ ok: boolean }>(
      await db.execute(sql`select pg_try_advisory_xact_lock(hashtextextended('live_activities.sync', 0)) as ok`),
    );
    if (lock[0]?.ok === false) return 0;
    return syncPass(db, sender, deps.now?.() ?? new Date());
  });
}

async function syncPass(db: Database, sender: LiveActivitySender, now: Date): Promise<number> {
  const rows = await db
    .select({
      a: liveActivities,
      run: agentRuns,
      body: messages.body,
      issueTitle: issues.title,
    })
    .from(liveActivities)
    .leftJoin(agentRuns, and(eq(agentRuns.orgId, liveActivities.orgId), eq(agentRuns.id, liveActivities.runId)))
    .leftJoin(messages, and(eq(messages.orgId, agentRuns.orgId), eq(messages.id, agentRuns.triggerMessageId)))
    .leftJoin(issues, and(eq(issues.orgId, agentRuns.orgId), eq(issues.id, agentRuns.issueId)))
    .where(isNull(liveActivities.endedAt))
    .orderBy(asc(liveActivities.createdAt))
    .limit(SYNC_BATCH);
  const out: { id: string; message: LiveActivityMessage; state: LiveState; end: boolean }[] = [];
  const expired: string[] = [];
  for (const { a, run, body, issueTitle } of rows) {
    const old = now.getTime() - a.createdAt.getTime() >= LIVE_ACTIVITY_MAX_MS;
    if (!run) {
      expired.push(a.id);
      continue;
    }
    const title = liveTitle({ issueTitle, body });
    const state = liveStateOf(run, title, a.locale);
    const end = ENDED.has(run.status) || old;
    if (!end && sameState(a.state, state)) continue;
    const ran = (run.finishedAt ?? now).getTime() - (run.startedAt ?? run.createdAt).getTime();
    const message: LiveActivityMessage = {
      to: a.token,
      event: end ? "end" : "update",
      state: { ...state },
      apns: { ...(a.appId ? { topic: a.appId } : {}), ...(a.apnsSandbox ? { sandbox: true } : {}) },
      urgent: state.phase === "wait" || end,
      ...(end
        ? { dismissAt: new Date(now.getTime() + (ran < LIVE_ACTIVITY_QUICK_MS ? 0 : LIVE_ACTIVITY_LINGER_MS)) }
        : { staleAt: new Date(now.getTime() + LIVE_ACTIVITY_STALE_MS) }),
    };
    out.push({ id: a.id, message, state, end });
  }
  if (expired.length > 0) {
    await db.update(liveActivities).set({ endedAt: now }).where(inArray(liveActivities.id, expired));
  }
  if (out.length === 0) return 0;
  const results = await sender.send(out.map((o) => o.message));
  let sent = 0;
  for (const [i, o] of out.entries()) {
    const r = results[i];
    if (r?.ok) {
      sent++;
      await db
        .update(liveActivities)
        .set({ state: { ...o.state }, sentAt: now, ...(o.end ? { endedAt: now } : {}) })
        .where(eq(liveActivities.id, o.id));
    } else if (r?.unregistered || (r && r.retryable === false)) {
      // Gone (dismissed, the app removed), or refused for good: tried no more.
      await db.update(liveActivities).set({ endedAt: now }).where(eq(liveActivities.id, o.id));
    }
  }
  return sent;
}

/** Ended activities a day old are forgotten. */
export async function purgeLiveActivities(db: Database, now = new Date()) {
  await db.delete(liveActivities).where(lt(liveActivities.endedAt, new Date(now.getTime() - 24 * 3600_000)));
}
