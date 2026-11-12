/**
 * DougBot: os tokens da marca (`--db-*` de identidade/dougbot-identidade/tokens.css, IDENTIDADE.md §4–6) em TS,
 * para o app de celular. Puro (sem React Native), para os testes.
 *
 * - Escuro: o palco da identidade, valor por valor.
 * - Claro: a identidade só define a assinatura em fundo claro (`#F4F6F2` com tinta `#0A0A0A`, §3). O resto do claro
 *   sai das mesmas regras: palco claro, cartões brancos, tinta quase preta, e o verde que vira texto ou borda usa a
 *   variante escura (`verdeEscuro`), que passa AA (≥ 4,5:1) no palco claro. O verde de fundo (botão principal, o Doug)
 *   é o mesmo nos dois temas: a tinta em cima dele tem contraste de sobra.
 */
export type DbScheme = "dark" | "light";

export interface DbTokens {
  /** Palco: fundo de tudo. */
  palco: string;
  /** Vidro: painéis e janelas. */
  palco2: string;
  /** Sobre vidro: campos e mensagens. */
  palco3: string;
  /** Elevado: item ativo, a mensagem do usuário. */
  palco4: string;
  linha: string;
  linha2: string;
  linha3: string;
  texto: string;
  texto2: string;
  texto3: string;
  verde: string;
  verdeClaro: string;
  verdeFundo: string;
  verdeTinta: string;
  /** Verde a 12%: fundo do item escolhido. */
  verdeSuave: string;
  /** Verde a 35%: borda do campo ativo. */
  verdeLuz: string;
  /** O verde quando vira texto, ícone ou borda fina: no escuro o próprio; no claro a variante escura (AA). */
  verdeTexto: string;
  atencao: string;
  erro: string;
  vidro: string;
  vidroLeve: string;
  vidroBorda: string;
  vidroBrilho: string;
  /** Vidro de peça pequena (gradiente de cima para baixo). */
  vidroCartao: readonly [string, string];
}

/** O botão verde: os três tons, de cima para baixo (`--db-verde-botao`). */
export const VERDE_BOTAO = {
  colors: ["#C5FF52", "#9CFA05", "#84E407"] as const,
  locations: [0, 0.55, 1] as const,
};

/** Cores dos bots (§4). Turquesa e fúcsia ficam livres para os próximos. Bot novo nunca é verde. */
export const CORES_BOTS = {
  verde: "#9CFA05",
  rosa: "#EC4899",
  ciano: "#22D3EE",
  laranja: "#FB923C",
  violeta: "#A78BFA",
  amarelo: "#FACC15",
  azul: "#60A5FA",
  turquesa: "#2DD4BF",
  fucsia: "#E879F9",
} as const;

/** O verde escuro do claro: #3E6B00 no palco #F4F6F2 dá 5,9:1, e no branco 6,4:1. */
export const VERDE_ESCURO = "#3E6B00";

export const DB_DARK: DbTokens = {
  palco: "#0A0A0A",
  palco2: "#121212",
  palco3: "#1A1A1A",
  palco4: "#212121",
  linha: "#262626",
  linha2: "#303030",
  linha3: "#424242",
  texto: "#EDEDED",
  texto2: "#999999",
  texto3: "#6B6B6B",
  verde: "#9CFA05",
  verdeClaro: "#C5FF52",
  verdeFundo: "#84E407",
  verdeTinta: "#0A0A0A",
  verdeSuave: "rgba(156, 250, 5, 0.12)",
  verdeLuz: "rgba(156, 250, 5, 0.35)",
  verdeTexto: "#9CFA05",
  atencao: "#F5B544",
  erro: "#F2555A",
  vidro: "rgba(18, 18, 18, 0.78)",
  vidroLeve: "rgba(18, 18, 18, 0.58)",
  vidroBorda: "rgba(255, 255, 255, 0.086)",
  vidroBrilho: "rgba(255, 255, 255, 0.06)",
  vidroCartao: ["rgba(255, 255, 255, 0.043)", "rgba(255, 255, 255, 0.016)"],
};

export const DB_LIGHT: DbTokens = {
  palco: "#F4F6F2",
  palco2: "#FFFFFF",
  palco3: "#ECEFE8",
  palco4: "#E3E7DE",
  linha: "#E1E4DC",
  linha2: "#D3D7CD",
  linha3: "#B9BEB1",
  texto: "#0A0A0A",
  texto2: "#55594F",
  // 4,6:1 no palco claro: o "discreto" ainda lê (AA para texto pequeno).
  texto3: "#6A6E63",
  verde: "#9CFA05",
  verdeClaro: "#C5FF52",
  verdeFundo: "#84E407",
  verdeTinta: "#0A0A0A",
  verdeSuave: "rgba(124, 200, 4, 0.16)",
  verdeLuz: "rgba(62, 107, 0, 0.45)",
  verdeTexto: VERDE_ESCURO,
  atencao: "#9A5B00",
  erro: "#C42B30",
  vidro: "rgba(255, 255, 255, 0.82)",
  vidroLeve: "rgba(255, 255, 255, 0.64)",
  vidroBorda: "rgba(10, 10, 10, 0.08)",
  vidroBrilho: "rgba(255, 255, 255, 0.9)",
  vidroCartao: ["rgba(255, 255, 255, 0.9)", "rgba(255, 255, 255, 0.7)"],
};

export const dbTokens = (scheme: DbScheme): DbTokens => (scheme === "dark" ? DB_DARK : DB_LIGHT);

/**
 * Raios (§6): 8 itens pequenos, 12 botões e campos, 16 linhas e avisos, 22 painéis, 34 janelas. Sem pílulas.
 * Cantos concêntricos: o raio de dentro é o de fora menos a folga (`concentrico`).
 */
export const DB_RAIO = { r1: 8, r2: 12, r3: 16, r4: 22, r5: 34 } as const;

/** Folga mínima entre a borda de um contêiner e o que está dentro: controles 12, cartões e composer 16, painéis 20–24. */
export const DB_FOLGA = { controle: 12, cartao: 16, painel: 20, painelLargo: 24 } as const;

/** O raio de uma peça junto do canto de outra: externo − folga, nunca menos que 4. */
export const concentrico = (externo: number, folga: number) => Math.max(4, externo - folga);

/** Famílias carregadas pelo expo-font (`src/providers/fonts.ts`): um nome por peso, como o React Native pede. */
export const DB_FONTES = {
  titulo800: "Manrope_800ExtraBold",
  titulo700: "Manrope_700Bold",
  titulo500: "Manrope_500Medium",
  texto400: "Inter_400Regular",
  texto500: "Inter_500Medium",
  texto600: "Inter_600SemiBold",
  texto700: "Inter_700Bold",
  codigo400: "JetBrainsMono_400Regular",
  codigo500: "JetBrainsMono_500Medium",
} as const;

/** A família Inter do peso pedido (o React Native não escolhe peso dentro de uma família carregada por arquivo). */
export function interDoPeso(peso: string | number | undefined): string {
  const p = Number(peso ?? 400);
  if (p >= 700) return DB_FONTES.texto700;
  if (p >= 600) return DB_FONTES.texto600;
  if (p >= 500) return DB_FONTES.texto500;
  return DB_FONTES.texto400;
}

/** A família Manrope do peso pedido (títulos e nomes: 800, 700 e 500). */
export function manropeDoPeso(peso: string | number | undefined): string {
  const p = Number(peso ?? 800);
  if (p >= 800) return DB_FONTES.titulo800;
  if (p >= 600) return DB_FONTES.titulo700;
  return DB_FONTES.titulo500;
}
