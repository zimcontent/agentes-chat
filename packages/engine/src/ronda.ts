import type { PubSub } from "@agenteschat/adapters";
import { and, type Database, desc, type Executor, eq, inArray, isNull, rowsOf, schema, sql } from "@agenteschat/db";
import { isCustomModel, isKnownModel } from "@agenteschat/providers";
import { canTalkTo, speakerFor } from "./audience";
import { recordAudit } from "./audit";
import { nextCronTime } from "./cron";
import { ForbiddenError, NotFoundError, ValidationError } from "./errors";
import { publishListChanged, publishRoutineRuns } from "./events";
import { cutText } from "./format";
import type { Judge } from "./judge";
import type { MailDeps } from "./mail/accounts";
import { can, requireActiveMembership } from "./organizations";
import { isRightHand, RIGHT_HAND } from "./right-hand";
import { isRondaTarget, RONDA_EVENT, type RondaChanges, rondaChanges, rondaEvent } from "./ronda-changes";

const { agents, routines, routineRuns } = schema;

/**
 * The ronda (ADR 9004): an agent looks at the operation on its own, as its owner would, with nobody asking. It is a
 * routine of the agent's (ADR 0053: a background run in its own room that speaks only through `hand_off`, in the DM of
 * the person who turned it on), marked `ronda` on its target, with a gate in code before any model runs (§2–§3).
 */
export const RONDA_SCHEDULES = ["off", "daily", "three_daily", "hourly"] as const;
export type RondaSchedule = (typeof RONDA_SCHEDULES)[number];

/** When each schedule passes, in the person's time zone: mornings, three times a day, or every hour of the day. */
export const RONDA_CRON: Record<Exclude<RondaSchedule, "off">, string> = {
  daily: "0 8 * * *",
  three_daily: "0 8,13,18 * * *",
  hourly: "0 8-20 * * *",
};

const SCHEDULE_WORDS: Record<Exclude<RondaSchedule, "off">, string> = {
  daily: "Every day at 08:00",
  three_daily: "Every day at 08:00, 13:00 and 18:00",
  hourly: "Every hour from 08:00 to 20:00",
};

/** Codes a ronda's slot passes with (the app words them, `routines.code.<code>`). */
export const RONDA_NOTHING = "ronda_nothing";
export const RONDA_QUIET = "ronda_quiet";

/** The judge's bar for spending a run on what changed (§3): below it, the slot passes quietly. */
export const RONDA_WORTH_THRESHOLD = 0.5;

/** How far back the first ronda looks. */
const FIRST_WINDOW_MS = 24 * 3_600_000;

/**
 * The ronda's instructions: its brief in the routine room (fixed by the server, like a widget's: people change only
 * its schedule). What changed comes with it as the run's event.
 */
export const RONDA_PROMPT = [
  "This is your ronda: you look at the operation on your own, as its owner would, and nobody asked for anything.",
  "The server gathered what changed since your last ronda (below, as data). Read it with your role in mind, then check the real sources with your tools before you conclude anything.",
  "Do what you can do yourself now, inside your permissions: move a stuck task forward, look into what failed and fix it or open a task for it, prepare what is coming, research what the work needs (sites, references, numbers). Hand work to the agent it belongs to with tell_agent instead of doing another agent's job.",
  "Bring the person only what is worth their attention: what you did and its result, a finding with its link, a draft ready to approve, or a decision only they can make. One short message through hand_off, in their language, most important first.",
  "Never repeat what your last ronda already reported unless it changed. When nothing deserves anything, just finish: silence is a good ronda.",
].join("\n\n");

export interface RondaView {
  schedule: RondaSchedule;
  routineId: string | null;
  /** Who turned it on: it reports in their DM with the agent. */
  personId: string | null;
  nextRunAt: string | null;
  /** The API model its runs think with (§5); null: the agent's own brain. */
  model: string | null;
  /** Its latest slots, newest first: how each ended and why (`code`). */
  recent: { at: string; status: string; code: string | null; summary: string }[];
}

type RoutineRow = typeof routines.$inferSelect;

/**
 * The agent's ronda routine (one at most, the newest when two raced), live or switched off. The right hand has one per
 * person (ADR 9005 §3): `personId` is whose; any other agent has one, whoever turned it on.
 */
async function rondaRoutine(
  db: Database,
  orgId: string,
  agentId: string,
  personId?: string,
): Promise<RoutineRow | null> {
  const [row] = await db
    .select()
    .from(routines)
    .where(
      and(
        eq(routines.orgId, orgId),
        eq(routines.agentId, agentId),
        isNull(routines.deletedAt),
        sql`(${routines.target} ->> 'ronda') = 'true'`,
        personId ? eq(routines.createdByUserId, personId) : undefined,
      ),
    )
    .orderBy(desc(routines.createdAt))
    .limit(1);
  return row ?? null;
}

const scheduleOf = (row: RoutineRow | null): RondaSchedule => {
  if (!row?.active || !row.cron) return "off";
  const found = (Object.keys(RONDA_CRON) as Exclude<RondaSchedule, "off">[]).find((k) => RONDA_CRON[k] === row.cron);
  return found ?? "daily";
};

/** The agent's ronda as its settings show it (any member who reads the agent). */
export async function getRonda(db: Database, actorId: string, orgId: string, agentId: string): Promise<RondaView> {
  await requireActiveMembership(db, actorId, orgId);
  const row = await rondaRoutine(db, orgId, agentId, (await rightHandOf(db, orgId, agentId)) ? actorId : undefined);
  const recent = row
    ? await db
        .select({
          at: routineRuns.at,
          status: routineRuns.status,
          code: routineRuns.code,
          summary: routineRuns.summary,
        })
        .from(routineRuns)
        .where(and(eq(routineRuns.orgId, orgId), eq(routineRuns.routineId, row.id)))
        .orderBy(desc(routineRuns.createdAt))
        .limit(5)
    : [];
  return {
    schedule: scheduleOf(row),
    routineId: row?.id ?? null,
    personId: row?.createdByUserId ?? null,
    nextRunAt: row?.active && row.nextRunAt ? row.nextRunAt.toISOString() : null,
    model: rondaModelOf(row?.target).model ?? null,
    recent: recent.map((r) => ({
      at: r.at.toISOString(),
      status: r.status,
      code: r.code,
      summary: cutText(r.summary, 400),
    })),
  };
}

/**
 * Turns the agent's ronda on, changes when it passes, or switches it off (§1). Admins who manage agents, or the
 * agent's owner. Turning it on makes the person who does it its person: it reports in their DM with the agent, and
 * what it reads is what they see. Off keeps the routine (its history stays) inactive.
 */
export async function setRonda(
  deps: { db: Database; pubsub: PubSub; now?: () => Date },
  actorId: string,
  orgId: string,
  agentId: string,
  schedule: RondaSchedule,
  timezone: string,
  /** The API model its runs think with (§5): a catalog model, null for the agent's own brain, absent to keep it. */
  model?: string | null,
): Promise<RondaView> {
  const { db } = deps;
  if (!RONDA_SCHEDULES.includes(schedule)) throw new ValidationError("unknown ronda schedule");
  if (model && !isKnownModel(model) && !isCustomModel(model)) throw new ValidationError("unknown model");
  const membership = await requireActiveMembership(db, actorId, orgId);
  const [agent] = await db
    .select()
    .from(agents)
    .where(and(eq(agents.id, agentId), eq(agents.orgId, orgId), isNull(agents.deletedAt)));
  if (!agent || agent.archivedAt) throw new NotFoundError("agent not found");
  // The right hand is everyone's (ADR 9005 §3): each person who may talk to it sets their own ronda, in their own DM.
  const own = isRightHand(agent);
  if (own) {
    if (!canTalkTo(agent, actorId, await speakerFor(db, orgId, actorId))) throw new ForbiddenError();
  } else if (!can(membership, "manage_agents") && agent.ownerUserId !== actorId) throw new ForbiddenError();
  const now = deps.now?.() ?? new Date();
  const existing = await rondaRoutine(db, orgId, agentId, own ? actorId : undefined);
  const keptModel = model === undefined ? rondaModelOf(existing?.target).model : model;
  const target: Record<string, unknown> = { type: "dm", ronda: true, ...(keptModel ? { model: keptModel } : {}) };
  if (schedule === "off") {
    if (existing && (existing.active || model !== undefined)) {
      await db
        .update(routines)
        .set({ active: false, nextRunAt: null, pausedReason: null, target, updatedAt: now })
        .where(eq(routines.id, existing.id));
      await recordAudit(db, {
        orgId,
        actor: { type: "person", id: actorId },
        action: "routine.updated",
        target: { type: "routine", id: existing.id },
        details: { agentId, ronda: "off" },
      });
      await publishListChanged(deps.pubsub, orgId, "routines");
      await publishRoutineRuns(deps.pubsub, orgId, existing.id).catch(() => {});
    }
    return getRonda(db, actorId, orgId, agentId);
  }
  const cron = RONDA_CRON[schedule];
  const fields = {
    agentId,
    name: "Ronda",
    // Instructions a person added in Rotinas stay ("look at the ads first"); the default otherwise.
    prompt: existing?.prompt.trim() ? existing.prompt : RONDA_PROMPT,
    target,
    triggerType: "schedule",
    phrase: null,
    cron,
    rule: null,
    timezone,
    description: SCHEDULE_WORDS[schedule],
    event: null,
    access: "act",
    report: "when_new",
    ownActions: [] as string[],
    createdByUserId: actorId,
    active: true,
    pausedReason: null,
    failuresInRow: 0,
    nextRunAt: nextCronTime(cron, timezone, now),
    updatedAt: now,
  };
  let routineId: string;
  if (existing) {
    await db.update(routines).set(fields).where(eq(routines.id, existing.id));
    routineId = existing.id;
  } else {
    const [made] = await db
      .insert(routines)
      .values({ orgId, ...fields })
      .returning({ id: routines.id });
    if (!made) throw new Error("ronda routine insert returned nothing");
    routineId = made.id;
  }
  await recordAudit(db, {
    orgId,
    actor: { type: "person", id: actorId },
    action: existing ? "routine.updated" : "routine.created",
    target: { type: "routine", id: routineId },
    details: { agentId, ronda: schedule },
  });
  await publishListChanged(deps.pubsub, orgId, "routines");
  await publishRoutineRuns(deps.pubsub, orgId, routineId).catch(() => {});
  return getRonda(db, actorId, orgId, agentId);
}

/** How recently a person used the workspace for the right hand to start a ronda with them on its own (ADR 9005 §6). */
const ACTIVE_FOR_RONDA_MS = 30 * 24 * 3_600_000;

/**
 * The right hand's ronda is on for every person by default (ADR 9005 §6): each member who used the workspace in the
 * last 30 days and may talk to it gets their own ronda, every hour of the day in their time zone, unless they ever had
 * one. One they switched off or deleted is never made again: off is their choice. Runs at boot and every hour, so a
 * person who joins or comes back gets theirs. Returns how many it made.
 */
export async function ensureRightHandRondas(db: Database, now = new Date()): Promise<number> {
  const hands = await db
    .select()
    .from(agents)
    .innerJoin(schema.organizations, eq(schema.organizations.id, agents.orgId))
    .where(
      and(
        eq(agents.builtin, RIGHT_HAND),
        isNull(agents.archivedAt),
        isNull(agents.deletedAt),
        isNull(schema.organizations.deletionDueAt),
      ),
    );
  const since = new Date(now.getTime() - ACTIVE_FOR_RONDA_MS);
  const schedule = "hourly" as const;
  const cron = RONDA_CRON[schedule];
  let made = 0;
  for (const { agents: agent } of hands) {
    const people = rowsOf<{ user_id: string; timezone: string | null }>(
      await db.execute(sql`select om.user_id, coalesce(om.timezone, os.timezone) as timezone
          from ${schema.organizationMembers} om
          join ${schema.users} u on u.id = om.user_id
          left join ${schema.organizationSettings} os on os.org_id = om.org_id
          where om.org_id = ${agent.orgId}::uuid and u.blocked_at is null and u.deletion_due_at is null
            and om.last_seen_at >= ${since.toISOString()}::timestamptz
            and not exists (select 1 from ${routines} r where r.org_id = om.org_id and r.agent_id = ${agent.id}::uuid
              and r.created_by_user_id = om.user_id and (r.target ->> 'ronda') = 'true')`),
    );
    for (const person of people) {
      if (!canTalkTo(agent, person.user_id, await speakerFor(db, agent.orgId, person.user_id))) continue;
      const timezone = validZone(person.timezone);
      const added = await db.transaction(async (tx) => {
        // Two servers sweeping at once make one: the second finds the first's row under the lock.
        await tx.execute(
          sql`select pg_advisory_xact_lock(hashtext(${`right-hand-ronda:${agent.id}:${person.user_id}`}))`,
        );
        const [had] = await tx
          .select({ id: routines.id })
          .from(routines)
          .where(
            and(
              eq(routines.orgId, agent.orgId),
              eq(routines.agentId, agent.id),
              eq(routines.createdByUserId, person.user_id),
              sql`(${routines.target} ->> 'ronda') = 'true'`,
            ),
          )
          .limit(1);
        if (had) return false;
        await tx.insert(routines).values({
          orgId: agent.orgId,
          agentId: agent.id,
          name: "Ronda",
          prompt: RONDA_PROMPT,
          target: { type: "dm", ronda: true },
          triggerType: "schedule",
          phrase: null,
          cron,
          rule: null,
          timezone,
          description: SCHEDULE_WORDS[schedule],
          event: null,
          access: "act",
          report: "when_new",
          ownActions: [],
          createdByUserId: person.user_id,
          active: true,
          nextRunAt: nextCronTime(cron, timezone, now),
        });
        return true;
      });
      if (added) made++;
    }
  }
  return made;
}

/** A stored time zone the cron can use, or UTC. */
function validZone(zone: string | null): string {
  if (!zone) return "UTC";
  try {
    new Intl.DateTimeFormat("en", { timeZone: zone });
    return zone;
  } catch {
    return "UTC";
  }
}

/**
 * Where this ronda's window starts (§2): when its last gate looked (`until` on that slot's event, written whether the
 * slot ran or passed). Slots skipped before the gate (paused, the previous still running) looked at nothing.
 */
async function windowStart(db: Database, routineId: string, now: Date, currentRunId: string): Promise<Date> {
  const [last] = await db
    .select({ until: sql<string | null>`${routineRuns.event} ->> 'until'`, at: routineRuns.at })
    .from(routineRuns)
    .where(
      and(
        eq(routineRuns.routineId, routineId),
        sql`${routineRuns.id} <> ${currentRunId}::uuid`,
        sql`${routineRuns.event} ->> 'type' = ${RONDA_EVENT}`,
      ),
    )
    .orderBy(desc(sql`${routineRuns.event} ->> 'until'`))
    .limit(1);
  const until = last?.until ? new Date(last.until) : null;
  return until && !Number.isNaN(until.getTime()) ? until : new Date(now.getTime() - FIRST_WINDOW_MS);
}

/** The last thing a ronda told people (its record), for the judge not to spend a run on news already given. */
async function lastRecord(db: Database, routineId: string): Promise<string> {
  const [last] = await db
    .select({ summary: routineRuns.summary })
    .from(routineRuns)
    .where(and(eq(routineRuns.routineId, routineId), inArray(routineRuns.status, ["reported", "silent"])))
    .orderBy(desc(routineRuns.at))
    .limit(1);
  return last?.summary ?? "";
}

/** `since`: where the slot's window started (what "arrived" means for the right hand's cards). */
export type RondaGate =
  | { skip: typeof RONDA_NOTHING | typeof RONDA_QUIET; since: Date }
  | { event: Record<string, unknown>; opening: boolean; since: Date };

/** The calendar day of `at` in `zone` (`2026-11-17`). */
const dayIn = (at: Date, zone: string) => {
  try {
    return new Intl.DateTimeFormat("en-CA", {
      timeZone: zone,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
    }).format(at);
  } catch {
    return at.toISOString().slice(0, 10);
  }
};

/**
 * Whether this slot opens the person's day (ADR 9005 §4): the right hand's first ronda that looks today, in the
 * routine's time zone. A person's "Run now" never takes the opening from the day's first scheduled slot.
 */
async function opensTheDay(
  db: Database,
  routine: { id: string; timezone: string | null },
  run: { id: string; trigger: string },
  now: Date,
): Promise<boolean> {
  if (run.trigger === "manual") return false;
  const [last] = await db
    .select({ at: routineRuns.at })
    .from(routineRuns)
    .where(
      and(
        eq(routineRuns.routineId, routine.id),
        sql`${routineRuns.id} <> ${run.id}::uuid`,
        sql`${routineRuns.event} ->> 'opening' = 'true'`,
      ),
    )
    .orderBy(desc(routineRuns.at))
    .limit(1);
  const zone = routine.timezone || "UTC";
  return !last || dayIn(last.at, zone) !== dayIn(now, zone);
}

/**
 * The gate before a ronda's run (§2–§3), called as its slot fires: what changed, from stored data (no model); nothing
 * → the slot passes (`ronda_nothing`). Something → the judge reads it with the agent's role and its last record and
 * says whether it is worth a run; below `RONDA_WORTH_THRESHOLD` the slot passes (`ronda_quiet`). A person's "Run
 * now" skips the judge, and runs even with nothing new: they asked. The judge failing or absent lets the run start:
 * a ronda that saw changes should not go silent because a cheap call failed.
 */
export async function rondaGate(
  deps: { db: Database; judge?: Judge | null; now?: Date; mail?: Omit<MailDeps, "db"> | null },
  input: {
    routine: Pick<RoutineRow, "id" | "orgId" | "target"> & Partial<Pick<RoutineRow, "timezone">>;
    run: { id: string; trigger: string };
    agent: { id: string; name: string; handle: string; role: string; instructions: string; builtin?: string | null };
    personId: string;
  },
): Promise<RondaGate> {
  const now = deps.now ?? new Date();
  const since = await windowStart(deps.db, input.routine.id, now, input.run.id);
  const changes = await rondaChanges(deps.db, {
    orgId: input.routine.orgId,
    agentId: input.agent.id,
    personId: input.personId,
    since,
    now,
    mail: deps.mail,
  });
  // The right hand's first ronda of the day always runs (ADR 9005 §4): it opens the person's day.
  const opening =
    isRightHand(input.agent) &&
    (await opensTheDay(deps.db, { id: input.routine.id, timezone: input.routine.timezone ?? null }, input.run, now));
  const asked = input.run.trigger === "manual" || opening;
  const quiet =
    !asked &&
    (changes.count === 0
      ? RONDA_NOTHING
      : deps.judge && !(await worthARun(deps.judge, input, changes, await lastRecord(deps.db, input.routine.id)))
        ? RONDA_QUIET
        : null);
  // Kept on the slot either way: the run reads it, and the next ronda's window starts at `until`.
  const event = { ...rondaEvent(changes, since, now), ...(opening ? { opening: true } : {}) };
  await deps.db.update(routineRuns).set({ event }).where(eq(routineRuns.id, input.run.id));
  return quiet ? { skip: quiet, since } : { event, opening, since };
}

/** Whether `agentId` is the workspace's right hand. */
async function rightHandOf(db: Database, orgId: string, agentId: string) {
  const [row] = await db
    .select({ builtin: agents.builtin })
    .from(agents)
    .where(and(eq(agents.orgId, orgId), eq(agents.id, agentId)));
  return row?.builtin === "right_hand";
}

/** The judge's read (§3): is there something here this agent should act on or bring to the person? */
async function worthARun(
  judge: Judge,
  input: {
    routine: Pick<RoutineRow, "orgId">;
    agent: { id: string; name: string; handle: string; role: string; instructions: string };
  },
  changes: RondaChanges,
  record: string,
): Promise<boolean> {
  try {
    const answers = await judge.ask({
      orgId: input.routine.orgId,
      agentId: input.agent.id,
      kind: "ronda_worth",
      state: {
        agent: {
          name: input.agent.name,
          handle: `@${input.agent.handle}`,
          role: input.agent.role,
          instructions: cutText(input.agent.instructions, 1500),
        },
        changes: cutText(changes.text, 6000),
        last_ronda_record: cutText(record, 1500),
      },
      questions: {
        worth: {
          type: "noul",
          instructions:
            "`agent` makes rounds of its workspace on its own, as an owner would, with nobody asking. `changes` is what happened since its last round. Is there something in `changes` that this agent, given its role and instructions, should act on now or bring to the person's attention (something broke or failed, work is stuck or late, a decision waits too long, a request or an opportunity in the conversations that fits its role)? `last_ronda_record` is what it already found or reported last time: the same thing again is not new.",
          criteria: {
            true: "Something fits this agent's role and deserves action or the person's attention now: a failure to look into, stuck or late work it can move, a decision waiting too long, a request, a problem or an opportunity in the conversations that is its business.",
            false:
              "Routine noise or someone else's business: chatter, thanks, work moving normally, things done, matters outside its role, or only what its last round already handled.",
          },
        },
      },
    });
    return (answers.worth?.noul ?? 1) >= RONDA_WORTH_THRESHOLD;
  } catch {
    return true;
  }
}

/** Whether a routine row is a ronda (its target marked, ADR 9004 §1). */
export const isRonda = (row: { target: unknown }) => isRondaTarget(row.target);

export { isRondaTarget, RONDA_EVENT, rondaChanges };

/** A ronda target's own model (§5), as a brief's field: `{ model }`, or nothing for the agent's own brain. */
export function rondaModelOf(target: unknown): { model?: string } {
  if (!isRondaTarget(target)) return {};
  const model = (target as { model?: unknown }).model;
  return typeof model === "string" && model ? { model } : {};
}

/**
 * The agent as a ronda's own run thinks (§5): with the ronda's model, through the API on the workspace's key of that
 * model's provider, in place of whatever brain the agent has (a plan on a computer, the right hand's person's AI).
 * Every other run, and a ronda with no model of its own, gets the agent as given. Callers apply it after the right
 * hand's own AI, so the ronda's choice wins.
 */
export async function withRondaModel<
  T extends { orgId: string; brain: string; model: string; credentialId: string | null },
>(db: Executor, agent: T, run: { orgId: string; id: string }): Promise<T> {
  const { runAuthorityById } = await import("./authority");
  const authority = await runAuthorityById(db, run.orgId, run.id).catch(() => null);
  const model = authority?.kind === "routine" ? authority.brief?.model : undefined;
  if (!model) return agent;
  return { ...agent, brain: "model", model, credentialId: null };
}
