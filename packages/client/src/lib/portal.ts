import type { TFunction } from "i18next";
import { ApiError } from "../api/http";
import type {
  PlanCard,
  PortalCard,
  PortalClientColor,
  PortalClientSummary,
  PortalColumn,
  PortalItem,
  PortalLabelColor,
  PortalMissing,
  PortalPipelineEntry,
  PortalPlan,
  PortalStatus,
  PortalTaskRef,
  PortalType,
} from "../api/types";
import { errorText } from "./errors";
import { previewKindOfName } from "./files";

/**
 * The approval portal's board (ADR 9001), as the apps show it: the columns in order, what each status reads as, what
 * a send may carry. The server decides which column a post is in; this only orders and words what it sent.
 */
export const PORTAL_COLUMNS: readonly PortalColumn[] = [
  "todo",
  "doing",
  "approval",
  "adjusting",
  "approved",
  "scheduled",
  "posted",
];
/** The board's own columns: what was published is a list of its own. */
export const PORTAL_BOARD_COLUMNS = ["todo", "doing", "approval", "adjusting", "approved", "scheduled"] as const;
export type PortalBoardColumn = (typeof PORTAL_BOARD_COLUMNS)[number];
export const PORTAL_TYPES: readonly PortalType[] = ["reel", "carousel", "image", "story"];
export const PORTAL_MISSING: readonly PortalMissing[] = ["cover", "caption", "editor", "date"];
/** A send takes at most this many files (`PORTAL_SEND_FILES`, packages/engine/src/approval-portal.ts). */
export const PORTAL_SEND_FILES = 20;

/**
 * How a status reads: `waiting` only where the team has to act (the client asked for a change), `done` where the
 * client said yes or it went out, neutral for everything else (the client's turn, the team's work, a date set): its
 * icon and its word say which.
 */
export const PORTAL_STATUS_LOOK: Record<
  PortalStatus,
  { tone: "neutral" | "waiting" | "done"; icon: "send" | "eye" | "check" | "alert" | "edit" | "calendar" }
> = {
  sent: { tone: "neutral", icon: "send" },
  seen: { tone: "neutral", icon: "eye" },
  approved: { tone: "done", icon: "check" },
  adjust_requested: { tone: "waiting", icon: "alert" },
  adjusting: { tone: "neutral", icon: "edit" },
  adjusted: { tone: "neutral", icon: "send" },
  scheduled: { tone: "neutral", icon: "calendar" },
  published: { tone: "done", icon: "check" },
};

/**
 * The names the team gave clients (ADR 9001, addendum 2026-11-18), as the last overview read said them. One map for
 * the app: the portal is one workspace's (§18), and every screen that names a client reads the overview, which keeps
 * this up to date (`rememberPortalClientNames`).
 */
const teamNames = new Map<string, string>();

/** Keeps the names an overview read carries, the visible clients' and the hidden ones'. */
export function rememberPortalClientNames(overview: {
  clients: readonly { client: string; name?: string | null }[];
  hidden?: readonly { client: string; name: string | null }[];
}) {
  teamNames.clear();
  for (const c of [...overview.clients, ...(overview.hidden ?? [])]) if (c.name) teamNames.set(c.client, c.name);
}

/** A client's id as it reads: the portal knows clients by a slug ("acme-foods" reads "Acme Foods"). */
export const portalClientSlugName = (client: string) =>
  client
    .split("-")
    .filter(Boolean)
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
    .join(" ") || client;

/** A client's name: the one the team gave it, else its id as it reads. */
export const portalClientName = (client: string) => teamNames.get(client) ?? portalClientSlugName(client);

/** Every client's counts added up, for the overview's line on top. */
export function portalTotals(clients: readonly PortalClientSummary[]) {
  const counts: Record<PortalColumn, number> = {
    todo: 0,
    doing: 0,
    approval: 0,
    adjusting: 0,
    approved: 0,
    scheduled: 0,
    posted: 0,
  };
  let open = 0;
  for (const c of clients) {
    open += c.open;
    for (const column of PORTAL_COLUMNS) counts[column] += c.counts[column];
  }
  return { counts, open };
}

/**
 * The overview's order: who asked for adjustments first (that is what waits on the team), then who has posts
 * approved and not scheduled yet (the team's move too), then who has the most open, then by name.
 */
export const sortPortalClients = (clients: readonly PortalClientSummary[]) =>
  [...clients].sort(
    (a, b) =>
      b.counts.adjusting - a.counts.adjusting ||
      b.counts.approved - a.counts.approved ||
      b.open - a.open ||
      portalClientName(a.client).localeCompare(portalClientName(b.client)),
  );

/** When a published post went out: its publication, else the date it was set for, else its last change. */
export const portalPostedAt = (item: Pick<PortalItem, "publishedAt" | "scheduledFor" | "updatedAt">) =>
  item.publishedAt ?? item.scheduledFor ?? item.updatedAt;

/** The published posts newest first, by the month they went out (`YYYY-MM`; `null`: no date known, last). */
export function portalPostedByMonth<T extends Pick<PortalItem, "publishedAt" | "scheduledFor" | "updatedAt">>(
  items: readonly T[],
): { month: string | null; items: T[] }[] {
  const time = (item: T) => {
    const at = portalPostedAt(item);
    const ms = at ? Date.parse(at) : Number.NaN;
    return Number.isNaN(ms) ? Number.NEGATIVE_INFINITY : ms;
  };
  const groups: { month: string | null; items: T[] }[] = [];
  for (const item of [...items].sort((x, y) => time(y) - time(x))) {
    // The month as the portal wrote it, not as this browser's time zone would move it.
    const month = portalDayOf(portalPostedAt(item))?.slice(0, 7) ?? null;
    const last = groups[groups.length - 1];
    if (last && last.month === month) last.items.push(item);
    else groups.push({ month, items: [item] });
  }
  return groups;
}

/** A card's or a send's day (`YYYY-MM-DD`) out of what the portal keeps, which may carry a time; null: none it reads. */
export const portalDayOf = (date: string | null | undefined) => date?.match(/^\d{4}-\d{2}-\d{2}/)?.[0] ?? null;
/** The time of day (`HH:MM`) of the same, when it has one. */
export const portalTimeOf = (date: string | null | undefined) =>
  date?.match(/^\d{4}-\d{2}-\d{2}T(\d{2}:\d{2})/)?.[1] ?? null;
/** A day and a time as a send takes them (`YYYY-MM-DDTHH:MM`). */
export const portalSendDate = (day: string, time: string) => `${day}T${time}`;

/**
 * Whether a day and a time are still ahead, by this device's clock. The portal reads them in its own time zone and
 * has the last word (it refuses a time that passed, in its own words): this only keeps an obvious slip from going.
 */
export function portalAhead(day: string | null, time: string, now = new Date()): boolean {
  if (!day || !/^\d{2}:\d{2}$/.test(time)) return false;
  const at = new Date(`${day}T${time}:00`);
  return !Number.isNaN(at.getTime()) && at.getTime() > now.getTime();
}

/**
 * An approved post already released for publishing waits for the publishing service to take it: it shows in
 * Approved, as scheduling, until a later read finds it scheduled, and can't be released again. A date alone doesn't
 * say so: an approved post may carry a proposed date without having been released.
 */
export const portalScheduling = (item: Pick<PortalItem, "status" | "released">) =>
  item.status === "approved" && item.released === true;

export type PortalSendProblem = "noFiles" | "tooMany" | "reelOneVideo" | "notMedia" | "coverNotImage";

/**
 * Why these files can't go as this type, before the server is asked: a reel is exactly one video (its cover goes
 * apart, an image), everything else is pictures and videos. Read from each file's name, as the Drive lists them.
 */
export function portalSendProblem(
  type: PortalType,
  files: readonly { name: string }[],
  cover?: { name: string } | null,
): PortalSendProblem | null {
  if (files.length === 0) return "noFiles";
  if (files.length > PORTAL_SEND_FILES) return "tooMany";
  const kinds = files.map((f) => previewKindOfName(f.name));
  if (type === "reel") {
    if (files.length !== 1 || kinds[0] !== "video") return "reelOneVideo";
    if (cover && previewKindOfName(cover.name) !== "image") return "coverNotImage";
    return null;
  }
  return kinds.every((k) => k === "image" || k === "video") ? null : "notMedia";
}

/**
 * A failed portal call in the person's words: the portal's own refusal as it said it (`portal.refused`, safe to
 * show), that it didn't answer, that this server has none, else what any failed request reads as.
 */
export function portalErrorText(t: TFunction, error: unknown, locale?: string): string {
  if (error instanceof ApiError) {
    if (error.code === "portal.refused" && error.message) return error.message;
    if (error.code === "portal.unavailable") return t("portal.unavailable");
    if (error.code === "portal.off") return t("portal.off.title");
  }
  return errorText(t, error, locale);
}

/**
 * A date of the portal's as people read it ("20 de nov., 14:00"), in the portal's own clock: the day and the time
 * are read as written, never moved to this browser's time zone. Text it can't read shows as it came; null: none.
 */
export function portalWhen(locale: string, date: string | null | undefined, now = new Date()): string | null {
  const day = portalDayOf(date);
  if (!day) return date?.trim() || null;
  const [y = 0, m = 1, d = 1] = day.split("-").map(Number);
  const text = new Intl.DateTimeFormat(locale, {
    day: "numeric",
    month: "short",
    ...(y === now.getFullYear() ? {} : { year: "numeric" }),
  }).format(new Date(y, m - 1, d));
  const time = portalTimeOf(date);
  return time ? `${text}, ${time}` : text;
}

/** A month (`YYYY-MM`) as a heading ("novembro de 2026"). */
export function portalMonthName(locale: string, month: string): string {
  const [y = 0, m = 1] = month.split("-").map(Number);
  return new Intl.DateTimeFormat(locale, { month: "long", year: "numeric" }).format(new Date(y, m - 1, 1));
}

/** A link the portal sent, only when it is a web address: outside text never becomes another kind of link. */
export const portalLink = (url: string | null | undefined) => (url && /^https?:\/\//i.test(url) ? url : null);

/** The address that opens one card of a client's board in its dialog, to share: the page reads `client` and `card`. */
export const portalCardAddress = (origin: string, orgId: string, client: string, cardId: string) =>
  `${origin}/org/${encodeURIComponent(orgId)}/portal?${new URLSearchParams({ client, card: cardId }).toString()}`;

/** The colours a label takes (`PORTAL_LABEL_COLORS`, packages/adapters/src/approval-portal.ts): names the apps draw. */
export const PORTAL_LABEL_COLORS: readonly PortalLabelColor[] = [
  "green",
  "mint",
  "olive",
  "yellow",
  "wine",
  "red",
  "purple",
  "lilac",
  "blue",
  "gray",
];

/** The column of the schedule that holds the cards in no list. */
export const PORTAL_NO_LIST = "none";

/**
 * The `order` of a card dropped at `index` among `others` (its new list's cards without it, in order): the midpoint
 * between its neighbours, one before the first, one past the last, so nothing else has to be renumbered.
 */
export function portalOrderAt(others: readonly { order: number }[], index: number): number {
  const at = Math.max(0, Math.min(index, others.length));
  const before = others[at - 1]?.order;
  const after = others[at]?.order;
  if (before === undefined && after === undefined) return 1;
  if (before === undefined) return (after as number) - 1;
  if (after === undefined) return before + 1;
  return (before + after) / 2;
}

/** The room left between two cards' orders when a list is numbered again, so the next drops fit between them. */
export const PORTAL_ORDER_STEP = 1024;

/**
 * Where a card dropped at `index` among `others` (its new list's cards without it, as the list shows them) goes: an
 * `order` strictly between its neighbours', in whole numbers. When none fits between them (two cards share an order,
 * as cards made at the portal often do, or sit one apart) the list is numbered again around it: `renumber` holds each
 * other card whose order changes. A midpoint alone would leave the card tied with a neighbour, and a tie keeps it
 * after that neighbour, back where it was.
 */
export function portalPlaceAt(
  others: readonly { id: string; order: number }[],
  index: number,
): { order: number; renumber: { cardId: string; order: number }[] } {
  const at = Math.max(0, Math.min(index, others.length));
  const before = others[at - 1]?.order;
  const after = others[at]?.order;
  const sorted = others.every((c, i) => i === 0 || (others[i - 1] as { order: number }).order < c.order);
  if (sorted && Number.isInteger(before ?? 0) && Number.isInteger(after ?? 0)) {
    if (before === undefined && after === undefined) return { order: PORTAL_ORDER_STEP, renumber: [] };
    if (before === undefined) return { order: (after as number) - PORTAL_ORDER_STEP, renumber: [] };
    if (after === undefined) return { order: before + PORTAL_ORDER_STEP, renumber: [] };
    if (after - before >= 2) return { order: before + Math.floor((after - before) / 2), renumber: [] };
  }
  const renumber: { cardId: string; order: number }[] = [];
  others.forEach((c, i) => {
    const order = (i + (i >= at ? 2 : 1)) * PORTAL_ORDER_STEP;
    if (c.order !== order) renumber.push({ cardId: c.id, order });
  });
  return { order: (at + 1) * PORTAL_ORDER_STEP, renumber };
}

/** Every card of a schedule, the listed ones first. */
export const planCards = (plan: Pick<PortalPlan, "lists" | "unlisted">): PlanCard[] => [
  ...plan.lists.flatMap((list) => list.cards),
  ...plan.unlisted,
];

/** The schedule with one card in another list or place: what a move shows before the portal answers. */
export function movedInPlan(plan: PortalPlan, cardId: string, list: string | null, order: number): PortalPlan {
  const card = planCards(plan).find((c) => c.id === cardId);
  if (!card) return plan;
  const moved = { ...card, list, order };
  const without = (cards: PlanCard[]) => cards.filter((c) => c.id !== cardId);
  const withIt = (cards: PlanCard[]) => [...without(cards), moved].sort((a, b) => a.order - b.order);
  const known = list !== null && plan.lists.some((l) => l.id === list);
  return {
    ...plan,
    lists: plan.lists.map((l) => ({ ...l, cards: l.id === list ? withIt(l.cards) : without(l.cards) })),
    unlisted: known ? without(plan.unlisted) : withIt(plan.unlisted),
  };
}

/** A card's move: its list, its order there, and the list's other cards numbered again when the drop needed it. */
export type PortalMove = {
  cardId: string;
  list: string | null;
  order: number;
  renumber?: readonly { cardId: string; order: number }[];
};

/** The schedule with some cards' orders changed (a list numbered again), before the portal answers. */
export function renumberedInPlan(plan: PortalPlan, renumber: readonly { cardId: string; order: number }[]): PortalPlan {
  if (renumber.length === 0) return plan;
  const next = new Map(renumber.map((r) => [r.cardId, r.order]));
  const fix = (cards: PlanCard[]) =>
    cards
      .map((c) => (next.has(c.id) ? { ...c, order: next.get(c.id) as number } : c))
      .sort((a, b) => a.order - b.order);
  return { ...plan, lists: plan.lists.map((l) => ({ ...l, cards: fix(l.cards) })), unlisted: fix(plan.unlisted) };
}

/** How many of a checklist are done, or null when it has none. */
export const portalChecks = (card: Pick<PortalCard, "checklist">) =>
  card.checklist.length > 0
    ? { done: card.checklist.filter((c) => c.done).length, total: card.checklist.length }
    : null;

/** What a calendar shows a day for: the day the post goes out, or the day it is made. */
export type PortalCalendarBy = "post" | "produce";

/** One thing on the calendar: a card of the schedule, or a post at the portal no card stands for. */
export type PortalCalendarEntry =
  | { kind: "card"; id: string; title: string; stage: PortalColumn; card: PlanCard }
  | { kind: "item"; id: string; title: string; stage: PortalColumn; item: PortalItem };

const ITEM_STAGE: Record<PortalStatus, PortalColumn> = {
  sent: "approval",
  seen: "approval",
  adjusted: "approval",
  adjust_requested: "adjusting",
  adjusting: "adjusting",
  approved: "approved",
  scheduled: "scheduled",
  published: "posted",
};

/**
 * What each day (`YYYY-MM-DD`) of a calendar holds: by post date, every card on the day it goes out and every loose
 * post on the day it is set for or went out; by production date, only the cards (a loose post has none). Days are read
 * as the portal wrote them.
 */
export function portalCalendar(plan: PortalPlan, by: PortalCalendarBy): Map<string, PortalCalendarEntry[]> {
  const days = new Map<string, PortalCalendarEntry[]>();
  const put = (day: string | null, entry: PortalCalendarEntry) => {
    if (day) days.set(day, [...(days.get(day) ?? []), entry]);
  };
  for (const card of planCards(plan)) {
    put(by === "post" ? portalDayOf(card.postOn) : card.produceOn, {
      kind: "card",
      id: card.id,
      title: card.title,
      stage: card.stage,
      card,
    });
  }
  if (by === "post") {
    for (const item of plan.loose) {
      put(portalDayOf(item.scheduledFor ?? item.publishedAt), {
        kind: "item",
        id: item.id,
        title: item.title,
        stage: ITEM_STAGE[item.status],
        item,
      });
    }
  }
  return days;
}

/** A text with its web addresses apart, to draw them as links: plain words only, never markup. */
export function portalTextParts(text: string): { text: string; href?: string }[] {
  const parts: { text: string; href?: string }[] = [];
  let last = 0;
  for (const match of text.matchAll(/https?:\/\/[^\s<>"']+/g)) {
    const at = match.index ?? 0;
    // A sentence's own full stop or bracket after an address isn't part of it.
    const url = match[0].replace(/[.,;:!?)\]]+$/, "");
    if (at > last) parts.push({ text: text.slice(last, at) });
    parts.push({ text: url, href: url });
    last = at + url.length;
  }
  if (last < text.length) parts.push({ text: text.slice(last) });
  return parts;
}

/**
 * A card's description as the page's own formatting reads it. What another board wrote is kept, minus what only that
 * board understands: a link's title (`[text](address "smartCard-inline")`), the invisible marks it leaves between
 * paragraphs, and a line of underscores for a rule.
 */
export function portalArticle(text: string): string {
  return (
    text
      .replace(/\r\n?/g, "\n")
      .replace(/\u200b|\u200c|\u200d|\ufeff/g, "")
      .replace(/\]\((https?:\/\/[^)\s]+)\s+"[^"\n]*"\)/g, "]($1)")
      // On lines of its own, so it is a rule and never the heading mark of the line above.
      .replace(/^[ \t]*_{5,}[ \t]*$/gm, "\n---\n")
      .trim()
  );
}

/** How many lines a description shows before "Show more", and whether `text` is longer than that. */
export const PORTAL_ARTICLE_LINES = 14;
export const portalArticleIsLong = (text: string) =>
  text.split("\n").reduce((lines, line) => lines + Math.max(1, Math.ceil(line.length / 80)), 0) > PORTAL_ARTICLE_LINES;

/**
 * Who wrote a comment that no member or agent of the workspace answers for: a comment brought from another board
 * carries its writer's name as it was there (optionally as `name:<name>`). Null: not a name, so nobody we can say.
 */
export function portalWriterName(by: string): string | null {
  const name = (by.startsWith("name:") ? by.slice(5) : by).trim();
  return /^\p{L}[\p{L} .'’-]{0,59}$/u.test(name) ? name : null;
}

// ---------- the overview's pipeline (ADR 9001 §10) ----------

/** The stages the pipeline shows: everything not posted yet. */
export const PORTAL_PIPELINE_STAGES = PORTAL_BOARD_COLUMNS;

/**
 * The four things the overview counts on top, each a filter of the pipeline: what waits on the team (an adjustment
 * asked, or a production day that passed), what the team is making, what is with the client, what is approved and
 * waits for a date.
 */
export const PORTAL_FOCI = ["you", "making", "client", "schedule"] as const;
export type PortalFocus = (typeof PORTAL_FOCI)[number];

export const pipelineFocusHas = (focus: PortalFocus, entry: Pick<PortalPipelineEntry, "stage" | "late">) =>
  focus === "you"
    ? entry.stage === "adjusting" || entry.late
    : focus === "making"
      ? entry.stage === "todo" || entry.stage === "doing"
      : focus === "client"
        ? entry.stage === "approval"
        : entry.stage === "approved";

/** The tiles' numbers, with what each one's line of context says. */
export function pipelineTiles(entries: readonly PortalPipelineEntry[]) {
  const count = (keep: (e: PortalPipelineEntry) => boolean) => entries.filter(keep).length;
  return {
    you: count((e) => pipelineFocusHas("you", e)),
    making: count((e) => pipelineFocusHas("making", e)),
    client: count((e) => pipelineFocusHas("client", e)),
    schedule: count((e) => pipelineFocusHas("schedule", e)),
    adjusting: count((e) => e.stage === "adjusting"),
    late: count((e) => e.late),
    todo: count((e) => e.stage === "todo"),
    doing: count((e) => e.stage === "doing"),
    scheduled: count((e) => e.stage === "scheduled"),
  };
}

export interface PortalPipelineFilter {
  client?: string | null;
  /** A member's user id: only what they are on. */
  who?: string | null;
  focus?: PortalFocus | null;
}

export const filterPipeline = (entries: readonly PortalPipelineEntry[], filter: PortalPipelineFilter) =>
  entries.filter(
    (e) =>
      (!filter.client || e.client === filter.client) &&
      (!filter.who || e.members.includes(filter.who)) &&
      (!filter.focus || pipelineFocusHas(filter.focus, e)),
  );

/**
 * The one thing that matters most about a client, by priority: adjustments asked, then late work (both wait on the
 * team), then posts to schedule, then posts with the client, then work being made, then nothing to do but wait for
 * what is scheduled (`clear`); `idle` for a client with nothing open.
 */
export type PortalClientStatus =
  | { kind: "adjusting" | "late" | "schedule" | "client"; count: number }
  | { kind: "making" | "clear" | "idle" };

export function pipelineClientStatus(
  entries: readonly Pick<PortalPipelineEntry, "stage" | "late">[],
): PortalClientStatus {
  if (entries.length === 0) return { kind: "idle" };
  const count = (keep: (e: Pick<PortalPipelineEntry, "stage" | "late">) => boolean) => entries.filter(keep).length;
  const adjusting = count((e) => e.stage === "adjusting");
  if (adjusting > 0) return { kind: "adjusting", count: adjusting };
  const late = count((e) => e.late);
  if (late > 0) return { kind: "late", count: late };
  const schedule = count((e) => e.stage === "approved");
  if (schedule > 0) return { kind: "schedule", count: schedule };
  const client = count((e) => e.stage === "approval");
  if (client > 0) return { kind: "client", count: client };
  return count((e) => e.stage === "todo" || e.stage === "doing") > 0 ? { kind: "making" } : { kind: "clear" };
}

/** Whether a client's status waits on the team: what the overview marks, and lists first. */
export const portalStatusWaits = (status: PortalClientStatus) => status.kind === "adjusting" || status.kind === "late";

/** One stop of a client's line: a stage of the pipeline and how many of the client's open work sit at it. */
export interface PortalStep {
  stage: PortalColumn;
  count: number;
}

/**
 * A client's line, as a conveyor: every stage of the pipeline in order, each with how many of the client's open work
 * sit there (none: the stop is drawn empty), so where its work is along the line reads at a glance.
 */
export const pipelineSteps = (entries: readonly Pick<PortalPipelineEntry, "stage">[]): PortalStep[] =>
  PORTAL_PIPELINE_STAGES.map((stage) => ({ stage, count: entries.filter((e) => e.stage === stage).length }));

/** Who is on a client's open work, the ones on most of it first. */
export function pipelinePeople(entries: readonly Pick<PortalPipelineEntry, "members">[]): string[] {
  const seen = new Map<string, number>();
  for (const e of entries) for (const id of e.members) seen.set(id, (seen.get(id) ?? 0) + 1);
  return [...seen].sort((a, b) => b[1] - a[1]).map(([id]) => id);
}

/** The nearest day a client's post goes out, from the portal's today on; null: none set. */
export function pipelineNextPost(entries: readonly Pick<PortalPipelineEntry, "postOn">[], day: string): string | null {
  const ahead = entries
    .map((e) => e.postOn)
    .filter((on): on is string => Boolean(on) && (portalDayOf(on) ?? "") >= day)
    .sort((a, b) => (portalDayOf(a) ?? "").localeCompare(portalDayOf(b) ?? "") || a.localeCompare(b));
  return ahead[0] ?? null;
}

/**
 * The overview's clients in order: the ones that wait on the team first (an adjustment asked, late work), then the
 * ones with the most open, then by name; a client with nothing open last.
 */
export function pipelineClients(clients: readonly string[], entries: readonly PortalPipelineEntry[]) {
  const names = [...new Set([...clients, ...entries.map((e) => e.client)])];
  const rank = (status: PortalClientStatus) => (portalStatusWaits(status) ? 0 : status.kind === "idle" ? 2 : 1);
  return names
    .map((client) => {
      const own = entries.filter((e) => e.client === client);
      return { client, entries: own, status: pipelineClientStatus(own) };
    })
    .sort(
      (a, b) =>
        rank(a.status) - rank(b.status) ||
        b.entries.length - a.entries.length ||
        portalClientName(a.client).localeCompare(portalClientName(b.client)),
    );
}

/** A client's initials, for its mark: the first letters of its first two words ("Acme Foods": AF). */
export const portalClientInitials = (client: string) =>
  portalClientName(client)
    .split(" ")
    .slice(0, 2)
    .map((word) => word.charAt(0))
    .join("")
    .toUpperCase();

/** The colours a client takes (`PORTAL_CLIENT_COLORS`, packages/adapters/src/approval-portal.ts): names the apps draw. */
export const PORTAL_CLIENT_COLORS: readonly PortalClientColor[] = [
  "green",
  "blue",
  "navy",
  "sky",
  "white",
  "teal",
  "yellow",
  "orange",
  "red",
  "pink",
  "purple",
  "gray",
];

/** Each client's colour, from the overview: only the clients the team gave one. */
export const portalClientColors = (
  clients: readonly Pick<PortalClientSummary, "client" | "color">[] | undefined,
): ReadonlyMap<string, PortalClientColor> =>
  new Map((clients ?? []).flatMap((c) => (c.color ? [[c.client, c.color] as const] : [])));

/** Each client's logo, from the overview: only the clients the team gave one. */
export const portalClientLogos = (
  clients: readonly Pick<PortalClientSummary, "client" | "logo">[] | undefined,
): ReadonlyMap<string, string> =>
  new Map((clients ?? []).flatMap((c) => (c.logo ? [[c.client, c.logo] as const] : [])));

/** A hue for a client's mark, the same every time for the same client (0 to 359). */
export function portalClientHue(client: string): number {
  let h = 0;
  for (const ch of client) h = (h * 31 + ch.charCodeAt(0)) % 360;
  return h;
}

/** The pipeline's entries by production day, the ones with none last; `desc` turns the dated ones around. */
export const sortPipelineByProduction = <T extends Pick<PortalPipelineEntry, "produceOn" | "title">>(
  entries: readonly T[],
  desc = false,
) =>
  [...entries].sort((a, b) => {
    if (!a.produceOn || !b.produceOn) return a.produceOn ? -1 : b.produceOn ? 1 : a.title.localeCompare(b.title);
    return (desc ? -1 : 1) * a.produceOn.localeCompare(b.produceOn) || a.title.localeCompare(b.title);
  });

/**
 * A card's members with `id` first (ADR 9001): the first member is the one responsible, who has the card's task.
 * Whoever was first stays on the card, right after; an id that wasn't on it joins it.
 */
export const portalWithResponsible = (members: readonly string[], id: string): string[] => [
  id,
  ...members.filter((m) => m !== id),
];

/** Each card's task number by the card's id, to say "#12" beside it. */
export const portalTaskNumbers = (
  tasks: readonly Pick<PortalTaskRef, "cardId" | "number">[] | undefined,
): Map<string, number> => new Map((tasks ?? []).map((ref) => [ref.cardId, ref.number]));
