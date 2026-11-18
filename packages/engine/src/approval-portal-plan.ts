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
import type { CardReview } from "./approval-portal-reviews";
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
  /** What the team decided in Review, while the post isn't with the client yet (`approval-portal-reviews.ts`). */
  review: CardReview | null;
}

/** Each card's review in Review, by card id: `cardReviews` bound to a workspace (none: no review is read). */
export type ReviewsOf = (cards: PortalCard[]) => Promise<Map<string, CardReview>>;
const noReviews: ReviewsOf = async () => new Map();

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

/**
 * Where a card's post is. Sent: the portal's stage (one the portal no longer lists still reads as sent: it waits
 * there). Finished outside the portal: out, history in its list. Not sent yet: the team's review says it when there is
 * one (ADR 9001, addendum 2026-11-18): approved by the team, it is `approved`, ready to go up; in Review or sent back,
 * it is being made. Else the card's own stage.
 */
export function cardStage(card: PortalCard, item: PortalItem | undefined, review: CardReview | null = null) {
  if (item) return portalColumnOf(item);
  if (card.item) return "approval";
  if (card.done) return "posted";
  if (review?.status === "approved") return "approved";
  if (review) return "doing";
  return card.state;
}

export const planCard = (
  card: PortalCard,
  items: Map<string, PortalItem>,
  review: CardReview | null = null,
): PlanCard => {
  const item = card.item ? items.get(card.item) : undefined;
  const own = card.item || card.done || card.material ? null : review;
  return {
    ...card,
    stage: cardStage(card, item, own),
    postOn: item?.scheduledFor ?? card.date,
    link: item?.link ?? null,
    review: own,
  };
};

const byOrder = (a: Pick<PortalCard, "order" | "createdAt">, b: Pick<PortalCard, "order" | "createdAt">) =>
  a.order - b.order || a.createdAt - b.createdAt;

export async function portalPlan(
  portal: ApprovalPortal,
  client: string,
  reviewsOf: ReviewsOf = noReviews,
): Promise<PortalPlan> {
  const [items, cards, lists, labels] = await Promise.all([
    portal.items(),
    portal.cards(client),
    portal.lists(client),
    portal.labels(),
  ]);
  const reviews = await reviewsOf(cards);
  const mine = new Map(items.filter((item) => item.client === client).map((item) => [item.id, item]));
  const known = new Set(lists.map((list) => list.id));
  const sorted = [...cards].sort(byOrder).map((card) => planCard(card, mine, reviews.get(card.id) ?? null));
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

/**
 * A member's work, for their Home: what they are on that the team still has to make, by production date and, within
 * a day, in the schedule's own order (the client's lists as the team ordered them, then the cards in each), so the
 * person gets the work in the order it was planned, never in the order the cards were made.
 */
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

export async function myPortalWork(
  portal: ApprovalPortal,
  member: string,
  now = new Date(),
  timeZone = "America/Sao_Paulo",
  reviewsOf: ReviewsOf = noReviews,
): Promise<MyPortalWork> {
  const [items, all] = await Promise.all([portal.items(), portal.cards()]);
  const cards = all.filter((card) => card.members.includes(member) && !card.material);
  const [reviews, place] = await Promise.all([reviewsOf(cards), schedulePlace(portal, cards)]);
  const byKey = new Map(items.map((item) => [`${item.client}/${item.id}`, item]));
  const today = portalDay(now, timeZone);
  const work: MyPortalWork = { today, late: [], today_: [], next: [], undated: [] };
  for (const card of cards) {
    const item = card.item ? byKey.get(`${card.client}/${card.item}`) : undefined;
    const plan = planCard(card, new Map(item ? [[item.id, item]] : []), reviews.get(card.id) ?? null);
    // Approved by the team, it waits on whoever sends it, not on the person who made it.
    if (!OPEN_STAGES.includes(plan.stage)) continue;
    if (!card.produceOn) work.undated.push(plan);
    else if (card.produceOn < today) work.late.push(plan);
    else if (card.produceOn === today) work.today_.push(plan);
    else work.next.push(plan);
  }
  const bySchedule = (a: PlanCard, b: PlanCard) =>
    (a.produceOn ?? "9999").localeCompare(b.produceOn ?? "9999") ||
    place(a) - place(b) ||
    a.client.localeCompare(b.client) ||
    byOrder(a, b);
  for (const bucket of [work.late, work.today_, work.next, work.undated]) bucket.sort(bySchedule);
  return work;
}

/**
 * A card's place in its client's schedule, as one number that sorts: its list's position among the client's lists
 * (times 10 000), then its place among the given cards of that list, in the list's own order. Cards of different
 * clients compare by the same rule, so two clients' first weeks come before either's second. A card in no list (or
 * one the client no longer has) comes after the listed ones.
 */
export async function schedulePlace(
  portal: ApprovalPortal,
  cards: Pick<PortalCard, "id" | "client" | "list" | "order" | "createdAt">[],
): Promise<(card: Pick<PortalCard, "id">) => number> {
  const clients = [...new Set(cards.map((card) => card.client))];
  const lists = await Promise.all(clients.map((client) => portal.lists(client).catch(() => [] as PortalList[])));
  const listAt = new Map<string, number>();
  clients.forEach((client, i) => {
    for (const [at, list] of (lists[i] ?? []).entries()) listAt.set(`${client}/${list.id}`, at);
  });
  const groups = new Map<string, typeof cards>();
  for (const card of cards) {
    const key = `${card.client}/${card.list ?? ""}`;
    groups.set(key, [...(groups.get(key) ?? []), card]);
  }
  const place = new Map<string, number>();
  for (const [key, group] of groups) {
    const list = Math.min(listAt.get(key) ?? 9_999, 9_999);
    for (const [at, card] of [...group].sort(byOrder).entries()) {
      place.set(card.id, list * 10_000 + Math.min(at, 9_999));
    }
  }
  return (card) => place.get(card.id) ?? 99_999_999;
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
  /** The team's review of a card not sent yet: `approved` in the `approved` stage is one ready to go up. */
  review: CardReview | null;
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
  reviewsOf: ReviewsOf = noReviews,
): Promise<{ day: string; state: PortalState; entries: PipelineEntry[] }> {
  const [items, cards] = await Promise.all([portal.items(), portal.cards()]);
  const reviews = await reviewsOf(cards);
  const day = portalDay(now, timeZone);
  const byKey = new Map(items.map((item) => [`${item.client}/${item.id}`, item]));
  const carded = new Set<string>();
  const entries: PipelineEntry[] = [];
  for (const card of cards) {
    const item = card.item ? byKey.get(`${card.client}/${card.item}`) : undefined;
    if (item) carded.add(`${item.client}/${item.id}`);
    const plan = planCard(card, new Map(item ? [[item.id, item]] : []), reviews.get(card.id) ?? null);
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
      review: plan.review,
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
      review: null,
      updatedAt: item.updatedAt ? Date.parse(item.updatedAt) || 0 : 0,
    });
  }
  return { day, state: await portal.state(), entries };
}
