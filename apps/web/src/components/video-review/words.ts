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
  noNotesClosed: "No notes on this version.",
  wholeTitle: "About the whole video",
  wholePlaceholder: "Something that isn't at one point: color, music, pace…",
  talk: "Say it",
  point: "one point",
  stretch: (span: string) => `stretch ${span}`,
  markEnd: "Mark the end",
  remark: "Mark the end again",
  marking: (from: string) => `Marking from ${from}: click the picture or press Enter where it ends`,
  cancel: "Cancel",
  save: "Save",
  kindLabel: "What it's about",
  kinds: {
    cut: "Cut/pace",
    text: "Text/captions",
    motion: "Motion",
    sound: "Sound/music",
    color: "Color",
    broll: "Cards/B-roll",
    other: "Other",
  },
  scrub: "Where in the video",
  play: "Play",
  pause: "Pause",
  back1s: "Back a second",
  back1f: "Back a frame",
  fwd1f: "Forward a frame",
  fwd1s: "Forward a second",
  speed: "Speed",
  download: "Download",
  keys: "Click the picture to note that point · Space play · J/L slower/faster · ←/→ frame · Shift ±1 s · Enter note",
  keysClosed: "Space play · J/L slower/faster · ←/→ frame · Shift ±1 s",
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
  noNotesClosed: "Nenhuma nota nesta versão.",
  wholeTitle: "Sobre o vídeo todo",
  wholePlaceholder: "Algo que não está num ponto só: cor, trilha, ritmo…",
  talk: "Falar",
  point: "ponto único",
  stretch: (span) => `trecho ${span}`,
  markEnd: "Marcar fim",
  remark: "Marcar fim de novo",
  marking: (from) => `Marcando a partir de ${from}: clique no vídeo ou aperte Enter onde termina`,
  cancel: "Cancelar",
  save: "Salvar",
  kindLabel: "Sobre o quê",
  kinds: {
    cut: "Corte/ritmo",
    text: "Texto/legenda",
    motion: "Movimento",
    sound: "Som/trilha",
    color: "Cor",
    broll: "Cards/B-roll",
    other: "Outro",
  },
  scrub: "Onde no vídeo",
  play: "Tocar",
  pause: "Pausar",
  back1s: "Voltar um segundo",
  back1f: "Voltar um quadro",
  fwd1f: "Avançar um quadro",
  fwd1s: "Avançar um segundo",
  speed: "Velocidade",
  download: "Baixar",
  keys: "Clique no vídeo para comentar aquele ponto · Espaço toca · J/L mais lento/rápido · ←/→ quadro · Shift ±1 s · Enter nota",
  keysClosed: "Espaço toca · J/L mais lento/rápido · ←/→ quadro · Shift ±1 s",
};

export function useReviewWords(): ReviewWords {
  const { i18n } = useTranslation();
  return i18n.language?.toLowerCase().startsWith("pt") ? ptBR : en;
}

const two = (n: number) => String(n).padStart(2, "0");

/** `83400` → `1:23.4`: a note's place, to a tenth of a second (what the agent reads too). */
export function timecode(ms: number): string {
  const s = Math.max(0, Math.floor(ms / 1000));
  const m = Math.floor(s / 60);
  const h = Math.floor(m / 60);
  const tenth = Math.floor((Math.max(0, ms) % 1000) / 100);
  return h > 0 ? `${h}:${two(m % 60)}:${two(s % 60)}.${tenth}` : `${m}:${two(s % 60)}.${tenth}`;
}

/** `6400` at 25 fps → `00:06:10`: minutes, seconds and frames, as an editor's clock reads. */
export function frameCode(ms: number, fps: number): string {
  const frames = Math.max(0, Math.floor((ms / 1000) * fps + 1e-6));
  const f = frames % fps;
  const s = Math.floor(frames / fps);
  return `${two(Math.floor(s / 60))}:${two(s % 60)}:${two(f)}`;
}
