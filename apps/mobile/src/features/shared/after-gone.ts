/**
 * What waits for the screen's sheet to be gone (a GIF to send, the photo library to present), kept apart from React so
 * every way a sheet can end is tested: nothing picked in a sheet is lost or done while one is still on screen.
 */
export interface AfterGone {
  /** A sheet comes up. What the last one left waiting runs now: it is not coming back to be gone. */
  opened: () => void;
  /** The sheet closes; `then` runs once it is gone, or now when none is on screen. */
  closing: (then?: () => void) => void;
  /** The sheet is gone from the screen: what waited runs. */
  gone: () => void;
  /** The screen goes away with its sheet: what waited is dropped, its screen isn't there to take it. */
  drop: () => void;
}

export function createAfterGone(): AfterGone {
  // Whether a sheet is on screen (opening, open or still sliding out).
  let shown = false;
  let waiting: (() => void)[] = [];
  const flush = () => {
    const now = waiting;
    waiting = [];
    for (const then of now) then();
  };
  return {
    opened: () => {
      flush();
      shown = true;
    },
    closing: (then) => {
      if (!then) return;
      if (shown) waiting.push(then);
      else then();
    },
    gone: () => {
      shown = false;
      flush();
    },
    drop: () => {
      shown = false;
      waiting = [];
    },
  };
}
