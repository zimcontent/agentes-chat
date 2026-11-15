import { type RefObject, useEffect } from "react";

/** How far a press moves before it pans: a shaky click stays a click. */
const SLOP = 4;

/**
 * A row of choices too wide for its place (`Segmented`, `Tabs`) scrolls sideways with no scrollbar. A finger, a pen
 * and a trackpad pan it natively; this gives a mouse the same: the up-and-down wheel slides it sideways (until its end,
 * then the page scrolls on), and a press and a drag anywhere on it, its choices included, slide it. A drag never
 * chooses: the click it ends with is swallowed. A row that fits is left alone.
 */
export function useStripScroll(ref: RefObject<HTMLElement | null>) {
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const overflows = () => el.scrollWidth > el.clientWidth + 1;
    const onWheel = (e: WheelEvent) => {
      if (e.ctrlKey || !overflows()) return;
      const dy = e.deltaY * (e.deltaMode === 1 ? 40 : e.deltaMode === 2 ? el.clientWidth : 1);
      if (!dy || Math.abs(e.deltaX) >= Math.abs(e.deltaY)) return;
      const max = el.scrollWidth - el.clientWidth;
      if ((dy < 0 && el.scrollLeft <= 0) || (dy > 0 && el.scrollLeft >= max - 1)) return;
      e.preventDefault();
      el.scrollLeft += dy;
    };
    const onDown = (e: PointerEvent) => {
      if (e.button !== 0 || e.pointerType !== "mouse" || e.ctrlKey || e.metaKey || e.shiftKey || e.altKey) return;
      if (!overflows()) return;
      const x0 = e.clientX;
      const left0 = el.scrollLeft;
      let panning = false;
      const onMove = (m: PointerEvent) => {
        if (m.pointerId !== e.pointerId) return;
        if (!panning && Math.abs(m.clientX - x0) < SLOP) return;
        if (!panning) {
          panning = true;
          el.style.cursor = "grabbing";
        }
        el.scrollLeft = left0 - (m.clientX - x0);
      };
      const onUp = (u: PointerEvent) => {
        if (u.pointerId !== e.pointerId) return;
        document.removeEventListener("pointermove", onMove);
        document.removeEventListener("pointerup", onUp);
        document.removeEventListener("pointercancel", onUp);
        el.style.cursor = "";
        if (!panning) return;
        // The click that follows the release was a drag, not a choice.
        const swallow = (c: MouseEvent) => {
          c.stopPropagation();
          c.preventDefault();
        };
        el.addEventListener("click", swallow, { capture: true, once: true });
        setTimeout(() => el.removeEventListener("click", swallow, { capture: true }), 0);
      };
      document.addEventListener("pointermove", onMove);
      document.addEventListener("pointerup", onUp);
      document.addEventListener("pointercancel", onUp);
    };
    el.addEventListener("wheel", onWheel, { passive: false });
    el.addEventListener("pointerdown", onDown);
    return () => {
      el.removeEventListener("wheel", onWheel);
      el.removeEventListener("pointerdown", onDown);
    };
  }, [ref]);
}
