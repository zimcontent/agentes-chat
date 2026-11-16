import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { clippedHeight } from "@agenteschat/client/lib/message-length";
import { wordsHeightAfter } from "../../src/features/chat/kept-sizes";

const src = (path: string) => readFileSync(join(import.meta.dir, "../../src", path), "utf8");

/** One layout of the words: folded when the kept height cuts them (`ClippedMessage`'s `shows`), or before a measure. */
function layout(kept: number, measures: { folded: number; whole: number }) {
  const folded = kept === 0 || clippedHeight(kept) !== null;
  const next = wordsHeightAfter(kept, folded ? measures.folded : measures.whole, folded);
  return next ?? kept;
}

describe("a long message near the rule never flips between folded and whole", () => {
  test("measured just under the rule when folded and just over it whole, it stays folded", () => {
    // The fold changes the room around the words: 515 folded, 530 whole (the rule cuts above 520).
    const measures = { folded: 515, whole: 530 };
    let kept = 0;
    const seen: number[] = [];
    for (let i = 0; i < 8; i++) {
      kept = layout(kept, measures);
      seen.push(kept);
    }
    expect(seen.slice(1).every((h) => h === 530)).toBe(true);
    expect(clippedHeight(kept)).not.toBeNull();
  });

  test("whole, a measure is the truth; folded, it only raises the height", () => {
    expect(wordsHeightAfter(530, 515, true)).toBeNull();
    expect(wordsHeightAfter(530, 560, true)).toBe(560);
    expect(wordsHeightAfter(530, 515, false)).toBe(515);
    expect(wordsHeightAfter(0, 400, true)).toBe(400);
    expect(wordsHeightAfter(400, 400, false)).toBeNull();
    expect(wordsHeightAfter(400, Number.NaN, false)).toBeNull();
  });

  test("the row keeps what the rule decides", () => {
    const clip = src("features/chat/ClippedMessage.tsx");
    expect(clip).toContain("const folded = shows !== null || unmeasured;");
    expect(clip).toContain("const next = wordsHeightAfter(height, e.nativeEvent.layout.height, folded);");
  });
});
