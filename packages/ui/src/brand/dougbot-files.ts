import DougBot from "./dougbot-avatar.js";

/** The browser tab's icon: the Doug close up, no light on the floor (IDENTIDADE.md §3), fixed ids. */
export const dougFavicon = () =>
  `${DougBot.avatar({ bot: "doug", perto: true, brilho: false, id: "dbf", tamanho: 64, titulo: "DougBot" })}\n`;

/** The boot screen's Doug, at work while the app loads, written into index.html. */
export const dougBoot = () =>
  DougBot.avatar({ bot: "doug", perto: true, brilho: false, estado: "trabalhando", id: "dbb", titulo: "DougBot" });

/**
 * A drawing beside words that already name the product: sized by its page, said by nothing (the cut `BotFace`
 * makes). `classe` is the page's own class for it.
 */
const quiet = (svg: string, classe?: string) =>
  svg
    .replace(/ role="img" aria-label="[^"]*"><title>[^<]*<\/title>/, ' aria-hidden="true" focusable="false">')
    .replace(/^<svg /, classe ? `<svg class="${classe}" ` : "<svg ");

/** The Doug close up for a page the server writes by itself (a link that didn't open): `id` prefixes its inner ids. */
export const dougMark = (id: string) => quiet(DougBot.avatar({ bot: "doug", perto: true, brilho: false, id }));

/**
 * The page a proxy serves while the server is away (apps/web/public/unavailable.html) loads nothing and travels
 * whole inside docker-compose.yml, under 16 KB: its tab's icon is the Doug's flat drawing (the same shapes without
 * the glass's light), and in its middle the Doug in glass, asleep while the server is.
 */
const FLAT = { bot: "doug", perto: true, material: "chapado", brilho: false } as const;
export const dougOutageIcon = () =>
  `<link rel="icon" type="image/svg+xml" href="data:image/svg+xml,${encodeURIComponent(DougBot.avatar({ ...FLAT, id: "dbo", titulo: "DougBot" }))}">`;
export const dougOutageMark = () =>
  quiet(DougBot.avatar({ bot: "doug", estado: "dormindo", brilho: true, id: "dbu" }), "doug");
