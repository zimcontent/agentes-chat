/**
 * The agents' desktop wallpaper, drawn by the DougBot identity's own code (`dougbot-avatar.js`): the stage, the
 * team behind the glass counter and the signature on it. render.sh bundles this file and screenshots wall.html.
 */
import DougBot, { type DougBotNome } from "../../../packages/ui/src/brand/dougbot-avatar.js";

/** The glass counter's top edge: the dock (y 844–893) and the signature sit on it, the team stands behind it. */
const COUNTER = 804;
/** How far a bot's piece goes down behind the counter's glass. */
const BEHIND = 8;
/** The Doug in the middle, larger; the team at his sides, in the identity's order. */
const TEAM: { bot: DougBotNome; size: number }[] = [
  { bot: "rosa", size: 96 },
  { bot: "sony", size: 96 },
  { bot: "mark", size: 96 },
  { bot: "doug", size: 148 },
  { bot: "chess", size: 96 },
  { bot: "kiara", size: 96 },
  { bot: "junin", size: 96 },
];
const GAP = 26;
/** A piece ends at 110 of its drawing's 120: what is left under it. */
const UNDER = 10 / 120;

/**
 * The signature (the identity's §3): the Doug close up, 1.42 times the name's size and 0.36 of it away, the name
 * in the stage's text color. Centered on the dock's line, below 840, where a maximized window ends, so it shows
 * whatever is open.
 */
const SIGNATURE = { left: 36, middle: 869, size: 24 };

function team(): HTMLElement {
  const row = document.createElement("div");
  row.className = "team";
  row.style.gap = `${GAP}px`;
  for (const { bot, size } of TEAM) {
    const el = document.createElement("span");
    el.style.width = `${size}px`;
    el.style.height = `${size}px`;
    // Behind the glass by the same depth, whatever its size.
    el.style.marginBottom = `${-Math.round(size * UNDER)}px`;
    el.innerHTML = DougBot.avatar({ bot, tamanho: size, perto: false, id: `w${bot}` });
    row.append(el);
  }
  row.style.bottom = `${900 - COUNTER - BEHIND}px`;
  return row;
}

function signature(): HTMLElement {
  const el = document.createElement("span");
  el.className = "assina";
  el.style.setProperty("--t", `${SIGNATURE.size}px`);
  el.style.left = `${SIGNATURE.left}px`;
  el.style.top = `${SIGNATURE.middle}px`;
  el.innerHTML = `<span class="av">${DougBot.avatar({ bot: "doug", perto: true, brilho: false, id: "ws" })}</span><span><b>Doug</b>Bot</span>`;
  return el;
}

async function main() {
  const host = document.querySelector<HTMLElement>(".wall");
  if (!host) return;
  const counter = document.createElement("div");
  counter.className = "counter";
  counter.style.top = `${COUNTER}px`;
  const faces = [`800 ${SIGNATURE.size}px "Manrope"`, `500 ${SIGNATURE.size}px "Manrope"`];
  await Promise.all(faces.map((face) => document.fonts.load(face, "DougBot")));
  // Without the brand's font the name would come out in a fallback face: the image stays black instead.
  if (!faces.every((face) => document.fonts.check(face, "DougBot"))) return;
  host.append(team(), counter, signature());
}

void main();
