import type { ApprovalPortal, PortalCard, PortalItem, PubSub } from "@agenteschat/adapters";
import { and, asc, type Database, eq, isNull, schema, sql } from "@agenteschat/db";
import { type PortalColumn, portalColumnOf } from "./approval-portal";
import { planCard } from "./approval-portal-plan";
import { localDay, type PortalOpenTask, portalOpenTasks, portalZone, shiftDay } from "./approval-portal-watch";
import { openPersonAgentDm } from "./dms";
import { publishMessageCreated } from "./events";
import { projectByName } from "./issue-projects";
import {
  askAgentToImplement,
  commentIssue,
  createIssue,
  type IssueActor,
  type IssueStatus,
  updateIssue,
  type WorkActor,
} from "./issues";
import { insertMessage, messageView, postPersonMessage } from "./messages";
import { notifyMessage } from "./notification-producers";
import { rightHandId } from "./right-hand";

const { agents, channels, issues, organizationMembers, organizations, users } = schema;

/**
 * A card of the approval portal's board is also a task of the workspace (ADR 9001 §11), so it is assigned to a person
 * or an agent, worked on and followed where every other task is. Nothing here asks a model: one pass compares each
 * card with its task and carries what changed on either side to the other. The card owns the post (type, caption,
 * files, dates, labels, list); title, description, production day, who has it and the stage are kept the same on both.
 *
 * What each side had at the last pass is kept on the task (`source.synced`), so a change is told from a difference:
 * the side that moved since then wins, the card when both did.
 */

/** A task's status for each stage of the board. */
export const PORTAL_STAGE_STATUS: Record<PortalColumn, IssueStatus> = {
  todo: "todo",
  doing: "in_progress",
  approval: "in_review",
  adjusting: "in_progress",
  approved: "in_review",
  scheduled: "done",
  posted: "done",
};

export interface PortalTaskDeps {
  db: Database;
  pubsub?: PubSub;
  log?: { warn: (message: string, details?: Record<string, unknown>) => void };
}

interface Side {
  title: string;
  /** A hash: the text itself is on the card and the task. */
  description: string;
  due: string | null;
  lead: string | null;
}
interface Synced {
  /** `kind`: the post's kind (reel, carousel…), kept for whoever reads the board from the tasks. */
  card: Side & { stage: PortalColumn; kind?: string };
  issue: Side & { status: IssueStatus };
}

type IssueRow = typeof issues.$inferSelect;

/** A stage the pass saw change at the portal's side: what the notices are made from. */
export interface PortalStageChange {
  issueId: string;
  number: number;
  client: string;
  cardId: string;
  title: string;
  /** The post's kind on its card (reel, carousel, image, story). */
  kind: string;
  from: PortalColumn;
  to: PortalColumn;
  assignee: WorkActor | null;
}

export interface PortalSyncResult {
  created: number;
  toTasks: number;
  toCards: number;
  changes: PortalStageChange[];
}

const NO_CHANNEL = "00000000-0000-0000-0000-000000000000";
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const hash = (text: string) => Bun.hash(text).toString(36);

const cardSide = (card: PortalCard, stage: PortalColumn): Synced["card"] => ({
  title: card.title,
  description: hash(card.description),
  due: card.produceOn,
  lead: card.members[0] ?? null,
  stage,
  kind: card.type,
});
const issueSide = (
  row: Pick<IssueRow, "title" | "description" | "dueDate" | "assigneeId" | "status">,
): Synced["issue"] => ({
  title: row.title,
  description: hash(row.description),
  due: row.dueDate,
  lead: row.assigneeId,
  status: row.status,
});

/**
 * The workspace the portal's tasks live in: the one that already has them, else the installation's first. One
 * installation has one portal (its bridge is set by env vars), so its cards are one workspace's.
 */
export async function portalWorkspace(db: Database): Promise<string | null> {
  const [has] = await db
    .select({ orgId: issues.orgId })
    .from(issues)
    .where(sql`${issues.source}->>'type' = 'portal'`)
    .limit(1);
  if (has) return has.orgId;
  const [first] = await db.select({ id: organizations.id }).from(organizations).orderBy(asc(organizations.createdAt));
  return first?.id ?? null;
}

async function ownerOf(db: Database, orgId: string) {
  const [row] = await db
    .select({ userId: organizationMembers.userId, locale: users.locale })
    .from(organizationMembers)
    .innerJoin(users, eq(users.id, organizationMembers.userId))
    .where(and(eq(organizationMembers.orgId, orgId), eq(organizationMembers.role, "owner")))
    .orderBy(asc(organizationMembers.createdAt))
    .limit(1);
  return row ?? null;
}

type Writers = NonNullable<Awaited<ReturnType<typeof writers>>>;

/** Who a pass writes as: the right hand, which every workspace has, else the owner. */
async function writers(db: Database, orgId: string) {
  const [owner, rightHand] = await Promise.all([ownerOf(db, orgId), rightHandId(db, orgId)]);
  if (!owner) return null;
  const person: IssueActor = { type: "person", userId: owner.userId };
  const script: IssueActor = rightHand ? { type: "agent", agentId: rightHand, channelId: NO_CHANNEL } : person;
  return { owner: owner.userId, locale: owner.locale, person, script, rightHand };
}

/** A member id on a card as a task's assignee: an agent of the workspace, a member, or nobody the task can take. */
async function assigneeOf(db: Database, orgId: string, id: string | null, seen: Map<string, WorkActor | null>) {
  if (!id) return null;
  const known = seen.get(id);
  if (known !== undefined) return known;
  let found: WorkActor | null = null;
  if (UUID.test(id)) {
    const [agent] = await db
      .select({ id: agents.id })
      .from(agents)
      .where(and(eq(agents.orgId, orgId), eq(agents.id, id), isNull(agents.archivedAt)));
    if (agent) found = { type: "agent", id };
  }
  if (!found) {
    const [member] = await db
      .select({ userId: organizationMembers.userId })
      .from(organizationMembers)
      .where(and(eq(organizationMembers.orgId, orgId), eq(organizationMembers.userId, id)));
    if (member) found = { type: "person", id };
  }
  seen.set(id, found);
  return found;
}

const stageOf = (card: PortalCard, items: Map<string, PortalItem>) =>
  planCard(
    card,
    new Map(
      card.item && items.has(`${card.client}/${card.item}`)
        ? [[card.item, items.get(`${card.client}/${card.item}`) as PortalItem]]
        : [],
    ),
  ).stage;

/** The stages a post with no card is given one in: the ones somebody still has something to do about. */
const ADOPTED: PortalColumn[] = ["approval", "adjusting", "approved"];
const ADOPT_AFTER_MS = 15 * 60_000;

const plain = (text: string) =>
  text
    .normalize("NFD")
    .replace(/\p{M}/gu, "")
    .toLowerCase()
    .replace(/[^a-z0-9]/g, "");

/**
 * The workspace's people and agents by the name the portal knows an editor by (a first name or a handle), for the
 * ones only one of them answers to.
 */
async function editorsByName(db: Database, orgId: string) {
  const [people, team] = await Promise.all([
    db
      .select({ id: organizationMembers.userId, name: users.name, handle: organizationMembers.handle })
      .from(organizationMembers)
      .innerJoin(users, eq(users.id, organizationMembers.userId))
      .where(eq(organizationMembers.orgId, orgId)),
    db
      .select({ id: agents.id, name: agents.name, handle: agents.handle })
      .from(agents)
      .where(and(eq(agents.orgId, orgId), isNull(agents.archivedAt))),
  ]);
  const found = new Map<string, string | null>();
  for (const one of [...people, ...team]) {
    const keys = new Set([plain(one.name.split(/\s+/)[0] ?? ""), plain(one.handle ?? "")]);
    for (const key of keys) {
      if (!key) continue;
      found.set(key, found.has(key) && found.get(key) !== one.id ? null : one.id);
    }
  }
  return new Map([...found].flatMap(([key, id]) => (id ? [[key, id] as const] : [])));
}

/** The card's members with `lead` first, in place of the one who led before. */
const withLead = (members: string[], lead: string | null, before: string | null) => {
  const rest = members.filter((m) => m !== lead && m !== before);
  return lead ? [lead, ...rest] : rest;
};

async function saveSynced(db: Database, row: IssueRow, client: string, cardId: string, synced: Synced) {
  const nudged = (row.source as { nudged?: string }).nudged;
  const source = { type: "portal" as const, client, cardId, synced, ...(nudged ? { nudged } : {}) };
  if (JSON.stringify(row.source) === JSON.stringify(source)) return;
  await db.update(issues).set({ source }).where(eq(issues.id, row.id));
}

const reload = async (db: Database, id: string) => (await db.select().from(issues).where(eq(issues.id, id)))[0];

/**
 * One pass over the board (or over `only`, one card): a card with no task gets one, and each pair is brought to
 * agree. Safe to run at any time and twice: what already agrees is left alone. A card whose task was deleted keeps
 * none (it says which it had), and a task whose card is gone is left as it is: the pass never deletes either.
 */
export function syncPortalTasks(
  deps: PortalTaskDeps,
  portal: ApprovalPortal,
  orgId: string,
  only?: { cardId: string },
): Promise<PortalSyncResult> {
  // One pass at a time in a process: a card made a moment ago is never given two tasks by two passes.
  const pass = passes.then(() => onePass(deps, portal, orgId, only));
  passes = pass.catch(() => {});
  return pass;
}

let passes: Promise<unknown> = Promise.resolve();

async function onePass(
  deps: PortalTaskDeps,
  portal: ApprovalPortal,
  orgId: string,
  only?: { cardId: string },
): Promise<PortalSyncResult> {
  const { db } = deps;
  const result: PortalSyncResult = { created: 0, toTasks: 0, toCards: 0, changes: [] };
  const who = await writers(db, orgId);
  if (!who) return result;
  const [allCards, allItems] = await Promise.all([portal.cards(), portal.items()]);
  const items = new Map(allItems.map((item) => [`${item.client}/${item.id}`, item]));
  if (!only) {
    // A post that went up some other way and is still open gets a card, so it has a task like any other: what the
    // client says about it reaches someone. Posts already scheduled or out are left as the portal has them.
    const carded = new Set(allCards.flatMap((card) => (card.item ? [`${card.client}/${card.item}`] : [])));
    const people = await editorsByName(db, orgId);
    for (const item of allItems) {
      if (carded.has(`${item.client}/${item.id}`) || !ADOPTED.includes(portalColumnOf(item))) continue;
      // One that just went up may be a card's own post, a moment before the card is tied to it.
      const made = item.createdAt ? Date.parse(item.createdAt) : Number.NaN;
      if (Number.isFinite(made) && Date.now() - made < ADOPT_AFTER_MS) continue;
      try {
        const editor = item.editor ? people.get(plain(item.editor)) : undefined;
        allCards.push(
          await portal.createCard(
            item.client,
            {
              title: item.title.slice(0, 120) || item.id,
              type: item.type,
              item: item.id,
              ...(editor ? { members: [editor] } : {}),
            },
            "sync",
          ),
        );
      } catch (error) {
        deps.log?.warn("approval portal: a post could not be given a card", {
          item: item.id,
          error: error instanceof Error ? error.message : String(error),
        });
      }
    }
  }
  const cards = only ? allCards.filter((card) => card.id === only.cardId) : allCards;
  if (cards.length === 0) return result;
  const rows = await db
    .select()
    .from(issues)
    .where(and(eq(issues.orgId, orgId), sql`${issues.source}->>'type' = 'portal'`));
  const byCard = new Map(rows.map((row) => [(row.source as { cardId?: string }).cardId ?? "", row]));
  const seen = new Map<string, WorkActor | null>();
  const projects = new Map<string, string>();
  for (const row of rows) {
    const client = (row.source as { client?: string }).client;
    if (client && row.projectId && !projects.has(client)) projects.set(client, row.projectId);
  }

  for (const card of cards) {
    try {
      const stage = stageOf(card, items);
      const row = byCard.get(card.id);
      if (!row) {
        // Its task was deleted on purpose, or it is out already: neither gets a task now.
        if (card.task || stage === "posted") continue;
        let projectId = projects.get(card.client);
        if (!projectId) {
          projectId = (await projectByName({ db, pubsub: deps.pubsub }, orgId, card.client, "new")).id;
          projects.set(card.client, projectId);
        }
        const assignee = await assigneeOf(db, orgId, card.members[0] ?? null, seen);
        const made = await createIssue({ db, pubsub: deps.pubsub }, who.person, orgId, {
          title: card.title,
          description: card.description,
          dueDate: card.produceOn,
          assignee,
          projectId,
          source: { type: "portal", client: card.client, cardId: card.id },
        });
        const status = PORTAL_STAGE_STATUS[stage];
        if (status !== "todo") {
          await updateIssue({ db, pubsub: deps.pubsub }, who.script, orgId, made.id, { status });
        }
        await portal.updateCard(card.id, { task: made.id }, "sync");
        const fresh = await reload(db, made.id);
        if (fresh)
          await saveSynced(db, fresh, card.client, card.id, { card: cardSide(card, stage), issue: issueSide(fresh) });
        result.created++;
        // Made while the client already waits on a change: said and handed on like one that came in just now.
        if (stage === "adjusting") {
          result.changes.push({
            issueId: made.id,
            number: made.number,
            client: card.client,
            cardId: card.id,
            title: card.title,
            kind: card.type,
            from: "approval",
            to: stage,
            assignee,
          });
        }
        continue;
      }

      const was = (row.source as { synced?: Synced }).synced ?? null;
      const now = { card: cardSide(card, stage), issue: issueSide(row) };
      const toTask: Parameters<typeof updateIssue>[4] = {};
      const toCard: Parameters<ApprovalPortal["updateCard"]>[1] = {};
      // Each field on its own: the card's change goes to the task; else the task's goes to the card.
      const moved = <K extends keyof Side>(key: K) => ({
        card: !was || was.card[key] !== now.card[key],
        issue: Boolean(was) && was?.issue[key] !== now.issue[key],
      });
      const title = moved("title");
      if (title.card) {
        if (row.title !== card.title) toTask.title = card.title;
      } else if (title.issue) toCard.title = row.title.slice(0, 120);
      const description = moved("description");
      if (description.card) {
        if (row.description !== card.description) toTask.description = card.description;
      } else if (description.issue) toCard.description = row.description.slice(0, 20_000);
      const due = moved("due");
      if (due.card) {
        if (row.dueDate !== card.produceOn) toTask.dueDate = card.produceOn;
      } else if (due.issue) toCard.produceOn = row.dueDate;
      const lead = moved("lead");
      if (lead.card) {
        const assignee = await assigneeOf(db, orgId, now.card.lead, seen);
        const same = (assignee?.id ?? null) === row.assigneeId;
        // A member the task can't take (someone who left) leaves the task's assignee as it is.
        if (!same && (assignee || !now.card.lead)) toTask.assignee = assignee;
      } else if (lead.issue) {
        toCard.members = withLead(card.members, row.assigneeId, was?.card.lead ?? null);
      }
      const stageMoved = !was || was.card.stage !== stage;
      if (stageMoved) {
        if (row.status !== PORTAL_STAGE_STATUS[stage] && row.status !== "canceled") {
          toTask.status = PORTAL_STAGE_STATUS[stage];
        }
      } else if (was && was.issue.status !== row.status && !card.item) {
        // Before the post goes up the task's board moves the card too; after, the stage is the portal's alone.
        const state = row.status === "todo" ? "todo" : row.status === "in_progress" ? "doing" : null;
        if (state && state !== card.state) toCard.state = state;
      }

      let issueNow: Pick<IssueRow, "title" | "description" | "dueDate" | "assigneeId" | "status"> = row;
      if (Object.keys(toTask).length > 0) {
        await updateIssue({ db, pubsub: deps.pubsub }, who.script, orgId, row.id, toTask);
        issueNow = (await reload(db, row.id)) ?? row;
        result.toTasks++;
      }
      let cardNow = card;
      if (Object.keys(toCard).length > 0) {
        cardNow = await portal.updateCard(card.id, toCard, "sync");
        result.toCards++;
      }
      if (!card.task) await portal.updateCard(card.id, { task: row.id }, "sync");
      const stageNow = cardNow.item ? stage : cardNow.state;
      await saveSynced(db, row, card.client, card.id, {
        card: cardSide(cardNow, stageNow),
        issue: issueSide(issueNow),
      });
      if (was && stageMoved) {
        const assignee: WorkActor | null =
          issueNow.assigneeId && (row.assigneeType === "agent" || row.assigneeType === "person")
            ? ((await assigneeOf(db, orgId, issueNow.assigneeId, seen)) ?? null)
            : null;
        result.changes.push({
          issueId: row.id,
          number: row.number,
          client: card.client,
          cardId: card.id,
          title: card.title,
          kind: card.type,
          from: was.card.stage,
          to: stage,
          assignee,
        });
      }
    } catch (error) {
      // One card that can't be brought in step never stops the others: the next pass tries it again.
      deps.log?.warn("approval portal: a card and its task could not be put in step", {
        card: card.id,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }
  return result;
}

/** The task that stands for a card, when it has one. */
export async function portalTaskOf(db: Database, orgId: string, cardId: string) {
  const [row] = await db
    .select()
    .from(issues)
    .where(
      and(
        eq(issues.orgId, orgId),
        sql`${issues.source}->>'type' = 'portal'`,
        sql`${issues.source}->>'cardId' = ${cardId}`,
      ),
    );
  return row ?? null;
}

/** Each card's task as the board shows it: its number and who has it. */
export async function portalTaskRefs(db: Database, orgId: string) {
  const rows = await db
    .select({
      id: issues.id,
      number: issues.number,
      source: issues.source,
      assigneeType: issues.assigneeType,
      assigneeId: issues.assigneeId,
    })
    .from(issues)
    .where(and(eq(issues.orgId, orgId), sql`${issues.source}->>'type' = 'portal'`));
  return new Map(
    rows.map((row) => [
      (row.source as { cardId?: string }).cardId ?? "",
      {
        id: row.id,
        number: row.number,
        assignee:
          row.assigneeId && (row.assigneeType === "agent" || row.assigneeType === "person")
            ? { type: row.assigneeType, id: row.assigneeId }
            : null,
      },
    ]),
  );
}

/**
 * A person put an agent on a card: the agent starts on its task at once, as "ask an agent" on the task does. Returns
 * false when the card has no task or the agent isn't one the person may ask.
 */
export async function startPortalAgent(
  deps: PortalTaskDeps,
  userId: string,
  orgId: string,
  cardId: string,
  agentId: string,
) {
  const row = await portalTaskOf(deps.db, orgId, cardId);
  if (!row || !deps.pubsub) return false;
  await askAgentToImplement({ db: deps.db, pubsub: deps.pubsub }, userId, orgId, row.id, agentId);
  return true;
}

/** A card deleted by someone: its task is canceled, never deleted (its conversation and history stay). */
export async function cancelPortalTask(deps: PortalTaskDeps, actor: IssueActor, orgId: string, cardId: string) {
  const row = await portalTaskOf(deps.db, orgId, cardId);
  if (!row || row.status === "done" || row.status === "canceled") return;
  await updateIssue({ db: deps.db, pubsub: deps.pubsub }, actor, orgId, row.id, { status: "canceled" });
}

type NoticeLocale = "pt-BR" | "en";
const NOTICES: Record<NoticeLocale, Partial<Record<PortalColumn, (title: string) => string>>> = {
  "pt-BR": {
    approval: (t) => `"${t}" subiu para a aprovação do cliente.`,
    adjusting: (t) => `O cliente pediu ajuste em "${t}". O pedido está no cartão do Portal.`,
    approved: (t) => `O cliente aprovou "${t}". Já pode ser agendado.`,
    scheduled: (t) => `"${t}" está agendado.`,
    posted: (t) => `"${t}" foi publicado.`,
  },
  en: {
    approval: (t) => `"${t}" went up for the client's approval.`,
    adjusting: (t) => `The client asked for a change on "${t}". The request is on the card in the Portal.`,
    approved: (t) => `The client approved "${t}". It can be scheduled now.`,
    scheduled: (t) => `"${t}" is scheduled.`,
    posted: (t) => `"${t}" is out.`,
  },
};
/** The lines about a post's day, said once each: the day it is for, and the day after when it still isn't up. */
const DATE_NOTICES: Record<NoticeLocale, Record<"today" | "late", (title: string) => string>> = {
  "pt-BR": {
    today: (t) => `"${t}" é para hoje.`,
    late: (t) => `"${t}" era para ontem e ainda não subiu para aprovação.`,
  },
  en: {
    today: (t) => `"${t}" is for today.`,
    late: (t) => `"${t}" was for yesterday and hasn't gone up for approval yet.`,
  },
};
/** What the assistant is told in its owner's conversation with it about the posts nobody has. */
const UNOWNED: Record<NoticeLocale, { head: string; why: Record<"adjusting" | "today" | "late", string> }> = {
  "pt-BR": {
    head: "Aviso automático do Portal: estes posts estão sem responsável. Passe cada um para quem deve fazer e me diga em uma linha com quem ficou.",
    why: { adjusting: "o cliente pediu ajuste", today: "é para hoje", late: "era para ontem" },
  },
  en: {
    head: "Automatic notice from the Portal: nobody has these posts. Hand each to whoever should make it and tell me in one line who has it.",
    why: { adjusting: "the client asked for a change", today: "it is for today", late: "it was for yesterday" },
  },
};
const localeOf = (locale: string | null | undefined): NoticeLocale =>
  locale?.toLowerCase().startsWith("pt") ? "pt-BR" : "en";

interface Unowned {
  number: number;
  title: string;
  client: string;
  kind: string | null;
  why: "adjusting" | "today" | "late";
}

/**
 * Posts nobody has, given to the workspace's assistant to hand on (ADR 9001 §12): one message in its owner's own
 * conversation with it, the only place it may assign a task, written by code in the owner's name and saying so. The
 * assistant decides who (the one judgment here that isn't a rule); nothing a client wrote goes in the message.
 */
async function askAssistant(deps: PortalTaskDeps, orgId: string, who: Writers, unowned: Unowned[]) {
  if (unowned.length === 0 || !who.rightHand || !deps.pubsub) return;
  const words = UNOWNED[localeOf(who.locale)];
  const dm = await openPersonAgentDm(deps.db, orgId, who.owner, who.rightHand);
  const listed = unowned.slice(0, 20);
  const body = [
    words.head,
    ...listed.map(
      (u) =>
        `- #${u.number} "${u.title.slice(0, 120)}" (${u.client}${u.kind ? `, ${u.kind}` : ""}): ${words.why[u.why]}`,
    ),
  ].join("\n");
  await postPersonMessage({ db: deps.db, pubsub: deps.pubsub }, who.owner, orgId, dm.id, {
    body,
    meta: { portalUnowned: listed.map((u) => u.number) },
  });
}

/** The stages a client's group hears about: what the client did, and the post going out. */
const GROUP_STAGES: PortalColumn[] = ["adjusting", "approved", "posted"];

/** The client's group: the open channel whose name carries the client's id (`acme` → `#acme`, `#clientes-acme`). */
async function clientChannel(db: Database, orgId: string, client: string) {
  const rows = await db
    .select({ id: channels.id, name: channels.name, displayName: channels.displayName })
    .from(channels)
    .where(and(eq(channels.orgId, orgId), eq(channels.kind, "channel"), isNull(channels.archivedAt)));
  const plain = (text: string | null) =>
    (text ?? "")
      .normalize("NFD")
      .replace(/\p{M}/gu, "")
      .toLowerCase()
      .replace(/[^a-z0-9]/g, "");
  const wanted = plain(client);
  if (!wanted) return null;
  const hit = rows.filter((row) => plain(row.name).includes(wanted) || plain(row.displayName).includes(wanted));
  // The shortest name is the client's own group rather than one that only mentions it.
  return hit.sort((a, b) => a.name.length - b.name.length)[0] ?? null;
}

/**
 * What follows a stage that changed at the portal, all of it written by code (ADR 9001 §11): a line in the task's
 * conversation for whoever follows it, the same line in the client's group, and the agent that has the task started
 * again when the client asked for a change. The client's own words are never copied: they stay on the card, where an
 * agent reads them as outside text.
 */
export async function announcePortalStages(deps: PortalTaskDeps, orgId: string, changes: PortalStageChange[]) {
  const { db, pubsub } = deps;
  if (changes.length === 0 || !pubsub) return;
  const who = await writers(db, orgId);
  if (!who) return;
  const locale = localeOf(who.locale);
  const unowned: Unowned[] = [];
  for (const change of changes) {
    try {
      const line = NOTICES[locale][change.to]?.(change.title);
      if (line && who.rightHand) {
        // A person who has it is named, so the line reaches them wherever they are.
        const to = change.to === "adjusting" && change.assignee?.type === "person" ? change.assignee.id : null;
        const name = to ? await mentionOf(db, orgId, to) : "";
        const said = await commentIssue({ db, pubsub }, who.script, orgId, change.issueId, `${name}${line}`);
        await notifyMessage({ db, pubsub }, orgId, said.id).catch(() => {});
        const group = GROUP_STAGES.includes(change.to) ? await clientChannel(db, orgId, change.client) : null;
        if (group) {
          const message = await insertMessage(db, {
            orgId,
            channelId: group.id,
            author: { type: "agent", agentId: who.rightHand, runId: null, hop: 1, stretchId: null },
            body: line,
            meta: { portalNotice: { client: change.client, cardId: change.cardId, stage: change.to } },
          });
          await publishMessageCreated(pubsub, messageView(message));
        }
      }
      if (change.to === "adjusting") {
        // The agent that has it starts on the change at once; a post nobody has goes to the assistant to hand on.
        if (change.assignee?.type === "agent") {
          await askAgentToImplement({ db, pubsub }, who.owner, orgId, change.issueId, change.assignee.id);
        } else if (!change.assignee) {
          unowned.push({ ...change, why: "adjusting" });
        }
      }
    } catch (error) {
      deps.log?.warn("approval portal: a stage's notice could not be written", {
        card: change.cardId,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }
  await askAssistant(deps, orgId, who, unowned).catch((error: unknown) =>
    deps.log?.warn("approval portal: the assistant could not be told of posts nobody has", {
      error: error instanceof Error ? error.message : String(error),
    }),
  );
}

/** `@handle ` of a person, to open a line that is for them; "" when they have none. */
async function mentionOf(db: Database, orgId: string, userId: string) {
  const [row] = await db
    .select({ handle: organizationMembers.handle })
    .from(organizationMembers)
    .where(and(eq(organizationMembers.orgId, orgId), eq(organizationMembers.userId, userId)));
  return row?.handle ? `@${row.handle} ` : "";
}

/** The hour of the day, in the owner's time, from which the day's lines are written. */
const DATES_FROM_HOUR = 8;

/**
 * The posts' days, watched by code (ADR 9001 §12): on the day a post is to be made, and the day after when it still
 * hasn't gone up, the assistant says so once in the task's conversation, naming the person who has it. A post nobody
 * has goes to the assistant to hand on. Older ones are not gone over again: the assistant's own view lists them.
 */
export async function watchPortalDates(deps: PortalTaskDeps, orgId: string, at = new Date()) {
  const { db, pubsub } = deps;
  if (!pubsub) return 0;
  const who = await writers(db, orgId);
  if (!who?.rightHand) return 0;
  const { day, hour } = localDay(await portalZone(db, orgId, who.owner), at);
  if (hour < DATES_FROM_HOUR) return 0;
  const yesterday = shiftDay(day, -1);
  const due: { task: PortalOpenTask; kind: "today" | "late"; key: string }[] = [];
  for (const task of await portalOpenTasks(db, orgId)) {
    if (task.stage !== "todo" && task.stage !== "doing") continue;
    const kind = task.due === day ? "today" : task.due === yesterday ? "late" : null;
    if (!kind) continue;
    const key = `${task.due}:${kind}`;
    if (task.nudged !== key) due.push({ task, kind, key });
  }
  if (due.length === 0) return 0;
  const locale = localeOf(who.locale);
  const unowned: Unowned[] = [];
  let said = 0;
  for (const { task, kind, key } of due) {
    try {
      // Marked first: a line that fails is skipped, never said twice.
      await db
        .update(issues)
        .set({ source: sql`${issues.source} || ${JSON.stringify({ nudged: key })}::jsonb` })
        .where(eq(issues.id, task.id));
      const name = task.assignee?.type === "person" ? await mentionOf(db, orgId, task.assignee.id) : "";
      const line = `${name}${DATE_NOTICES[locale][kind](task.title)}`;
      const message = await commentIssue({ db, pubsub }, who.script, orgId, task.id, line);
      await notifyMessage({ db, pubsub }, orgId, message.id).catch(() => {});
      if (!task.assignee) unowned.push({ ...task, why: kind });
      said++;
    } catch (error) {
      deps.log?.warn("approval portal: a post's day could not be said", {
        card: task.cardId,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }
  await askAssistant(deps, orgId, who, unowned).catch((error: unknown) =>
    deps.log?.warn("approval portal: the assistant could not be told of posts nobody has", {
      error: error instanceof Error ? error.message : String(error),
    }),
  );
  return said;
}

/**
 * One tick of the portal's worker: bring every card and task in step, then say what changed at the portal's side.
 * Nothing when the installation has no workspace yet.
 */
export function portalTasksTick(deps: PortalTaskDeps, portal: ApprovalPortal): Promise<PortalSyncResult | null> {
  // One tick at a time in a process: the worker's and the one the bridge asks for never say the same thing twice.
  const tick = ticks.then(async () => {
    const orgId = await portalWorkspace(deps.db);
    if (!orgId) return null;
    const result = await syncPortalTasks(deps, portal, orgId);
    await announcePortalStages(deps, orgId, result.changes);
    await watchPortalDates(deps, orgId).catch((error: unknown) =>
      deps.log?.warn("approval portal: the posts' days could not be watched", {
        error: error instanceof Error ? error.message : String(error),
      }),
    );
    return result;
  });
  ticks = tick.catch(() => {});
  return tick;
}

let ticks: Promise<unknown> = Promise.resolve();
let asked = false;

/**
 * The bridge saw something change at the portal (ADR 9001 §12): one tick now, in place of waiting for the worker's.
 * Calls that come while one already waits are that same tick.
 */
export function portalTasksNow(deps: PortalTaskDeps, portal: ApprovalPortal, after?: () => void) {
  if (asked) return;
  asked = true;
  void ticks
    .then(() => {
      asked = false;
      return portalTasksTick(deps, portal);
    })
    .then(() => after?.())
    .catch((error: unknown) =>
      deps.log?.warn("approval portal: the tick the bridge asked for failed", {
        error: error instanceof Error ? error.message : String(error),
      }),
    );
}
