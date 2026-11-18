import { describe, expect, test } from "bun:test";
import {
  hhmmOf,
  pendingBadge,
  SCHEDULE_DAYS,
  scheduleReady,
  scheduleSendOf,
  scheduleStart,
  toScheduleRows,
  ymdOf,
} from "../../src/features/portal/schedule";

// A Tuesday afternoon, local time (the picker and the portal's day are the device's local calendar).
const NOW = new Date(2026, 10, 17, 14, 7);

describe("Pronto para agendar: the rows", () => {
  test("only approved posts not released yet, in the list's order", () => {
    const rows = toScheduleRows([
      { id: "a", status: "approved", released: false },
      { id: "b", status: "approved", released: true },
      { id: "c", status: "scheduled", released: false },
      { id: "d", status: "approved", released: false },
    ] as never[]);
    expect(rows.map((r: { id: string }) => r.id)).toEqual(["a", "d"]);
  });

  test("the tab's badge is the two sections' counts added", () => {
    expect(pendingBadge(3, 2)).toBe(5);
    expect(pendingBadge(0, 0)).toBe(0);
    expect(pendingBadge(-1, 2)).toBe(2);
  });
});

describe("Pronto para agendar: the day and time", () => {
  test("a day is the local calendar's, never UTC's", () => {
    expect(ymdOf(new Date(2026, 0, 5, 23, 59))).toBe("2026-01-05");
    expect(ymdOf(new Date(2026, 11, 31, 0, 0))).toBe("2026-12-31");
    expect(hhmmOf({ hour: 9, minute: 5 })).toBe("09:05");
  });

  test("with no date, it starts as a reminder does: two hours ahead, on the hour, over two weeks of days", () => {
    const { days, pick } = scheduleStart({ scheduledFor: null }, NOW);
    expect(days).toHaveLength(SCHEDULE_DAYS);
    expect(ymdOf(days[0] as Date)).toBe("2026-11-17");
    expect(pick).toEqual({ dayOffset: 0, time: { hour: 16, minute: 0 } });
    expect(scheduleSendOf(days, pick)).toBe("2026-11-17T16:00");
    expect(scheduleReady(days, pick, NOW)).toBe(true);
  });

  test("late at night it starts tomorrow at nine", () => {
    const late = new Date(2026, 10, 17, 21, 30);
    const { days, pick } = scheduleStart({ scheduledFor: null }, late);
    expect(scheduleSendOf(days, pick)).toBe("2026-11-18T09:00");
  });

  test("a proposed date still ahead is where it starts, as the web's dialog", () => {
    const { days, pick } = scheduleStart({ scheduledFor: "2026-11-20T10:30:00-03:00" }, NOW);
    expect(pick).toEqual({ dayOffset: 3, time: { hour: 10, minute: 30 } });
    expect(scheduleSendOf(days, pick)).toBe("2026-11-20T10:30");
  });

  test("a proposed date past two weeks still shows as picked", () => {
    const { days, pick } = scheduleStart({ scheduledFor: "2026-12-10T18:00" }, NOW);
    expect(days.length).toBeGreaterThan(SCHEDULE_DAYS);
    expect(scheduleSendOf(days, pick)).toBe("2026-12-10T18:00");
  });

  test("a proposed date that passed is ignored", () => {
    const { pick } = scheduleStart({ scheduledFor: "2026-11-16T10:00" }, NOW);
    expect(pick).toEqual({ dayOffset: 0, time: { hour: 16, minute: 0 } });
  });

  test("a time already gone today can't be confirmed, the same time tomorrow can", () => {
    const { days } = scheduleStart({ scheduledFor: null }, NOW);
    expect(scheduleReady(days, { dayOffset: 0, time: { hour: 14, minute: 0 } }, NOW)).toBe(false);
    expect(scheduleReady(days, { dayOffset: 1, time: { hour: 14, minute: 0 } }, NOW)).toBe(true);
  });

  test("a day the picker doesn't offer sends nothing", () => {
    const { days } = scheduleStart({ scheduledFor: null }, NOW);
    const pick = { dayOffset: 99, time: { hour: 10, minute: 0 } };
    expect(scheduleSendOf(days, pick)).toBeNull();
    expect(scheduleReady(days, pick, NOW)).toBe(false);
  });
});
