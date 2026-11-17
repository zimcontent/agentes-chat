import { describe, expect, test } from "bun:test";
import { hasCameraIsland, islandShape } from "../src/features/island/shape";

// The phones' top safe insets, in points: what `useSafeAreaInsets().top` reads on each.
const PHONES = [
  { name: "iPhone SE", os: "ios", top: 20, camera: false },
  { name: "iPhone 11", os: "ios", top: 48, camera: false },
  { name: "iPhone 13 Pro Max", os: "ios", top: 47, camera: false },
  { name: "iPhone 14", os: "ios", top: 47, camera: false },
  { name: "iPhone 14 Pro", os: "ios", top: 59, camera: true },
  { name: "iPhone 15 Pro Max", os: "ios", top: 59, camera: true },
  { name: "iPhone 16 Pro", os: "ios", top: 62, camera: true },
  { name: "Android with a punch hole", os: "android", top: 48, camera: false },
  { name: "Android with a tall status bar", os: "android", top: 64, camera: false },
] as const;

describe("the notice island on each phone", () => {
  for (const phone of PHONES) {
    test(`${phone.name}: ${phone.camera ? "beside the camera" : "never parked over the screen's bar"}`, () => {
      const camera = hasCameraIsland(phone.os, phone.top);
      expect(camera).toBe(phone.camera);
      // A request waiting on me: a small island only beside the camera's island.
      expect(islandShape({ lead: true, open: false, small: true, camera })).toBe(phone.camera ? "small" : "none");
      // A notice arriving still shows its pill, and a tap still opens it, on every phone.
      expect(islandShape({ lead: true, open: false, small: false, camera })).toBe("pill");
      expect(islandShape({ lead: true, open: true, small: true, camera })).toBe("open");
      expect(islandShape({ lead: false, open: false, small: false, camera })).toBe("none");
    });
  }
});
