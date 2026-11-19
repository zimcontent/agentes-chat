import { expect, test } from "bun:test";
import { clipWhole, cutWhole } from "../src/clip";

// Doug: previews, pushes and quotes are cut on whole characters.
const FAMILY = "👨‍👩‍👧"; // one character a reader sees, 8 UTF-16 units
const FLAG = "🇧🇷"; // 4 units

test("never half of a surrogate pair", () => {
  expect(cutWhole("ab😀", 3)).toBe("ab");
  expect(clipWhole("ab😀cd", 4)).toBe("ab…");
});

test("a joined emoji or a flag stays whole or goes whole", () => {
  expect(cutWhole(`a${FAMILY}b`, 5)).toBe("a");
  expect(cutWhole(`a${FAMILY}b`, 9)).toBe(`a${FAMILY}`);
  expect(clipWhole(`oi ${FLAG} tudo bem`, 6)).toBe("oi…");
});

test("short text is left as it is", () => {
  expect(clipWhole("oi", 10)).toBe("oi");
  expect(clipWhole(`${FAMILY}`, 8)).toBe(FAMILY);
});

// Doug: the phone's engine has no Intl.Segmenter. The module must load without it and still never cut a pair in half.
test("without Intl.Segmenter it loads and keeps surrogate pairs whole", async () => {
  const intl = Intl as { Segmenter?: unknown };
  const saved = intl.Segmenter;
  delete intl.Segmenter;
  try {
    // A fresh copy of the module, loaded now that the API is gone (the query keeps it apart from the one above).
    const fresh = "../src/clip.ts?no-segmenter";
    const bare = (await import(fresh)) as typeof import("../src/clip");
    expect(bare.cutWhole("ab😀", 3)).toBe("ab");
    expect(bare.cutWhole("ab😀", 4)).toBe("ab😀");
    expect(bare.clipWhole("ab😀cd", 4)).toBe("ab…");
    expect(bare.clipWhole("ab😀cd", 5)).toBe("ab😀…");
    expect(bare.cutWhole("😀😀", 1)).toBe("");
    expect(bare.clipWhole("oi", 10)).toBe("oi");
    // Pairs only, not graphemes: proof this is the module loaded without the API.
    expect(bare.cutWhole(`a${FAMILY}b`, 5)).toBe("a👨\u200d");
  } finally {
    intl.Segmenter = saved;
  }
  expect(typeof Intl.Segmenter).toBe("function");
});
