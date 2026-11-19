import { useEffect, useRef } from "react";
import { prefersLessMotion } from "./motion";

/** The bots' colors (IDENTIDADE.md §6), never the Doug's green: the field is theirs. */
const TONES = ["236, 72, 153", "34, 211, 238", "167, 139, 250", "251, 146, 60", "96, 165, 250", "240, 245, 255"];

interface Shard {
  x: number;
  y: number;
  vx: number;
  vy: number;
  size: number;
  alpha: number;
  tone: string;
  spin: number;
  turn: number;
  glow: number;
  depth: number;
}

/**
 * A field of glass shards behind the hero: they drift, swirl around the pointer as if it were a magnet, and stream
 * with the scroll's speed, the near ones faster than the far ones. Drawn on a canvas sized to its box and its
 * screen's density; paused off screen; with less motion, one still frame. Decoration only.
 */
export function GlassField({ className }: { className?: string }) {
  const ref = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const canvas = ref.current;
    const ctx = canvas?.getContext("2d");
    if (!canvas || !ctx) return;
    const still = prefersLessMotion();
    let w = 0;
    let h = 0;
    let dpr = 1;
    let shards: Shard[] = [];
    let raf = 0;
    let running = false;
    const pointer = { x: -9999, y: -9999 };
    let lastScroll = window.scrollY;
    let flow = 0;

    const make = (): Shard => ({
      x: Math.random() * w,
      y: Math.random() * h,
      vx: (Math.random() - 0.5) * 0.25,
      vy: (Math.random() - 0.5) * 0.25,
      size: Math.random() * 1.6 + 0.6,
      alpha: Math.random() * 0.35 + 0.08,
      tone: TONES[Math.floor(Math.random() * TONES.length)] as string,
      spin: Math.random() * Math.PI * 2,
      turn: (Math.random() - 0.5) * 0.04,
      glow: 0,
      depth: Math.random() * 0.8 + 0.2,
    });

    const size = () => {
      dpr = Math.min(2, window.devicePixelRatio || 1);
      w = canvas.clientWidth;
      h = canvas.clientHeight;
      canvas.width = Math.round(w * dpr);
      canvas.height = Math.round(h * dpr);
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      // About one shard per 1,400 square points: a phone gets a few hundred, a wide screen under a thousand.
      const count = Math.min(900, Math.round((w * h) / 1400));
      shards = Array.from({ length: count }, make);
    };

    const draw = () => {
      ctx.clearRect(0, 0, w, h);
      const radius = Math.min(300, Math.max(160, w * 0.2));
      for (const s of shards) {
        if (!still) {
          const dx = pointer.x - s.x;
          const dy = pointer.y - s.y;
          const dist = Math.hypot(dx, dy) || 1;
          if (dist < radius) {
            const force = (radius - dist) / radius;
            s.vx += (dx / dist) * force * 0.06 + (dy / dist) * force * 0.5;
            s.vy += (dy / dist) * force * 0.06 - (dx / dist) * force * 0.5;
            s.glow = Math.max(s.glow, force * 0.8);
          } else s.glow *= 0.94;
          s.x += s.vx;
          s.y += s.vy - flow * s.depth;
          s.vx *= 0.94;
          s.vy *= 0.94;
          s.vx += (Math.random() - 0.5) * 0.03;
          s.vy += (Math.random() - 0.5) * 0.03;
          s.spin += s.turn + (Math.abs(s.vx) + Math.abs(s.vy)) * 0.04;
          if (s.x < -20) s.x = w + 20;
          if (s.x > w + 20) s.x = -20;
          if (s.y < -20) s.y = h + 20;
          if (s.y > h + 20) s.y = -20;
        }
        const a = Math.min(0.95, s.alpha + s.glow);
        const len = s.size * (2.4 + s.glow * 2);
        ctx.save();
        ctx.translate(s.x, s.y);
        ctx.rotate(s.spin);
        ctx.fillStyle = `rgba(${s.tone}, ${a})`;
        if (s.glow > 0.25) {
          ctx.shadowBlur = 10 * s.glow;
          ctx.shadowColor = `rgba(${s.tone}, ${s.glow})`;
        }
        ctx.beginPath();
        ctx.moveTo(0, -len);
        ctx.lineTo(s.size, 0);
        ctx.lineTo(0, len);
        ctx.lineTo(-s.size, 0);
        ctx.closePath();
        ctx.fill();
        ctx.restore();
      }
      flow *= 0.9;
    };

    const loop = () => {
      draw();
      raf = running ? requestAnimationFrame(loop) : 0;
    };
    const start = () => {
      if (still || running) return;
      running = true;
      raf = requestAnimationFrame(loop);
    };
    const stop = () => {
      running = false;
      if (raf) cancelAnimationFrame(raf);
      raf = 0;
    };

    const onMove = (e: PointerEvent) => {
      const r = canvas.getBoundingClientRect();
      pointer.x = e.clientX - r.left;
      pointer.y = e.clientY - r.top;
    };
    const onLeave = () => {
      pointer.x = -9999;
      pointer.y = -9999;
    };
    const onScroll = () => {
      const y = window.scrollY;
      flow = Math.max(-14, Math.min(14, flow + (y - lastScroll) * 0.04));
      lastScroll = y;
    };
    const onResize = () => {
      size();
      if (still) draw();
    };

    size();
    draw();
    const seen =
      typeof IntersectionObserver === "function"
        ? new IntersectionObserver(([entry]) => (entry?.isIntersecting ? start() : stop()))
        : null;
    if (seen) seen.observe(canvas);
    else start();
    window.addEventListener("pointermove", onMove, { passive: true });
    document.addEventListener("pointerleave", onLeave);
    window.addEventListener("scroll", onScroll, { passive: true });
    window.addEventListener("resize", onResize);
    return () => {
      stop();
      seen?.disconnect();
      window.removeEventListener("pointermove", onMove);
      document.removeEventListener("pointerleave", onLeave);
      window.removeEventListener("scroll", onScroll);
      window.removeEventListener("resize", onResize);
    };
  }, []);

  return (
    <span className={className} aria-hidden="true">
      <canvas ref={ref} />
    </span>
  );
}
