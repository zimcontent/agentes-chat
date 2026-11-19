/**
 * Which DougBot each agent is: the one file to edit when the team changes (IDENTIDADE.md §6–7).
 *
 * 1. `BOTS_DO_TIME`: an agent whose name or handle is one of these is that bot of the identity (its form, color, eyes
 *    and detail are the package's). The Doug is the bot's head in the piece of green glass, the only green one.
 * 2. Every other agent gets a "free" bot, the same on every screen: its form from its trade (`OFICIOS`, read in its
 *    role, handle and name, first match wins), its color from `CORES_LIVRES` and its eyes from its handle's hash.
 *    Never green, never a mouth.
 */
import type { AgentAccessory, AgentAppearance, AgentEyes } from "@dougbot/tokens/look";
import { gradientOf } from "../agent/engine.js";
import DougBot, {
  type DougBotAcessorio,
  type DougBotForma,
  type DougBotNome,
  type DougBotOlhos,
  type DougBotOpcoes,
} from "./dougbot-avatar.js";

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

/**
 * Every form and every pair of eyes a free bot may have: with `CORES_LIVRES`, all `botDoAgente` answers besides the
 * team. For what must draw each bot ahead of time (the emails' pictures).
 */
export const FORMAS_LIVRES: readonly DougBotForma[] = [...new Set(OFICIOS.map((o) => o.forma)), "squircle"];
export const OLHOS_LIVRES: readonly DougBotOlhos[] = OLHOS;

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
  name: string;
  handle?: string | null;
  role?: string | null;
  /** `right_hand`: the team's right hand (ADR 0137), the Doug whatever its name. */
  builtin?: string | null;
  /** The look picked for it: with a `shape`, the bot is drawn as picked (the Doug stays the Doug). */
  look?: AgentAppearance | null;
}

/** The look's eyes → the bot's (the bot has four; "happy" reads as the pill). */
const OLHOS_DO_LOOK: Record<AgentEyes, DougBotOlhos> = {
  round: "pilula",
  dots: "ponto",
  wide: "largo",
  sleepy: "meia",
  happy: "pilula",
};
/** The look's accessories the bot draws (the others are the pixel engine's alone). */
const ACESSORIO_DO_LOOK: Partial<Record<AgentAccessory, DougBotAcessorio>> = {
  headphones: "fone",
  headset: "fone",
  tie: "gravata",
  keys: "chaves",
};
/** What the look picker offers for the bot: each one draws differently. */
export const OLHOS_DO_PICKER: readonly AgentEyes[] = ["round", "dots", "wide", "sleepy"];
export const ACESSORIOS_DO_PICKER: readonly AgentAccessory[] = ["none", "headphones", "tie", "keys"];

/** A look color as the bot's one color: a custom "#rrggbb" as is, a preset the middle of its gradient. */
export function corDoLook(color: AgentAppearance["color"]): string {
  if (color && /^#[0-9a-f]{6}$/i.test(color)) return color.toLowerCase();
  const [top, bottom] = gradientOf(color ?? "sky");
  return DougBot.mix(top, bottom, 0.5);
}

/**
 * The look a free bot already has, in the picker's words: where the picker starts, so the first pick changes only
 * what was picked. The Doug and the team's bots start from their own form and color too.
 */
export function lookDoBot(a: AgenteParaBot): Required<AgentAppearance> {
  const b = botDoAgente({ ...a, look: null });
  const f = b.bot ? DougBot.TIME[b.bot] : null;
  const forma = (f ? f.forma : b.forma) ?? "squircle";
  const olhos = (f ? f.olhos : b.olhos) ?? "pilula";
  const acessorio = f ? f.acessorio : b.acessorio;
  return {
    shape: forma === "cabeca" ? "squircle" : forma,
    color: corDoBot(b).toLowerCase() as `#${string}`,
    eyes: (Object.entries(OLHOS_DO_LOOK).find(([, o]) => o === olhos)?.[0] ?? "round") as AgentEyes,
    accessory: (Object.entries(ACESSORIO_DO_LOOK).find(([, o]) => o === acessorio)?.[0] ?? "none") as AgentAccessory,
  };
}

/** The identity's bot for an agent, or its free bot. Same answer for the same agent, everywhere. */
export function botDoAgente(a: AgenteParaBot): DougBotOpcoes {
  const nome = plain(a.name);
  const handle = plain(a.handle ?? "");
  const time = a.builtin === "right_hand" ? "doug" : (BOTS_DO_TIME[handle] ?? BOTS_DO_TIME[nome]);
  if (time === "doug") return { bot: time };
  const look = a.look;
  if (look?.shape) {
    const acessorio = look.accessory ? ACESSORIO_DO_LOOK[look.accessory] : undefined;
    return {
      forma: look.shape,
      cor: corDoLook(look.color),
      olhos: OLHOS_DO_LOOK[look.eyes ?? "round"],
      ...(acessorio ? { acessorio } : {}),
      sorriso: false,
    };
  }
  if (time) return { bot: time };
  const texto = plain(`${a.role ?? ""} ${handle.replace(/[-_]/g, " ")} ${nome}`);
  const forma = OFICIOS.find((o) => o.palavras.test(texto))?.forma ?? "squircle";
  const h = hash(handle || nome);
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

export type { DougBotOpcoes };
export { DougBot };
