/** Types for dougbot-avatar.js, the DougBot identity's avatar drawer (SVG by code, no images). */

export type DougBotNome = "doug" | "rosa" | "sony" | "mark" | "chess" | "kiara" | "junin";
export type DougBotEstado = "ok" | "trabalhando" | "pedindo" | "terminou" | "dormindo";
export type DougBotForma = "petala" | "monitor" | "quadrado" | "torre" | "moeda" | "hexagono" | "squircle";
export type DougBotOlhos = "pilula" | "largo" | "meia" | "ponto";
export type DougBotAcessorio = "fone" | "gravata" | "chaves";
/** A look the Doug holds still (his eyes only): the faces of the app icon. */
export type DougBotOlhar =
  | "normal"
  | "feliz"
  | "piscando"
  | "surpreso"
  | "desconfiado"
  | "triste"
  | "bravo"
  | "de-lado"
  | "pra-cima"
  | "rindo"
  | "dormindo";

export interface DougBotOpcoes {
  bot?: DougBotNome;
  estado?: DougBotEstado;
  /** The Doug only: what his eyes do, instead of what his state gives them (the state still dims him asleep). */
  olhar?: DougBotOlhar;
  /** Size in px: below 60 the Doug's head fills his piece of glass (unless `perto` says). */
  tamanho?: number;
  perto?: boolean;
  /** The light on the floor (off below 44 px and on light grounds). */
  brilho?: boolean;
  /** The Doug only: `false` draws his head alone, without the piece of green glass around it. */
  peca?: boolean;
  /**
   * The Doug's head alone: green glass with ink eyes ("vidro", the default), black with white eyes ("preto"), or one
   * flat colour (`cor`) with the eyes cut out of it ("chapado": a glyph a system tints, a stamp). In his piece,
   * "chapado" draws the piece, the head and the eyes in flat colours, with no light and no filter: a few hundred
   * bytes, for a page that has to stay small.
   */
  material?: "vidro" | "preto" | "chapado";
  forma?: DougBotForma;
  cor?: string;
  olhos?: DougBotOlhos;
  acessorio?: DougBotAcessorio;
  sorriso?: boolean;
  y?: number;
  titulo?: string;
  /** Prefix of the SVG's inner ids: unique per drawing on a page. */
  id?: string;
}

export interface DougBotFicha {
  nome: string;
  papel: string;
  cor: string;
  forma: DougBotForma | "cabeca";
  olhos?: DougBotOlhos;
  acessorio?: DougBotAcessorio;
  y?: number;
  dx?: number;
}

export interface DougBotApi {
  avatar(opcoes?: DougBotOpcoes): string;
  montar(onde?: ParentNode): void;
  ficha(opcoes: DougBotOpcoes): DougBotFicha & DougBotOpcoes;
  mix(a: string, b: string, t: number): string;
  TIME: Record<DougBotNome, DougBotFicha>;
  ORDEM: DougBotNome[];
  CORPOS: Record<DougBotForma, string>;
  VISORES: Record<DougBotForma, string>;
  /** The Doug's piece of glass and, inside it, his head: both in the 120 × 120 frame. */
  QUADRO: string;
  CABECA: string;
  versao: string;
}

declare const DougBot: DougBotApi;
export default DougBot;
