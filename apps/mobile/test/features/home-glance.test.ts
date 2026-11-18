import { describe, expect, test } from "bun:test";
import { adjustmentsHref, editorNow, portalAdjusting } from "../../src/features/chats/glance";

describe("Início's glance", () => {
  const review = (id: string, status: "changes" | "in_review" | "approved", at: string, sender: string | null) => ({
    id,
    title: `T${id}`,
    status,
    updatedAt: at,
    sender: sender ? { id: sender, name: `${sender} Alves` } : null,
  });

  test("the editor now is the person whose video moved last, never me or an agent, by first name", () => {
    const list = [
      review("1", "approved", "2026-11-16T01:00:00Z", "Ronny"),
      review("2", "changes", "2026-11-16T03:00:00Z", "Ronny"),
      review("3", "in_review", "2026-11-16T04:00:00Z", null),
      review("4", "in_review", "2026-11-16T05:00:00Z", "me"),
    ];
    expect(editorNow(list, "me")).toEqual({ name: "Ronny", reviewId: "2", title: "T2", status: "changes" });
    expect(editorNow([review("3", "in_review", "2026-11-16T04:00:00Z", null)], "me")).toBeNull();
  });

  test("clients' changes: the total, and the clients asking most first, three at most", () => {
    const c = (client: string, adjusting: number) => ({ client, counts: { adjusting } });
    expect(portalAdjusting([c("lexeer", 1), c("elmx", 3), c("alliance", 0), c("bte", 2), c("zim", 1)])).toEqual({
      total: 7,
      clients: ["elmx", "bte", "lexeer"],
    });
    expect(portalAdjusting([])).toEqual({ total: 0, clients: [] });
  });
});

test("Alterações opens the changes asked: one client's Quadro, several narrowed in the Portal, none the Portal", () => {
  const c = (client: string, adjusting: number) => ({ client, counts: { adjusting } });
  expect(adjustmentsHref([c("lexeer", 2), c("elmx", 0)])).toBe("/portal/client/lexeer?tab=board");
  expect(adjustmentsHref([c("lexeer", 2), c("elmx", 1)])).toBe("/portal?alteracoes=1");
  expect(adjustmentsHref([c("lexeer", 0)])).toBe("/portal");
});
