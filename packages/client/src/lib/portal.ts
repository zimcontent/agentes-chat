import type { TFunction } from "i18next";
import { ApiError } from "../api/http";
import type {
  PortalClientSummary,
  PortalColumn,
  PortalItem,
  PortalMissing,
  PortalStatus,
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

/** A client's id as a name: the portal knows clients by a slug ("acme-foods" reads "Acme Foods"). */
export const portalClientName = (client: string) =>
  client
    .split("-")
    .filter(Boolean)
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
    .join(" ") || client;

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
