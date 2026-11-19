import { type PointerEvent as ReactPointerEvent, useEffect, useRef, useState } from "react";

const MOUSE_SLOP = 5;
const EDGE = 60;
const SCROLL_STEP = 12;

/** What scrolls the page around `el`: its nearest ancestor that scrolls up and down, or the document. */
function scrollerOf(el: HTMLElement): HTMLElement {
  for (let p = el.parentElement; p; p = p.parentElement) {
    const { overflowY } = getComputedStyle(p);
    if ((overflowY === "auto" || overflowY === "scroll") && p.scrollHeight > p.clientHeight) return p;
  }
  return (document.scrollingElement as HTMLElement | null) ?? document.documentElement;
}

/**
 * Moving a task up or down its assignee's queue by its handle (ADR doug-0022), with a mouse (press and drag) or a
 * finger (the handle takes the touch at once: it scrolls nothing): the row follows the pointer, a bar shows where it
 * would land, the page scrolls near the window's top and bottom and Esc gives it up. The handle's arrow keys are the
 * keyboard's way (the caller's). The sibling of `useListDrag` (portal/board-parts.tsx), which moves lists sideways.
 *
 * Reads, under each list: `[data-queue="<lane>"]` on the list and `[data-queue-row="<id>"]` on each row, in order.
 * `onDrop(lane, id, index)`: `index` is among the lane's other rows, as `orderAfterDrop` takes it.
 */
export function useQueueDrag({
  enabled,
  onDrop,
}: {
  enabled: boolean;
  onDrop: (lane: string, id: string, index: number) => void;
}) {
  const [drop, setDrop] = useState<{ id: string; where: "before" | "after" } | null>(null);
  const [lifted, setLifted] = useState<string | null>(null);
  const latest = useRef(onDrop);
  latest.current = onDrop;
  const stop = useRef<(() => void) | null>(null);
  useEffect(() => () => stop.current?.(), []);

  const onPointerDown = (e: ReactPointerEvent<HTMLElement>, id: string) => {
    if (!enabled || e.button !== 0 || e.ctrlKey || e.metaKey || e.shiftKey || e.altKey || stop.current) return;
    const row = e.currentTarget.closest<HTMLElement>("[data-queue-row]");
    const list = row?.closest<HTMLElement>("[data-queue]");
    if (!row || !list) return;
    const lane = list.dataset.queue ?? "";
    const touch = e.pointerType !== "mouse";
    const pointerId = e.pointerId;
    const y0 = e.clientY;
    const x0 = e.clientX;
    const scroller = scrollerOf(list);
    const scroll0 = scroller.scrollTop;
    let y = y0;
    let started = false;
    let index = -1;
    let frame = 0;

    const place = () => {
      row.style.transform = `translateY(${y - y0 + (scroller.scrollTop - scroll0)}px)`;
      const others = [...list.querySelectorAll<HTMLElement>("[data-queue-row]")].filter((r) => r !== row);
      let at = others.length;
      for (let i = 0; i < others.length; i++) {
        const r = (others[i] as HTMLElement).getBoundingClientRect();
        if (y < r.top + r.height / 2) {
          at = i;
          break;
        }
      }
      index = at;
      const target = others[at] ?? others[at - 1];
      const targetId = target?.dataset.queueRow;
      setDrop(targetId ? { id: targetId, where: at < others.length ? "before" : "after" } : null);
    };
    const tick = () => {
      const was = scroller.scrollTop;
      if (y > window.innerHeight - EDGE) scroller.scrollTop += SCROLL_STEP;
      else if (y < EDGE) scroller.scrollTop -= SCROLL_STEP;
      if (scroller.scrollTop !== was) place();
      frame = requestAnimationFrame(tick);
    };
    function start() {
      started = true;
      setLifted(id);
      document.body.classList.add("queue-dragging");
      place();
      frame = requestAnimationFrame(tick);
    }
    const end = (commit: boolean) => {
      cancelAnimationFrame(frame);
      document.removeEventListener("pointermove", onMove);
      document.removeEventListener("pointerup", onUp);
      document.removeEventListener("pointercancel", onCancel);
      document.removeEventListener("keydown", onKey, true);
      document.removeEventListener("touchmove", onTouch);
      document.body.classList.remove("queue-dragging");
      row.style.transform = "";
      stop.current = null;
      setLifted(null);
      setDrop(null);
      if (!started) return;
      // The press that ends a drag isn't a click on what is under it.
      const swallow = (click: MouseEvent) => {
        click.stopPropagation();
        click.preventDefault();
      };
      document.addEventListener("click", swallow, { capture: true, once: true });
      window.setTimeout(() => document.removeEventListener("click", swallow, true), 0);
      if (commit && index >= 0) latest.current(lane, id, index);
    };
    const onMove = (m: PointerEvent) => {
      if (m.pointerId !== pointerId) return;
      y = m.clientY;
      if (!started) {
        if (Math.hypot(m.clientX - x0, m.clientY - y0) < MOUSE_SLOP) return;
        start();
      }
      place();
    };
    const onUp = (u: PointerEvent) => u.pointerId === pointerId && end(true);
    const onCancel = (u: PointerEvent) => u.pointerId === pointerId && end(false);
    const onKey = (k: KeyboardEvent) => {
      if (k.key !== "Escape" || !started) return;
      k.preventDefault();
      k.stopPropagation();
      end(false);
    };
    // While a task is held, a finger moves it instead of the page.
    const onTouch = (t: TouchEvent) => started && t.cancelable && t.preventDefault();
    document.addEventListener("pointermove", onMove);
    document.addEventListener("pointerup", onUp);
    document.addEventListener("pointercancel", onCancel);
    document.addEventListener("keydown", onKey, true);
    document.addEventListener("touchmove", onTouch, { passive: false });
    stop.current = () => end(false);
    // A finger on the handle picks the task up at once: the handle has no other use for a touch.
    if (touch) start();
  };

  return {
    /** The row a moving one would land beside, and on which side. */
    drop,
    /** The row under the pointer. */
    lifted,
    handle: (id: string) => ({ onPointerDown: (e: ReactPointerEvent<HTMLElement>) => onPointerDown(e, id) }),
  };
}
