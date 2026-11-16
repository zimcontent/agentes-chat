import { describe, expect, test } from "bun:test";
import { reviewKindOf, reviewTabs } from "../../src/features/review/logic";

const ai = { medium: "video" as const, status: "in_review", sender: null };
const ronny = { medium: "video" as const, status: "in_review", sender: { id: "u1", name: "Ronny Souza" } };
const piece = { medium: "design" as const, status: "approved", sender: null };

describe("Revisão's tabs", () => {
  test("a person's video is that editor's, an agent's is AI's, a piece is Design", () => {
    expect(reviewKindOf(ai)).toBe("ai");
    expect(reviewKindOf(ronny)).toBe("editor:u1");
    expect(reviewKindOf(piece)).toBe("design");
  });

  test("Tudo, Vídeo de IA, each editor by first name, Design; only kinds with something, with how many wait", () => {
    expect(reviewTabs([ai, ronny, ronny, piece])).toEqual([
      { key: "all", waiting: 3 },
      { key: "ai", waiting: 1 },
      { key: "editor:u1", editor: "Ronny", waiting: 2 },
      { key: "design", waiting: 0 },
    ]);
    expect(reviewTabs([piece])).toEqual([
      { key: "all", waiting: 0 },
      { key: "design", waiting: 0 },
    ]);
  });
});
