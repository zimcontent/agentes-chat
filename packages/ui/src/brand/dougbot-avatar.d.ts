/** Types for dougbot-avatar.js, the DougBot identity's avatar drawer (a verbatim copy, SVG by code, no images). */

export type DougBotNome = "doug" | "rosa" | "sony" | "mark" | "chess" | "kiara" | "junin";
export type DougBotEstado = "ok" | "trabalhando" | "pedindo" | "terminou" | "dormindo";
export type DougBotForma = "petala" | "monitor" | "quadrado" | "torre" | "moeda" | "hexagono" | "squircle";
export type DougBotOlhos = "pilula" | "largo" | "meia" | "ponto";
export type DougBotAcessorio = "fone" | "gravata" | "chaves";

export interface DougBotOpcoes {
  bot?: DougBotNome;
  estado?: DougBotEstado;
  /** Size in px: below 60 the Doug closes on his face (unless `perto` says). */
  tamanho?: number;
  perto?: boolean;
  /** The light on the floor (off below 44 px and on light grounds). */
  brilho?: boolean;
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
  forma: DougBotForma | "retrato";
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
  QUADRO: string;
  versao: string;
}

declare const DougBot: DougBotApi;
export default DougBot;
