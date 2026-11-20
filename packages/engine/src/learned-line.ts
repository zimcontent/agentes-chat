import type { PubSub } from "@dougbot/adapters";
import { and, asc, type Database, desc, eq, gte, inArray, isNull, schema, sql } from "@dougbot/db";
import { parseBlockSpec } from "@dougbot/ui/blocks/spec";
import { type ArtifactDeps, createConversationArtifact } from "./artifacts";
import { ValidationError } from "./errors";
import { publishMessageCreated } from "./events";
import {
  type Cadence,
  cadenceOf,
  isLearnedLine,
  LEARNED_KEY,
  type LearnedHow,
  type LearnedLang,
  learnedLine,
  offerButtons,
  offerQuestion,
  offerSpec,
  offerTitle,
  routinePrompt,
  ruleOf,
} from "./learned-words";
import { isMediaAfterReply } from "./media";
import { getMessage, insertMessage, type Message, messageView } from "./messages";
import { isQuickAck } from "./quick-ack";
import { lineLocale, personBehindCall } from "./requester";
import { createRoutine, requireRoutineManager } from "./routines";
import { standingRefusal } from "./standing";

const { agentActions, agentRuns, agents, blockActions, messages, routineRuns, routines, skills } = schema;

/**
 * "Aprendi a fazer isso" (ADR 0120, addendum of 2026-11-20). Agents already got better on their own, but nobody saw
 * it. Once a run left a skill that is new or meaningfully better, the agent says so once, in one plain line under its
 * answer, and when the task looks recurring offers to make it a routine with one tap.
 *
 * Read from facts, never from the wording of the answer: the run's `skill.created` and `skill.updated` receipts (made
 * by `create_skill`, `update_skill`, the learning job's fixes and the promotion of how-tos), not undone. Once per skill
 * (`skills.learned_said_at`), at most one line per run, only where the run spoke (a run that passed or stayed silent
 * says nothing more, and a routine's background run only where it handed off), never for a trivial edit.
 */

/** Past this since the answer it goes under, the moment is gone (a promotion days later): nothing is said. */
export const LEARNED_LATE_MS = 6 * 3600_000;

/** A skill loaded in this many runs already is work that comes back: the offer to make it a routine shows. */
export const RECURRING_USES = 2;

/** An edit counts when it adds at least this many new lines and this much text, or one long new passage. */
export const MEANINGFUL_EDIT = { lines: 2, chars: 80, passage: 200 } as const;

export type LearnedSkip =
  | "missing"
  | "running"
  | "nothing"
  | "trivial"
  | "said"
  | "silent"
  | "late"
  | "standing"
  | "background";

export type LearnedOutcome =
  | { skipped: LearnedSkip }
  | { messageId: string; skillId: string; how: LearnedHow; offered: boolean; cadence: Cadence | null };

export type LearnedDeps = ArtifactDeps & { pubsub: PubSub; now?: () => Date };

const normLine = (l: string) => l.trim().replace(/\s+/g, " ").toLowerCase();

/**
 * Whether a change to a skill taught something: a file written, or new lines that add up (not a typo, a reworded
 * sentence or a moved line).
 */
export function meaningfulChange(before: string, after: string, files: readonly string[] = []): boolean {
  if (files.length > 0) return true;
  const had = new Set(before.split("\n").map(normLine).filter(Boolean));
  const added = after
    .split("\n")
    .map(normLine)
    .filter((l) => l && !had.has(l));
  const chars = added.reduce((n, l) => n + l.length, 0);
  return (added.length >= MEANINGFUL_EDIT.lines && chars >= MEANINGFUL_EDIT.chars) || chars >= MEANINGFUL_EDIT.passage;
}

const bodyOf = (v: unknown) =>
  v && typeof v === "object" && typeof (v as { body?: unknown }).body === "string" ? (v as { body: string }).body : "";

/** The answer the line goes under: the run's reply, else its latest message people read. Null when it said nothing. */
async function answerOf(db: Database, run: typeof agentRuns.$inferSelect): Promise<Message | null> {
  const said = (m: Message | null) =>
    !!m &&
    !m.deletedAt &&
    m.body.trim() !== "" &&
    !isQuickAck(m.meta) &&
    !isMediaAfterReply(m.meta) &&
    !isLearnedLine(m.meta);
  if (run.background) {
    // A routine's run speaks only through `hand_off`: where it handed off is where people saw it.
    const [handed] = await db
      .select({ messageId: routineRuns.messageId })
      .from(routineRuns)
      .where(and(eq(routineRuns.orgId, run.orgId), eq(routineRuns.agentRunId, run.id)))
      .limit(1);
    const m = handed?.messageId ? await getMessage(db, run.orgId, handed.messageId) : null;
    return said(m) ? m : null;
  }
  if (run.replyMessageId) {
    const reply = await getMessage(db, run.orgId, run.replyMessageId);
    if (said(reply)) return reply;
  }
  const rows = await db
    .select()
    .from(messages)
    .where(
      and(
        eq(messages.orgId, run.orgId),
        eq(messages.agentRunId, run.id),
        eq(messages.authorAgentId, run.agentId),
        gte(messages.createdAt, run.createdAt),
        isNull(messages.deletedAt),
      ),
    )
    .orderBy(desc(messages.createdAt))
    .limit(10);
  return (rows as Message[]).find((m) => said(m)) ?? null;
}

interface Found {
  skill: typeof skills.$inferSelect;
  how: LearnedHow;
}

/** The first skill this run made or meaningfully changed that no line spoke of yet, or why there is none. */
async function learnedIn(db: Database, run: typeof agentRuns.$inferSelect): Promise<Found | LearnedSkip> {
  const receipts = await db
    .select()
    .from(agentActions)
    .where(
      and(
        eq(agentActions.orgId, run.orgId),
        eq(agentActions.runId, run.id),
        eq(agentActions.agentId, run.agentId),
        inArray(agentActions.kind, ["skill.created", "skill.updated"]),
        isNull(agentActions.undoneAt),
      ),
    )
    .orderBy(asc(agentActions.createdAt));
  if (receipts.length === 0) return "nothing";
  let trivial = false;
  for (const r of receipts) {
    const params = r.params as { files?: unknown; fromLink?: unknown };
    // An update from the skill's link is someone else's writing, not something the agent learned.
    if (params.fromLink) continue;
    const [skill] = await db
      .select()
      .from(skills)
      .where(and(eq(skills.orgId, run.orgId), eq(skills.id, r.targetId), isNull(skills.deletedAt)));
    if (!skill || skill.learnedSaidAt) continue;
    if (r.kind === "skill.created") {
      const notes = (r.after as { noteIds?: unknown } | null)?.noteIds;
      return { skill, how: Array.isArray(notes) && notes.length > 0 ? "promoted" : "created" };
    }
    const files = Array.isArray(params.files) ? params.files.filter((f): f is string => typeof f === "string") : [];
    if (meaningfulChange(bodyOf(r.before), bodyOf(r.after), files)) return { skill, how: "updated" };
    trivial = true;
  }
  return trivial ? "trivial" : "said";
}

/**
 * Says "Aprendi a fazer isso" for a run when it taught a skill (see the top of this file). The line is the agent's,
 * on its run and at its answer's hop, silent (`meta.learned`: no notification, no routing). With a person behind the
 * run who may manage its routines, a task that looks recurring (a cadence in their words, the skill used in
 * `RECURRING_USES` runs, or a skill made from how-tos used again and again) and no active routine naming the skill
 * yet, a block under the line offers the routine: one button with the cadence they named, or one per common cadence.
 */
export async function announceLearned(
  deps: LearnedDeps,
  input: { orgId: string; runId: string },
): Promise<LearnedOutcome> {
  const { db } = deps;
  const now = deps.now?.() ?? new Date();
  const skip = (skipped: LearnedSkip): LearnedOutcome => ({ skipped });
  const [run] = await db
    .select()
    .from(agentRuns)
    .where(and(eq(agentRuns.orgId, input.orgId), eq(agentRuns.id, input.runId)));
  if (!run) return skip("missing");
  if (run.status === "queued" || run.status === "running") return skip("running");
  const [agent] = await db
    .select({ id: agents.id, archivedAt: agents.archivedAt })
    .from(agents)
    .where(and(eq(agents.orgId, run.orgId), eq(agents.id, run.agentId)));
  if (!agent || agent.archivedAt) return skip("missing");

  const found = await learnedIn(db, run);
  if (typeof found === "string") return skip(found);
  const answer = await answerOf(db, run);
  if (!answer) return skip(run.background ? "background" : "silent");
  if (now.getTime() - answer.createdAt.getTime() > LEARNED_LATE_MS) return skip("late");
  if (await standingRefusal(db, run.orgId, run.agentId)) return skip("standing");

  const person = run.background
    ? null
    : await personBehindCall({ db, orgId: run.orgId, runId: run.id, triggerMessageId: run.triggerMessageId });
  const lang: LearnedLang = (await lineLocale(db, run.orgId, person, run.id)).toLowerCase().startsWith("pt")
    ? "pt"
    : "en";
  const offer = person ? await offerFor(db, run, found, person) : null;

  // Claimed first: two moments of the same run (a turn's end, the learning job) never both speak of one skill.
  const [claimed] = await db
    .update(skills)
    .set({ learnedSaidAt: now })
    .where(and(eq(skills.id, found.skill.id), isNull(skills.learnedSaidAt)))
    .returning({ id: skills.id });
  if (!claimed) return skip("said");
  try {
    const where = { channelId: answer.channelId, threadId: answer.threadId };
    let link: { id: string; version: number; title: string } | null = null;
    if (offer && person) {
      const buttons = offerButtons(offer.cadence, lang);
      const a = await createConversationArtifact(
        deps,
        { type: "agent", agentId: run.agentId, ...where, runId: run.id },
        run.orgId,
        { title: offerTitle(lang), content: { kind: "block", spec: parseBlockSpec(offerSpec(buttons, lang)) } },
      );
      await db.insert(blockActions).values(
        buttons.map((b) => ({
          orgId: run.orgId,
          artifactId: a.id,
          act: b.act,
          kind: b.cadence ? "make_routine" : "skip_routine",
          payload: b.cadence
            ? {
                agentId: run.agentId,
                skillId: found.skill.id,
                name: found.skill.description.slice(0, 120) || found.skill.name,
                prompt: routinePrompt(found.skill, offer.request, lang),
                rule: ruleOf(b.cadence),
                channelId: answer.channelId,
                threadId: answer.threadId,
              }
            : {},
          forUserId: person,
        })),
      );
      link = { id: a.id, version: a.version, title: a.title };
    }
    const body = offer
      ? `${learnedLine(found.how, lang)} ${offerQuestion(offer.cadence, lang)}`
      : learnedLine(found.how, lang);
    const message = await insertMessage(db, {
      orgId: run.orgId,
      ...where,
      // The same agent, run and hop as its answer: it reads as part of it, and wakes nobody.
      author: { type: "agent", agentId: run.agentId, runId: run.id, hop: answer.hop },
      body,
      meta: {
        [LEARNED_KEY]: { skillId: found.skill.id, how: found.how },
        ...(link ? { artifacts: [link] } : {}),
      },
    });
    await publishMessageCreated(deps.pubsub, messageView(message));
    return {
      messageId: message.id,
      skillId: found.skill.id,
      how: found.how,
      offered: !!offer,
      cadence: offer?.cadence ?? null,
    };
  } catch (error) {
    await db.update(skills).set({ learnedSaidAt: null }).where(eq(skills.id, found.skill.id));
    throw error;
  }
}

/** Whether to offer a routine, and with which cadence (null: ask which). Null: no offer. */
async function offerFor(db: Database, run: typeof agentRuns.$inferSelect, found: Found, person: string) {
  try {
    await requireRoutineManager(db, person, run.orgId, run.agentId);
  } catch {
    return null;
  }
  const trigger = await getMessage(db, run.orgId, run.triggerMessageId);
  const request = trigger?.authorUserId === person ? trigger.body : "";
  const cadence = cadenceOf(request);
  const recurring = cadence !== null || found.how === "promoted" || found.skill.useCount >= RECURRING_USES;
  if (!recurring) return null;
  // Already a routine: one active routine of the agent names the skill (as decay reads it).
  const [named] = await db
    .select({ id: routines.id })
    .from(routines)
    .where(
      and(
        eq(routines.orgId, run.orgId),
        eq(routines.agentId, run.agentId),
        eq(routines.active, true),
        isNull(routines.deletedAt),
        sql`${routines.prompt} ilike ${`%${found.skill.slug.replace(/[%_\\]/g, "\\$&")}%`}`,
      ),
    )
    .limit(1);
  if (named) return null;
  return { cadence, request };
}

/**
 * The offer's "Sim" pressed (`runBlockAct`, kind `make_routine`): the routine is made by the person who pressed it,
 * through `createRoutine` as from Routines (who may manage the agent's routines, the cap, the target's checks), in the
 * conversation the line is in, on the schedule the button names (read in code, in the person's time zone).
 */
export async function acceptRoutineOffer(
  deps: { db: Database; pubsub: PubSub },
  userId: string,
  orgId: string,
  payload: Record<string, unknown>,
) {
  const { agentId, prompt, name, rule, channelId, threadId } = payload as {
    agentId?: string;
    prompt?: string;
    name?: string;
    rule?: Record<string, unknown>;
    channelId?: string;
    threadId?: string | null;
  };
  if (!agentId || !prompt || !rule || !channelId) throw new ValidationError("Nothing to make a routine of");
  return createRoutine(deps, userId, orgId, {
    agentId,
    name,
    prompt,
    target: { type: "conversation", channelId, threadId: threadId ?? null, reminder: false },
    trigger: { type: "schedule", rule: rule as never },
  });
}
