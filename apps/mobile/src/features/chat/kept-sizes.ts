/**
 * Sizes a conversation's rows measured, kept in memory while the app runs (nothing is stored anywhere).
 *
 * The list unmounts a row that leaves the screen and mounts it again when it comes back. A row that measures part of
 * itself to decide its size (how tall its words are before they are cut, how wide a table's columns are, how much room
 * its pictures have) drew at a guess for a frame and then changed size, and every row under it moved while the person
 * scrolled. Kept here, a row comes back at its size from its first frame; it measures only the first time it shows, out
 * of sight ahead of the scroll (the list draws a screen ahead).
 *
 * A key holds what the size depends on besides the content (`useLayoutKey`: the window's width, the text size, the
 * conversation's look). Bounded: past `MAX_KEPT` the size kept longest ago goes first.
 */

export const MAX_KEPT = 3000;

/** A height or a width, or a table's columns by index. */
type Kept = number | Readonly<Record<number, number>>;

const kept = new Map<string, Kept>();

function keep(key: string, value: Kept) {
  // Kept again, it becomes the newest: the oldest are the ones not seen for longest.
  kept.delete(key);
  kept.set(key, value);
  if (kept.size > MAX_KEPT) {
    const oldest = kept.keys().next();
    if (!oldest.done) kept.delete(oldest.value);
  }
}

export function keptSize(key: string): number | undefined {
  const value = kept.get(key);
  return typeof value === "number" ? value : undefined;
}

export function keepSize(key: string, size: number) {
  keep(key, size);
}

export function keptColumns(key: string): Readonly<Record<number, number>> | undefined {
  const value = kept.get(key);
  return typeof value === "object" ? value : undefined;
}

export function keepColumns(key: string, columns: Readonly<Record<number, number>>) {
  keep(key, { ...columns });
}

/** Everything kept, gone (tests). */
export function forgetKeptSizes() {
  kept.clear();
}

/**
 * The words' height to keep after a measure (`ClippedMessage`), or null when nothing changes. Folded (under the cut, or
 * the cap before the first measure) the words can measure shorter than they are whole, since the fold changes the room
 * around them: a message near the rule measured just under it folded and just over it whole, and flipped between the
 * two on every layout. Folded, a measure only ever raises the height; unfolded, it is the words' whole height.
 */
export function wordsHeightAfter(kept: number, measured: number, folded: boolean): number | null {
  if (!Number.isFinite(measured) || measured === kept) return null;
  if (folded && measured < kept) return null;
  return measured;
}
