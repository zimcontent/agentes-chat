import { describe, expect, test } from "bun:test";
import type { TFunction } from "i18next";
import { ApiError } from "../src/api/http";
import type { PortalClientSummary, PortalColumn } from "../src/api/types";
import {
  PORTAL_BOARD_COLUMNS,
  PORTAL_COLUMNS,
  portalAhead,
  portalClientName,
  portalDayOf,
  portalErrorText,
  portalLink,
  portalPostedByMonth,
  portalScheduling,
  portalSendDate,
  portalSendProblem,
  portalTimeOf,
  portalTotals,
  portalWhen,
  sortPortalClients,
} from "../src/lib/portal";

const counts = (over: Partial<Record<PortalColumn, number>> = {}): Record<PortalColumn, number> => ({
  todo: 0,
  doing: 0,
  approval: 0,
  adjusting: 0,
  approved: 0,
  scheduled: 0,
  posted: 0,
  ...over,
});
const client = (name: string, open: number, over: Partial<Record<PortalColumn, number>> = {}): PortalClientSummary => ({
  client: name,
  counts: counts(over),
  open,
  next: null,
});
/** The key itself, so a test reads which words were picked. */
const t = ((key: string) => key) as unknown as TFunction;

describe("the approval portal's board (ADR 9001)", () => {
  test("seven columns, the last one a list of its own: the board shows six", () => {
    expect(PORTAL_COLUMNS).toEqual(["todo", "doing", "approval", "adjusting", "approved", "scheduled", "posted"]);
    expect([...PORTAL_BOARD_COLUMNS] as string[]).toEqual(PORTAL_COLUMNS.slice(0, 6));
  });

  test("a client's id reads as a name", () => {
    expect(portalClientName("acme-foods")).toBe("Acme Foods");
    expect(portalClientName("blue")).toBe("Blue");
  });

  test("the overview: what waits on the team first (adjustments, then approved and not scheduled), then the busiest", () => {
    const sorted = sortPortalClients([
      client("quiet", 1),
      client("busy", 9),
      client("approved", 2, { approved: 2 }),
      client("asked", 1, { adjusting: 1 }),
    ]);
    expect(sorted.map((c) => c.client)).toEqual(["asked", "approved", "busy", "quiet"]);
    expect(portalTotals(sorted)).toEqual({ counts: counts({ approved: 2, adjusting: 1 }), open: 13 });
  });

  test("what was published, newest first, by the month the portal wrote", () => {
    const item = (id: string, publishedAt: string | null) => ({ id, publishedAt, scheduledFor: null, updatedAt: null });
    const groups = portalPostedByMonth([
      item("old", "2026-09-30T23:30:00-03:00"),
      item("none", null),
      item("new", "2026-10-05T10:00:00-03:00"),
      item("mid", "2026-10-01T08:00:00-03:00"),
    ]);
    expect(groups.map((g) => [g.month, g.items.map((i) => i.id)])).toEqual([
      ["2026-10", ["new", "mid"]],
      // 23:30 at the portal stays in September, whatever this machine's time zone makes of it.
      ["2026-09", ["old"]],
      [null, ["none"]],
    ]);
  });

  test("a date reads in the portal's own clock, never moved to this time zone", () => {
    const now = new Date(2026, 10, 13);
    expect(portalWhen("en", "2026-11-21T14:00:00-03:00", now)).toBe("Nov 21, 14:00");
    expect(portalWhen("en", "2027-01-02", now)).toBe("Jan 2, 2027");
    expect(portalWhen("en", "next week", now)).toBe("next week");
    expect(portalWhen("en", null, now)).toBeNull();
    expect(portalDayOf("2026-11-21T14:00:00-03:00")).toBe("2026-11-21");
    expect(portalTimeOf("2026-11-21T14:00:00-03:00")).toBe("14:00");
    expect(portalTimeOf("2026-11-21")).toBeNull();
    expect(portalSendDate("2026-11-21", "14:00")).toBe("2026-11-21T14:00");
  });

  test("a time can be confirmed only while it is still ahead", () => {
    const now = new Date(2026, 10, 13, 12, 0);
    expect(portalAhead("2026-11-13", "12:01", now)).toBe(true);
    expect(portalAhead("2026-11-13", "12:00", now)).toBe(false);
    expect(portalAhead("2026-11-12", "23:00", now)).toBe(false);
    expect(portalAhead(null, "12:30", now)).toBe(false);
    expect(portalAhead("2026-11-14", "", now)).toBe(false);
  });

  test("an approved post that was released waits for the publishing service, whatever date it carries", () => {
    expect(portalScheduling({ status: "approved", released: true })).toBe(true);
    // A proposed date alone is no release.
    expect(portalScheduling({ status: "approved", released: false })).toBe(false);
    expect(portalScheduling({ status: "scheduled", released: true })).toBe(false);
  });

  test("what can go up: a reel is one video with a picture as its cover, the rest pictures and videos", () => {
    const video = { name: "take.mp4" };
    const picture = { name: "capa.png" };
    expect(portalSendProblem("reel", [], null)).toBe("noFiles");
    expect(portalSendProblem("reel", [video], null)).toBeNull();
    expect(portalSendProblem("reel", [video], picture)).toBeNull();
    expect(portalSendProblem("reel", [video], video)).toBe("coverNotImage");
    expect(portalSendProblem("reel", [picture])).toBe("reelOneVideo");
    expect(portalSendProblem("reel", [video, video])).toBe("reelOneVideo");
    expect(portalSendProblem("carousel", [picture, video, picture])).toBeNull();
    expect(portalSendProblem("image", [{ name: "brief.pdf" }])).toBe("notMedia");
    expect(
      portalSendProblem(
        "carousel",
        Array.from({ length: 21 }, () => picture),
      ),
    ).toBe("tooMany");
  });

  test("a link is used only when it is a web address", () => {
    expect(portalLink("https://portal.example/acme/p1")).toBe("https://portal.example/acme/p1");
    expect(portalLink("javascript:alert(1)")).toBeNull();
    expect(portalLink(null)).toBeNull();
  });

  test("a refusal shows the portal's own words, the rest the app's", () => {
    expect(portalErrorText(t, new ApiError(400, "portal.refused", "This post isn't approved yet"))).toBe(
      "This post isn't approved yet",
    );
    expect(portalErrorText(t, new ApiError(502, "portal.unavailable", "Bad Gateway"))).toBe("portal.unavailable");
    expect(portalErrorText(t, new ApiError(404, "portal.off", "no portal"))).toBe("portal.off.title");
  });
});
