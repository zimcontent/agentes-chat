import { expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { appColors } from "../src/ui/palette";
import { chosenSurface, panelSurface, pillSurface, surfaceStyle } from "../src/ui/surfaces";

const src = (path: string) => readFileSync(join(import.meta.dir, "../src", path), "utf8");

// On iOS React Native draws each box shadow as a masked layer of the view's whole size, rendered off screen on
// every frame. Builds 20 to 25 put three inset ones on the panel holding Início's whole list and two on every
// message bubble: the GPU stayed busy until the app, then the phone, stalled. Rims are borders.
test("the site's surfaces are a fill and a border, never a box shadow", () => {
  for (const scheme of ["dark", "light"] as const) {
    for (const s of [panelSurface(scheme), pillSurface(scheme), chosenSurface(scheme)]) {
      const style = surfaceStyle(s, 24);
      expect(style.borderWidth).toBe(1);
      expect("boxShadow" in style).toBe(false);
    }
  }
});

test("a bubble's rim is a border color, not a shadow", () => {
  for (const scheme of ["dark", "light"] as const) {
    const c = appColors(scheme);
    expect(c.bubbleEdge).not.toMatch(/px|inset/);
    expect(c.bubbleTheirsEdge).not.toMatch(/px|inset/);
  }
});

test("what repeats in a list or a conversation carries no box shadow", () => {
  for (const file of [
    "features/chat/MessageRow.tsx",
    "features/chats/HomeSection.tsx",
    "features/chats/ConversationRowView.tsx",
    "features/dashboards/WidgetTile.tsx",
  ]) {
    const text = src(file);
    expect(text).not.toMatch(/boxShadow: c\.bubble/);
    expect(text).not.toMatch(/boxShadow: "0 12px/);
  }
  // A glow that follows the audio level is two fixed shadows, never a new one per frame.
  expect(src("features/call/AgentCallView.tsx")).not.toMatch(/boxShadow: `0px 0px \$\{/);
});
