import type { PubSub } from "@dougbot/adapters";
import { and, asc, type Database, type Executor, eq, inArray, ne, or, schema, sql } from "@dougbot/db";
import { startOrJoinRun } from "./dispatch";
import { publishChannelEvent } from "./events";
import { cutText } from "./format";
import type { Message, ReplyRef } from "./messages";
import { missionOfThread } from "./missions";
import { holdsMessages } from "./run-hold";
import { ACTIVE_RUN_STATUSES, queueOnRun, triggerFor } from "./run-inbox";
import { inChannelRun } from "./run-scope";
import { type AgentRun, addRunStep, replyThreadOf } from "./runs";

const { agentRuns, messages } = schema;

/**
 * Parallel work (docs/adr/doug-0038-parallel-work.md, this instance's own): while an agent works a long task in a
 * conversation, a person's new, separate request there starts a second run of the same agent beside it, in its own
 * computer session, instead of waiting for the task's end. What is about the task (a correction, a question, a stop,
 * more detail) still goes to the task (`steering.ts`).
 */

/** A run younger than this is no long task yet: a separate request waits for its end, as before (`queueAfterRun`). */
export const PARALLEL_AFTER_MS = 60_000;

/** At most this many runs of one agent at work in one conversation at once: past it, a request waits as before. */
export const MAX_PARALLEL_RUNS = 3;

/**
 * Words that say a short message is about the work in progress, in Portuguese, English and Spanish: a stop, a go-on,
 * a status question, thanks or a plain yes. Matched at the start of a message of at most `SHORT_WORDS` words (after the
 * agent's @handle): a longer one that starts so may still ask for something new ("ok, e monta também a proposta").
 */
const ABOUT_THE_TASK_SHORT = [
  // Stop, wait, go on.
  /^(para|pare|parar|stop|cancel[ae]?|deixa|esquece|forget it|espera|aguarda|wait|hold on|continu[ae]|segue|go on|keep going|sigue)(?=$|[^\p{L}\p{N}])/u,
  // How is it going.
  /^(e a[ií]|como (est[aá]|t[aá]|vai|anda)|cad[eê]|status|andamento|progress|how('s| is) it going|how far|qu[eé] tal|c[oó]mo va)(?=$|[^\p{L}\p{N}])/u,
  // Thanks, yes, ok.
  /^(ok|okay|blz|beleza|valeu|vlw|obrigad[oa]|brigad[oa]|thanks|thank you|gracias|sim|yes|s[ií]|isso|exato|perfeito|show|top|massa)(?=$|[^\p{L}\p{N}])/u,
];
const SHORT_WORDS = 6;

/** Words that point at the work itself ("nessa planilha, …"), whatever the message's length. */
const POINTS_AT_THE_TASK =
  /^(nessa|nesta|nesse|neste|nisso|nela|nele|na mesma|no mesmo|tamb[eé]m (nessa|nesse|nisso)|in (that|this|it)|on (that|this|it))(?=$|[^\p{L}\p{N}])/u;

/**
 * The rules before any judgment: whether a person's message sent while the agent works may be a separate request at
 * all. `task`: it is about the work in progress (the triage still decides how the task takes it); `judge`: the
 * triage's `queue` may start it beside the task. `quotedOwn`: it quotes the task's own reply or its request.
 */
export function parallelRule(input: { text: string; now: boolean; quotedOwn: boolean }): {
  verdict: "task" | "judge";
  reason: "now" | "quoted" | "short" | "words" | null;
} {
  if (input.now) return { verdict: "task", reason: "now" };
  if (input.quotedOwn) return { verdict: "task", reason: "quoted" };
  const text = input.text
    .trim()
    .toLowerCase()
    .replace(/^(@[\w.-]+[\s,:]*)+/, "")
    .trim();
  const words = text.split(/\s+/).filter((w) => /[\p{L}\p{N}]/u.test(w)).length;
  // Two words or fewer ask no new work ("e aí?", "manda ver", "valeu!").
  if (words <= 2) return { verdict: "task", reason: "short" };
  if (POINTS_AT_THE_TASK.test(text)) return { verdict: "task", reason: "words" };
  if (words <= SHORT_WORDS && ABOUT_THE_TASK_SHORT.some((rule) => rule.test(text)))
    return { verdict: "task", reason: "words" };
  return { verdict: "judge", reason: null };
}

/** SQL: an active run of the same agent in the same conversation as `run` (`heldHere` reads the conversation so). */
function sameConversation(
  run: Pick<AgentRun, "orgId" | "agentId" | "channelId" | "threadRootId" | "triggerMessageId">,
) {
  return and(
    eq(agentRuns.orgId, run.orgId),
    eq(agentRuns.agentId, run.agentId),
    eq(agentRuns.channelId, run.channelId),
    eq(agentRuns.background, false),
    inArray(agentRuns.status, [...ACTIVE_RUN_STATUSES]),
    or(eq(agentRuns.threadRootId, run.threadRootId), replyThreadOf(run) ? undefined : inChannelRun(sql`${agentRuns}`)),
  );
}

/** How many runs of the agent are active in this conversation, `run` included. */
export async function activeHere(
  db: Executor,
  run: Pick<AgentRun, "orgId" | "agentId" | "channelId" | "threadRootId" | "triggerMessageId">,
): Promise<number> {
  const [row] = await db
    .select({ n: sql<number>`count(*)`.mapWith(Number) })
    .from(agentRuns)
    .where(sameConversation(run));
  return row?.n ?? 0;
}

/** What a run works on, as its judges read it: its request, grown with what the person added, else its trigger. */
export async function taskOf(
  db: Executor,
  run: Pick<AgentRun, "orgId" | "triggerMessageId" | "transcript">,
): Promise<string | null> {
  const request = (run.transcript as { request?: unknown } | null)?.request;
  if (typeof request === "string" && request.trim()) return request;
  const [trigger] = await db
    .select({ body: messages.body })
    .from(messages)
    .where(and(eq(messages.orgId, run.orgId), eq(messages.id, run.triggerMessageId)))
    .limit(1);
  return trigger?.body.trim() || null;
}

/**
 * The agent's other runs at work in this conversation that take messages (not held by a decision, `holdsMessages`),
 * oldest first, with what each works on. `read`: those runs already read (`othersHere`, which the run's context reads
 * anyway), so no statement of its own while there are none.
 */
export async function siblingRuns(
  db: Executor,
  run: Pick<AgentRun, "id" | "orgId" | "agentId" | "channelId" | "threadRootId" | "triggerMessageId">,
  read?: AgentRun[],
): Promise<{ run: AgentRun; task: string | null }[]> {
  const rows = read
    ? read.filter((r) => r.id !== run.id && !r.background && r.agentId === run.agentId).slice(0, MAX_PARALLEL_RUNS)
    : await db
        .select()
        .from(agentRuns)
        .where(and(sameConversation(run), ne(agentRuns.id, run.id)))
        .orderBy(asc(agentRuns.createdAt))
        .limit(MAX_PARALLEL_RUNS);
  const out: { run: AgentRun; task: string | null }[] = [];
  for (const row of rows) {
    if (await holdsMessages(db, row)) continue;
    out.push({ run: row, task: await taskOf(db, row).catch(() => null) });
  }
  return out;
}

/** The run a quote reply points at: the run that wrote the quoted message, or the one it asked. Null for none. */
export async function quotedRunId(db: Executor, message: Pick<Message, "orgId" | "meta">): Promise<string | null> {
  const quoted = (message.meta.replyTo as ReplyRef | undefined)?.messageId;
  if (typeof quoted !== "string") return null;
  const [row] = await db
    .select({ runId: messages.agentRunId })
    .from(messages)
    .where(and(eq(messages.orgId, message.orgId), eq(messages.id, quoted)))
    .limit(1);
  if (row?.runId) return row.runId;
  const [asked] = await db
    .select({ id: agentRuns.id })
    .from(agentRuns)
    .where(and(eq(agentRuns.orgId, message.orgId), eq(agentRuns.triggerMessageId, quoted)))
    .orderBy(sql`${agentRuns.createdAt} desc`)
    .limit(1);
  return asked?.id ?? null;
}

/**
 * Whether a separate request sent into `run` may start beside it: a person's message, not "Parar e mandar", into a
 * conversation run (not background work, not a mission's thread) that has been at work at least `PARALLEL_AFTER_MS`.
 * The cap (`MAX_PARALLEL_RUNS`) is checked when the run starts (`startParallelRun`).
 */
export async function mayRunBeside(
  db: Executor,
  run: AgentRun,
  message: Pick<Message, "authorType" | "body" | "meta" | "orgId">,
  options: { now: boolean; atWork: boolean; at?: Date },
): Promise<boolean> {
  if (message.authorType !== "person" || !options.atWork) return false;
  if (run.status !== "running" || run.background || run.workId) return false;
  const since = (run.startedAt ?? run.createdAt).getTime();
  if ((options.at ?? new Date()).getTime() - since < PARALLEL_AFTER_MS) return false;
  const quoted = await quotedRunId(db, message).catch(() => null);
  if (parallelRule({ text: message.body, now: options.now, quotedOwn: quoted === run.id }).verdict === "task")
    return false;
  if (await missionOfThread(db, run.orgId, run.threadRootId)) return false;
  return true;
}

/** Rolls the start back: the message stays in the task's inbox, as before. */
class NotStarted extends Error {}

/**
 * A separate request starts beside the run at work (`steerHandling` `queue`, the run past `PARALLEL_AFTER_MS`): out of
 * the run's inbox while still unread and into a new run of the same agent in the same conversation, whose trigger it
 * is. That run thinks in a session of its own (`sessionFor` never picks a session an active run uses) and answers in
 * the conversation like any run. Null: not started (the run read it already, or ended, or the agent already has
 * `MAX_PARALLEL_RUNS` at work here): the caller goes on as before. One message, one run: it leaves the inbox in the same
 * transaction that starts the new run.
 */
export async function startParallelRun(
  db: Database,
  pubsub: PubSub | undefined,
  run: AgentRun,
  message: Message,
): Promise<AgentRun | null> {
  const trigger = await triggerFor(db, run, message);
  const started = await db
    .transaction(async (tx) => {
      // One start at a time per agent and conversation: two requests at once never pass the cap together.
      await tx.execute(sql`select pg_advisory_xact_lock(hashtext(${`parallel:${run.agentId}:${run.channelId}`}))`);
      if ((await activeHere(tx, run)) >= MAX_PARALLEL_RUNS) return null;
      const taken = await tx
        .update(agentRuns)
        .set({
          pendingMessageIds: sql`array_remove(${agentRuns.pendingMessageIds}, ${message.id}::uuid)`,
          updatedAt: new Date(),
        })
        .where(
          and(
            eq(agentRuns.id, run.id),
            eq(agentRuns.status, "running"),
            sql`${message.id}::uuid = any(${agentRuns.pendingMessageIds})`,
          ),
        )
        .returning({ id: agentRuns.id });
      if (taken.length === 0) return null;
      const out = await startOrJoinRun(tx, message, run.agentId, trigger, { alongside: true });
      if (!out || !("created" in out)) throw new NotStarted();
      await steeredInto(tx, message, run.id, out.created.id);
      return out.created;
    })
    .catch((e) => {
      if (e instanceof NotStarted) return null;
      throw e;
    });
  if (!started) return null;
  await addRunStep(db, run, "context", {
    redispatchedMessageIds: [message.id],
    reason: "parallel",
    toRunId: started.id,
  }).catch(() => undefined);
  await publishChannelEvent(pubsub, {
    type: "agent.run.redispatched",
    channelId: run.channelId,
    threadId: replyThreadOf(run),
    agentId: run.agentId,
    runId: run.id,
    newRunId: started.id,
    messageIds: [message.id],
  });
  await publishChannelEvent(pubsub, {
    type: "agent.thinking",
    channelId: run.channelId,
    threadId: replyThreadOf(started),
    agentId: run.agentId,
    runId: started.id,
  });
  return started;
}

/**
 * A message that went into one run is about another of the agent's runs at work there (it quotes that run, or the
 * triage says so): it moves to that run's inbox while still unread in the first. False: read already, or the other run
 * no longer takes messages; it stays where it was.
 */
export async function moveToSibling(
  db: Database,
  pubsub: PubSub | undefined,
  from: AgentRun,
  to: AgentRun,
  message: Message,
): Promise<boolean> {
  const moved = await db
    .transaction(async (tx) => {
      const taken = await tx
        .update(agentRuns)
        .set({
          pendingMessageIds: sql`array_remove(${agentRuns.pendingMessageIds}, ${message.id}::uuid)`,
          updatedAt: new Date(),
        })
        .where(
          and(
            eq(agentRuns.id, from.id),
            inArray(agentRuns.status, [...ACTIVE_RUN_STATUSES]),
            sql`${message.id}::uuid = any(${agentRuns.pendingMessageIds})`,
          ),
        )
        .returning({ id: agentRuns.id });
      if (taken.length === 0) return false;
      if (!(await queueOnRun(tx, to.id, message.id))) throw new NotStarted();
      await steeredInto(tx, message, from.id, to.id);
      return true;
    })
    .catch((e) => {
      if (e instanceof NotStarted) return false;
      throw e;
    });
  if (!moved) return false;
  await addRunStep(db, from, "context", {
    redispatchedMessageIds: [message.id],
    reason: "sibling",
    toRunId: to.id,
  }).catch(() => undefined);
  await publishChannelEvent(pubsub, {
    type: "agent.run.redispatched",
    channelId: from.channelId,
    threadId: replyThreadOf(from),
    agentId: from.agentId,
    runId: from.id,
    newRunId: to.id,
    messageIds: [message.id],
  });
  return true;
}

/** The message's `steeredRunIds` names the run that has it now, never the one it left (receipts, the router). */
async function steeredInto(
  tx: Executor,
  message: Pick<Message, "id" | "orgId" | "createdAt">,
  from: string,
  to: string,
) {
  const runs = sql`(coalesce(${messages.meta}->'steeredRunIds', '[]'::jsonb) - ${from}::text - ${to}::text) || jsonb_build_array(${to}::text)`;
  await tx
    .update(messages)
    .set({ meta: sql`jsonb_set(${messages.meta}, '{steeredRunIds}', ${runs})` })
    .where(
      and(
        eq(messages.orgId, message.orgId),
        eq(messages.id, message.id),
        sql`${messages.createdAt} >= ${new Date(new Date(message.createdAt).getTime() - 1000).toISOString()}::timestamptz`,
      ),
    );
}

/**
 * The context line of a run with siblings at work in the same conversation: what each other one works on, so the two
 * neither collide nor redo each other's work. Null when it works alone.
 */
export async function alongsideHere(
  db: Executor,
  run: Pick<AgentRun, "id" | "orgId" | "agentId" | "channelId" | "threadRootId" | "triggerMessageId">,
  read?: AgentRun[],
): Promise<string | null> {
  const others = await siblingRuns(db, run, read);
  if (others.length === 0) return null;
  return [
    "# Also at work here",
    "You are also working on this in another session of yours in this conversation, right now:",
    ...others.map((o) => `- ${cutText(o.task ?? "(a task asked here)", 300)}`),
    "That session does it and answers it itself: don't redo it, don't answer for it, and don't touch the same files or records at once. Do only what you were asked here; if your work depends on it, say so.",
  ].join("\n");
}
