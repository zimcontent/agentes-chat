/**
 * Which DougBot each agent is (IDENTIDADE.md §6–7), the same rules as the web (`packages/ui/src/brand/dougbot-time.ts`
 * on the doug-ui branch), so an agent is the same bot on the phone and on the computer.
 *
 * 1. `BOTS_DO_TIME`: an agent whose name or handle is one of these is that bot of the identity (its form, color, eyes
 *    and detail are the package's). The Doug is the bot's head in the piece of green glass, the only green one.
 * 2. Every other agent gets a "free" bot, the same on every screen: its form from its trade (`OFICIOS`, read in its
 *    role, handle and name, first match wins), its color from `CORES_LIVRES` and its eyes from its handle's hash.
 *    Never green, never a mouth.
 *
 * Pure (no React Native): unit-tested.
 */
import { gradientOf } from "@dougbot/ui/agent/engine";
import DougBot, {
  type DougBotAcessorio,
  type DougBotEstado,
  type DougBotForma,
  type DougBotNome,
  type DougBotOlhos,
  type DougBotOpcoes,
} from "./dougbot-avatar.js";

export type { DougBotEstado, DougBotOpcoes };
export { DougBot };

/** Names and handles (lowercase, no accents) that are a bot of the identity. */
export const BOTS_DO_TIME: Record<string, DougBotNome> = {
  doug: "doug",
  "doug boss": "doug",
  dougboss: "doug",
  "doug-boss": "doug",
  dougbot: "doug",
  rosa: "rosa",
  sony: "sony",
  mark: "mark",
  chess: "chess",
  kiara: "kiara",
  junin: "junin",
};

/** A trade's words → its form. First match wins, so the more specific trades come first. */
export const OFICIOS: { forma: DougBotForma; palavras: RegExp }[] = [
  { forma: "monitor", palavras: /v[ií]deo|edi[cç][aã]o|editor|motion|reels|youtube|filmag/ },
  { forma: "petala", palavras: /design|criativ|thumb|arte|ilustra|visual|fotograf|marca/ },
  { forma: "moeda", palavras: /financ|cont[aá]b|fiscal|pagament|cobran|fatura|or[cç]ament|dinheiro/ },
  { forma: "hexagono", palavras: /c[oó]dig|dev|program|engenh|automa|suporte|t[eé]cnic|tecnolog|api\b|sistema/ },
  { forma: "torre", palavras: /estrat[eé]g|pesquis|an[aá]lis|planej|growth|resultado|intelig|napole/ },
  {
    forma: "quadrado",
    palavras: /marketing|social|tr[aá]fego|m[ií]dia|copy|conte[uú]do|instagram|an[uú]nc|campanh|redes/,
  },
];

/** The free colors (turquoise and fuchsia) and two of their own lighter tones: none of them green. */
export const CORES_LIVRES = [
  "#2DD4BF",
  "#E879F9",
  DougBot.mix("#2DD4BF", "#60A5FA", 0.5),
  DougBot.mix("#E879F9", "#FFFFFF", 0.25),
] as const;

const OLHOS: DougBotOlhos[] = ["pilula", "largo", "meia", "ponto"];

const plain = (s: string) =>
  s
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .trim();

/** A steady number for a word. */
function hash(s: string): number {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 16777619);
  return h >>> 0;
}

/** What an agent's bot is drawn from: who it is and what it does. */
export interface AgenteParaBot {
  name?: string | null;
  handle?: string | null;
  role?: string | null;
  /** When there is no name (a look being picked, a sample): a steady key for the free bot. */
  id?: string | null;
  /** The look picked for it (the web's picker): with a `shape`, the bot is drawn as picked (the Doug stays the Doug). */
  look?: { shape?: string; color?: string; eyes?: string; accessory?: string } | null;
}

/** The look's eyes and accessories → the bot's, as on the web (`packages/ui/src/brand/dougbot-time.ts`). */
const OLHOS_DO_LOOK: Record<string, DougBotOlhos> = {
  round: "pilula",
  dots: "ponto",
  wide: "largo",
  sleepy: "meia",
  happy: "pilula",
};
const ACESSORIO_DO_LOOK: Record<string, DougBotAcessorio> = {
  headphones: "fone",
  headset: "fone",
  tie: "gravata",
  keys: "chaves",
};
const FORMAS: readonly string[] = ["squircle", "quadrado", "petala", "monitor", "torre", "moeda", "hexagono"];

/** A look color as the bot's one color: a custom "#rrggbb" as is, a preset the middle of its gradient. */
function corDoLook(color: string | undefined): string {
  if (color && /^#[0-9a-f]{6}$/i.test(color)) return color.toLowerCase();
  const [top, bottom] = gradientOf(color ?? "sky");
  return DougBot.mix(top, bottom, 0.5);
}

/** The identity's bot for an agent, or its free bot. Same answer for the same agent, everywhere. */
export function botDoAgente(a: AgenteParaBot): DougBotOpcoes {
  const nome = plain(a.name ?? "");
  const handle = plain(a.handle ?? "");
  const time = BOTS_DO_TIME[handle] ?? BOTS_DO_TIME[nome];
  if (time === "doug") return { bot: time };
  const look = a.look;
  if (look?.shape && FORMAS.includes(look.shape)) {
    const acessorio = look.accessory ? ACESSORIO_DO_LOOK[look.accessory] : undefined;
    return {
      forma: look.shape as DougBotForma,
      cor: corDoLook(look.color),
      olhos: OLHOS_DO_LOOK[look.eyes ?? "round"] ?? "pilula",
      ...(acessorio ? { acessorio } : {}),
      sorriso: false,
    };
  }
  if (time) return { bot: time };
  const texto = plain(`${a.role ?? ""} ${handle.replace(/[-_]/g, " ")} ${nome}`);
  const forma = OFICIOS.find((o) => o.palavras.test(texto))?.forma ?? "squircle";
  const h = hash(handle || nome || a.id || "bot");
  return {
    forma,
    cor: CORES_LIVRES[h % CORES_LIVRES.length],
    olhos: OLHOS[(h >>> 4) % OLHOS.length],
    sorriso: false,
  };
}

/** A bot's own color (its name in a message, the edge of its notice). */
export function corDoBot(b: DougBotOpcoes): string {
  return b.bot ? DougBot.TIME[b.bot].cor : (b.cor ?? CORES_LIVRES[0]);
}

/** The app's states of an agent (the old engine's modes) → the identity's five states (§2 and §7). */
export type ModoDoAgente = "idle" | "run" | "think" | "rest" | "sleep";

export function estadoDoModo(modo: ModoDoAgente, expressao?: string): DougBotEstado {
  if (expressao === "happy" || expressao === "star" || expressao === "heart") return "terminou";
  if (expressao === "surprised") return "pedindo";
  // Eyes shut while a password is typed (the sign-in screens): the eyes in a dash, as working.
  if (expressao === "closed") return "trabalhando";
  if (modo === "run") return "trabalhando";
  if (modo === "think") return "pedindo";
  if (modo === "sleep") return "dormindo";
  return "ok";
}

/** The `<title>` and fixed size come off: the native view sizes the drawing and names it for screen readers. */
export function svgDoBot(opcoes: DougBotOpcoes & { tamanho: number }): string {
  return DougBot.avatar(opcoes)
    .replace(/<title>[^<]*<\/title>/, "")
    .replace(/ role="img" aria-label="[^"]*"/, "");
}
