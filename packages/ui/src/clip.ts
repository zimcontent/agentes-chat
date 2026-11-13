/**
 * Doug: cutting text people read (previews, push and notification lines, quoted replies, names) on whole characters.
 * A plain `slice` can stop inside an emoji: half of a surrogate pair shows as "�", and half of a joined emoji
 * (a family, a flag, a skin tone) shows as a different one. These cut between graphemes, what a reader calls a letter.
 */
const GRAPHEMES = new Intl.Segmenter(undefined, { granularity: "grapheme" });

/** The longest start of `text` within `max` UTF-16 units that ends between two whole characters. */
export function cutWhole(text: string, max: number): string {
  if (text.length <= max) return text;
  let end = 0;
  for (const { index, segment } of GRAPHEMES.segment(text)) {
    const next = index + segment.length;
    if (next > max) break;
    end = next;
  }
  return text.slice(0, end);
}

/** `text` within `max` units: cut on a whole character, ending in "…" when it was cut. */
export function clipWhole(text: string, max: number): string {
  return text.length > max ? `${cutWhole(text, max - 1).trimEnd()}…` : text;
}
