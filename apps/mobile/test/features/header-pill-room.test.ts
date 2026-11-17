import { expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const source = (path: string) => readFileSync(join(import.meta.dir, "../../src/features/chat", path), "utf8");

test("the conversation's pill never runs under the bar's buttons: its room comes from the list that draws them", () => {
  // No renderer for the phone's components in these tests: what only the source can say is read from it.
  const chat = source("ChatScreen.tsx");
  // Every pill (a thread, a DM, a group) gives up the room of the same buttons the bar draws, never a count by hand
  // (a group's call button once went uncounted and the pill ran under it).
  const pills = chat.match(/<HeaderPill\b/g) ?? [];
  expect(pills.length).toBe(3);
  expect(chat.match(/extraActions=\{barRoom\}/g)?.length).toBe(pills.length);
  expect(chat.match(/extraActions=/g)?.length).toBe(pills.length);
  // The bar is drawn from that list alone, and the room is its sum less the "…" the pill already leaves.
  expect(chat).toContain("const right = barButtons.length ? barButtons.map(");
  expect(chat).toContain("const barRoom = Math.max(0, barButtons.reduce((sum, b) => sum + b.room, 0) - 1);");
  // The call button is in the list, for a group too.
  expect(chat).toMatch(/key: "call",\s+room: 1,/);
  // A button that may draw nothing keeps no room while it does: the computer's says when it shows.
  expect(chat).toContain("room: computerShown ? 1 : 0,");
  expect(source("DmComputerButton.tsx")).toContain("onShown?.(shown);");
  // The pill's room is the screen less the bar's margins, back, "…" and those buttons, with no floor wider than the
  // closed pill: a floor of 160 ran under an agent DM's tasks, computer and call on a 375-point phone.
  const pill = source("HeaderPill.tsx");
  expect(pill).toContain("const room = Math.max(HEIGHT, screen - 152 - extraActions * 44);");
  // Less room than its least width, the pill closes to its lead; a channel's faces go before the name does.
  expect(pill).toContain("const closed = (collapsed || room < MIN_WIDTH) && Boolean(lead);");
  expect(pill).toContain("const showTrailing = Boolean(trailing) && room - bare - faces >= MIN_WORDS;");
});

test("the pill's words grow with the text size only as far as both lines fit its height", () => {
  const pill = source("HeaderPill.tsx");
  expect(pill).toContain("const WORDS_MAX_SCALE = (HEIGHT - 2 * WORDS_INSET) / (TITLE_LINE + STATUS_LINE);");
  // The name, the quiet line and what measures them share the cap, so the measured widths are the drawn ones.
  expect(pill.match(/maxFontSizeMultiplier=\{WORDS_MAX_SCALE\}/g)?.length).toBe(4);
  expect(pill).toContain("const lineBox = Math.ceil(STATUS_LINE * Math.min(useFontScale(), WORDS_MAX_SCALE));");
});
