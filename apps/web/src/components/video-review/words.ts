import { useTranslation } from "react-i18next";

/**
 * The video review screens' words (docs/adr/doug-0007-video-review.md). This feature is this instance's own, so its
 * words live beside it, in Portuguese and English: any other language reads English.
 */
const en = {
  title: "Review",
  meta: "Videos agents edited, waiting on the team",
  back: "Back to videos",
  empty: "No videos to review",
  emptyText: "When an agent sends a video for review, it shows up here.",
  status: { in_review: "To review", changes: "Changes asked", approved: "Approved" },
  filters: { open: "To review", all: "All" },
  version: (n: number) => `V${n}`,
  notesOpen: (n: number) => (n === 1 ? "1 note" : `${n} notes`),
  by: (name: string) => `by ${name}`,
  notesTitle: "Notes",
  noNotes: "No notes on this version yet. Pause where something should change and write or say it.",
  placeholder: "What should change here?",
  whole: "Whole video",
  atTime: (t: string) => `At ${t}`,
  add: "Add note",
  record: "Say a note",
  stop: "Stop and add",
  recording: "Recording…",
  transcribing: "Transcribing…",
  voice: "Said aloud",
  remove: "Remove",
  sent: "Sent to the agent",
  approve: "Approve",
  changes: "Ask for changes",
  changesHint: "Every note of this version goes to the agent, which makes the next one.",
  message: "A word to the agent (optional)",
  approvedBy: (name: string) => `Approved by ${name}`,
  changesBy: (name: string) => `${name} asked for changes`,
  waitingNext: (n: number) => `The agent is making V${n}.`,
  versionNote: "What changed",
  versionsLabel: "Version",
  whereLabel: "Where the note goes",
  micBlocked: "The microphone is blocked in this browser.",
  failed: "That didn't work. Try again.",
  agentGone: "The agent that made this video was removed.",
};

export type ReviewWords = typeof en;

const ptBR: ReviewWords = {
  title: "Revisão",
  meta: "Vídeos que os agentes editaram, esperando a equipe",
  back: "Voltar aos vídeos",
  empty: "Nenhum vídeo para revisar",
  emptyText: "Quando um agente mandar um vídeo para revisão, ele aparece aqui.",
  status: { in_review: "Para revisar", changes: "Ajustes pedidos", approved: "Aprovado" },
  filters: { open: "Para revisar", all: "Todos" },
  version: (n) => `V${n}`,
  notesOpen: (n) => (n === 1 ? "1 nota" : `${n} notas`),
  by: (name) => `por ${name}`,
  notesTitle: "Notas",
  noNotes: "Nenhuma nota nesta versão. Pause onde algo deve mudar e escreva ou fale.",
  placeholder: "O que muda aqui?",
  whole: "Vídeo todo",
  atTime: (t) => `Em ${t}`,
  add: "Adicionar nota",
  record: "Falar uma nota",
  stop: "Parar e adicionar",
  recording: "Gravando…",
  transcribing: "Transcrevendo…",
  voice: "Falada",
  remove: "Remover",
  sent: "Enviada ao agente",
  approve: "Aprovar",
  changes: "Pedir ajustes",
  changesHint: "Todas as notas desta versão vão para o agente, que faz a próxima.",
  message: "Um recado ao agente (opcional)",
  approvedBy: (name) => `Aprovado por ${name}`,
  changesBy: (name) => `${name} pediu ajustes`,
  waitingNext: (n) => `O agente está fazendo a V${n}.`,
  versionNote: "O que mudou",
  versionsLabel: "Versão",
  whereLabel: "Onde vai a nota",
  micBlocked: "O microfone está bloqueado neste navegador.",
  failed: "Não deu certo. Tente de novo.",
  agentGone: "O agente que fez este vídeo foi removido.",
};

export function useReviewWords(): ReviewWords {
  const { i18n } = useTranslation();
  return i18n.language?.toLowerCase().startsWith("pt") ? ptBR : en;
}

/** `83400` → `1:23`, as a player shows it. */
export function timecode(ms: number): string {
  const s = Math.max(0, Math.floor(ms / 1000));
  const m = Math.floor(s / 60);
  const h = Math.floor(m / 60);
  const two = (n: number) => String(n).padStart(2, "0");
  return h > 0 ? `${h}:${two(m % 60)}:${two(s % 60)}` : `${m}:${two(s % 60)}`;
}
