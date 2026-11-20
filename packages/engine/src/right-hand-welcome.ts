import { and, type Database, type Executor, eq, gt, ne, schema, sql } from "@dougbot/db";
import { serverText } from "@dougbot/i18n";
import { en } from "@dougbot/i18n/en";
import { personAgentDmKey } from "./dms";
import type { JobDeps } from "./jobs";
import { enqueue } from "./outbox";
import { personLocale } from "./requester";
import { defineLodiLane, type LodiPromptContext } from "./right-hand-lane";
import { lodiFor, lodiSwitches, postFromLodi } from "./right-hand-proactive";
import { orgStanding, workRefusal } from "./standing";
import type { ReplyChips } from "./team-proposals";

/**
 * "Dar boas-vindas a quem entra": one message from the right hand to each person who joins a workspace, once, and
 * what it keeps in mind while they are new. The greeting calls no model.
 *
 * The contract with the rest of the server is `welcomeLane` below: the server reads the job, the prompt block and the
 * switch from it, so nothing else is wired by hand.
 * - `WELCOME_JOB` is queued where a person becomes a member (`queueWelcome`), in that transaction, with
 *   `payload.userId` and one dedupe key per workspace and person, so nobody is greeted twice, a rejoin included.
 * - `postWelcome` is that job. It posts nothing when the workspace turned it off (`lodiSwitches(...).welcomePeople`)
 *   or `lodiFor` says no, and may run twice (`postFromLodi` with `posted`). A job that ends without posting spent
 *   its key: nobody is greeted late.
 * - `newcomerBlock` is a block of the right hand's prompt in its DM with `ctx.personId`, or "". It is read on every
 *   turn there: one statement.
 * - `live` shows the "Dar boas-vindas a quem entra" switch on the right hand's page and adds it to
 *   `update_workspace`. False keeps it off both.
 *
 * The first five minutes (docs/adr/doug-0041-doug-defaults.md): an owner, who gets no greeting, is asked instead for
 * one boring task they do every week once their onboarding ends (`FIRST_TASK_JOB`, queued by `saveOnboarding`), and
 * `firstTaskBlock` tells the right hand, while that ask is fresh, to do the task right there and then offer to repeat
 * it as a routine. The same switch turns it off; the ask calls no model.
 */

const { agents, channels, messages, organizationMembers, organizationSettings, organizations, users } = schema;

export const WELCOME_JOB = "right_hand.welcome";

/** The greeting's `meta.bodyCode`: the apps word it with `chat.body.welcome_member`. */
export const WELCOME_BODY = "welcome_member";

/** How long after joining a person with no agent of their own is still new to the right hand. */
export const NEWCOMER_DAYS = 30;

/**
 * The areas a person taps under the greeting: the onboarding's own, in its order (the client's `WORK_AREAS`, which
 * this package cannot import). "Something else" is left out, since typing is that answer and the words alone tell the
 * right hand nothing.
 */
const AREAS = Object.keys(en.onboarding.flow.area.options).filter((id) => id !== "other");

/** Their area as the onboarding saved it, when it names one: not skipped, not "something else". */
const areaOf = (workArea: string | null) => (workArea && AREAS.includes(workArea) ? workArea : null);

/** The ask for a first task, queued when an owner's onboarding ends (docs/adr/doug-0041-doug-defaults.md). */
export const FIRST_TASK_JOB = "right_hand.first_task";

/** The ask's `meta.bodyCode`: the apps word it with `chat.body.first_task_ask`. */
export const FIRST_TASK_BODY = "first_task_ask";

/** How long after the ask the right hand still reads an answer in that DM as the task to do now. */
export const FIRST_TASK_DAYS = 3;

/** Queues the greeting of someone who just became a member, in the transaction that made them one. */
export const queueWelcome = (tx: Executor, orgId: string, userId: string) =>
  enqueue(tx, { orgId, kind: WELCOME_JOB, payload: { userId }, dedupeKey: `${WELCOME_JOB}:${orgId}:${userId}` });

export async function postWelcome(deps: JobDeps, orgId: string, payload: Record<string, unknown>): Promise<void> {
  const { db } = deps;
  const userId = typeof payload.userId === "string" ? payload.userId : null;
  if (!userId) return;
  if (!(await lodiSwitches(db, orgId)).welcomePeople) return;
  // On a hold nothing answers here: the greeting would promise an agent the person's reply cannot get.
  if (workRefusal(await orgStanding(db, orgId))) return;
  // No row: they left before the job ran.
  const [person] = await db
    .select({ role: organizationMembers.role, workArea: users.workArea, org: organizations.name })
    .from(organizationMembers)
    .innerJoin(users, eq(users.id, organizationMembers.userId))
    .innerJoin(organizations, eq(organizations.id, organizationMembers.orgId))
    .where(and(eq(organizationMembers.orgId, orgId), eq(organizationMembers.userId, userId)));
  if (!person) return;
  // An owner has the first-run checklist at the top of this DM, which holds the whole setup: one ask, not two.
  if (person.role === "owner") return;
  const lodi = await lodiFor(db, orgId, userId);
  if (!lodi) return;
  const locale = await personLocale(db, userId);
  const chips: ReplyChips = {
    choices: AREAS.map((id) => serverText(locale, `onboarding.flow.area.options.${id}`)),
    multiple: false,
    step: 1,
    of: 1,
  };
  await postFromLodi(deps, orgId, userId, {
    bodyCode: WELCOME_BODY,
    bodyParams: { org: person.org },
    // Someone whose area the onboarding already knows is not asked to tap it again.
    ...(areaOf(person.workArea) ? {} : { meta: { replyChips: chips } }),
    push: true,
    // Anything already in their conversation with it: they wrote first, or it was restored on a rejoin.
    posted: async (tx, lodiId) =>
      (
        await tx
          .select({ id: messages.id })
          .from(messages)
          .innerJoin(channels, and(eq(channels.orgId, messages.orgId), eq(channels.id, messages.channelId)))
          .where(and(eq(messages.orgId, orgId), eq(channels.dmKey, personAgentDmKey(userId, lodiId))))
          .limit(1)
      ).length > 0,
    lodi,
  });
}

/** Queues the ask for a first task to the owner who just finished the workspace's onboarding: once per person. */
export const queueFirstTask = (db: Executor, orgId: string, userId: string) =>
  enqueue(db, { orgId, kind: FIRST_TASK_JOB, payload: { userId }, dedupeKey: `${FIRST_TASK_JOB}:${orgId}:${userId}` });

/** Whether the right hand asked this person for a first task in their DM with it (since `since`, when given). */
const askedFirstTask = async (db: Executor, orgId: string, userId: string, lodiId: string, since?: Date) =>
  (
    await db
      .select({ id: messages.id })
      .from(messages)
      .innerJoin(channels, and(eq(channels.orgId, messages.orgId), eq(channels.id, messages.channelId)))
      .where(
        and(
          eq(messages.orgId, orgId),
          eq(channels.dmKey, personAgentDmKey(userId, lodiId)),
          eq(messages.authorAgentId, lodiId),
          sql`${messages.meta} ->> 'bodyCode' = ${FIRST_TASK_BODY}`,
          since ? gt(messages.createdAt, since) : undefined,
        ),
      )
      .limit(1)
  ).length > 0;

/**
 * The ask for a first task (docs/adr/doug-0041-doug-defaults.md): one message from the right hand in the owner's DM
 * once the onboarding ends, which is where the workspace opens. Nothing with the switch off, on a hold, for someone no
 * longer an owner, or when the right hand may not act. May run twice: the DM is asked once more in the transaction.
 */
export async function postFirstTask(deps: JobDeps, orgId: string, payload: Record<string, unknown>): Promise<void> {
  const { db } = deps;
  const userId = typeof payload.userId === "string" ? payload.userId : null;
  if (!userId) return;
  if (!(await lodiSwitches(db, orgId)).welcomePeople) return;
  if (workRefusal(await orgStanding(db, orgId))) return;
  const [person] = await db
    .select({ role: organizationMembers.role })
    .from(organizationMembers)
    .where(and(eq(organizationMembers.orgId, orgId), eq(organizationMembers.userId, userId)));
  if (person?.role !== "owner") return;
  const lodi = await lodiFor(db, orgId, userId);
  if (!lodi) return;
  await postFromLodi(deps, orgId, userId, {
    bodyCode: FIRST_TASK_BODY,
    // They are on their way into this very conversation: it opens when the onboarding ends.
    push: false,
    posted: (tx, lodiId) => askedFirstTask(tx, orgId, userId, lodiId),
    lodi,
  });
}

/**
 * While the ask for a first task is fresh in this DM (`FIRST_TASK_DAYS`): do the task they name right there, prove
 * it, then offer once to repeat it as a routine. "" otherwise, and with the workspace's switch off.
 */
export async function firstTaskBlock(db: Database, ctx: LodiPromptContext): Promise<string> {
  if (!(await lodiSwitches(db, ctx.orgId)).welcomePeople) return "";
  const since = new Date(Date.now() - FIRST_TASK_DAYS * 24 * 3_600_000);
  if (!(await askedFirstTask(db, ctx.orgId, ctx.personId, ctx.agentId, since))) return "";
  return [
    "# Their first task",
    "You asked this person, above in this conversation, for a boring task they do every week. It is how they see what you are for, so it comes before anything else you would raise:",
    "- When they name one, do it now, in this turn, yourself with your tools (# How you resolve): no agent, no team and no setup first. At most one question before you start, and only for what only they can give (a file, an access, a detail the work can't go without).",
    "- Deliver the real result here (the numbers, the draft, the file with its link), with how you checked it. A part that needs an app or an access you don't have yet: do the rest now and, after the result, ask for the one connection that completes it with request_connection, and finish that part once it is connected.",
    "- Then offer once to do it again on its own: one offer_answers whose first answer is the schedule that fits what they told you (like 'Sim, toda segunda às 9h', in their language) and the last a no. On a yes, create the routine (create_routine) with the steps that worked, reporting in this conversation, and say in one line when it runs first.",
    "- If their answer isn't a task (a question, a greeting, something else), answer that, and don't ask for the task again.",
  ].join("\n");
}

/**
 * What the right hand keeps in mind with someone new: a member who is not an owner (an owner has the first-run
 * checklist), joined in the last `NEWCOMER_DAYS` days and has no agent of their own. Only this person's own data.
 * "" with the workspace's switch off.
 */
export async function newcomerBlock(db: Database, ctx: LodiPromptContext): Promise<string> {
  const [person] = await db
    .select({ workArea: users.workArea })
    .from(organizationMembers)
    .innerJoin(users, eq(users.id, organizationMembers.userId))
    .leftJoin(organizationSettings, eq(organizationSettings.orgId, organizationMembers.orgId))
    .where(
      and(
        eq(organizationMembers.orgId, ctx.orgId),
        eq(organizationMembers.userId, ctx.personId),
        ne(organizationMembers.role, "owner"),
        gt(organizationMembers.createdAt, sql`now() - make_interval(days => ${NEWCOMER_DAYS})`),
        sql`coalesce(${organizationSettings.welcomePeople}, true)`,
        sql`not exists (select 1 from ${agents}
          where ${agents.orgId} = ${ctx.orgId} and ${agents.ownerUserId} = ${ctx.personId})`,
      ),
    );
  if (!person) return "";
  const area = areaOf(person.workArea);
  return [
    "# Someone new",
    `This person joined the workspace in the last ${NEWCOMER_DAYS} days and has no agent of their own yet.${
      area ? ` They work in ${serverText("en", `onboarding.flow.area.options.${area}`)}.` : ""
    }`,
    "- When they say what they look after, propose ONE agent for it with propose_agent and a first_task to try it on. Never a team and never the interview for them, unless they ask for one.",
    "- At most one question first, and only when what they do is unclear. What they typed comes first.",
    "- Once their agent is made and it has no AI, offer the Connect AI card (offer_connect_ai), once.",
    "- If you already proposed an agent in this conversation, don't propose another unless they ask.",
    "- A concrete task they hand you (something they do every week): do it now yourself and prove it, then offer once to repeat it as a routine; their agent can come after.",
  ].join("\n");
}

/** The lane's block in a DM: the newcomer's and the first task's, the empty ones left out. */
const welcomeBlock = async (db: Database, ctx: LodiPromptContext) =>
  (await Promise.all([newcomerBlock(db, ctx), firstTaskBlock(db, ctx)])).filter(Boolean).join("\n\n");

export const welcomeLane = defineLodiLane({
  switch: "welcomePeople",
  live: true,
  jobs: { [WELCOME_JOB]: postWelcome, [FIRST_TASK_JOB]: postFirstTask },
  promptBlock: welcomeBlock,
});
