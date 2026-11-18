/**
 * Doug's brand, in one place: the product's name, its mark and whether the pixel art draws. A fork with its own name
 * and logo (TRADEMARKS.md, "Forks") changes these, not every screen. The name itself is written once, in
 * `@agenteschat/i18n/brand`, which the server and the emails read too.
 */
export { BRAND_NAME, brandName, setClientProductName, subscribeBrand } from "@agenteschat/i18n/brand";

/**
 * The mark as a file, only for what can't run the identity's code (the browser tab's icon): `apps/web/public/favicon.svg`,
 * written from `dougbot-avatar.js` (the Doug close up). Every screen draws the mark by code (`DougMark`).
 */
export const BRAND_MARK_URL = "/favicon.svg";

/** The pixel skies, pixel agents and their dithered horizons: off in Doug, which draws glass instead. */
export const PIXEL_ART = false;
