import { expect, test } from "bun:test";
import { isTap, TAP_MS, TAP_SLOP } from "../src/ui/tap-away";

const at = (x: number, y: number, ms: number) => ({ x, y, at: ms });

test("a short touch that stays put is a tap: it closes the keyboard", () => {
  expect(isTap(at(100, 200, 0), at(100, 200, 80))).toBe(true);
  expect(isTap(at(100, 200, 0), at(100 + TAP_SLOP * 0.6, 200 + TAP_SLOP * 0.6, TAP_MS))).toBe(true);
});

test("a drag (scrolling, swiping to reply) and a hold (a message's menu) leave the keyboard up", () => {
  expect(isTap(at(100, 200, 0), at(100, 200 + TAP_SLOP + 1, 80))).toBe(false);
  expect(isTap(at(100, 200, 0), at(140, 200, 80))).toBe(false);
  expect(isTap(at(100, 200, 0), at(100, 200, TAP_MS + 1))).toBe(false);
});

test("the conversation closes the keyboard on a tap, on the list and on the empty chat's greeting", async () => {
  const chat = await Bun.file(new URL("../src/features/chat/ChatScreen.tsx", import.meta.url)).text();
  expect(chat).toContain("const tapAway = useTapAway();");
  expect(chat).toContain("onLayout={watchList} {...tapAway}>");
  expect(chat).toContain("<View style={StyleSheet.absoluteFill} {...tapAway}>");
});
