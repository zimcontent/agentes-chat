import { useTranslation } from "react-i18next";

/**
 * The phone's own words for Mídia (docs/adr/doug-0011): the ones the web's `mediaGen.*` keys don't have, because the
 * phone shows the feature in its own way (a gallery screen, a form screen, a generation's screen). This feature is
 * this instance's own, so its words live beside it, in Portuguese and English: any other language reads English.
 */
const en = {
  newTitle: "Generate media",
  newLabel: "New generation",
  detailTitle: "Generation",
  balance: "Wallet",
  running: "Generating…",
  failedShort: "Failed",
  open: "Open",
  openImage: (prompt: string) => `Open the image: ${prompt}`,
  openVideo: (prompt: string) => `Open the video: ${prompt}`,
  openGeneration: (prompt: string) => `Open the generation: ${prompt}`,
  reuse: "Use this prompt",
  copyPrompt: "Copy the prompt",
  copied: "Prompt copied",
  credits: "Credits",
  by: "By",
  when: "When",
  notFound: "This generation doesn't exist or isn't yours to see.",
  loadFailed: "Couldn't load Media.",
  off: "Media isn't on for this workspace.",
  noModels: "No model is available right now.",
  addPhoto: "Add a photo",
  photosBlocked: "The app may not open your photos. Allow it in Settings.",
  videoRefsOnWeb: "Video and audio references, and editing or extending a video, are on the computer.",
  topupBack: "Back from Mercado Pago? The balance updates when the payment is confirmed.",
  noPack: "There's no credit pack to buy right now.",
};

export type MediaWords = typeof en;

const pt: MediaWords = {
  newTitle: "Gerar mídia",
  newLabel: "Nova geração",
  detailTitle: "Geração",
  balance: "Carteira",
  running: "Gerando…",
  failedShort: "Falhou",
  open: "Abrir",
  openImage: (prompt) => `Abrir a imagem: ${prompt}`,
  openVideo: (prompt) => `Abrir o vídeo: ${prompt}`,
  openGeneration: (prompt) => `Abrir a geração: ${prompt}`,
  reuse: "Usar este prompt",
  copyPrompt: "Copiar o prompt",
  copied: "Prompt copiado",
  credits: "Créditos",
  by: "Por",
  when: "Quando",
  notFound: "Esta geração não existe ou não é sua para ver.",
  loadFailed: "Não deu para carregar a Mídia.",
  off: "A Mídia não está ligada neste workspace.",
  noModels: "Nenhum modelo disponível agora.",
  addPhoto: "Adicionar foto",
  photosBlocked: "O app não pode abrir suas fotos. Libere em Ajustes.",
  videoRefsOnWeb: "Vídeo e áudio de referência, e editar ou estender um vídeo, ficam no computador.",
  topupBack: "Voltou do Mercado Pago? O saldo muda quando o pagamento for confirmado.",
  noPack: "Não há pacote de créditos para comprar agora.",
};

/** The words in a language: Portuguese for any `pt`, English for the rest. */
export function mediaWords(language: string | undefined): MediaWords {
  return language?.toLowerCase().startsWith("pt") ? pt : en;
}

/** The words in the app's language. */
export function useMediaWords(): MediaWords {
  const { i18n } = useTranslation();
  return mediaWords(i18n.language);
}
