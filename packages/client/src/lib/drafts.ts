/**
 * Text waiting to be put in a conversation's composer (⌘K "Pedir a um
 * agente" opens the DM with it). Read with `peekDraft` (render-safe), then
 * `clearDraft` once used.
 *
 * `join`: the text goes after what the person already had in that box, instead of in its place (`draftJoins` tells
 * the composer), so a hand-off from another screen never erases a draft someone was writing.
 */
interface HandedDraft {
  text: string;
  join: boolean;
}

const drafts = new Map<string, HandedDraft>();

export const setDraftFor = (key: string, text: string, options: { join?: boolean } = {}) => {
  drafts.set(key, { text, join: options.join ?? false });
};
export const peekDraft = (key: string) => drafts.get(key)?.text;
/** Whether the waiting text is added after the box's own, or replaces it. */
export const draftJoins = (key: string) => drafts.get(key)?.join ?? false;
export const clearDraft = (key: string) => {
  drafts.delete(key);
};
