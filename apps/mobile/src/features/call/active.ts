import { useSyncExternalStore } from "react";

/**
 * Whether a voice call is on (docs/adr/doug-0006-live-voice.md, the phone app). The workspace's socket stays open while
 * one is, also in the background (`RealtimeProvider`): it carries the call's signals and pings, and a call that loses it
 * for a minute drops this person.
 */
let active = false;
const listeners = new Set<() => void>();

export const callActive = {
  get: () => active,
  set(next: boolean) {
    if (active === next) return;
    active = next;
    for (const fn of listeners) fn();
  },
  subscribe(fn: () => void) {
    listeners.add(fn);
    return () => {
      listeners.delete(fn);
    };
  },
};

export const useCallActive = () => useSyncExternalStore(callActive.subscribe, callActive.get, callActive.get);
