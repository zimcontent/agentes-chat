/**
 * The arithmetic of dragging on a board (the Cronograma's lists and cards, the Quadro's team cards), as Trello's app
 * drags: where a held card would land under the finger, how far every other card slides to make room, where the
 * placeholder opens, when the board pages to the next list and how fast a long list scrolls under the finger.
 *
 * Every function here runs on the UI thread while the finger moves (they are worklets), so the screen follows the
 * finger without a JS frame; the same functions are tested in plain JS.
 */
import { BOARD } from "./model";

/** Between two cards of a list (the lists' `gap`). */
export const DRAG_GAP = 8;
/** How long a finger holds still on a card or a list's head before it lifts (Trello's is about this). */
export const DRAG_HOLD_MS = 300;
/** The lifted card's tilt and scale, as Trello's. */
export const DRAG_TILT_DEG = 4;
export const DRAG_SCALE = 1.04;
/** How far the finger may wander, in all, for a hold released in place to count as a hold (it opens the card's menu). */
export const DRAG_STILL = 10;

/** A card of a list as it was laid out when the drag began: its place in the list's scrolled content. */
export type DragCardGeo = { id: string; x: number; y: number; h: number };
/** A list's cards area: where its scrolling box starts on the board and how tall it is, and its cards in order. */
export type DragListGeo = { top: number; left: number; height: number; padTop: number; cards: DragCardGeo[] };

/** The drag in flight: the card (or list) held, where it came from and where it would land. */
export type DragSlot = { fromL: number; fromI: number; toL: number; toI: number; H: number };

/**
 * The cards of a list as they would lie without the held one (`id`), the ones under it moved up by its height and gap
 * (`H`), so a drop's place doesn't depend on where the placeholder happens to be now.
 */
export function cardsWithout(cards: readonly DragCardGeo[], id: string | null, H: number): DragCardGeo[] {
  "worklet";
  const out: DragCardGeo[] = [];
  let past = false;
  for (const c of cards) {
    if (c.id === id) {
      past = true;
      continue;
    }
    out.push(past ? { id: c.id, x: c.x, y: c.y - H, h: c.h } : c);
  }
  return out;
}

/**
 * Where a card held over a list would land, from the held card's middle (`center`, in the list's scrolled content), as
 * Trello's: the other cards it is past, each one's middle read where the screen shows it now, under the placeholder
 * when the placeholder is above it (`current`: the slot shown in this list, -1 when it shows in another). So a card
 * held and let go in place stays in place, and the slot moves only once the card is past a neighbour as drawn.
 */
export function cardSlotAt(
  cards: readonly DragCardGeo[],
  id: string | null,
  H: number,
  center: number,
  current: number,
): number {
  "worklet";
  const others = cardsWithout(cards, id, H);
  let n = 0;
  for (let i = 0; i < others.length; i++) {
    const c = others[i] as DragCardGeo;
    const shown = c.y + (current >= 0 && i >= current ? H : 0) + c.h / 2;
    if (shown < center) n++;
  }
  return n;
}

/**
 * How far the card at `k` of list `L` slides while a card is held (`s`): the cards under the held one's old place go
 * up into it, the cards from the new place down go down to open the placeholder.
 */
export function cardShift(L: number, k: number, s: DragSlot): number {
  "worklet";
  let shift = 0;
  let index = k;
  if (L === s.fromL && k > s.fromI) {
    shift -= s.H;
    index -= 1;
  }
  if (L === s.toL && index >= s.toI) shift += s.H;
  return shift;
}

/**
 * How much longer list `L` gets while a card is held: the list it would land in grows by the card, the list it left
 * shrinks by it (a negative margin at the end of its cards), so neither shows a hole at its foot.
 */
export function listGrowth(L: number, s: DragSlot): number {
  "worklet";
  if (s.toL === s.fromL) return 0;
  if (L === s.toL) return s.H;
  if (L === s.fromL) return -s.H;
  return 0;
}

/** The top of the placeholder in a list's content: where the card would lie if it were dropped at `toI`. */
export function slotTop(list: DragListGeo, id: string | null, H: number, toI: number): number {
  "worklet";
  const others = cardsWithout(list.cards, id, H);
  const at = others[toI];
  if (at) return at.y;
  const last = others[others.length - 1];
  if (last) return last.y + last.h + DRAG_GAP;
  return list.padTop;
}

/**
 * The list under the finger (`x` on the board, the board scrolled `scroll`): the nearest one that takes cards when the
 * one under it doesn't (a "new list" column, a column the portal fills); -1 when none does.
 */
export function columnAt(scroll: number, x: number, step: number, droppable: readonly boolean[]): number {
  "worklet";
  const count = droppable.length;
  if (count === 0 || step <= 0) return -1;
  const raw = Math.min(count - 1, Math.max(0, Math.floor((scroll + x - BOARD.side + BOARD.gap / 2) / step)));
  if (droppable[raw]) return raw;
  for (let d = 1; d < count; d++) {
    if (raw - d >= 0 && droppable[raw - d]) return raw - d;
    if (raw + d < count && droppable[raw + d]) return raw + d;
  }
  return -1;
}

/** How close to the board's side the finger pages the board, and to a list's top or bottom it scrolls the list. */
export const EDGE = { side: 40, list: 56, deep: 24 } as const;

/** -1 near the board's left side, 1 near its right, 0 between. */
export function sideEdge(x: number, width: number): -1 | 0 | 1 {
  "worklet";
  if (width <= 0) return 0;
  if (x > width - EDGE.side) return 1;
  if (x < EDGE.side) return -1;
  return 0;
}

/**
 * Near a list's top (negative) or bottom (positive): 1 inside the zone, 2 deep in it (or past the list's end), 0 away
 * from both. The list scrolls faster the deeper the finger is.
 */
export function listEdge(y: number, top: number, height: number): -2 | -1 | 0 | 1 | 2 {
  "worklet";
  if (height <= 0) return 0;
  const bottom = top + height;
  if (y > bottom - EDGE.deep) return 2;
  if (y > bottom - EDGE.list) return 1;
  if (y < top + EDGE.deep) return -2;
  if (y < top + EDGE.list) return -1;
  return 0;
}

/** Points a list scrolls each frame for an edge band of `listEdge`. */
export function listEdgeSpeed(band: number): number {
  return band === 0 ? 0 : Math.sign(band) * (Math.abs(band) === 2 ? 14 : 6);
}

/** A list's scroll after one frame at `band`, held to what the list can scroll. */
export function scrolledBy(scroll: number, band: number, content: number, viewport: number): number {
  return Math.min(Math.max(0, content - viewport), Math.max(0, scroll + listEdgeSpeed(band)));
}

/** Where the board stops after paging once toward `dir` from `scroll`: the next list's snap, held to the board. */
export function pagedTo(scroll: number, dir: -1 | 1, step: number, count: number): number {
  if (step <= 0 || count <= 0) return 0;
  const at = Math.round(scroll / step);
  return Math.min(count - 1, Math.max(0, at + dir)) * step;
}

/** How long the finger rests at the board's side before it pages, and between pages while it stays. */
export const PAGE_DWELL_MS = 300;
export const PAGE_EVERY_MS = 1000;
