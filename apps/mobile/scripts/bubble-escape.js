/*
 * Nothing leaves its bubble: run in the board's page (`/conversa-pior`, `DOUGBOT_PRANCHA=1 expo export --platform web`),
 * at 320 and 390, e.g. as a DevTools expression or Runtime.evaluate. It finds every conversation bubble (a 1 px rim,
 * round corners, the bubble's fill: theirs, the earlier theirs, mine) and measures each descendant box and text run
 * (getBoundingClientRect, a Range's client rects) against it, 0.5 px allowed. What a clipping box holds (a code block
 * scrolling sideways) is measured by that box. Answers `{ bubbles, escapes }`: escapes must be empty.
 */
(() => {
  const isBubble = (e) => {
    const c = getComputedStyle(e);
    return (
      c.borderTopWidth === "1px" &&
      parseFloat(c.borderTopRightRadius) >= 8 &&
      parseFloat(c.borderBottomRightRadius) >= 8 &&
      /^rgb\((42, 42, 42|26, 26, 26|34, 34, 34|44, 57, 23)\)$/.test(c.backgroundColor)
    );
  };
  const bubbles = [...document.querySelectorAll("div")].filter(isBubble);
  const out = [];
  const T = 0.5;
  for (const b of bubbles) {
    const r = b.getBoundingClientRect();
    const name = b.textContent.slice(0, 50);
    const check = (what, cr) => {
      if (cr.width <= 0 || cr.height <= 0) return;
      const d = { l: r.left - cr.left, r: cr.right - r.right, t: r.top - cr.top, b: cr.bottom - r.bottom };
      if (d.l > T || d.r > T || d.t > T || d.b > T)
        out.push({
          bubble: name,
          what: what.slice(0, 60),
          d: Object.fromEntries(Object.entries(d).map(([k, v]) => [k, Math.round(v * 10) / 10])),
        });
    };
    const walk = (el) => {
      for (const n of el.childNodes) {
        if (n.nodeType === 3) {
          if (!n.textContent.trim()) continue;
          const range = document.createRange();
          range.selectNodeContents(n);
          for (const cr of range.getClientRects()) check(`text: ${n.textContent}`, cr);
        } else if (n.nodeType === 1) {
          const cs = getComputedStyle(n);
          check(`<${n.tagName.toLowerCase()}> ${n.textContent}`, n.getBoundingClientRect());
          // What a clipping box holds is cut at its edge (a code block scrolls sideways): its own box is what shows.
          if (cs.overflowX === "visible" && cs.overflowY === "visible") walk(n);
        }
      }
    };
    walk(b);
  }
  return { bubbles: bubbles.length, escapes: out };
})();
