/** Dictated words into the field (`Composer`'s `insert`). */

/** `words` put in `text` at `at`, a space on each side where a word touches them; the caret after them. */
export function spliceWords(text: string, at: number, words: string): { text: string; caret: number } {
  const before = text.slice(0, at);
  const after = text.slice(at);
  const lead = before && !/\s$/.test(before) ? " " : "";
  const trail = after && !/^\s/.test(after) ? " " : "";
  const put = `${lead}${words}${trail}`;
  return { text: `${before}${put}${after}`, caret: before.length + lead.length + words.length };
}
