import { cutText } from "./format";
import type { Judge } from "./judge";

/**
 * The first words of an agent (docs/adr/doug-0037-conversation-pace.md): a person who asks for work hears a short line
 * from the agent in about a second, before any context or model call, and its answer then comes as the result itself.
 * A calibrated judge (Jev) decides, beside the run's start; the line is picked from a fixed list, no model writes it.
 * Small talk ("oi", "valeu", "ok") never gets one: its answer is already quick.
 */

/** The judge's wait: an answer that comes later than this is dropped and the run goes on as before. */
export const QUICK_ACK_TIMEOUT_MS = 1200;
/** The line goes out at this probability that the message asks for work, or more. */
export const QUICK_ACK_THRESHOLD = 0.6;

/** A greeting, thanks, an ok, a laugh or emoji alone: messages whose answer is a line, never work. */
const SMALL_TALK =
  /^(?:oi+|ol[aá]|e a[ií]|eai|opa|bom dia|boa tarde|boa noite|tudo (?:bem|certo|bom)|td bem|blz|beleza|valeu|vlw|obrigad[oa]|obg|brigad[oa]|ok(?:ay)?|okk+|certo|fechado|show|top|perfeito|massa|legal|isso|sim|n[aã]o|entendi|beleza então|hi|hey|hello|thanks?|thank you|thx|cool|great|nice|yes|no|sure|got it|k+|(?:ha|ka|rs|hue)+|👍|🙏|❤️|😂)$/i;

/** No letters or digits at all: emoji, punctuation. */
const NO_WORDS = /^[^\p{L}\p{N}]*$/u;

/**
 * Whether a message is small talk: no work to look for in it, so the run skips the judges that size its work (tools,
 * the "Automático" model) and gets no first line. Files are never small talk.
 */
export function isSmallTalk(body: string, meta?: Record<string, unknown> | null): boolean {
  if (Array.isArray(meta?.artifacts) && meta.artifacts.length > 0) return false;
  // The agent's own mention ("@dev oi") is how the person calls it, not what they say.
  const text = body
    .replace(/@[a-z0-9_-]+/gi, " ")
    .trim()
    .toLowerCase()
    .replace(/[!.?,;~…\s]+$/u, "")
    .replace(/\s+/g, " ");
  if (text.length === 0) return true;
  if (text.length > 40) return false;
  return NO_WORDS.test(text) || SMALL_TALK.test(text);
}

const LINES: Record<"pt" | "en", readonly string[]> = {
  pt: [
    "Deixa comigo.",
    "Já vejo isso.",
    "Vou olhar aqui.",
    "Certo, já começo.",
    "Fechado, já cuido disso.",
    "Bora, já faço.",
    "Deixa eu ver.",
    "Pode deixar.",
    "Entendi, vou atrás.",
    "Já estou vendo.",
  ],
  en: [
    "On it.",
    "Let me check.",
    "Looking into it.",
    "Got it, starting now.",
    "Sure, on it.",
    "Let me take a look.",
    "Leave it with me.",
    "Checking now.",
  ],
};

/** The language of the line: the person's app language when set, else what their message looks like. */
export function ackLanguage(locale: string | null | undefined, body: string): "pt" | "en" {
  if (locale) return locale.toLowerCase().startsWith("pt") ? "pt" : "en";
  return /[ãõçâêô]|\b(?:n[aã]o|voc[eê]|vc|pra|por favor|preciso|quero|faz|fa[cç]a|olha|v[eê])\b/i.test(body)
    ? "pt"
    : "en";
}

/** Each agent's last line here, so the next one is another. */
const lastLine = new Map<string, string>();

/** A line in `language`, never the one this agent said last. */
export function pickAckLine(agentId: string, language: "pt" | "en", random: () => number = Math.random): string {
  const last = lastLine.get(agentId);
  const choices = LINES[language].filter((l) => l !== last);
  const line = choices[Math.floor(random() * choices.length)] ?? LINES[language][0] ?? "";
  if (lastLine.size > 5000) lastLine.clear();
  lastLine.set(agentId, line);
  return line;
}

/** The meta of the line: the run it opened. Silent (no notification), routes nobody, read by nobody's context. */
export const ackMeta = (runId: string) => ({ ack: { runId } });

export const isQuickAck = (meta: Record<string, unknown> | null | undefined) =>
  typeof meta?.ack === "object" && meta.ack !== null;

/** What the run reads once its line went out: the line counts as said, and its next words are the result. */
export const quickAckNote = (line: string) =>
  `# You already answered\nThe moment their message arrived you told them: "${line}". Don't acknowledge again ("um momento", "vou verificar", "let me check"): your next words are the result itself, or a short line on where the work stands if it takes long.`;

/**
 * Whether the message asks the agent for work (looking something up, using a tool, making or changing something,
 * several steps), as opposed to a question answered from what it knows. Only a calibrated judge answers; any failure
 * or a late answer is a no.
 */
export async function asksForWork(
  judge: Judge,
  input: {
    orgId: string;
    agentId: string;
    runId: string;
    agent: { name: string; role: string };
    message: string;
    recent: string[];
    timeoutMs?: number;
  },
): Promise<boolean> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const late = new Promise<"late">((resolve) => {
    timer = setTimeout(() => resolve("late"), input.timeoutMs ?? QUICK_ACK_TIMEOUT_MS);
  });
  try {
    const answers = await Promise.race([
      judge.ask({
        orgId: input.orgId,
        agentId: input.agentId,
        runId: input.runId,
        kind: "quick_ack",
        calibrated: true,
        timeoutMs: input.timeoutMs ?? QUICK_ACK_TIMEOUT_MS,
        state: {
          agent: input.agent,
          message: cutText(input.message, 1500),
          recent: input.recent.map((m) => cutText(m, 300)).join("\n"),
        },
        questions: {
          work: {
            type: "noul",
            instructions:
              "An AI agent of a team (`agent`) just got `message` in a chat (`recent` is what was said before it). Does the message ask it to do work that takes more than an instant answer: look something up, open or read something, use a tool or an app, make, change or send something, or a task of several steps?",
            criteria: {
              true: "It asks for work: the agent has to go and do or check something before it can give the result.",
              false:
                "It is conversation: a greeting, thanks, an opinion, a quick question the agent answers from what it knows, or a reply to the agent.",
            },
          },
        },
      }),
      late,
    ]);
    if (answers === "late") return false;
    return (answers.work?.noul ?? 0) >= QUICK_ACK_THRESHOLD;
  } catch {
    return false;
  } finally {
    clearTimeout(timer);
  }
}
