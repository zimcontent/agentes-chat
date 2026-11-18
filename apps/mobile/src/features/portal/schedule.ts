import type { PortalItem } from "@agenteschat/client";
import { portalAhead, portalDayOf, portalSendDate, portalTimeOf } from "@agenteschat/client/lib/portal";
import { type ClockTime, dayChoices, dayOffsetOf, defaultCustom } from "../reminders/logic";

/**
 * "Pronto para agendar" (ADR 9001, addendum 2026-11-17), on Pendentes: approved posts nobody scheduled yet, each
 * scheduled from a sheet with the app's own day and time picker. Pure, so it is unit-tested. The rules are the
 * web's `ScheduleDialog`: a day and a time in the portal's terms (`YYYY-MM-DDTHH:MM`, read by the portal in its own
 * time zone, which has the last word), confirmed only while they are ahead by this device's clock, and starting on
 * the post's own proposed date when it has one still ahead.
 */

/** Days the picker offers by default: today and the next 13. */
export const SCHEDULE_DAYS = 14;
/** At most this many days, so a far proposed date still shows as picked. */
const MAX_DAYS = 62;

export interface SchedulePick {
  dayOffset: number;
  time: ClockTime;
}

/** The rows: approved posts not released yet (the list may lag a schedule from elsewhere by one read). */
export const toScheduleRows = <T extends Pick<PortalItem, "status" | "released">>(items: readonly T[]): T[] =>
  items.filter((i) => i.status === "approved" && !i.released);

/** A local midnight as the portal's day (`YYYY-MM-DD`), without `toISOString` (UTC would move the day). */
export function ymdOf(d: Date): string {
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

/** `HH:MM` of a time of day. */
export const hhmmOf = (t: ClockTime) => `${String(t.hour).padStart(2, "0")}:${String(t.minute).padStart(2, "0")}`;

/** Where the sheet starts and how many days it offers: the post's proposed date while ahead, else the reminder's start. */
export function scheduleStart(
  item: Pick<PortalItem, "scheduledFor">,
  now = new Date(),
): { days: Date[]; pick: SchedulePick } {
  const day = portalDayOf(item.scheduledFor);
  const time = portalTimeOf(item.scheduledFor);
  if (day && time && portalAhead(day, time, now)) {
    const [y = 0, m = 1, d = 1] = day.split("-").map(Number);
    const [hour = 0, minute = 0] = time.split(":").map(Number);
    const offset = dayOffsetOf(new Date(y, m - 1, d), now);
    if (offset >= 0 && offset < MAX_DAYS)
      return {
        days: dayChoices(now, Math.max(SCHEDULE_DAYS, offset + 1)),
        pick: { dayOffset: offset, time: { hour, minute } },
      };
  }
  return { days: dayChoices(now, SCHEDULE_DAYS), pick: defaultCustom(now) };
}

/** The pick as the portal takes it (`YYYY-MM-DDTHH:MM`), or null when the day isn't one offered. */
export function scheduleSendOf(days: readonly Date[], pick: SchedulePick): string | null {
  const day = days[pick.dayOffset];
  return day ? portalSendDate(ymdOf(day), hhmmOf(pick.time)) : null;
}

/** Whether the pick may be confirmed: a day offered and a time still ahead by this device's clock. */
export function scheduleReady(days: readonly Date[], pick: SchedulePick, now = new Date()): boolean {
  const day = days[pick.dayOffset];
  return Boolean(day) && portalAhead(day ? ymdOf(day) : null, hhmmOf(pick.time), now);
}

/** The Pendentes tab's badge: what needs you plus the approved posts ready to schedule, the two sections' counts. */
export const pendingBadge = (waiting: number, toSchedule: number) => Math.max(0, waiting) + Math.max(0, toSchedule);
