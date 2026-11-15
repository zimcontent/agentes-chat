import { describe, expect, test } from "bun:test";
import { reviewLinksIn, reviewWords, timecode } from "../src/video-reviews/words";

const ORG = "0198a4b2-1111-7aaa-8bbb-123456789abc";
const R1 = "00148f70-2e9f-4ee2-a508-14b26906c861";
const R2 = "0198a4b2-2222-7aaa-8bbb-123456789abc";

describe("video review words", () => {
  test("a message's review links, each once, in order", () => {
    const body = `Pronto! https://dougbot.app/org/${ORG}/review/${R1} e a outra (https://dougbot.app/org/${ORG}/review/${R2}). De novo: https://dougbot.app/org/${ORG}/review/${R1}`;
    expect(reviewLinksIn(body)).toEqual([
      { orgId: ORG, reviewId: R1 },
      { orgId: ORG, reviewId: R2 },
    ]);
    expect(reviewLinksIn(`https://dougbot.app/org/${ORG}/review`)).toEqual([]);
    expect(reviewLinksIn(`https://dougbot.app/org/${ORG}/review/${R1}x`)).toEqual([]);
  });

  test("Portuguese for any pt, English otherwise", () => {
    expect(reviewWords("pt-BR").open).toBe("Revisar");
    expect(reviewWords("es").open).toBe("Review");
    expect(timecode(83_400)).toBe("1:23.4");
  });
});
