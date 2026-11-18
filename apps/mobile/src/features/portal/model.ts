import type {
  PlanCard,
  PortalBoard,
  PortalCard,
  PortalCardFile,
  PortalClientColor,
  PortalClientSummary,
  PortalColumn,
  PortalComment,
  PortalItem,
  PortalLabel,
  PortalLabelColor,
  PortalListKind,
  PortalPlan,
  PortalStatus,
} from "@agenteschat/client";
import { previewKindOfName } from "@agenteschat/client/lib/files";
import {
  PORTAL_BOARD_COLUMNS,
  type PortalBoardColumn,
  type PortalClientStatus,
  portalAhead,
  portalDayOf,
  portalSendProblem,
  portalTimeOf,
} from "@agenteschat/client/lib/portal";
import type { IconName } from "@/ui/Icon";
import type { PortalWords } from "./words";

/**
 * The phone's approval portal (ADR 9001), pure: what each screen lists and in what order. The web's rules live in
 * `@agenteschat/client/lib/portal`; this only shapes them for the phone's lists.
 */

/** A client as a route segment: the portal's slug, never anything that could leave the path. */
export const isClientSlug = (client: unknown): client is string =>
  typeof client === "string" && /^[\p{L}\p{N}_.-]{1,120}$/u.test(client) && !/^\.+$/.test(client);

/** A card's or a post's id as a route segment: the portal's own ids, held to the same safe shape. */
export const isPortalId = isClientSlug;

/**
 * A client's one line from the overview's counts alone, by the same priority as the pipeline's
 * (`pipelineClientStatus`): used while the pipeline hasn't answered, which also knows what is late.
 */
export function summaryStatus(summary: Pick<PortalClientSummary, "counts" | "open">): PortalClientStatus {
  const { counts } = summary;
  if (counts.adjusting > 0) return { kind: "adjusting", count: counts.adjusting };
  if (counts.approved > 0) return { kind: "schedule", count: counts.approved };
  if (counts.approval > 0) return { kind: "client", count: counts.approval };
  if (counts.todo + counts.doing > 0) return { kind: "making" };
  return summary.open > 0 || counts.scheduled > 0 ? { kind: "clear" } : { kind: "idle" };
}

/** A client's status in words. */
export function statusLine(w: PortalWords, status: PortalClientStatus): string {
  switch (status.kind) {
    case "adjusting":
    case "late":
    case "send":
    case "schedule":
    case "client":
      return w.clientStatus[status.kind](status.count);
    default:
      return w.clientStatus[status.kind];
  }
}

/** One column of a client's board: the team's cards in the first two, the portal's posts in the others. */
export interface BoardColumn {
  column: PortalBoardColumn;
  cards: PortalCard[];
  items: PortalItem[];
}

export const boardColumns = (board: PortalBoard): BoardColumn[] =>
  PORTAL_BOARD_COLUMNS.map((column) =>
    column === "todo" || column === "doing"
      ? { column, cards: board.cards[column], items: [] }
      : { column, cards: [], items: board.items[column] },
  );

/** The two columns the team's own cards move between; the portal fills the others (the web's `TEAM_COLUMNS`). */
export const isTeamColumn = (column: PortalBoardColumn): column is "todo" | "doing" =>
  column === "todo" || column === "doing";

/**
 * The Quadro's columns on the phone, as Trello's board: every stage that holds something, in the web's order; for
 * whoever may move cards, To do and In production always, so a card has somewhere to go.
 */
export const stageColumns = (board: PortalBoard, moves: boolean): BoardColumn[] =>
  boardColumns(board).filter((c) => columnCount(c) > 0 || (moves && isTeamColumn(c.column)));

/**
 * What a column says while a card from `from` is held over the board: `drop`, it takes the card (the other team
 * column); `home`, the card's own; `closed`, the portal's to fill, it takes none.
 */
export function columnDrop(column: PortalBoardColumn, from: "todo" | "doing"): "drop" | "home" | "closed" {
  if (!isTeamColumn(column)) return "closed";
  return column === from ? "home" : "drop";
}

/**
 * A team card of the board as the schedule's card face draws it: its stage is the board's column (a move shows at
 * once), its post date and portal link the schedule's when it has the card.
 */
export function boardCardOf(card: PortalCard, plan: PortalPlan | undefined): PlanCard {
  const known = allPlanCards(plan).find((c) => c.id === card.id);
  return { ...card, stage: card.state, postOn: known?.postOn ?? card.date, link: known?.link ?? null };
}

/** A client's counts on the Portal tab, only those above zero: what is open, with the client, sent back. */
export function clientCounts(
  summary: Pick<PortalClientSummary, "counts" | "open"> | undefined,
): { key: "open" | "approval" | "adjusting"; count: number }[] {
  if (!summary) return [];
  const all = [
    { key: "open" as const, count: summary.open },
    { key: "approval" as const, count: summary.counts.approval ?? 0 },
    { key: "adjusting" as const, count: summary.counts.adjusting ?? 0 },
  ];
  return all.filter((c) => c.count > 0);
}

/** How many things wait in a column. */
export const columnCount = (c: Pick<BoardColumn, "cards" | "items">) => c.cards.length + c.items.length;

/** A post on the board by its id, with the column it is in (`posted` included). */
export function findItem(
  board: PortalBoard | undefined,
  itemId: string,
): { item: PortalItem; column: Exclude<PortalColumn, "todo" | "doing"> } | null {
  if (!board) return null;
  for (const column of ["approval", "adjusting", "approved", "scheduled", "posted"] as const) {
    const item = board.items[column].find((i) => i.id === itemId);
    if (item) return { item, column };
  }
  return null;
}

/** Every card of a schedule, materials included, the listed ones first. */
export const allPlanCards = (plan: Pick<PortalPlan, "lists" | "unlisted"> | undefined): PlanCard[] =>
  plan ? [...plan.lists.flatMap((l) => l.cards), ...plan.unlisted] : [];

/** The card a post at the portal came from: it carries the files, the comments and the task. */
export const cardOfItem = (plan: PortalPlan | undefined, itemId: string): PlanCard | null =>
  allPlanCards(plan).find((c) => c.item === itemId) ?? null;

/** One list of a section: its name and cards (`id` null: the cards in no list, which belong to the schedule). */
export interface PlanGroup {
  id: string | null;
  name: string | null;
  cards: PlanCard[];
}

/** A section of the schedule (its lists, then the cards in no list) or of the client's materials (lists only). */
export function planGroups(plan: PortalPlan, kind: PortalListKind): PlanGroup[] {
  const lists: PlanGroup[] = plan.lists
    .filter((l) => l.kind === kind)
    .map((l) => ({ id: l.id, name: l.name, cards: [...l.cards].sort((a, b) => a.order - b.order) }));
  if (kind === "plan" && plan.unlisted.length > 0) {
    lists.push({ id: null, name: null, cards: [...plan.unlisted].sort((a, b) => a.order - b.order) });
  }
  return lists;
}

/** The lists a card may move to: the ones of its own section (a material stays among materials). */
export const listsFor = (plan: PortalPlan, card: Pick<PortalCard, "material">) =>
  plan.lists.filter((l) => l.kind === (card.material ? "materials" : "plan"));

export type FileKind = "image" | "video" | "other";
export const fileKind = (file: Pick<PortalCardFile, "name">): FileKind => {
  const kind = previewKindOfName(file.name);
  return kind === "image" || kind === "video" ? kind : "other";
};

/** What stands for a card in a list: its first picture, else its first video, else nothing. */
export function coverOf(files: readonly PortalCardFile[]): { file: PortalCardFile; kind: "image" | "video" } | null {
  const image = files.find((f) => fileKind(f) === "image");
  if (image) return { file: image, kind: "image" };
  const video = files.find((f) => fileKind(f) === "video");
  return video ? { file: video, kind: "video" } : null;
}

/** Why a card can't go for approval as it is (read from its files), or null: it can. */
export const sendProblemOf = (card: Pick<PortalCard, "type" | "files">) => portalSendProblem(card.type, card.files);

/**
 * A card ready to go up for approval from the board: the team's (To do or In production), marked done, with the
 * files a send takes. The board's card then carries "Subir para aprovação" itself.
 */
export function readyToSend(card: Pick<PlanCard, "type" | "files" | "stage" | "done" | "material">) {
  return (
    !card.material && (card.stage === "todo" || card.stage === "doing") && card.done && sendProblemOf(card) === null
  );
}

/**
 * The send a card makes, with what it already knows but its date: a post goes to the client without one, and gets it
 * when a person schedules it (ADR 9001, addendum 2026-11-17). `key`: one press never sends twice.
 */
export function sendInputOf(card: PortalCard, key: string) {
  return {
    client: card.client,
    type: card.type,
    artifactIds: card.files.map((f) => f.id),
    ...(card.title.trim() ? { title: card.title.trim() } : {}),
    ...(card.caption.trim() ? { caption: card.caption } : {}),
    ...(card.editor?.trim() ? { editor: card.editor.trim() } : {}),
    card: card.id,
    key,
  };
}

/**
 * The date an approved post can be released for from the phone: the one it already carries, while it is still ahead.
 * Choosing another date is the web's (its date and time pickers); null: nothing to release here.
 */
export function releaseDateOf(
  item: Pick<PortalItem, "status" | "released" | "scheduledFor">,
  now = new Date(),
): string | null {
  if (item.status !== "approved" || item.released) return null;
  const day = portalDayOf(item.scheduledFor);
  const time = portalTimeOf(item.scheduledFor);
  if (!day || !time || !portalAhead(day, time, now)) return null;
  return `${day}T${time}`;
}

/** The two columns a team card moves between, and the other one. */
export const otherTeamColumn = (state: "todo" | "doing") => (state === "todo" ? "doing" : "todo");

/** What was said on a card, newest first. */
export const commentsNewestFirst = (comments: readonly PortalComment[]) => [...comments].sort((a, b) => b.at - a.at);

/** A stage's colour, the one the web's legend and calendar chips use (the same in both themes). */
export const STAGE_COLOR: Record<PortalColumn, string> = {
  todo: "#8a909c",
  doing: "#3b82f6",
  approval: "#f59e0b",
  adjusting: "#ef4444",
  approved: "#22c55e",
  scheduled: "#8b5cf6",
  posted: "#14b8a6",
};

/** A client's colour and the ink on it (`PORTAL_CLIENT_COLORS`), as the web's marks draw them. */
export const CLIENT_COLOR: Record<PortalClientColor, { bg: string; ink: string }> = {
  green: { bg: "#35c46a", ink: "#111111" },
  blue: { bg: "#2563eb", ink: "#ffffff" },
  navy: { bg: "#24409e", ink: "#ffffff" },
  sky: { bg: "#7cc8f5", ink: "#111111" },
  white: { bg: "#f2f2f0", ink: "#111111" },
  teal: { bg: "#1fb5a6", ink: "#111111" },
  yellow: { bg: "#e8c21a", ink: "#111111" },
  orange: { bg: "#f08a3c", ink: "#111111" },
  red: { bg: "#cf3535", ink: "#ffffff" },
  pink: { bg: "#ee6fb0", ink: "#111111" },
  purple: { bg: "#8448e0", ink: "#ffffff" },
  gray: { bg: "#8a909c", ink: "#111111" },
};

/** A post status's icon and whether it waits on the team (`PORTAL_STATUS_LOOK`, in the phone's icons). */
export const STATUS_LOOK: Record<PortalStatus, { icon: IconName; wait: boolean }> = {
  sent: { icon: "send", wait: false },
  seen: { icon: "eye", wait: false },
  approved: { icon: "check", wait: false },
  adjust_requested: { icon: "flag", wait: true },
  adjusting: { icon: "pen", wait: false },
  adjusted: { icon: "send", wait: false },
  scheduled: { icon: "calendar", wait: false },
  published: { icon: "check", wait: false },
};

/**
 * The schedule as Trello's app draws it on a phone: one list across the screen at a time, the next one's edge in
 * sight at the right so the eye knows there is more, and a swipe stops on each list. Every number is the list's
 * width or a step of it, so the snap, the dots and a dot's press all agree.
 */
export const BOARD = {
  /** Space before the first list and after the last: the screen's own side margin. */
  side: 16,
  /** Between two lists. */
  gap: 8,
  /** How much of the next list stays in sight past the gap. */
  peek: 24,
  /** A list never narrower than this (a small phone in landscape), nor wider (a tablet). */
  min: 260,
  max: 400,
} as const;

/** A list's width on a screen this wide. */
export const boardListWidth = (screen: number) =>
  Math.round(Math.min(BOARD.max, Math.max(BOARD.min, screen - BOARD.side - BOARD.gap - BOARD.peek)));

/** The distance a swipe moves from one list to the next. */
export const boardStep = (screen: number) => boardListWidth(screen) + BOARD.gap;

/** Which list is in front for a sideways scroll (`x`), held to the lists there are. */
export function boardIndexAt(x: number, step: number, count: number): number {
  if (count <= 0 || step <= 0) return 0;
  return Math.min(count - 1, Math.max(0, Math.round(x / step)));
}

/**
 * The board's three layers, as Trello draws a board: the board light, the lists dark on it, the cards a step lighter
 * than their list, in both themes (the lists' words then read on the dark palette, `ThemeColorsOverride`). In dark the
 * board is a step dimmer, still light, so it doesn't glare beside the dark bar. `dot`/`dotOn`: the dots under the
 * lists, on the board; `hole`: where a held list would land; `slot`: where a held card would land, on a list.
 */
export function boardPaint(dark: boolean): {
  board: string;
  list: string;
  card: string;
  edge: string;
  dot: string;
  dotOn: string;
  hole: string;
  slot: string;
} {
  return {
    board: dark ? "#C9CEC2" : "#E3E7DE",
    list: "#141414",
    card: "#212121",
    edge: "#333333",
    dot: "#55594F",
    dotOn: "#0A0A0A",
    hole: "rgba(10, 10, 10, 0.16)",
    slot: "rgba(255, 255, 255, 0.08)",
  };
}

/** WCAG's contrast ratio between two #RRGGBB colors. */
export function contrast(a: string, b: string): number {
  const lum = (hex: string) => {
    const [r, g, bl] = [1, 3, 5].map((i) => {
      const v = Number.parseInt(hex.slice(i, i + 2), 16) / 255;
      return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4;
    }) as [number, number, number];
    return 0.2126 * r + 0.7152 * g + 0.0722 * bl;
  };
  const [x, y] = [lum(a), lum(b)].sort((m, n) => n - m) as [number, number];
  return (x + 0.05) / (y + 0.05);
}

/**
 * A search's words for the board: lower case, no accents, and a task's number on its own ("#49" or "49") as `task`.
 * Empty: no search.
 */
export function boardQuery(text: string): { words: string; task: number | null } | null {
  const words = fold(text.trim());
  if (!words) return null;
  const n = /^#?(\d{1,7})$/.exec(words);
  return { words, task: n ? Number(n[1]) : null };
}

const fold = (text: string) => text.normalize("NFD").replace(/\p{M}/gu, "").toLowerCase();

/** Whether a card answers a search: its title, description, caption, a label's name, or its task's number. */
export function cardMatches(
  card: Pick<PlanCard, "title" | "description" | "caption" | "labels">,
  query: { words: string; task: number | null },
  task: number | undefined,
  labelNames: ReadonlyMap<string, string>,
): boolean {
  if (query.task !== null && task === query.task) return true;
  const words = query.words.replace(/^#/, "");
  const said = [card.title, card.description, card.caption, ...card.labels.map((id) => labelNames.get(id) ?? "")];
  return said.some((text) => fold(text).includes(words));
}

/** The board's lists for a search: only the cards that answer it, and only the lists that hold one. */
export function searchGroups(
  groups: readonly PlanGroup[],
  query: { words: string; task: number | null } | null,
  numbers: ReadonlyMap<string, number>,
  labels: readonly { id: string; name: string }[],
): PlanGroup[] {
  if (!query) return [...groups];
  const names = new Map(labels.map((l) => [l.id, l.name]));
  return groups
    .map((g) => ({ ...g, cards: g.cards.filter((c) => cardMatches(c, query, numbers.get(c.id), names)) }))
    .filter((g) => g.cards.length > 0);
}

/** `ids` with `id` taken out and put back at `index` among the others: what a list dropped there makes the order. */
export function orderAfterDrop(ids: readonly string[], id: string, index: number): string[] {
  const rest = ids.filter((x) => x !== id);
  if (rest.length === ids.length) return [...ids];
  rest.splice(Math.max(0, Math.min(index, rest.length)), 0, id);
  return rest;
}

/**
 * Where a held list would land: the slot under the finger, from how far the board is scrolled (`scroll`), the
 * finger's x on the board and the lists' step, held to the `count` lists that can move.
 */
export function listSlotAt(scroll: number, x: number, step: number, count: number): number {
  "worklet";
  if (count <= 0 || step <= 0) return 0;
  return Math.min(count - 1, Math.max(0, Math.floor((scroll + x - BOARD.side + BOARD.gap / 2) / step)));
}

/**
 * While the list at `from` is held over `slot`: how many places the list at `index` slides (-1 left, 1 right; the held
 * one's hole goes all the way to `slot`), so the board shows the order the drop would make without moving anything.
 */
export function listShift(index: number, from: number, slot: number): number {
  "worklet";
  if (index < 0 || from < 0) return 0;
  if (index === from) return slot - from;
  if (from < slot && index > from && index <= slot) return -1;
  if (slot < from && index >= slot && index < from) return 1;
  return 0;
}

/** How close to the board's side a held list makes it scroll, and how far each frame. */
export const BOARD_EDGE = { zone: 48, step: 12 } as const;

/** The board's scroll each frame while a held list is at `x` on a board this wide: toward the side it is near. */
export function edgeScroll(x: number, width: number): number {
  if (x > width - BOARD_EDGE.zone) return BOARD_EDGE.step;
  if (x < BOARD_EDGE.zone) return -BOARD_EDGE.step;
  return 0;
}

/** A list one place to the left (-1) or right (1), for the menu and a screen reader: null at an end. */
export function orderNudged(ids: readonly string[], id: string, by: -1 | 1): string[] | null {
  const at = ids.indexOf(id);
  if (at < 0 || at + by < 0 || at + by >= ids.length) return null;
  return orderAfterDrop(ids, id, at + by);
}

/** What a card's face says at a glance: the checklist's progress, how many comments and files, a description. */
export function cardBadges(card: Pick<PlanCard, "checklist" | "comments" | "files" | "description">): {
  checks: { done: number; total: number } | null;
  comments: number;
  files: number;
  described: boolean;
} {
  const total = card.checklist.length;
  return {
    checks: total > 0 ? { done: card.checklist.filter((x) => x.done).length, total } : null,
    comments: card.comments.length,
    files: card.files.length,
    described: card.description.trim().length > 0,
  };
}

/** A label's color, the web's (`[data-color]` in the portal's styles), the same in both themes. */
export const LABEL_COLOR: Record<PortalLabelColor, string> = {
  green: "#22a34a",
  mint: "#2bb39a",
  olive: "#7c8a2a",
  yellow: "#d9a406",
  wine: "#8e2a4a",
  red: "#d93a3a",
  purple: "#7b4bd6",
  lilac: "#a78bda",
  blue: "#2f7fe0",
  gray: "#7d838f",
};

/** A card's labels as the board names them, in the card's order; a label the board no longer has is left out. */
export function cardLabels(card: Pick<PlanCard, "labels">, labels: readonly PortalLabel[]): PortalLabel[] {
  const byId = new Map(labels.map((l) => [l.id, l]));
  return card.labels.flatMap((id) => byId.get(id) ?? []);
}

/** A card's labels with one put on or taken off. */
export const toggledLabels = (on: readonly string[], id: string) =>
  on.includes(id) ? on.filter((x) => x !== id) : [...on, id];

/** One client's approved posts nobody released yet: what "Para agendar" lists (the server's list is every client's). */
export const toScheduleOf = (items: readonly PortalItem[] | undefined, client: string): PortalItem[] =>
  (items ?? []).filter((i) => i.client === client && i.status === "approved" && !i.released);

/** A day as the portal writes it (`YYYY-MM-DD`), in this device's own calendar. */
export function ymdOf(date: Date): string {
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

/** The days a post may be scheduled for on the phone: today and the next ones; a day already chosen further out too. */
export function scheduleDays(now: Date, count: number, keep: string | null = null): string[] {
  const days = Array.from({ length: count }, (_, i) =>
    ymdOf(new Date(now.getFullYear(), now.getMonth(), now.getDate() + i)),
  );
  if (keep && /^\d{4}-\d{2}-\d{2}$/.test(keep) && !days.includes(keep) && keep > (days[0] ?? "")) days.push(keep);
  return days;
}

/** The minutes a time steps by on the phone (the reminders' own). */
export const SCHEDULE_STEP = 15;

/** A time of day (`HH:MM`) moved by `minutes`, around the clock. */
export function stepClock(time: string, minutes: number): string {
  const m = /^(\d{2}):(\d{2})$/.exec(time);
  const at = m ? Number(m[1]) * 60 + Number(m[2]) : 0;
  const total = (((at + minutes) % 1440) + 1440) % 1440;
  return `${String(Math.floor(total / 60)).padStart(2, "0")}:${String(total % 60).padStart(2, "0")}`;
}

/**
 * Where the phone's scheduling starts: the post's own date and time when it carries one still ahead (a date proposed
 * for it), else tomorrow at 10:00, a time feeds read well at.
 */
export function scheduleStart(item: Pick<PortalItem, "scheduledFor">, now = new Date()): { day: string; time: string } {
  const day = portalDayOf(item.scheduledFor);
  const time = portalTimeOf(item.scheduledFor) ?? "10:00";
  if (day && portalAhead(day, time, now)) return { day, time };
  return { day: ymdOf(new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1)), time: "10:00" };
}
