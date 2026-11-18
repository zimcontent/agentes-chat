import {
  type ApprovalPortal,
  ApprovalPortalError,
  PORTAL_TYPES,
  type PortalCard,
  type PortalItem,
  type PortalLabel,
  type PortalList,
  type PortalState,
  type PortalType,
} from "@agenteschat/adapters";
import type { Database } from "@agenteschat/db";
import { type PortalColumn, portalColumnOf } from "./approval-portal";
import { ValidationError } from "./errors";
import { listMembers } from "./organizations";
import { personBehindCall } from "./requester";
import type { ToolDefinition, ToolOutput } from "./tools/types";

/**
 * The strategic schedule (ADR 9001 §8): a client's posts planned in lists the team names (usually weeks), each card
 * with its labels, the members on it, a production date and a post date. A card's stage is never typed: it is the
 * card's own (`todo`, `doing`) until the post goes up, and the portal's from then on, so the board's colour follows
 * what the client does with nobody moving a thing.
 */

/** A card as the schedule shows it. */
export interface PlanCard extends PortalCard {
  /** Where the post is: the card's own stage, or the portal's once it was sent. */
  stage: PortalColumn;
  /** When it goes out: the portal's date once it is there, else the card's own. */
  postOn: string | null;
  /** The post at the portal, once it was sent. */
  link: string | null;
}

export interface PortalPlan {
  client: string;
  state: PortalState;
  lists: (PortalList & { cards: PlanCard[] })[];
  /** Cards in no list (a deleted list's, or made on the board). */
  unlisted: PlanCard[];
  /** Posts at the portal no card stands for (sent before the schedule, or by another way): the calendar shows them. */
  loose: PortalItem[];
  labels: PortalLabel[];
}

export const planCard = (card: PortalCard, items: Map<string, PortalItem>): PlanCard => {
  const item = card.item ? items.get(card.item) : undefined;
  return {
    ...card,
    // A sent card whose post the portal no longer lists still reads as sent: it waits there.
    // A card finished outside the portal reads as out: history in its list, nothing left to make.
    stage: item ? portalColumnOf(item) : card.item ? "approval" : card.done ? "posted" : card.state,
    postOn: item?.scheduledFor ?? card.date,
    link: item?.link ?? null,
  };
};

const byOrder = (a: PortalCard, b: PortalCard) => a.order - b.order || a.createdAt - b.createdAt;

export async function portalPlan(portal: ApprovalPortal, client: string): Promise<PortalPlan> {
  const [items, cards, lists, labels] = await Promise.all([
    portal.items(),
    portal.cards(client),
    portal.lists(client),
    portal.labels(),
  ]);
  const mine = new Map(items.filter((item) => item.client === client).map((item) => [item.id, item]));
  const known = new Set(lists.map((list) => list.id));
  const sorted = [...cards].sort(byOrder).map((card) => planCard(card, mine));
  const carded = new Set(cards.map((card) => card.item).filter(Boolean));
  return {
    client,
    state: await portal.state(),
    lists: lists.map((list) => ({ ...list, cards: sorted.filter((card) => card.list === list.id) })),
    unlisted: sorted.filter((card) => !card.list || !known.has(card.list)),
    loose: [...mine.values()].filter((item) => !carded.has(item.id)),
    labels,
  };
}

/** A member's work, for their Home: what they are on that isn't out yet, by production date. */
export interface MyPortalWork {
  /** The portal's own day (`YYYY-MM-DD`), the one "today" is read against. */
  today: string;
  /** Production date before today, still not done. */
  late: PlanCard[];
  today_: PlanCard[];
  /** Dated after today, soonest first. */
  next: PlanCard[];
  /** On them with no production date. */
  undated: PlanCard[];
}

/** Stages where the team still has work: a post with the client, approved or out is nobody's task. */
const OPEN_STAGES: readonly PortalColumn[] = ["todo", "doing", "adjusting"];

export const portalDay = (now: Date, timeZone: string) =>
  new Intl.DateTimeFormat("en-CA", { timeZone, year: "numeric", month: "2-digit", day: "2-digit" }).format(now);

/**
 * `queue`: the member's place for each card's task (`portalQueueOf`, ADR doug-0022). Inside each group the cards go in
 * that order, the team's priority; a card with no task of theirs keeps the group's own order after them.
 */
export async function myPortalWork(
  portal: ApprovalPortal,
  member: string,
  now = new Date(),
  timeZone = "America/Sao_Paulo",
  queue: ReadonlyMap<string, number> = new Map(),
): Promise<MyPortalWork> {
  const [items, cards] = await Promise.all([portal.items(), portal.cards()]);
  const byKey = new Map(items.map((item) => [`${item.client}/${item.id}`, item]));
  const today = portalDay(now, timeZone);
  const work: MyPortalWork = { today, late: [], today_: [], next: [], undated: [] };
  for (const card of cards) {
    if (!card.members.includes(member) || card.material) continue;
    const item = card.item ? byKey.get(`${card.client}/${card.item}`) : undefined;
    const plan = planCard(card, new Map(item ? [[item.id, item]] : []));
    if (!OPEN_STAGES.includes(plan.stage)) continue;
    if (!card.produceOn) work.undated.push(plan);
    else if (card.produceOn < today) work.late.push(plan);
    else if (card.produceOn === today) work.today_.push(plan);
    else work.next.push(plan);
  }
  const byDay = (a: PlanCard, b: PlanCard) => (a.produceOn ?? "").localeCompare(b.produceOn ?? "") || byOrder(a, b);
  const place = (card: PlanCard) => queue.get(card.id) ?? Number.POSITIVE_INFINITY;
  const byQueue = (a: PlanCard, b: PlanCard) => (place(a) === place(b) ? 0 : place(a) < place(b) ? -1 : 1);
  work.late.sort((a, b) => byQueue(a, b) || byDay(a, b));
  work.today_.sort((a, b) => byQueue(a, b) || byOrder(a, b));
  work.next.sort((a, b) => byQueue(a, b) || byDay(a, b));
  work.undated.sort((a, b) => byQueue(a, b) || byOrder(a, b));
  return work;
}

// ---------- names for agents: a list, labels and members are said by name ----------

const same = (a: string, b: string) => a.trim().toLowerCase() === b.trim().toLowerCase();

/** Label ids by name; a name the team doesn't have is refused with the ones it has. */
export async function labelIdsByName(portal: ApprovalPortal, names: string[]): Promise<string[]> {
  if (!names.length) return [];
  const labels = await portal.labels();
  return names.map((name) => {
    const label = labels.find((l) => same(l.name, name));
    if (!label) {
      throw new ValidationError(`no label "${name}"; the labels are: ${labels.map((l) => l.name).join(", ")}`);
    }
    return label.id;
  });
}

/** Member ids by name (a person's name or the start of it); an unknown or ambiguous name is refused. */
export async function memberIdsByName(db: Database, orgId: string, names: string[]): Promise<string[]> {
  if (!names.length) return [];
  const members = await listMembers(db, orgId);
  return names.map((name) => {
    const wanted = name.trim().toLowerCase();
    const exact = members.filter((m) => m.name.trim().toLowerCase() === wanted);
    const found = exact.length ? exact : members.filter((m) => m.name.trim().toLowerCase().startsWith(wanted));
    if (found.length !== 1) {
      throw new ValidationError(
        `${found.length ? "more than one member is" : "no member is"} called "${name}"; the members are: ${members
          .map((m) => m.name)
          .join(", ")}`,
      );
    }
    return (found[0] as (typeof members)[number]).userId;
  });
}

export const PORTAL_PLAN_TOOL = "portal_plan";

const str = (value: unknown) => (typeof value === "string" ? value : "");
const names = (value: unknown) => (Array.isArray(value) ? value.map(String).filter(Boolean) : []);
const DAY = /^\d{4}-\d{2}-\d{2}$/;

/** A plan takes this many posts in one call: a month of a client's weeks. */
export const PORTAL_PLAN_POSTS = 60;

/**
 * `portal_plan`: a strategy written straight into a client's schedule, list by list. Lists are found by name, so
 * planning a week twice adds to it instead of making a second one.
 */
export function planTool(portal: ApprovalPortal): ToolDefinition {
  const post = {
    type: "object",
    properties: {
      title: { type: "string", minLength: 1, maxLength: 120 },
      type: { enum: [...PORTAL_TYPES] },
      description: { type: "string", maxLength: 20000, description: "The brief: idea, script, references." },
      caption: { type: "string", maxLength: 5000 },
      post_on: { type: "string", maxLength: 40, description: "When it goes out: YYYY-MM-DDTHH:MM." },
      produce_on: {
        type: "string",
        maxLength: 10,
        description: "The day whoever is on it makes it (YYYY-MM-DD). Not the day it goes out.",
      },
      members: { type: "array", items: { type: "string", maxLength: 120 }, maxItems: 10 },
      labels: { type: "array", items: { type: "string", maxLength: 40 }, maxItems: 10 },
    },
    required: ["title"],
    additionalProperties: false,
  };
  return {
    name: PORTAL_PLAN_TOOL,
    description:
      "Write a content strategy into a client's strategic schedule at the approval portal's board: lists (usually weeks, named as the team names them, e.g. \"Semana 16 a 20/11\") and the posts of each. Use it when a person asks you to put a strategy or a set of posts on the schedule. A list that already exists by that name gets the new posts; nothing is removed. `members` are people of the workspace by name, `labels` the team's labels by name; `produce_on` is the day a person makes the post, `post_on` the day it goes out.",
    scope: "",
    inputSchema: {
      type: "object",
      properties: {
        client: { type: "string", maxLength: 64, description: "The client's id, as `portal_board` lists it." },
        lists: {
          type: "array",
          minItems: 1,
          maxItems: 12,
          items: {
            type: "object",
            properties: {
              name: { type: "string", minLength: 1, maxLength: 80 },
              posts: { type: "array", items: post, maxItems: PORTAL_PLAN_POSTS },
            },
            required: ["name", "posts"],
            additionalProperties: false,
          },
        },
      },
      required: ["client", "lists"],
      additionalProperties: false,
    },
    describe: (input) => ({ title: `Put a plan on ${str(input.client)}'s schedule` }),
    async execute(input, ctx): Promise<ToolOutput> {
      try {
        const client = str(input.client);
        const lists = (input.lists as { name: string; posts: Record<string, unknown>[] }[]) ?? [];
        const total = lists.reduce((sum, list) => sum + list.posts.length, 0);
        if (total > PORTAL_PLAN_POSTS) throw new ValidationError(`a plan takes at most ${PORTAL_PLAN_POSTS} posts`);
        // Every name is resolved before the first card is made: a typo stops the plan with nothing written.
        const resolved = [];
        for (const list of lists) {
          for (const p of list.posts) {
            if (p.produce_on !== undefined && !DAY.test(str(p.produce_on))) {
              throw new ValidationError("`produce_on` is YYYY-MM-DD");
            }
            resolved.push({
              list: list.name,
              post: p,
              labels: await labelIdsByName(portal, names(p.labels)),
              members: await memberIdsByName(ctx.db as Database, ctx.orgId, names(p.members)),
            });
          }
        }
        const by = (await personBehindCall(ctx)) ?? `agent:${ctx.agentId}`;
        const ids = new Map<string, string>();
        for (const list of lists) ids.set(list.name, (await portal.createList(client, list.name.trim())).id);
        let order = Date.now() / 1000;
        for (const { list, post: p, labels, members } of resolved) {
          await portal.createCard(
            client,
            {
              title: str(p.title).trim(),
              type: (p.type as PortalType | undefined) ?? "image",
              description: str(p.description),
              caption: str(p.caption),
              date: str(p.post_on) || null,
              produceOn: str(p.produce_on) || null,
              list: ids.get(list) ?? null,
              order: order++,
              labels,
              members,
            },
            by,
          );
        }
        return {
          content: `Put ${total} post(s) on ${client}'s schedule, in ${lists.length} list(s): ${lists
            .map((l) => `"${l.name}" (${l.posts.length})`)
            .join(", ")}.`,
        };
      } catch (error) {
        if (error instanceof ApprovalPortalError || error instanceof ValidationError) {
          return { content: `The schedule wasn't changed: ${error.message}`, isError: true };
        }
        throw error;
      }
    },
  };
}

/** One open piece of work in the pipeline: a team's card, or a post at the portal no card stands for. */
export interface PipelineEntry {
  client: string;
  kind: "card" | "post";
  /** The card's id, or the post's. */
  id: string;
  title: string;
  type: PortalType;
  stage: PortalColumn;
  /** Workspace members on it; empty for a post with no card. */
  members: string[];
  produceOn: string | null;
  postOn: string | null;
  /** Its production day is past and the team still has it. */
  late: boolean;
  /** The client's last words on it, when it waits on an adjustment. */
  note: string | null;
  link: string | null;
  updatedAt: number;
}

/**
 * Everything not posted yet, across every client, one entry each (ADR 9001 §10): what the overview draws as a
 * pipeline, so a person sees at a glance what is where, whose it is and what waits on the team.
 */
export async function portalPipeline(
  portal: ApprovalPortal,
  now = new Date(),
  timeZone = "America/Sao_Paulo",
): Promise<{ day: string; state: PortalState; entries: PipelineEntry[] }> {
  const [items, cards] = await Promise.all([portal.items(), portal.cards()]);
  const day = portalDay(now, timeZone);
  const byKey = new Map(items.map((item) => [`${item.client}/${item.id}`, item]));
  const carded = new Set<string>();
  const entries: PipelineEntry[] = [];
  for (const card of cards) {
    const item = card.item ? byKey.get(`${card.client}/${card.item}`) : undefined;
    if (item) carded.add(`${item.client}/${item.id}`);
    const plan = planCard(card, new Map(item ? [[item.id, item]] : []));
    if (plan.stage === "posted" || card.material) continue;
    entries.push({
      client: card.client,
      kind: "card",
      id: card.id,
      title: card.title,
      type: card.type,
      stage: plan.stage,
      members: card.members,
      produceOn: card.produceOn,
      postOn: plan.postOn,
      late: Boolean(card.produceOn && card.produceOn < day && OPEN_STAGES.includes(plan.stage)),
      note: plan.stage === "adjusting" ? (item?.lastNote?.text ?? null) : null,
      link: plan.link,
      updatedAt: card.updatedAt,
    });
  }
  for (const item of items) {
    const stage = portalColumnOf(item);
    if (stage === "posted" || carded.has(`${item.client}/${item.id}`)) continue;
    entries.push({
      client: item.client,
      kind: "post",
      id: item.id,
      title: item.title,
      type: item.type,
      stage,
      members: [],
      produceOn: null,
      postOn: item.scheduledFor,
      late: false,
      note: stage === "adjusting" ? (item.lastNote?.text ?? null) : null,
      link: item.link,
      updatedAt: item.updatedAt ? Date.parse(item.updatedAt) || 0 : 0,
    });
  }
  return { day, state: await portal.state(), entries };
}
