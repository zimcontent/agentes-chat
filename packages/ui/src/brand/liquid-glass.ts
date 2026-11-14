/**
 * Doug's glass lens, after Nordus's Liquid Glass (src/lib/liquid-glass.ts there, itself after Apple's macOS and iOS 26
 * glass): the rim of a floating piece bends what is behind it like a lens. The look lives in doug.css (`--dg-*`); this
 * adds what CSS cannot, an SVG displacement filter that backdrop-filter points at through `--dg-lens`.
 *
 * Only engines that apply an SVG filter to the backdrop get it (Chromium). Detected by support, never by user agent:
 * WebKit and Firefox answer no and keep the blur, saturation, rim light and shadow, which read as the same glass.
 * Reduced transparency turns it off. The rim is the same few pixels wide on every piece, so each size gets its own
 * filter (sizes snap to a 4 px grid, so a screen needs only a handful).
 */

/** The pieces that bend: the floating controls, never long text or lists. */
export const LENS_SELECTOR = [
  ".dg-glass",
  ".channel__head-text",
  ".channel__acts",
  ".dm-who",
  ".ac-composer",
  ".ac-composer__plus",
  ".sidebar__dock",
  ".sidebar__jump",
  ".sidebar__me",
].join(", ");

/** Pixels of rim that bend, and how far the rim reaches for what it shows. */
export const LENS_RIM = 14;
export const LENS_BEND = 22;
const STEP = 4;

export function lensId(width: number, height: number): string {
  return `dg-lens-${width}x${height}`;
}

/** Sizes snap to a 4 px grid so pieces of nearly the same size share a filter. */
export function lensSize(width: number, height: number): { width: number; height: number } {
  const snap = (n: number) => Math.max(STEP * 2, Math.round(n / STEP) * STEP);
  return { width: snap(width), height: snap(height) };
}

/**
 * The displacement map for a piece of this size: red pushes sideways, green up and down, 0.5 is still. The middle stays
 * still; across the last `rim` pixels toward each edge the value ramps away from 0.5, so the rim pulls in what lies just
 * outside it.
 */
export function lensMapSvg(width: number, height: number, rim = LENS_RIM): string {
  const pct = (n: number, of: number) => Math.round(Math.min(50, (n / of) * 100) * 100) / 100;
  const ax = pct(rim, width);
  const ay = pct(rim, height);
  return [
    `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}" preserveAspectRatio="none">`,
    "<defs>",
    `<linearGradient id="x" x1="0" x2="1" y1="0" y2="0">`,
    `<stop offset="0%" stop-color="rgb(0,0,0)"/><stop offset="${ax}%" stop-color="rgb(128,0,0)"/>`,
    `<stop offset="${100 - ax}%" stop-color="rgb(128,0,0)"/><stop offset="100%" stop-color="rgb(255,0,0)"/>`,
    "</linearGradient>",
    `<linearGradient id="y" x1="0" x2="0" y1="0" y2="1">`,
    `<stop offset="0%" stop-color="rgb(0,0,0)"/><stop offset="${ay}%" stop-color="rgb(0,128,0)"/>`,
    `<stop offset="${100 - ay}%" stop-color="rgb(0,128,0)"/><stop offset="100%" stop-color="rgb(0,255,0)"/>`,
    "</linearGradient>",
    "</defs>",
    `<rect width="${width}" height="${height}" fill="url(#x)"/>`,
    `<rect width="${width}" height="${height}" fill="url(#y)" style="mix-blend-mode:screen"/>`,
    "</svg>",
  ].join("");
}

/** The filter a piece of this size points its backdrop at, in the piece's own pixels. */
export function lensFilterMarkup(width: number, height: number, bend = LENS_BEND): string {
  const href = `data:image/svg+xml,${encodeURIComponent(lensMapSvg(width, height))}`;
  return [
    `<filter id="${lensId(width, height)}" x="0" y="0" width="${width}" height="${height}" filterUnits="userSpaceOnUse" primitiveUnits="userSpaceOnUse" color-interpolation-filters="sRGB">`,
    `<feImage href="${href}" x="0" y="0" width="${width}" height="${height}" preserveAspectRatio="none" result="map"/>`,
    `<feGaussianBlur in="map" stdDeviation="2" result="soft"/>`,
    `<feDisplacementMap in="SourceGraphic" in2="soft" scale="${bend}" xChannelSelector="R" yChannelSelector="G"/>`,
    "</filter>",
  ].join("");
}

/** True where backdrop-filter takes an SVG filter (Chromium), so the rim can really bend. */
export function lensSupported(
  css: { supports?: (property: string, value: string) => boolean } | undefined = globalThis.CSS,
): boolean {
  try {
    return Boolean(css?.supports?.("backdrop-filter", "url(#dg-lens) blur(1px)"));
  } catch {
    return false;
  }
}

/**
 * Where the lens works, gives every glass piece on the page a filter of its size and keeps it current as pieces come, go
 * and resize; marks `<html data-glass-lens>`. Elsewhere does nothing: the glass stays, without the bend. Returns the
 * cleanup.
 */
export function installLiquidGlass(doc: Document = document): () => void {
  const root = doc.documentElement;
  const win = doc.defaultView;
  const reduced = win?.matchMedia?.("(prefers-reduced-transparency: reduce)").matches === true;
  if (!win || !lensSupported(win.CSS) || reduced || typeof win.ResizeObserver !== "function") {
    delete root.dataset.glassLens;
    return () => {};
  }
  const holder = doc.createElementNS("http://www.w3.org/2000/svg", "svg");
  holder.setAttribute("aria-hidden", "true");
  holder.setAttribute("style", "position:absolute;width:0;height:0;overflow:hidden;pointer-events:none");
  const defs = doc.createElementNS("http://www.w3.org/2000/svg", "defs");
  holder.append(defs);
  doc.body.prepend(holder);
  const made = new Set<string>();

  const fit = (el: HTMLElement) => {
    const rect = el.getBoundingClientRect();
    if (rect.width < 1 || rect.height < 1) return;
    const { width, height } = lensSize(rect.width, rect.height);
    const id = lensId(width, height);
    if (!made.has(id)) {
      made.add(id);
      defs.insertAdjacentHTML("beforeend", lensFilterMarkup(width, height));
    }
    el.style.setProperty("--dg-lens", `url(#${id})`);
  };
  const sizes = new win.ResizeObserver((entries) => {
    for (const entry of entries) fit(entry.target as HTMLElement);
  });
  const watched = new WeakSet<Element>();
  const scan = () => {
    for (const el of doc.querySelectorAll<HTMLElement>(LENS_SELECTOR)) {
      if (watched.has(el)) continue;
      watched.add(el);
      // Fitted at once too: the observer only reports on rendered frames.
      fit(el);
      sizes.observe(el);
    }
  };
  // Only a new element can bring a piece: text arriving (a reply as it is written) searches nothing.
  const tree = new win.MutationObserver((records) => {
    for (const record of records) {
      for (const node of record.addedNodes) {
        if (node.nodeType === 1) return scan();
      }
    }
  });
  tree.observe(doc.body, { childList: true, subtree: true });
  scan();
  root.dataset.glassLens = "";
  return () => {
    tree.disconnect();
    sizes.disconnect();
    holder.remove();
    delete root.dataset.glassLens;
  };
}
