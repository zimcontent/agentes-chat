import type { ApprovalPortal } from "@agenteschat/adapters";
import { and, type Database, desc, eq, gt, inArray, lte, schema, sql } from "@agenteschat/db";
import type { AgendaTone } from "@agenteschat/ui/blocks/spec";
import { portalColumnOf, portalToSchedule } from "../approval-portal";
import { listApprovals } from "../approvals";
import { listProposals } from "../context/proposals";
import { cutText } from "../format";
import { taskSeenSql } from "../task-access";
import { listVideoReviews } from "../video-reviews";
import { whatsappAgentState } from "../whatsapp/agent";
import { CALENDAR_EVENTS, type CalendarReader, type DayEvent, dayBounds } from "./google-calendar";
import type { CardWords } from "./words";

/**
 * Each sector the right hand brings as a card (docs/adr/doug-0020-doug-sector-cards.md §2), read in code from stored
 * data (and the calendar through its connection), as the card's person may see it. A sector with nothing gives null:
 * no card. Every card's buttons are an `actions` part; the ones that do something on the server name an `act` this
 * reading also returns, for the server to hold.
 */
export const SECTORS = ["whatsapp", "calendar", "approvals", "proposals", "tasks", "review", "portal"] as const;
export type Sector = (typeof SECTORS)[number];
export const isSector = (v: unknown): v is Sector => SECTORS.includes(v as Sector);

/** What a pressed `act` does on the server (`block_actions.kind`). */
export type CardActKind = "ask_agent" | "whatsapp_mine";

export interface CardAct {
  act: string;
  kind: CardActKind;
  payload: Record<string, unknown>;
}

export interface SectorCard {
  sector: Sector;
  /** The card's title (its artifact's). */
  title: string;
  /** Its pill's number: what waits (0: a pill with no number, as the agenda's). */
  count: number;
  /** What it is about: a card with the same key was already shown, so it isn't shown again the same day. */
  key: string;
  /** Something arrived since `since` that needs the person: worth a card during the day, not only in the brief. */
  urgent: boolean;
  spec: { parts: Record<string, unknown>[] };
  acts: CardAct[];
}

export interface SectorInput {
  db: Database;
  orgId: string;
  agentId: string;
  personId: string;
  zone: string;
  locale: string;
  words: CardWords;
  now: Date;
  /** What "arrived" means: after this. */
  since: Date;
  calendar: CalendarReader | null;
  portal: ApprovalPortal | null;
}

const source = (service: string, title: string, count?: string) => ({
  type: "source",
  service,
  title,
  ...(count ? { count } : {}),
});
const text = (t: string) => ({ type: "text", text: cutText(t.replace(/\s+/g, " ").trim(), 600) });
const actions = (buttons: Record<string, unknown>[]) => ({ type: "actions", align: "start", buttons });

/** The local calendar day of `at` (`2026-11-19`). */
export function sectorDay(at: Date, zone: string) {
  try {
    return new Intl.DateTimeFormat("en-CA", {
      timeZone: zone,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
    }).format(at);
  } catch {
    return at.toISOString().slice(0, 10);
  }
}

/** WhatsApp: the new messages on the numbers the person answers, and the conversation that needs them most. */
async function whatsapp(q: SectorInput): Promise<SectorCard | null> {
  const accounts = (
    await q.db.select().from(schema.whatsappAccounts).where(eq(schema.whatsappAccounts.orgId, q.orgId))
  ).filter((a) => a.people.includes(q.personId));
  if (accounts.length === 0) return null;
  const chats = schema.whatsappChats;
  const rows = await q.db
    .select()
    .from(chats)
    .where(
      and(
        inArray(
          chats.accountId,
          accounts.map((a) => a.id),
        ),
        gt(chats.unread, 0),
      ),
    )
    .orderBy(desc(chats.lastAt))
    .limit(50);
  const total = rows.reduce((n, r) => n + r.unread, 0);
  if (total === 0) return null;
  const accountOf = (id: string) => accounts.find((a) => a.id === id);
  // The one nobody is answering: no agent on it, or the agent off, quiet or handed to a person.
  const waiting = rows.find((r) => {
    const account = accountOf(r.accountId);
    if (!account || r.group || r.lastFromMe) return false;
    return whatsappAgentState(account, r, q.now).state !== "on";
  });
  const w = q.words;
  const head = source("whatsapp", w.whatsapp, w.newCount(total));
  if (!waiting) {
    const first = rows[0];
    const account = first ? accountOf(first.accountId) : undefined;
    return {
      sector: "whatsapp",
      title: w.whatsapp,
      count: total,
      key: `count:${total}`,
      urgent: false,
      spec: {
        parts: [
          head,
          actions([
            { label: w.waOpen, primary: true, open: { place: "whatsapp", ...(account ? { id: account.id } : {}) } },
          ]),
        ],
      },
      acts: [],
    };
  }
  const account = accountOf(waiting.accountId);
  const name = (waiting.name || waiting.jid.split("@")[0] || "?").slice(0, 60);
  const said = cutText(waiting.lastText.replace(/\s+/g, " "), 160);
  const line = waiting.needsPerson ? w.waNeedsYou(name, cutText(waiting.agentNote, 200)) : w.waLead(name, said || "…");
  return {
    sector: "whatsapp",
    title: w.whatsapp,
    count: total,
    key: `chat:${waiting.id}:${waiting.lastAt?.toISOString() ?? ""}`,
    urgent: !!waiting.lastAt && waiting.lastAt > q.since,
    spec: {
      parts: [
        head,
        text(line),
        actions([
          { label: w.waReply, act: "reply", primary: true },
          { label: w.waMine, act: "mine" },
          { label: w.waOpen, open: { place: "whatsapp", id: waiting.accountId, sub: waiting.id } },
        ]),
      ],
    },
    acts: [
      { act: "reply", kind: "ask_agent", payload: { text: w.waAsk(name, account?.label ?? "") } },
      { act: "mine", kind: "whatsapp_mine", payload: { accountId: waiting.accountId, chatId: waiting.id } },
    ],
  };
}

const TONES: AgendaTone[] = ["blue", "green", "orange", "purple", "teal"];

function hhmm(at: Date, zone: string) {
  try {
    return new Intl.DateTimeFormat("en-GB", {
      timeZone: zone,
      hour: "2-digit",
      minute: "2-digit",
      hourCycle: "h23",
    }).format(at);
  } catch {
    return at.toISOString().slice(11, 16);
  }
}

/** "quarta, 19" / "Wednesday 19". */
function dayLabel(at: Date, zone: string, locale: string) {
  const pt = locale.startsWith("pt");
  try {
    const f = (o: Intl.DateTimeFormatOptions) =>
      new Intl.DateTimeFormat(pt ? "pt-BR" : "en-US", { timeZone: zone, ...o }).format(at);
    const weekday = f({ weekday: "long" }).replace(/-feira$/, "");
    return pt ? `${weekday}, ${f({ day: "numeric" })}` : `${weekday} ${f({ day: "numeric" })}`;
  } catch {
    return sectorDay(at, zone);
  }
}

/** The agenda's events for a card: what is left of today, or tomorrow's in the evening when today is over. */
export async function agendaDay(
  read: CalendarReader,
  now: Date,
  zone: string,
): Promise<{ day: Date; events: DayEvent[] } | null> {
  const today = dayBounds(now, zone);
  const left = (await read(today.from, today.to)).filter((e) => !e.start || (e.end ?? e.start) > now);
  if (left.length > 0) return { day: today.from, events: left };
  const hour = Number(hhmm(now, zone).slice(0, 2));
  if (hour < 17) return null;
  const tomorrow = dayBounds(now, zone, 1);
  const next = await read(tomorrow.from, tomorrow.to);
  return next.length > 0 ? { day: tomorrow.from, events: next } : null;
}

/** Agenda: the day's events from the Google Calendar connection, with the next call's link. */
async function calendar(q: SectorInput): Promise<SectorCard | null> {
  if (!q.calendar) return null;
  const found = await agendaDay(q.calendar, q.now, q.zone).catch(() => null);
  if (!found) return null;
  const w = q.words;
  const events = found.events.slice(0, CALENDAR_EVENTS);
  const items = events.map((e, i) => {
    const time = e.start ? hhmm(e.start, q.zone) : w.allDay;
    const span = e.start ? `${time}${e.end ? ` – ${hhmm(e.end, q.zone)}` : ""}` : "";
    const sub = [span, e.place].filter(Boolean).join(" · ");
    return { time, title: e.title, ...(sub ? { sub } : {}), tone: e.tone ?? (TONES[i % TONES.length] as AgendaTone) };
  });
  const next = events.find((e) => e.link && e.start && e.start > q.now) ?? events.find((e) => e.link);
  const day = sectorDay(found.day, q.zone);
  const title = w.agendaTitle(dayLabel(found.day, q.zone, q.locale));
  return {
    sector: "calendar",
    title,
    count: 0,
    key: `day:${day}:${events.length}`,
    urgent: false,
    spec: {
      parts: [
        source("calendar", title),
        {
          type: "agenda",
          items,
          ...(next?.link
            ? {
                note: w.agendaNext(next.title, next.start ? hhmm(next.start, q.zone) : w.allDay),
                link: {
                  label: next.place === "Google Meet" ? w.agendaJoin : w.agendaOpen,
                  open: { place: "link", href: next.link },
                },
              }
            : {}),
        },
      ],
    },
    acts: [],
  };
}

/** Aprovações: what agents asked to do and waits for a person who may decide. */
async function approvals(q: SectorInput): Promise<SectorCard | null> {
  const list = (await listApprovals(q.db, q.personId, q.orgId, { status: "pending", limit: 50 })).filter(
    (a) => (a as { canDecide?: boolean }).canDecide !== false,
  );
  if (list.length === 0) return null;
  const w = q.words;
  const newest = list[0];
  return {
    sector: "approvals",
    title: w.approvals,
    count: list.length,
    key: `newest:${newest?.id}`,
    urgent: !!newest && new Date(newest.createdAt) > q.since,
    spec: {
      parts: [
        source("approvals", w.approvals, w.waitingCount(list.length)),
        text(w.approvalsText(list.length, cutText(list.at(-1)?.title ?? "", 120))),
        actions([{ label: w.approvalsOpen, primary: true, open: { place: "approvals" } }]),
      ],
    },
    acts: [],
  };
}

/** Propostas: changes the agents proposed that this person may decide. */
async function proposals(q: SectorInput): Promise<SectorCard | null> {
  const list = (await listProposals(q.db, q.personId, q.orgId, { status: "pending" })).filter((p) => p.canDecide);
  if (list.length === 0) return null;
  const w = q.words;
  const newest = list[0];
  return {
    sector: "proposals",
    title: w.proposals,
    count: list.length,
    key: `newest:${newest?.id}`,
    urgent: !!newest && new Date(newest.createdAt) > q.since,
    spec: {
      parts: [
        source("proposals", w.proposals, w.waitingCount(list.length)),
        text(w.proposalsText(list.length)),
        actions([{ label: w.proposalsOpen, primary: true, open: { place: "proposals" } }]),
      ],
    },
    acts: [],
  };
}

/** Tarefas: the person's own open tasks that are late or due today. Only in the brief or when asked. */
async function tasks(q: SectorInput): Promise<SectorCard | null> {
  const today = sectorDay(q.now, q.zone);
  const issues = schema.issues;
  const rows = await q.db
    .select({ id: issues.id, dueDate: issues.dueDate })
    .from(issues)
    .where(
      and(
        eq(issues.orgId, q.orgId),
        eq(issues.assigneeType, "person"),
        eq(issues.assigneeId, q.personId),
        inArray(issues.status, ["todo", "in_progress"]),
        lte(issues.dueDate, today),
        taskSeenSql("issues", sql`${q.personId}::text`),
      ),
    )
    .limit(100);
  if (rows.length === 0) return null;
  const late = rows.filter((r) => (r.dueDate ?? today) < today).length;
  const due = rows.length - late;
  const w = q.words;
  return {
    sector: "tasks",
    title: w.tasks,
    count: rows.length,
    key: `day:${today}:${rows.length}`,
    urgent: false,
    spec: {
      parts: [
        source("tasks", w.tasks, w.openCount(rows.length)),
        text(w.tasksText(late, due)),
        actions([
          { label: w.tasksOpen, primary: true, open: { place: "tasks" } },
          { label: w.tasksHelp, act: "help" },
        ]),
      ],
    },
    acts: [{ act: "help", kind: "ask_agent", payload: { text: w.tasksAsk } }],
  };
}

/** Revisão: pieces the agents sent that wait for the team's review. */
async function review(q: SectorInput): Promise<SectorCard | null> {
  const list = (await listVideoReviews({ db: q.db }, q.personId, q.orgId)).filter((r) => r.status === "in_review");
  if (list.length === 0) return null;
  const w = q.words;
  const first = list[0];
  if (!first) return null;
  return {
    sector: "review",
    title: w.review,
    count: list.length,
    key: `newest:${first.id}:${first.version}`,
    urgent: new Date(first.updatedAt) > q.since,
    spec: {
      parts: [
        source("review", w.review, w.waitingCount(list.length)),
        text(w.reviewText(list.length, cutText(first.title, 100))),
        actions([{ label: w.reviewOpen, primary: true, open: { place: "review", id: first.id } }]),
      ],
    },
    acts: [],
  };
}

/** Portal: approved posts nobody scheduled yet, and the changes clients asked for. */
async function portal(q: SectorInput): Promise<SectorCard | null> {
  if (!q.portal) return null;
  const [toSchedule, items] = await Promise.all([portalToSchedule(q.portal), q.portal.items()]);
  const adjusting = items.filter((i) => portalColumnOf(i) === "adjusting");
  const count = toSchedule.length + adjusting.length;
  if (count === 0) return null;
  const w = q.words;
  const changed = [...toSchedule, ...adjusting].some((i) => !!i.updatedAt && new Date(i.updatedAt) > q.since);
  return {
    sector: "portal",
    title: w.portal,
    count,
    key: `count:${toSchedule.length}:${adjusting.length}`,
    urgent: changed,
    spec: {
      parts: [
        source("portal", w.portal, w.waitingCount(count)),
        text(w.portalText(toSchedule.length, adjusting.length)),
        actions([{ label: w.portalOpen, primary: true, open: { place: "portal" } }]),
      ],
    },
    acts: [],
  };
}

const READERS: Record<Sector, (q: SectorInput) => Promise<SectorCard | null>> = {
  whatsapp,
  calendar,
  approvals,
  proposals,
  tasks,
  review,
  portal,
};

/** One sector's card, or null (nothing there, or it couldn't be read: one sector failing never stops the others). */
export async function readSector(sector: Sector, q: SectorInput): Promise<SectorCard | null> {
  return READERS[sector](q).catch(() => null);
}

/** Every sector's card that has something, in the brief's order. */
export async function readSectors(q: SectorInput, only: readonly Sector[] = SECTORS): Promise<SectorCard[]> {
  const cards = await Promise.all(only.map((s) => readSector(s, q)));
  return cards.filter((c): c is SectorCard => c !== null);
}
