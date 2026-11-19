import { type RefObject, useEffect } from "react";

/** The person asked the system for less motion: scroll-linked pieces stay, everything that moves by itself stops. */
export const prefersLessMotion = (): boolean =>
  typeof window !== "undefined" && window.matchMedia?.("(prefers-reduced-motion: reduce)").matches === true;

export const clamp01 = (n: number): number => Math.min(1, Math.max(0, n));
export const smooth = (n: number): number => {
  const t = clamp01(n);
  return t * t * (3 - 2 * t);
};
export const mix = (a: number, b: number, t: number): number => a + (b - a) * t;

/**
 * Calls `frame` on every animation frame while `ref` is on screen (and once when it arrives), with how far the page
 * has scrolled through it: 0 when its top meets the bottom of the window, 1 when its bottom leaves the top. With
 * `pinned`, 0 when its top reaches the top of the window and 1 when its bottom reaches the bottom (a sticky stage
 * inside a tall section). One rAF per section, stopped while it is off screen.
 */
export function useScrollFrame(
  ref: RefObject<HTMLElement | null>,
  frame: (progress: number, el: HTMLElement) => void,
  pinned = false,
): void {
  useEffect(() => {
    const el = ref.current;
    if (!el || typeof window === "undefined") return;
    let raf = 0;
    let last = Number.NaN;
    let visible = false;
    const tick = () => {
      raf = 0;
      const rect = el.getBoundingClientRect();
      const vh = window.innerHeight || 1;
      const p = pinned
        ? clamp01(-rect.top / Math.max(1, rect.height - vh))
        : clamp01((vh - rect.top) / Math.max(1, rect.height + vh));
      if (p !== last) {
        last = p;
        frame(p, el);
      }
    };
    const ask = () => {
      if (visible && !raf) raf = requestAnimationFrame(tick);
    };
    const seen =
      typeof IntersectionObserver === "function"
        ? new IntersectionObserver(
            ([entry]) => {
              visible = entry?.isIntersecting ?? false;
              ask();
            },
            { rootMargin: "20% 0px" },
          )
        : null;
    if (seen) seen.observe(el);
    else visible = true;
    tick();
    window.addEventListener("scroll", ask, { passive: true });
    window.addEventListener("resize", ask);
    return () => {
      seen?.disconnect();
      window.removeEventListener("scroll", ask);
      window.removeEventListener("resize", ask);
      if (raf) cancelAnimationFrame(raf);
    };
  }, [ref, frame, pinned]);
}

/**
 * Marks every `[data-reveal]` under `ref` with `data-in` once a fifth of it is on screen, for the CSS to bring it in
 * (each one's `--d` staggers it). Without IntersectionObserver everything is in at once.
 */
export function useReveal(ref: RefObject<HTMLElement | null>): void {
  useEffect(() => {
    const root = ref.current;
    if (!root) return;
    const items = Array.from(root.querySelectorAll<HTMLElement>("[data-reveal]"));
    if (typeof IntersectionObserver !== "function") {
      for (const el of items) el.dataset.in = "";
      return;
    }
    const seen = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          if (!entry.isIntersecting) continue;
          (entry.target as HTMLElement).dataset.in = "";
          seen.unobserve(entry.target);
        }
      },
      { threshold: 0.2, rootMargin: "0px 0px -8% 0px" },
    );
    for (const el of items) seen.observe(el);
    return () => seen.disconnect();
  }, [ref]);
}

/**
 * Where the pointer is over `ref`, as `--mx`/`--my` from -1 to 1 (0 at the middle) and `--gx`/`--gy` in percent, eased
 * toward it every frame so the pieces that follow it glide. Touch screens and less motion leave it at the middle.
 */
export function usePointer(ref: RefObject<HTMLElement | null>): void {
  useEffect(() => {
    const el = ref.current;
    if (!el || prefersLessMotion() || !window.matchMedia?.("(pointer: fine)").matches) return;
    let tx = 0;
    let ty = 0;
    let x = 0;
    let y = 0;
    let raf = 0;
    const step = () => {
      x += (tx - x) * 0.08;
      y += (ty - y) * 0.08;
      el.style.setProperty("--mx", x.toFixed(4));
      el.style.setProperty("--my", y.toFixed(4));
      raf = Math.abs(tx - x) + Math.abs(ty - y) > 0.001 ? requestAnimationFrame(step) : 0;
    };
    const move = (e: PointerEvent) => {
      const r = el.getBoundingClientRect();
      tx = clamp01((e.clientX - r.left) / r.width) * 2 - 1;
      ty = clamp01((e.clientY - r.top) / r.height) * 2 - 1;
      el.style.setProperty("--gx", `${(((tx + 1) / 2) * 100).toFixed(1)}%`);
      el.style.setProperty("--gy", `${(((ty + 1) / 2) * 100).toFixed(1)}%`);
      if (!raf) raf = requestAnimationFrame(step);
    };
    const leave = () => {
      tx = 0;
      ty = 0;
      if (!raf) raf = requestAnimationFrame(step);
    };
    el.addEventListener("pointermove", move);
    el.addEventListener("pointerleave", leave);
    return () => {
      el.removeEventListener("pointermove", move);
      el.removeEventListener("pointerleave", leave);
      if (raf) cancelAnimationFrame(raf);
    };
  }, [ref]);
}

/**
 * Cards under `ref` marked `[data-tilt]` lean toward the pointer in 3D (`--rx`/`--ry` in degrees) and carry their own
 * light (`--gx`/`--gy`), back flat when it leaves. One listener for the whole list.
 */
export function useTilt(ref: RefObject<HTMLElement | null>, max = 8): void {
  useEffect(() => {
    const root = ref.current;
    if (!root || prefersLessMotion() || !window.matchMedia?.("(pointer: fine)").matches) return;
    let current: HTMLElement | null = null;
    const flat = (el: HTMLElement) => {
      el.style.setProperty("--rx", "0deg");
      el.style.setProperty("--ry", "0deg");
    };
    const move = (e: PointerEvent) => {
      const card = (e.target as HTMLElement).closest<HTMLElement>("[data-tilt]");
      if (current && current !== card) flat(current);
      current = card;
      if (!card) return;
      const r = card.getBoundingClientRect();
      const px = clamp01((e.clientX - r.left) / r.width);
      const py = clamp01((e.clientY - r.top) / r.height);
      card.style.setProperty("--ry", `${((px - 0.5) * 2 * max).toFixed(2)}deg`);
      card.style.setProperty("--rx", `${((0.5 - py) * 2 * max).toFixed(2)}deg`);
      card.style.setProperty("--gx", `${(px * 100).toFixed(1)}%`);
      card.style.setProperty("--gy", `${(py * 100).toFixed(1)}%`);
    };
    const leave = () => {
      if (current) flat(current);
      current = null;
    };
    root.addEventListener("pointermove", move);
    root.addEventListener("pointerleave", leave);
    return () => {
      root.removeEventListener("pointermove", move);
      root.removeEventListener("pointerleave", leave);
    };
  }, [ref, max]);
}
