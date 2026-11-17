import { describe, expect, test } from "bun:test";
import {
  BRAND_RING,
  BRAND_ROW,
  brandBox,
  CAMERA,
  noticeClear,
  noticeTop,
  topKindOf,
} from "../../src/features/island/shape";
import { brandSpot } from "../../src/lib/brand-spot";

describe("the top of the screen", () => {
  test("the camera's island from a 59 inset, the notch from 44, else neither; Android never", () => {
    expect(topKindOf("ios", 59)).toBe("camera");
    expect(topKindOf("ios", 62)).toBe("camera");
    expect(topKindOf("ios", 47)).toBe("notch");
    expect(topKindOf("ios", 44)).toBe("notch");
    expect(topKindOf("ios", 20)).toBe("plain");
    expect(topKindOf("android", 59)).toBe("plain");
  });
});

describe("DougBot's signature resting in the island", () => {
  test("out of the camera: the camera inside it 6 from its edges, concentric, the name under it", () => {
    const b = brandBox("camera", 59);
    expect(b.top).toBe(CAMERA.top - BRAND_RING);
    expect(b.w).toBeGreaterThanOrEqual(CAMERA.width + 2 * BRAND_RING);
    expect(b.corner).toBe(CAMERA.height / 2 + BRAND_RING);
    expect(b.clear).toBe(BRAND_RING + CAMERA.height);
    expect(b.h).toBe(b.clear + BRAND_ROW);
    // It stays between the time and the battery: never wider than the camera by more than the bar leaves.
    expect(b.w).toBeLessThanOrEqual(160);
  });

  test("hanging from the notch: flush with the screen's edge, the name under the notch", () => {
    const b = brandBox("notch", 47);
    expect(b.top).toBe(0);
    expect(b.clear).toBe(33);
    expect(b.h).toBe(33 + BRAND_ROW);
  });

  test("with neither, a pill under the status bar", () => {
    const b = brandBox("plain", 24);
    expect(b.top).toBe(28);
    expect(b.clear).toBe(0);
    expect(b.corner).toBe(b.h / 2);
  });

  test("a notice grows from the same place: out of the camera, from the screen's edge under the notch", () => {
    expect(noticeTop("camera", 59)).toBe(CAMERA.top);
    expect(noticeClear("camera", 59)).toBe(CAMERA.height);
    expect(noticeTop("notch", 47)).toBe(0);
    expect(noticeClear("notch", 47)).toBe(33);
    expect(noticeTop("plain", 24)).toBe(30);
    expect(noticeClear("plain", 24)).toBe(0);
  });
});

describe("which screens want the signature", () => {
  test("held while a tab root is on show, released when it leaves; two holders, one release keeps it", () => {
    let calls = 0;
    const stop = brandSpot.subscribe(() => {
      calls += 1;
    });
    expect(brandSpot.get()).toBe(false);
    const a = brandSpot.hold();
    const b = brandSpot.hold();
    expect(brandSpot.get()).toBe(true);
    a();
    expect(brandSpot.get()).toBe(true);
    b();
    expect(brandSpot.get()).toBe(false);
    // A second release changes nothing.
    b();
    expect(calls).toBe(4);
    stop();
  });
});
