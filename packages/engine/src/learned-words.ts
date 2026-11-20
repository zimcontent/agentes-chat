import type { Executor } from "@dougbot/db";
import { enqueue } from "./outbox";
import type { ScheduleRule } from "./rrule";

/**
 * The words of "Aprendi a fazer isso" (ADR 0120, addendum of 2026-11-20) and its job's name, apart from the code that
 * posts it (`learned-line.ts`) so `messages.ts`, the learning code and the jobs reach them without importing routines.
 * Nothing here reads the database.
 */

export const LEARNED_LINE_JOB = "agents.learned";

/**
 * Queues the line for a run (`LEARNED_LINE_JOB`). `step` tells apart the moments that may find something new in the
 * same run (a turn's end, the learning job, a promotion): each queues once.
 */
export async function enqueueLearnedLine(db: Executor, orgId: string, runId: string, step: string) {
  await enqueue(db, {
    orgId,
    kind: LEARNED_LINE_JOB,
    payload: { runId },
    dedupeKey: `${LEARNED_LINE_JOB}:${runId}:${step}`,
    // A turn's end queues it while the run may still go on for long (continues, waits): each try finds it still going
    // and comes back on the outbox's backoff. Eight tries span about 4.7 hours, inside `LEARNED_LATE_MS`; four gave up
    // after under three minutes, so a run longer than that never said it.
    maxAttempts: 8,
  });
}

/** The block actions of the offer (`runBlockAct`): make the routine, or leave it. */
export const OFFER_ACT_KINDS = new Set(["make_routine", "skip_routine"]);

/** `meta.learned` on the line: `{ skillId, how }`. Such a line is silent: it notifies nobody and routes to nobody. */
export const LEARNED_KEY = "learned";

/** True for an agent's "Aprendi a fazer isso" line (`meta.learned`). */
export const isLearnedLine = (meta: Record<string, unknown> | null | undefined) =>
  typeof meta?.[LEARNED_KEY] === "object" && meta[LEARNED_KEY] !== null;

/** How the skill came to be: made in the run, made from how-tos it used again and again, or changed in the run. */
export type LearnedHow = "created" | "promoted" | "updated";

export type LearnedLang = "pt" | "en";

/** When a task repeats, as read from what the person wrote: the routine an offer makes. */
export type Cadence =
  | { kind: "daily"; time: string }
  | { kind: "weekdays"; time: string }
  | { kind: "weekly"; weekday: Weekday; time: string }
  | { kind: "monthly"; day: number; time: string };

type Weekday = "MO" | "TU" | "WE" | "TH" | "FR" | "SA" | "SU";

/** A routine's time when the person named none. */
export const DEFAULT_ROUTINE_TIME = "09:00";

const WEEKDAY_WORDS: [RegExp, Weekday][] = [
  [/segunda|monday/, "MO"],
  [/ter[cç]a|tuesday/, "TU"],
  [/quarta|wednesday/, "WE"],
  [/quinta|thursday/, "TH"],
  [/sexta|friday/, "FR"],
  [/s[aá]bado|saturday/, "SA"],
  [/domingo|sunday/, "SU"],
];

const DAY_NAMES = "segunda|ter[cç]a|quarta|quinta|sexta|s[aá]bado|domingo";
const EN_DAY_NAMES = "monday|tuesday|wednesday|thursday|friday|saturday|sunday";

/** A whole-words pattern: `\b` knows no accented letters ("às", "manhã"). */
const words = (src: string) => new RegExp(`(?<![\\p{L}\\d])(?:${src})(?![\\p{L}\\d])`, "u");

/** "todo dia útil", "de segunda a sexta", "weekdays". */
const WEEKDAYS = words(
  "dias?\\s+[uú]te(?:is|l)|de\\s+segunda\\s+a\\s+sexta|weekdays|every\\s+weekday|business\\s+days?",
);
/** "toda segunda", "todas as segundas", "às sextas", "segundas-feiras", "every monday", "on mondays". */
const ON_WEEKDAY = words(
  `(?:tod[ao]s?|cada)\\s+(?:as\\s+|os\\s+)?(?:${DAY_NAMES})|(?:[àa]s|nas|aos)\\s+(?:${DAY_NAMES})s|(?:${DAY_NAMES})s-feiras|(?:every|each)\\s+(?:${EN_DAY_NAMES})|on\\s+(?:${EN_DAY_NAMES})s`,
);
/** "todo dia 5", "dia 1º de cada mês", "on the 5th of every month". */
const MONTH_DAY = words(
  "tod[ao]\\s+dia\\s+(\\d{1,2})|dia\\s+(\\d{1,2})º?\\s+de\\s+(?:cada|todo)\\s+m[eê]s|the\\s+(\\d{1,2})(?:st|nd|rd|th)?\\s+of\\s+(?:every|each)\\s+month",
);
const MONTHLY = words("todo\\s+m[eê]s|todos\\s+os\\s+meses|mensal(?:mente)?|monthly|every\\s+month|each\\s+month");
const WEEKLY = words("toda\\s+semana|todas\\s+as\\s+semanas|semanal(?:mente)?|weekly|every\\s+week|each\\s+week");
const DAILY = words(
  "todo\\s+dia|todos\\s+os\\s+dias|diariamente|toda\\s+(?:manh[aã]|tarde|noite)|daily|every\\s+(?:day|morning|evening)|each\\s+day",
);

/** The times a request may name: "às 9h", "as 18:00", "9h30", "at 9am", "5:30 pm", "8h". Hour, minutes, am/pm. */
const TIMES = [
  words("(?:[àa]s|at)\\s+(\\d{1,2})(?:[:h](\\d{2}))?\\s*(h|am|pm)?"),
  words("(\\d{1,2})[:h](\\d{2})\\s*(am|pm)?"),
  words("(\\d{1,2})\\s*(h|am|pm)"),
];

/** The time a request names ("às 9h" → "09:00"), or null. */
function timeOf(text: string): string | null {
  for (const [i, re] of TIMES.entries()) {
    const m = re.exec(text);
    if (!m) continue;
    const h0 = Number(m[1]);
    const min = i === 2 ? 0 : Number(m[2] ?? 0);
    const suffix = i === 2 ? m[2] : m[3];
    const h = suffix === "pm" && h0 < 12 ? h0 + 12 : suffix === "am" && h0 === 12 ? 0 : h0;
    if (h > 23 || min > 59) return null;
    return `${String(h).padStart(2, "0")}:${String(min).padStart(2, "0")}`;
  }
  return null;
}

/**
 * The cadence a person's request names, if any ("puxa o relatório toda segunda às 9h", "every day at 8am"). Read in
 * code: only these plain forms count, so "na segunda" (once) or "semana que vem" never become a routine.
 */
export function cadenceOf(raw: string): Cadence | null {
  const text = raw.toLowerCase().replace(/\s+/g, " ");
  const time = timeOf(text) ?? DEFAULT_ROUTINE_TIME;
  if (WEEKDAYS.test(text)) return { kind: "weekdays", time };
  const on = ON_WEEKDAY.exec(text);
  if (on) {
    const day = WEEKDAY_WORDS.find(([re]) => re.test(on[0]))?.[1];
    if (day) return { kind: "weekly", weekday: day, time };
  }
  const monthDay = MONTH_DAY.exec(text);
  if (monthDay) {
    const day = Number(monthDay[1] ?? monthDay[2] ?? monthDay[3]);
    if (day >= 1 && day <= 28) return { kind: "monthly", day, time };
  }
  if (MONTHLY.test(text)) return { kind: "monthly", day: 1, time };
  if (WEEKLY.test(text)) return { kind: "weekly", weekday: "MO", time };
  if (DAILY.test(text)) return { kind: "daily", time };
  return null;
}

/** The routine's schedule as the period picker writes it (no model reads it); the zone is the creator's. */
export function ruleOf(c: Cadence): Omit<ScheduleRule, "timezone"> {
  switch (c.kind) {
    case "daily":
      return { freq: "daily", time: c.time };
    case "weekdays":
      return { freq: "weekly", byWeekday: ["MO", "TU", "WE", "TH", "FR"], time: c.time };
    case "weekly":
      return { freq: "weekly", byWeekday: [c.weekday], time: c.time };
    case "monthly":
      return { freq: "monthly", byMonthDay: [c.day], time: c.time };
  }
}

/** The cadences offered when the request named none: one question, one tap each. */
export const OFFERED_CADENCES: { act: string; cadence: Cadence }[] = [
  { act: "weekdays", cadence: { kind: "weekdays", time: DEFAULT_ROUTINE_TIME } },
  { act: "weekly", cadence: { kind: "weekly", weekday: "MO", time: DEFAULT_ROUTINE_TIME } },
  { act: "monthly", cadence: { kind: "monthly", day: 1, time: DEFAULT_ROUTINE_TIME } },
];

const PT_DAYS: Record<Weekday, string> = {
  MO: "toda segunda",
  TU: "toda terça",
  WE: "toda quarta",
  TH: "toda quinta",
  FR: "toda sexta",
  SA: "todo sábado",
  SU: "todo domingo",
};
const EN_DAYS: Record<Weekday, string> = {
  MO: "every Monday",
  TU: "every Tuesday",
  WE: "every Wednesday",
  TH: "every Thursday",
  FR: "every Friday",
  SA: "every Saturday",
  SU: "every Sunday",
};

const ptTime = (t: string) => {
  const [h, m] = t.split(":");
  return `${Number(h)}h${m === "00" ? "" : m}`;
};

/** "toda segunda às 9h", "every Monday at 09:00". */
export function cadenceWords(c: Cadence, lang: LearnedLang): string {
  if (lang === "pt") {
    const at = `às ${ptTime(c.time)}`;
    if (c.kind === "daily") return `todo dia ${at}`;
    if (c.kind === "weekdays") return `todo dia útil ${at}`;
    if (c.kind === "weekly") return `${PT_DAYS[c.weekday]} ${at}`;
    return `todo dia ${c.day} ${at}`;
  }
  const at = `at ${c.time}`;
  if (c.kind === "daily") return `every day ${at}`;
  if (c.kind === "weekdays") return `every weekday ${at}`;
  if (c.kind === "weekly") return `${EN_DAYS[c.weekday]} ${at}`;
  const nth = c.day === 1 ? "1st" : c.day === 2 ? "2nd" : c.day === 3 ? "3rd" : `${c.day}th`;
  return `on the ${nth} of every month ${at}`;
}

/** The short button for a cadence offered without one named: "Todo dia útil", "Every Monday". */
function cadenceButton(c: Cadence, lang: LearnedLang): string {
  const said = cadenceWords(c, lang).replace(/ (?:às|at) .*$/, "");
  return said.charAt(0).toUpperCase() + said.slice(1);
}

/**
 * The line itself, in plain words: what the agent got better at, never the skill's technical name (ADR 0120, "learning
 * stays quiet"). No semicolons, no em dashes (the copy rules).
 */
export function learnedLine(how: LearnedHow, lang: LearnedLang): string {
  if (lang === "pt") {
    if (how === "updated") return "Aprendi um jeito melhor de fazer isso. Da próxima vez, vai mais rápido.";
    if (how === "promoted") return "Já fiz isso algumas vezes e agora aprendi de vez. Da próxima vez, leva segundos.";
    return "Aprendi a fazer isso. Da próxima vez, leva segundos.";
  }
  if (how === "updated") return "I learned a better way to do this. Next time it goes faster.";
  if (how === "promoted") return "I've done this a few times and now I've got it down. Next time it takes seconds.";
  return "I learned how to do this. Next time it takes seconds.";
}

/** The offer's question after the line: with the cadence the person named, or open when they named none. */
export function offerQuestion(cadence: Cadence | null, lang: LearnedLang): string {
  if (lang === "pt")
    return cadence
      ? `Quer que eu faça isso ${cadenceWords(cadence, "pt")}?`
      : "Quer que eu faça isso sozinho, com frequência?";
  return cadence ? `Want me to do this ${cadenceWords(cadence, "en")}?` : "Want me to do this on my own, regularly?";
}

/** One button of the offer: its server action (`act`) and the cadence it makes, or none for "Agora não". */
export interface OfferButton {
  act: string;
  label: string;
  cadence: Cadence | null;
}

/** The act of "Agora não". */
export const SKIP_ACT = "skip";

/** The offer's buttons: "Sim" for a named cadence, else one per offered cadence; then "Agora não". */
export function offerButtons(cadence: Cadence | null, lang: LearnedLang): OfferButton[] {
  const skip = { act: SKIP_ACT, label: lang === "pt" ? "Agora não" : "Not now", cadence: null };
  if (cadence)
    return [{ act: "yes", label: lang === "pt" ? "Sim, criar rotina" : "Yes, make it a routine", cadence }, skip];
  return [
    ...OFFERED_CADENCES.map((o) => ({ act: o.act, label: cadenceButton(o.cadence, lang), cadence: o.cadence })),
    skip,
  ];
}

/**
 * The offer as a live block (ADR 0113): the buttons while none was pressed, then one line saying what became of it.
 * Every button is a server action (`act`), so the apps draw it with the kit they already have.
 */
export function offerSpec(buttons: OfferButton[], lang: LearnedLang): { parts: Record<string, unknown>[] } {
  const open = buttons.map((b) => `!_acted.${b.act}`).join(" && ");
  return {
    parts: [
      {
        type: "actions",
        align: "start",
        when: open,
        buttons: buttons.map((b, i) => ({ label: b.label, act: b.act, ...(i === 0 ? { primary: true } : {}) })),
      },
      ...buttons.map((b) => ({
        type: "note",
        when: `_acted.${b.act}`,
        text: b.cadence
          ? lang === "pt"
            ? `Rotina criada: ${cadenceWords(b.cadence, "pt")}. Ela está em Rotinas.`
            : `Routine made: ${cadenceWords(b.cadence, "en")}. It's in Routines.`
          : lang === "pt"
            ? "Combinado. Fica guardado para quando você pedir."
            : "Okay. It's saved for when you ask.",
      })),
    ],
  };
}

/** The offer card's title (its artifact's). */
export const offerTitle = (lang: LearnedLang) => (lang === "pt" ? "Virar rotina" : "Make it a routine");

/** The routine's instructions: the skill to use, and the person's request it came from. */
export function routinePrompt(skill: { slug: string }, request: string, lang: LearnedLang): string {
  const asked = request.trim().slice(0, 1000);
  return lang === "pt"
    ? `Use a skill ${skill.slug} para fazer o que foi pedido${asked ? `:\n\n${asked}` : "."}`
    : `Use the skill ${skill.slug} to do what was asked${asked ? `:\n\n${asked}` : "."}`;
}
