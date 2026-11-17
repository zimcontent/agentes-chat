import { describe, expect, test } from "bun:test";
import { islandShape, topKindOf } from "../src/features/island/shape";

// The phones' top safe insets, in points: what `useSafeAreaInsets().top` reads on each.
const PHONES = [
  { name: "iPhone SE", os: "ios", top: 20, kind: "plain" },
  { name: "iPhone 11", os: "ios", top: 48, kind: "notch" },
  { name: "iPhone 13 Pro Max", os: "ios", top: 47, kind: "notch" },
  { name: "iPhone 14", os: "ios", top: 47, kind: "notch" },
  { name: "iPhone 14 Pro", os: "ios", top: 59, kind: "camera" },
  { name: "iPhone 15 Pro Max", os: "ios", top: 59, kind: "camera" },
  { name: "iPhone 16 Pro", os: "ios", top: 62, kind: "camera" },
  { name: "Android with a punch hole", os: "android", top: 48, kind: "plain" },
  { name: "Android with a tall status bar", os: "android", top: 64, kind: "plain" },
] as const;

describe("the notice island on each phone", () => {
  for (const phone of PHONES) {
    const camera = phone.kind === "camera";
    test(`${phone.name}: ${camera ? "waits beside the camera" : "never parked over the screen's bar"}`, () => {
      const kind = topKindOf(phone.os, phone.top);
      expect(kind).toBe(phone.kind);
      for (const branded of [false, true]) {
        const rest = branded ? "brand" : "none";
        // A request waiting on me: a small island only beside the camera's island; elsewhere back to rest.
        expect(islandShape({ kind, lead: true, open: false, small: true, branded })).toBe(camera ? "small" : rest);
        // A notice arriving still shows its pill, and a tap still opens it, on every phone.
        expect(islandShape({ kind, lead: true, open: false, small: false, branded })).toBe("pill");
        expect(islandShape({ kind, lead: true, open: true, small: true, branded })).toBe("open");
        expect(islandShape({ kind, lead: false, open: false, small: false, branded })).toBe(rest);
      }
    });
  }
});
