/**
 * The words of the right hand's sector cards (docs/adr/doug-0020-doug-sector-cards.md). Like pushes and emails, they
 * are written by the server for one person and shown as they are, so they are in that person's language: Portuguese
 * for a `pt` locale, English for every other. Never internal names: only the services, people's names and counts.
 */

export type CardLang = "pt" | "en";

export const cardLang = (locale: string | null | undefined): CardLang => (locale?.startsWith("pt") ? "pt" : "en");

const PT = {
  briefToday: "Bom dia! O teu dia:",
  briefMore: "Também tem isto pra você:",
  asked: "Aqui está:",
  nothing: "Nada novo por aqui agora.",
  arrived: "Chegou isto pra você:",
  whatsapp: "WhatsApp",
  calendar: "Agenda",
  proposals: "Propostas",
  approvals: "Aprovações",
  tasks: "Tarefas",
  review: "Revisão",
  portal: "Portal",
  newCount: (n: number) => (n === 1 ? "1 nova" : `${n} novas`),
  openCount: (n: number) => (n === 1 ? "1 aberta" : `${n} abertas`),
  waitingCount: (n: number) => (n === 1 ? "1 esperando" : `${n} esperando`),
  eventCount: (n: number) => (n === 1 ? "1 evento" : `${n} eventos`),
  waLead: (name: string, text: string) => `${name} escreveu: “${text}”. Eu respondo e te mostro antes de enviar?`,
  waNeedsYou: (name: string, note: string) =>
    note ? `${name} precisa de você: ${note}` : `${name} precisa de você nessa conversa.`,
  waReply: "Responder",
  waMine: "Eu respondo",
  waOpen: "Ver conversa",
  waAsk: (name: string, label: string) =>
    `Responda a conversa do WhatsApp com ${name} (número ${label}): leia a conversa e me mostre a resposta antes de enviar.`,
  agendaTitle: (day: string) => `Agenda · ${day}`,
  agendaNext: (title: string, time: string) => `Próximo: ${title} às ${time}.`,
  agendaJoin: "Entrar",
  agendaOpen: "Abrir",
  allDay: "Dia todo",
  proposalsText: (n: number) =>
    n === 1 ? "Um agente propôs uma mudança que espera você." : `${n} mudanças propostas pelos agentes esperam você.`,
  proposalsOpen: "Ver propostas",
  approvalsText: (n: number, first: string) =>
    n === 1 ? `Um pedido espera sua aprovação: ${first}.` : `${n} pedidos esperam sua aprovação. O primeiro: ${first}.`,
  approvalsOpen: "Ver aprovações",
  tasksText: (late: number, today: number) =>
    `${[
      late ? (late === 1 ? "1 tarefa atrasada" : `${late} tarefas atrasadas`) : "",
      today ? (today === 1 ? "1 para hoje" : `${today} para hoje`) : "",
    ]
      .filter(Boolean)
      .join(" e ")}.`,
  tasksOpen: "Ver tarefas",
  tasksHelp: "Me ajuda",
  tasksAsk: "Me ajude com as minhas tarefas atrasadas e as de hoje: o que você consegue andar agora?",
  reviewText: (n: number, first: string) =>
    n === 1 ? `“${first}” espera a sua revisão.` : `${n} peças esperam revisão. A primeira: “${first}”.`,
  reviewOpen: "Revisar",
  portalText: (approved: number, adjusting: number) =>
    `${[
      approved
        ? approved === 1
          ? "1 post aprovado esperando agendar"
          : `${approved} posts aprovados esperando agendar`
        : "",
      adjusting
        ? adjusting === 1
          ? "1 ajuste pedido pelo cliente"
          : `${adjusting} ajustes pedidos pelos clientes`
        : "",
    ]
      .filter(Boolean)
      .join(" e ")}.`,
  portalOpen: "Abrir portal",
};

const EN: typeof PT = {
  briefToday: "Good morning! Your day:",
  briefMore: "Also waiting for you:",
  asked: "Here it is:",
  nothing: "Nothing new here right now.",
  arrived: "This came in for you:",
  whatsapp: "WhatsApp",
  calendar: "Calendar",
  proposals: "Proposals",
  approvals: "Approvals",
  tasks: "Tasks",
  review: "Review",
  portal: "Portal",
  newCount: (n) => `${n} new`,
  openCount: (n) => `${n} open`,
  waitingCount: (n) => `${n} waiting`,
  eventCount: (n) => (n === 1 ? "1 event" : `${n} events`),
  waLead: (name, text) => `${name} wrote: “${text}”. Shall I answer and show you before it goes?`,
  waNeedsYou: (name, note) => (note ? `${name} needs you: ${note}` : `${name} needs you in this conversation.`),
  waReply: "Answer",
  waMine: "I'll answer",
  waOpen: "See conversation",
  waAsk: (name, label) =>
    `Answer the WhatsApp conversation with ${name} (number ${label}): read it and show me the answer before you send it.`,
  agendaTitle: (day) => `Calendar · ${day}`,
  agendaNext: (title, time) => `Next: ${title} at ${time}.`,
  agendaJoin: "Join",
  agendaOpen: "Open",
  allDay: "All day",
  proposalsText: (n) =>
    n === 1 ? "An agent proposed a change that waits for you." : `${n} changes proposed by the agents wait for you.`,
  proposalsOpen: "See proposals",
  approvalsText: (n, first) =>
    n === 1
      ? `A request waits for your approval: ${first}.`
      : `${n} requests wait for your approval. The first: ${first}.`,
  approvalsOpen: "See approvals",
  tasksText: (late, today) =>
    `${[late ? (late === 1 ? "1 task overdue" : `${late} tasks overdue`) : "", today ? `${today} due today` : ""]
      .filter(Boolean)
      .join(" and ")}.`,
  tasksOpen: "See tasks",
  tasksHelp: "Help me",
  tasksAsk: "Help me with my overdue tasks and today's: what can you move forward now?",
  reviewText: (n, first) =>
    n === 1 ? `“${first}” waits for your review.` : `${n} pieces wait for review. The first: “${first}”.`,
  reviewOpen: "Review",
  portalText: (approved, adjusting) =>
    `${[
      approved
        ? approved === 1
          ? "1 approved post waiting to be scheduled"
          : `${approved} approved posts waiting to be scheduled`
        : "",
      adjusting ? (adjusting === 1 ? "1 change a client asked for" : `${adjusting} changes clients asked for`) : "",
    ]
      .filter(Boolean)
      .join(" and ")}.`,
  portalOpen: "Open portal",
};

export type CardWords = typeof PT;

export const cardWords = (lang: CardLang): CardWords => (lang === "pt" ? PT : EN);
