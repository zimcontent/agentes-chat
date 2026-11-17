/**
 * Whether a touch was a tap, the rule `useTapAway` closes the keyboard by: one finger, lifted soon and close to where
 * it landed. A drag (scrolling, swiping a message to reply) or a hold (a message's menu) is never a tap.
 */

/** How far the finger may wander and still tap (points), as a list's own tap. */
export const TAP_SLOP = 10;
/** How long a tap may last (ms): past it, a hold. */
export const TAP_MS = 350;

export interface TouchAt {
  x: number;
  y: number;
  at: number;
}

export function isTap(start: TouchAt, end: TouchAt): boolean {
  return Math.hypot(end.x - start.x, end.y - start.y) <= TAP_SLOP && end.at - start.at <= TAP_MS;
}
