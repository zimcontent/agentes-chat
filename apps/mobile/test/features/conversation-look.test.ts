import { describe, expect, test } from "bun:test";
import { contrastOf } from "@agenteschat/ui/agent/engine";
import { BACKDROP_STEP, BRAND_GREEN, backdropTones } from "../../src/features/chat/backdrop";
import { ownBubble } from "../../src/features/chat/logic";
import { appColors } from "../../src/ui/palette";

const read = (rel: string) => Bun.file(new URL(`../../src/${rel}`, import.meta.url).pathname).text();

describe("my own bubble is the brand's green", () => {
  for (const scheme of ["dark", "light"] as const) {
    const c = appColors(scheme);
    test(`${scheme}: Clara is the lime's wash with its rim, Forte the green with its own ink`, () => {
      expect(ownBubble("light", c)).toEqual({ fill: c.bubble, edge: c.bubbleEdge, ink: null });
      expect(ownBubble("strong", c)).toEqual({ fill: c.green, edge: c.green, ink: c.greenInk });
    });
    test(`${scheme}: the words are AA on both`, () => {
      expect(contrastOf(c.ink, ownBubble("light", c).fill)).toBeGreaterThanOrEqual(4.5);
      expect(contrastOf(c.greenInk, ownBubble("strong", c).fill)).toBeGreaterThanOrEqual(4.5);
    });
  }
  test("the lime of the identity, never a blue", () => {
    expect(appColors("dark").bubble).toBe("#2C3917");
    expect(appColors("light").bubble).toBe("#E4F3C8");
  });
  test("the conversation takes no agent color for my bubble any more", async () => {
    const look = await read("features/chat/look.ts");
    expect(look).toContain("ownBubble(tone, colors)");
    expect(look).not.toContain("bubbleFill");
  });
});

describe("the conversation's texture", () => {
  test("a bot's own color glows; anything else is the brand's green", () => {
    expect(backdropTones(true, "#EC4899").glow).toBe("#EC4899");
    expect(backdropTones(true, null).glow).toBe(BRAND_GREEN);
    expect(backdropTones(false, "sky").glow).toBe(BRAND_GREEN);
  });
  test("quiet enough to read over in both themes", () => {
    for (const dark of [true, false]) {
      const t = backdropTones(dark);
      expect(t.dotOpacity).toBeLessThanOrEqual(0.08);
      expect(t.glowOpacity).toBeLessThanOrEqual(0.16);
    }
    expect(BACKDROP_STEP).toBeGreaterThanOrEqual(16);
  });
  test("drawn once, behind the list: static, no Skia, no animation", async () => {
    const src = await read("features/chat/ChatBackdrop.tsx");
    expect(src).not.toMatch(/react-native-skia|react-native-reanimated|useFrameCallback|requestAnimationFrame/);
    const screen = await read("features/chat/ChatScreen.tsx");
    // A sibling under the list, never one of its rows.
    expect(screen.indexOf("<ChatBackdrop")).toBeLessThan(screen.indexOf("<ConversationList"));
  });
});

describe("no box shadow on the conversation's bubbles", () => {
  test("their rims are borders", async () => {
    const row = await read("features/chat/MessageRow.tsx");
    expect(row).not.toContain("c.bubbleRim");
    expect(row).not.toContain("c.bubbleTheirsRim");
  });
});
