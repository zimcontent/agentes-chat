import { forwardRef, useEffect, useId, useImperativeHandle, useRef, useState } from "react";
import { prefersLessMotion } from "./motion";

/*
 * The app icon that peeks (docs/adr/doug-0010-doug-app-icons.md, `peekNight`'s day look: his black head, big, leaning
 * into the green glass from the bottom right corner), made to move like a tvOS icon: the glass with the head inside,
 * and a light on top that slides against the lean. The shapes and colors are the identity's drawer's own (`dougbot-avatar.js`: QUADRO, CABECA, the eyes
 * at 46.6 and 73.2), on its 120 grid.
 */
const QUADRO = "M38 10H82C101 10 110 19 110 38V82C110 101 101 110 82 110H38C19 110 10 101 10 82V38C10 19 19 10 38 10Z";
const CABECA =
  "M24 74C24 92 34 102 52 102H68C86 102 96 92 96 74V52C96 34 86 21.5 70 21C59 20.6 50.5 24.2 45.6 30.2C43.2 33.2 44.6 37.6 48.6 37.8C51.2 37.9 52.9 36.7 54.5 36.3C56.1 35.9 56.9 36.9 56.4 38.4C55 42 50.4 44.1 43.6 44.9C31.8 46.6 24 54.5 24 66Z";
/**
 * The head as the icon that peeks (`peek` in doug-icons.js): 1.3 of the glass's side, its middle low and to the right
 * (64% and 68%), turned 18 degrees to the left, so it leans in from the bottom right corner and the glass cuts it.
 * Drawn without its piece (`SOLTA`).
 */
const HEAD = "translate(74 78) rotate(-18) scale(1.0833) translate(-60 -60) translate(-10.8 -12.57) scale(1.18)";
const EYES = [46.6, 73.2];
const EYE_Y = 69.6;

/** What his eyes say: open, smiling, or one open and one smiling. */
export type DougFace = "normal" | "happy" | "wink";

export interface DougLogoHandle {
  /** The root, for whoever moves it around the page. */
  el: HTMLDivElement | null;
}

/**
 * The Doug's icon in motion: it comes in (the glass turns up toward the eye, a rim of light runs around it, the head
 * slides up into it with a squash, the eyes open), then floats blinks now and then, follows the pointer with its eyes and leans
 * toward it, and a sheen crosses the glass every few seconds. Over it, the eyes smile; a click winks. Decoration only:
 * the words beside it say what it is. With less motion it stands still, eyes open.
 */
export const DougLogo = forwardRef<DougLogoHandle, { className?: string; face?: DougFace; intro?: boolean }>(
  function DougLogo({ className, face = "normal", intro = true }, ref) {
    const root = useRef<HTMLDivElement>(null);
    const [hover, setHover] = useState(false);
    const [wink, setWink] = useState(false);
    useImperativeHandle(ref, () => ({ el: root.current }), []);
    // Ids inside the drawing are per instance: two icons on a page never share a gradient.
    const uid = useId().replace(/[^a-zA-Z0-9]/g, "");
    const u = (k: string) => `dl${uid}${k}`;

    useEffect(() => {
      const el = root.current;
      if (!el || prefersLessMotion()) return;
      let raf = 0;
      let alive = true;
      const aim = { x: 0, y: 0 };
      const now = { x: 0, y: 0 };
      // The pointer anywhere on the page: the eyes look at it, the icon leans a little toward it.
      const onMove = (e: PointerEvent) => {
        const r = el.getBoundingClientRect();
        const cx = r.left + r.width / 2;
        const cy = r.top + r.height / 2;
        const reach = Math.max(260, r.width * 2.2);
        aim.x = Math.max(-1, Math.min(1, (e.clientX - cx) / reach));
        aim.y = Math.max(-1, Math.min(1, (e.clientY - cy) / reach));
        if (!raf) raf = requestAnimationFrame(step);
      };
      const step = () => {
        now.x += (aim.x - now.x) * 0.12;
        now.y += (aim.y - now.y) * 0.12;
        el.style.setProperty("--lx", now.x.toFixed(3));
        el.style.setProperty("--ly", now.y.toFixed(3));
        raf = Math.abs(aim.x - now.x) + Math.abs(aim.y - now.y) > 0.002 ? requestAnimationFrame(step) : 0;
      };
      // A blink every few seconds, now and then two in a row.
      let timer = 0;
      const blink = () => {
        if (!alive) return;
        el.dataset.blink = "";
        window.setTimeout(() => delete el.dataset.blink, 150);
        const twice = Math.random() < 0.25;
        if (twice)
          window.setTimeout(() => {
            el.dataset.blink = "";
            window.setTimeout(() => delete el.dataset.blink, 140);
          }, 300);
        timer = window.setTimeout(blink, 2600 + Math.random() * 3600);
      };
      // The first one once he has opened his eyes.
      timer = window.setTimeout(blink, intro ? 2900 : 1800);
      window.addEventListener("pointermove", onMove, { passive: true });
      return () => {
        alive = false;
        window.clearTimeout(timer);
        if (raf) cancelAnimationFrame(raf);
        window.removeEventListener("pointermove", onMove);
      };
    }, [intro]);

    useEffect(() => {
      if (!wink) return;
      const t = window.setTimeout(() => setWink(false), 1100);
      return () => window.clearTimeout(t);
    }, [wink]);

    const shown: DougFace = wink ? "wink" : hover ? "happy" : face;
    return (
      <div
        ref={root}
        className={`dl${className ? ` ${className}` : ""}`}
        data-face={shown}
        data-intro={intro ? "" : undefined}
        aria-hidden="true"
        onPointerEnter={() => setHover(true)}
        onPointerLeave={() => setHover(false)}
        onPointerDown={() => setWink(true)}
      >
        <span className="dl__glow" />
        <span className="dl__floor" />
        <span className="dl__float">
          <span className="dl__card">
            <svg className="dl__layer dl__tile" viewBox="0 0 120 120" aria-hidden="true">
              <defs>
                <linearGradient id={u("g")} x1="0" y1="10" x2="0" y2="110" gradientUnits="userSpaceOnUse">
                  <stop offset="0" stopColor="#E2FF98" />
                  <stop offset=".3" stopColor="#CEFF63" />
                  <stop offset=".66" stopColor="#9CFA05" />
                  <stop offset="1" stopColor="#72D400" />
                </linearGradient>
                <radialGradient id={u("l")} cx="60" cy="3" r="74" gradientUnits="userSpaceOnUse">
                  <stop offset="0" stopColor="#fff" stopOpacity=".46" />
                  <stop offset=".5" stopColor="#fff" stopOpacity=".15" />
                  <stop offset="1" stopColor="#fff" stopOpacity="0" />
                </radialGradient>
                <radialGradient id={u("d")} cx="60" cy="128" r="66" gradientUnits="userSpaceOnUse">
                  <stop offset="0" stopColor="#3F8A00" stopOpacity=".55" />
                  <stop offset="1" stopColor="#3F8A00" stopOpacity="0" />
                </radialGradient>
                <linearGradient id={u("c")} x1="18" y1="10" x2="102" y2="112" gradientUnits="userSpaceOnUse">
                  <stop offset="0" stopColor="#fff" stopOpacity=".98" />
                  <stop offset=".28" stopColor="#fff" stopOpacity=".2" />
                  <stop offset=".62" stopColor="#fff" stopOpacity=".04" />
                  <stop offset="1" stopColor="#fff" stopOpacity=".6" />
                </linearGradient>

                <linearGradient id={u("hp")} x1="0" y1="21" x2="0" y2="102" gradientUnits="userSpaceOnUse">
                  <stop offset="0" stopColor="#0D0D0F" />
                  <stop offset=".55" stopColor="#09090A" />
                  <stop offset=".82" stopColor="#162205" />
                  <stop offset="1" stopColor="#385A02" />
                </linearGradient>
                <radialGradient id={u("hb")} cx="58" cy="27" r="34" gradientUnits="userSpaceOnUse">
                  <stop offset="0" stopColor="#fff" stopOpacity=".2" />
                  <stop offset=".5" stopColor="#fff" stopOpacity=".06" />
                  <stop offset="1" stopColor="#fff" stopOpacity="0" />
                </radialGradient>
                <linearGradient id={u("hr")} x1="0" y1="88" x2="0" y2="103" gradientUnits="userSpaceOnUse">
                  <stop offset="0" stopColor="#9CFA05" stopOpacity="0" />
                  <stop offset="1" stopColor="#BFFC5D" stopOpacity=".6" />
                </linearGradient>
                <linearGradient id={u("hv")} x1="70" y1="0" x2="97" y2="0" gradientUnits="userSpaceOnUse">
                  <stop offset="0" stopColor="#9CFA05" stopOpacity="0" />
                  <stop offset="1" stopColor="#B5FB43" stopOpacity=".36" />
                </linearGradient>
                <linearGradient id={u("ht")} x1="0" y1="20" x2="0" y2="40" gradientUnits="userSpaceOnUse">
                  <stop offset="0" stopColor="#fff" stopOpacity=".34" />
                  <stop offset="1" stopColor="#fff" stopOpacity="0" />
                </linearGradient>
                <clipPath id={u("hc")}>
                  <path d={CABECA} />
                </clipPath>
                <filter id={u("h0")} x="-30%" y="-30%" width="160%" height="160%">
                  <feGaussianBlur stdDeviation=".55" />
                </filter>
                <filter id={u("h1")} x="-30%" y="-30%" width="160%" height="160%">
                  <feGaussianBlur stdDeviation="1.3" />
                </filter>

                <clipPath id={u("t")}>
                  <path d={QUADRO} />
                </clipPath>
                <filter id={u("b")} x="-30%" y="-30%" width="160%" height="160%">
                  <feGaussianBlur stdDeviation="5" />
                </filter>
              </defs>
              <path d={QUADRO} fill={`url(#${u("g")})`} />
              <path d={QUADRO} fill={`url(#${u("l")})`} />
              <path d={QUADRO} fill={`url(#${u("d")})`} />
              <g clipPath={`url(#${u("t")})`}>
                <g className="dl__shade" transform="translate(0 7.7)" filter={`url(#${u("b")})`}>
                  <g transform={HEAD}>
                    <path d={CABECA} fill="#2C4601" opacity=".3" />
                  </g>
                </g>
                <g className="dl__lean">
                  <g className="dl__head">
                    <g transform={HEAD}>
                      <path d={CABECA} fill={`url(#${u("hp")})`} />
                      <g clipPath={`url(#${u("hc")})`}>
                        <rect x="10" y="10" width="100" height="70" fill={`url(#${u("hb")})`} />
                        <path
                          d={CABECA}
                          fill="none"
                          stroke={`url(#${u("ht")})`}
                          strokeWidth="1.2"
                          filter={`url(#${u("h0")})`}
                        />
                        <path
                          d={CABECA}
                          fill="none"
                          stroke={`url(#${u("hr")})`}
                          strokeWidth="3"
                          filter={`url(#${u("h0")})`}
                        />
                        <path
                          d={CABECA}
                          fill="none"
                          stroke={`url(#${u("hv")})`}
                          strokeWidth="2.6"
                          filter={`url(#${u("h1")})`}
                        />
                      </g>
                      <g className="dl__look">
                        {EYES.map((x, i) => (
                          <g key={x} className={`dl__eye dl__eye--${i ? "r" : "l"}`}>
                            <g transform={`rotate(-5 ${x} ${EYE_Y})`}>
                              <rect
                                className="dl__pill"
                                x={x - 5.5}
                                y={EYE_Y - 10.4}
                                width="11"
                                height="20.8"
                                rx="5.5"
                                fill="#fff"
                              />
                            </g>
                            <path
                              className="dl__smile"
                              d={`M${x - 7.4} ${EYE_Y + 4.4}Q${x} ${EYE_Y - 10.8} ${x + 7.4} ${EYE_Y + 4.4}`}
                              pathLength={1}
                              fill="none"
                              stroke="#fff"
                              strokeWidth="5.8"
                              strokeLinecap="round"
                            />
                          </g>
                        ))}
                      </g>
                    </g>
                  </g>
                </g>
              </g>
              <path
                className="dl__rim"
                d={QUADRO}
                pathLength={1}
                fill="none"
                stroke={`url(#${u("c")})`}
                strokeWidth="1.6"
              />
            </svg>
            <span className="dl__layer dl__shine">
              <span className="dl__sweep" />
            </span>
          </span>
        </span>
      </div>
    );
  },
);
