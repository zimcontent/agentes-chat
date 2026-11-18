import { describe, expect, test } from "bun:test";
import {
  cardShift,
  cardSlotAt,
  cardsWithout,
  columnAt,
  DRAG_GAP,
  type DragCardGeo,
  type DragListGeo,
  type DragSlot,
  listEdge,
  listEdgeSpeed,
  listGrowth,
  pagedTo,
  scrolledBy,
  sideEdge,
  slotTop,
} from "@/features/portal/drag";
import { BOARD, orderAfterDrop } from "@/features/portal/model";

/** Five cards of different heights, 8 apart, as a list lays them out. */
const heights = [60, 90, 40, 70, 50];
const cards: DragCardGeo[] = [];
for (let i = 0, y = 0; i < heights.length; y += (heights[i] ?? 0) + DRAG_GAP, i++) {
  cards.push({ id: `c${i}`, x: 8, y, h: heights[i] ?? 0 });
}
const list: DragListGeo = { top: 60, left: 0, height: 400, padTop: 0, cards };
const H = (id: string) => (cards.find((c) => c.id === id)?.h ?? 0) + DRAG_GAP;

/** What the list shows while `id` (at `fromI`) is held over slot `toI`: every other card's top after its shift. */
const shown = (s: DragSlot, id: string) =>
  cards
    .map((c, k) => ({ id: c.id, top: c.y + cardShift(0, k, s) }))
    .filter((c) => c.id !== id)
    .sort((a, b) => a.top - b.top);

describe("a card dragged inside its list", () => {
  test("the others close the hole it left and open one where it would land, never overlapping", () => {
    for (let from = 0; from < cards.length; from++) {
      const id = `c${from}`;
      for (let to = 0; to < cards.length; to++) {
        const s: DragSlot = { fromL: 0, fromI: from, toL: 0, toI: to, H: H(id) };
        const tops = shown(s, id);
        const gapTop = slotTop(list, id, s.H, to);
        // The placeholder sits exactly where the order after the drop puts the card.
        const order = orderAfterDrop(
          cards.map((c) => c.id),
          id,
          to,
        );
        expect(order.indexOf(id)).toBe(to);
        let y = 0;
        for (const cid of order) {
          if (cid === id) expect(gapTop).toBe(y);
          else expect(tops.find((t) => t.id === cid)?.top).toBe(y);
          y += (cards.find((c) => c.id === cid)?.h ?? 0) + DRAG_GAP;
        }
      }
    }
  });

  test("held where it was, nothing moves", () => {
    const s: DragSlot = { fromL: 0, fromI: 2, toL: 0, toI: 2, H: H("c2") };
    cards.forEach((_, k) => {
      if (k !== 2) expect(cardShift(0, k, s)).toBe(0);
    });
    expect(slotTop(list, "c2", s.H, 2)).toBe(cards[2]?.y ?? -1);
    expect(listGrowth(0, s)).toBe(0);
  });

  test("held and let go in place, it lands in place, whatever the heights", () => {
    for (let from = 0; from < cards.length; from++) {
      const me = cards[from] as DragCardGeo;
      expect(cardSlotAt(cards, me.id, H(me.id), me.y + me.h / 2, from)).toBe(from);
    }
  });

  test("the slot moves once the held card is past a neighbour's middle as the screen shows it", () => {
    const s = H("c1");
    const others = cardsWithout(cards, "c1", s);
    expect(others.map((c) => c.id)).toEqual(["c0", "c2", "c3", "c4"]);
    // Shown with the placeholder at 1: c2 sits under it, its middle at 68 + 98 + 20 = 186.
    expect(cardSlotAt(cards, "c1", s, 185, 1)).toBe(1);
    expect(cardSlotAt(cards, "c1", s, 187, 1)).toBe(2);
    // Once at 2, c2 is drawn up at 68 (middle 88): the card stays at 2 until it is back above that.
    expect(cardSlotAt(cards, "c1", s, 120, 2)).toBe(2);
    expect(cardSlotAt(cards, "c1", s, 87, 2)).toBe(1);
    // Up past c0's middle (30).
    expect(cardSlotAt(cards, "c1", s, 29, 1)).toBe(0);
    expect(cardSlotAt(cards, "c1", s, -20, 0)).toBe(0);
    expect(cardSlotAt(cards, "c1", s, 9999, 4)).toBe(4);
  });

  test("over another list (no placeholder there yet) the cards are read where they lie", () => {
    expect(cardSlotAt(cards, "x", 50, 31, -1)).toBe(1);
    expect(cardSlotAt(cards, "x", 50, 29, -1)).toBe(0);
  });
});

describe("a card dragged to another list", () => {
  const s: DragSlot = { fromL: 0, fromI: 1, toL: 1, toI: 2, H: H("c1") };
  test("its list closes up and shrinks, the other opens at the slot and grows", () => {
    // The held card itself (1) stays put, hidden under the one in the air.
    expect(cards.map((_, k) => cardShift(0, k, s))).toEqual([0, 0, -s.H, -s.H, -s.H]);
    expect([0, 1, 2, 3].map((k) => cardShift(1, k, s))).toEqual([0, 0, s.H, s.H]);
    expect(listGrowth(0, s)).toBe(-s.H);
    expect(listGrowth(1, s)).toBe(s.H);
    expect(listGrowth(2, s)).toBe(0);
  });
  test("an empty list takes it at its top", () => {
    const empty: DragListGeo = { top: 60, left: 0, height: 0, padTop: 4, cards: [] };
    expect(cardSlotAt(empty.cards, "c1", s.H, 500, -1)).toBe(0);
    expect(slotTop(empty, "c1", s.H, 0)).toBe(4);
  });
  test("past the last card the placeholder opens under it", () => {
    const last = cards[4] as DragCardGeo;
    expect(slotTop(list, "x", 50, 5)).toBe(last.y + last.h + DRAG_GAP);
  });
});

describe("the list under the finger", () => {
  const step = 300;
  test("by the board's scroll and the finger's x", () => {
    const all = [true, true, true, true];
    expect(columnAt(0, BOARD.side + 10, step, all)).toBe(0);
    expect(columnAt(0, BOARD.side + step + 10, step, all)).toBe(1);
    expect(columnAt(step * 2, BOARD.side + 10, step, all)).toBe(2);
    expect(columnAt(step * 9, 10, step, all)).toBe(3);
    expect(columnAt(0, -100, step, all)).toBe(0);
  });
  test("a column that takes no cards hands the drop to the nearest one that does", () => {
    // "New list" first, two lists, "Add list" last.
    const cols = [false, true, true, false];
    expect(columnAt(0, BOARD.side + 10, step, cols)).toBe(1);
    expect(columnAt(step * 3, BOARD.side + 10, step, cols)).toBe(2);
    // The Quadro: the portal's columns between and after the team's two.
    expect(columnAt(step * 4, BOARD.side + 10, step, [true, true, false, false, false])).toBe(1);
    expect(columnAt(0, 0, step, [false, false])).toBe(-1);
    expect(columnAt(0, 0, step, [])).toBe(-1);
  });
});

describe("edges", () => {
  test("the board pages near its sides only", () => {
    expect(sideEdge(10, 390)).toBe(-1);
    expect(sideEdge(195, 390)).toBe(0);
    expect(sideEdge(380, 390)).toBe(1);
    expect(sideEdge(10, 0)).toBe(0);
  });
  test("a page stops on the next list's snap, never past the board", () => {
    expect(pagedTo(0, 1, 300, 4)).toBe(300);
    expect(pagedTo(310, 1, 300, 4)).toBe(600);
    expect(pagedTo(900, 1, 300, 4)).toBe(900);
    expect(pagedTo(0, -1, 300, 4)).toBe(0);
    expect(pagedTo(600, -1, 300, 4)).toBe(300);
  });
  test("a list scrolls toward the edge the finger is near, faster deep in it, held to its content", () => {
    expect(listEdge(300, 100, 400)).toBe(0);
    expect(listEdge(130, 100, 400)).toBe(-1);
    expect(listEdge(105, 100, 400)).toBe(-2);
    expect(listEdge(470, 100, 400)).toBe(1);
    expect(listEdge(495, 100, 400)).toBe(2);
    expect(listEdge(900, 100, 400)).toBe(2);
    expect(listEdgeSpeed(0)).toBe(0);
    expect(listEdgeSpeed(1)).toBeLessThan(listEdgeSpeed(2));
    expect(listEdgeSpeed(-2)).toBe(-listEdgeSpeed(2));
    expect(scrolledBy(0, -2, 1000, 400)).toBe(0);
    expect(scrolledBy(595, 2, 1000, 400)).toBe(600);
    expect(scrolledBy(100, 1, 1000, 400)).toBe(106);
    expect(scrolledBy(0, 2, 300, 400)).toBe(0);
  });
});
