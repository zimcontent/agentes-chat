import { useTranslation } from "react-i18next";

/**
 * The WhatsApp screens' words on the phone. The feature is this instance's own (docs/adr/doug-0001-whatsapp-numbers.md),
 * so its words live beside it, in Portuguese and English, as the web's do: any other language reads English.
 */
const en = {
  title: "WhatsApp",
  numbers: "Numbers",
  conversations: "Conversations",
  loadMoreChats: "More conversations",
  askPhone: "Get older ones from the phone",
  askedPhone: "Asked the phone. Older messages show up here if it has them.",
  you: "You",
  group: "Group",
  unknown: "Unknown number",
  kind: {
    image: "Photo",
    video: "Video",
    audio: "Voice message",
    document: "Document",
    sticker: "Sticker",
    location: "Location",
    contact: "Contact",
    poll: "Poll",
    other: "Message",
    deleted: "Message deleted",
  },
  fileOnPhone: "Open it on the phone or on the web",
  fileGone: "WhatsApp no longer has this file",
  play: "Play",
  pause: "Pause",
  status: {
    pending: "Waiting for the QR code",
    qr: "Waiting to be read",
    connected: "Connected",
    disconnected: "Reconnecting",
    logged_out: "Disconnected on the phone",
  },
  /** Connecting is reading a QR code with the number's phone: on this phone it would be reading itself. */
  reconnectOnWeb: "Reconnect it on the web, in WhatsApp, with the phone that has this number.",
  tick: { sent: "Sent", delivered: "Delivered", read: "Read", received: "" },
  composer: { placeholder: "Message", offline: "This number isn't connected" },
  sentBy: (name: string) => `Sent by ${name}`,
  agent: {
    on: "Agent answering",
    quiet: (time: string) => `Agent paused until ${time}`,
    off: "Agent off here",
    person: "Waiting for a person",
    yourTurn: "Your turn",
    handed: "The agent left this conversation to a person.",
    limit: "The agent answered as much as it may in a day here.",
    failed: "The agent's AI account didn't answer.",
    failedWhy: (why: string) => `The agent's AI account didn't answer: ${why}`,
    giveBack: "Give back to the agent",
  },
  empty: {
    offTitle: "WhatsApp isn't set up on this server",
    noneTitle: "No number connected",
    noneWeb: "Connect a number on the web, in WhatsApp, reading its QR code with the number's phone.",
    noneAsk: "Ask someone who manages connectors to add you to a number.",
    noChatsTitle: "No conversations yet",
    noChatsText: "Messages show up here from the moment the number connects.",
    notMineTitle: "You aren't on this number's list",
    notMineText: "Someone who manages it can add you on the web, in its settings.",
    noMessages: "No messages here yet",
    failed: "Couldn't load this",
    gone: "This number isn't here anymore",
  },
  errors: {
    unavailable: "WhatsApp isn't answering right now",
    newChatsLimit: "This number already started 20 conversations today. More than that risks a ban.",
    tooLarge: "A file has at most 32 MB",
  },
};

export type WhatsAppWords = typeof en;

const ptBR: WhatsAppWords = {
  title: "WhatsApp",
  numbers: "Números",
  conversations: "Conversas",
  loadMoreChats: "Mais conversas",
  askPhone: "Buscar mais antigas no celular",
  askedPhone: "Pedido feito ao celular. Se ele tiver mensagens mais antigas, elas aparecem aqui.",
  you: "Você",
  group: "Grupo",
  unknown: "Número desconhecido",
  kind: {
    image: "Foto",
    video: "Vídeo",
    audio: "Mensagem de voz",
    document: "Documento",
    sticker: "Figurinha",
    location: "Localização",
    contact: "Contato",
    poll: "Enquete",
    other: "Mensagem",
    deleted: "Mensagem apagada",
  },
  fileOnPhone: "Abra no celular ou na web",
  fileGone: "O WhatsApp não tem mais este arquivo",
  play: "Tocar",
  pause: "Pausar",
  status: {
    pending: "Esperando o QR code",
    qr: "Esperando a leitura",
    connected: "Conectado",
    disconnected: "Reconectando",
    logged_out: "Desconectado no celular",
  },
  reconnectOnWeb: "Reconecte na web, em WhatsApp, com o celular que tem este número.",
  tick: { sent: "Enviada", delivered: "Entregue", read: "Lida", received: "" },
  composer: { placeholder: "Mensagem", offline: "Este número não está conectado" },
  sentBy: (name: string) => `Enviada por ${name}`,
  agent: {
    on: "Agente respondendo",
    quiet: (time: string) => `Agente em pausa até ${time}`,
    off: "Agente desligado aqui",
    person: "Esperando uma pessoa",
    yourTurn: "Sua vez",
    handed: "O agente passou esta conversa para uma pessoa.",
    limit: "O agente já respondeu o máximo de um dia aqui.",
    failed: "A conta de IA do agente não respondeu.",
    failedWhy: (why: string) => `A conta de IA do agente não respondeu: ${why}`,
    giveBack: "Devolver ao agente",
  },
  empty: {
    offTitle: "O WhatsApp não está configurado neste servidor",
    noneTitle: "Nenhum número conectado",
    noneWeb: "Conecte um número na web, em WhatsApp, lendo o QR code com o celular do número.",
    noneAsk: "Peça a quem gerencia conectores para colocar você em um número.",
    noChatsTitle: "Nenhuma conversa ainda",
    noChatsText: "As mensagens aparecem aqui a partir do momento em que o número conecta.",
    notMineTitle: "Você não está na lista deste número",
    notMineText: "Quem gerencia o número pode colocar você na web, nas configurações dele.",
    noMessages: "Nenhuma mensagem aqui ainda",
    failed: "Não deu para carregar",
    gone: "Este número não está mais aqui",
  },
  errors: {
    unavailable: "O WhatsApp não está respondendo agora",
    newChatsLimit: "Este número já começou 20 conversas hoje. Mais do que isso arrisca um banimento.",
    tooLarge: "Um arquivo tem no máximo 32 MB",
  },
};

/** The words in a language: Portuguese for any `pt`, English for everything else. */
export const whatsappWords = (language: string | undefined): WhatsAppWords =>
  language?.toLowerCase().startsWith("pt") ? ptBR : en;

/** The words in the app's language. */
export function useWhatsAppWords(): WhatsAppWords {
  const { i18n } = useTranslation();
  return whatsappWords(i18n.language);
}
