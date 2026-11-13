import DougBot from "./dougbot-avatar.js";

/** The browser tab's icon: the Doug close up, no light on the floor (IDENTIDADE.md §3), fixed ids. */
export const dougFavicon = () =>
  `${DougBot.avatar({ bot: "doug", perto: true, brilho: false, id: "dbf", tamanho: 64, titulo: "DougBot" })}\n`;

/** The boot screen's Doug, at work while the app loads, written into index.html. */
export const dougBoot = () =>
  DougBot.avatar({ bot: "doug", perto: true, brilho: false, estado: "trabalhando", id: "dbb", titulo: "DougBot" });
