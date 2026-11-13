/**
 * Doug: cutting text people read (previews, push and notification lines, quoted replies, names) on whole characters.
 * A plain `slice` can stop inside an emoji: half of a surrogate pair shows as "�", and half of a joined emoji
 * (a family, a flag, a skin tone) shows as a different one. These cut between graphemes, what a reader calls a letter.
 */
// Doug: the phone's engine (Hermes) has no `Intl.Segmenter`, and this module loads there through the chat's quotes,
// so nothing may throw on load: without the API a cut only keeps surrogate pairs whole (a joined emoji may lose a part).
const GRAPHEMES =
  typeof Intl !== "undefined" && typeof Intl.Segmenter === "function"
    ? new Intl.Segmenter(undefined, { granularity: "grapheme" })
    : null;

/** `max` units of `text`, one less when the last would be the first half of a surrogate pair. */
function cutPairs(text: string, max: number): string {
  const last = text.charCodeAt(max - 1);
  return text.slice(0, last >= 0xd800 && last <= 0xdbff ? max - 1 : max);
}

/** The longest start of `text` within `max` UTF-16 units that ends between two whole characters. */
export function cutWhole(text: string, max: number): string {
  if (text.length <= max) return text;
  if (max <= 0) return "";
  if (!GRAPHEMES) return cutPairs(text, max);
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
