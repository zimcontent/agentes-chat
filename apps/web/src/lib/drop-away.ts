/**
 * Places outside a board that take what is dragged out of it (ADR 9001 §20): the portal's "Materiais do cliente" tab
 * takes a card or a whole list from the schedule or the board, and the schedule's tab takes them back. A place is
 * marked `[data-drop-away="<where>"]` (on a tab's label: the box is then the whole tab around it); the one under the
 * pointer while something moves gets `data-drop-over`, which the page lights up.
 */

/** A dragged card's group when it is over a place away from the board: `away:<where>`. */
export const AWAY_PREFIX = "away:";

export const awayGroup = (where: string) => `${AWAY_PREFIX}${where}`;

/** What a group names when it is a place away from the board, else null. */
export const awayOf = (group: string) => (group.startsWith(AWAY_PREFIX) ? group.slice(AWAY_PREFIX.length) : null);

const boxOf = (mark: HTMLElement) => mark.closest<HTMLElement>("button, [role='tab'], [role='radio']") ?? mark;

/** The place away from the board under a point, if any. */
export function awayAt(x: number, y: number): { where: string; box: HTMLElement } | null {
  for (const mark of document.querySelectorAll<HTMLElement>("[data-drop-away]")) {
    const where = mark.dataset.dropAway;
    if (!where) continue;
    const box = boxOf(mark);
    const r = box.getBoundingClientRect();
    if (r.width > 0 && x >= r.left && x <= r.right && y >= r.top && y <= r.bottom) return { where, box };
  }
  return null;
}

/** Lights the place a drop would go to (none with null). */
export function lightAway(box: HTMLElement | null) {
  for (const lit of document.querySelectorAll<HTMLElement>("[data-drop-over]")) {
    if (lit !== box) delete lit.dataset.dropOver;
  }
  if (box) box.dataset.dropOver = "";
}
