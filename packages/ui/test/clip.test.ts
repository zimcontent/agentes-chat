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
