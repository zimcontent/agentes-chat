/**
 * Whether a screen on show wants DougBot's signature at the top of the screen (the tab roots): the island then rests
 * as the signature, and grows out of it when a notice comes. Each screen holds it while focused.
 */
const holders = new Set<symbol>();
const listeners = new Set<() => void>();
const changed = () => {
  for (const fn of listeners) fn();
};

export const brandSpot = {
  subscribe(fn: () => void) {
    listeners.add(fn);
    return () => {
      listeners.delete(fn);
    };
  },
  get: () => holders.size > 0,
  /** Held until the returned release. */
  hold() {
    const me = Symbol("brand");
    holders.add(me);
    changed();
    return () => {
      if (holders.delete(me)) changed();
    };
  },
};
