import type { Database } from "@dougbot/db";
import type { AgendaTone } from "@dougbot/ui/blocks/spec";
import type { ConnectorTriggerDeps } from "../connector-triggers";
import { activeConnections, connectionHeaders } from "../connectors/connections";
import { customScope } from "../connectors/custom";
import { connectOverHttp, type McpSession } from "../connectors/mcp";
import { presetForServer } from "../connectors/presets";
import { zonedParts, zonedTimeForward } from "../cron";
import { hasScope } from "../tools/scopes";

/**
 * The Agenda card reads the Google Calendar of the workspace's Google Calendar connection (ADR 0107: through Composio),
 * in code, with no model (docs/adr/doug-0020-doug-sector-cards.md §3). Only when the right hand itself may read that
 * connection: the card never shows what the agent couldn't tell when asked (ADR 0130 §4). No connection, no card.
 */

/** How long the read may take: a card that waits longer goes out without its agenda. */
export const CALENDAR_READ_MS = 6_000;
/** Events a day's card lists at most. */
export const CALENDAR_EVENTS = 8;

export interface DayEvent {
  /** Null: an all-day event. */
  start: Date | null;
  end: Date | null;
  title: string;
  /** Where: "Google Meet" for a call with a Meet link, else its location. */
  place: string;
  /** Where a click goes: the call's link, else the event's page. */
  link: string | null;
  tone: AgendaTone | null;
}

/** Google's event colors (`colorId` 1–11) as the kit's tones. */
const GOOGLE_TONES: Record<string, AgendaTone> = {
  "1": "purple",
  "2": "green",
  "3": "purple",
  "4": "red",
  "5": "yellow",
  "6": "orange",
  "7": "teal",
  "8": "gray",
  "9": "blue",
  "10": "green",
  "11": "red",
};

const get = (o: unknown, ...path: string[]): unknown =>
  path.reduce<unknown>((v, k) => (v && typeof v === "object" ? (v as Record<string, unknown>)[k] : undefined), o);
const str = (v: unknown) => (typeof v === "string" ? v.trim() : "");
const https = (v: unknown) => {
  const s = str(v);
  return /^https:\/\/\S+$/.test(s) && s.length <= 2000 ? s : null;
};

/** The events of Composio's answer, whatever wraps them (`items`, `data.items`, `event_data`). */
function itemsOf(answer: unknown): unknown[] {
  for (const path of [["items"], ["data", "items"], ["event_data", "event_data"], ["data", "event_data"], ["events"]]) {
    const v = get(answer, ...path);
    if (Array.isArray(v)) return v;
  }
  return [];
}

const timeOf = (v: unknown): Date | null => {
  const s = str(get(v, "dateTime"));
  if (!s) return null;
  const d = new Date(s);
  return Number.isNaN(d.getTime()) ? null : d;
};

/** An events list's answer as the card's events: cancelled ones and ones with no time left out, by start. */
export function eventsOfAnswer(answer: unknown): DayEvent[] {
  const out: DayEvent[] = [];
  for (const item of itemsOf(answer)) {
    if (str(get(item, "status")) === "cancelled") continue;
    const allDay = !!str(get(item, "start", "date")) && !str(get(item, "start", "dateTime"));
    const start = timeOf(get(item, "start"));
    if (!start && !allDay) continue;
    const meet = https(get(item, "hangoutLink"));
    const location = str(get(item, "location")).replace(/\s+/g, " ").slice(0, 60);
    out.push({
      start,
      end: timeOf(get(item, "end")),
      title: (str(get(item, "summary")) || "—").replace(/\s+/g, " ").slice(0, 120),
      place: meet ? "Google Meet" : location,
      link: meet ?? https(get(item, "htmlLink")),
      tone: GOOGLE_TONES[str(get(item, "colorId"))] ?? null,
    });
  }
  return out.sort((a, b) => (a.start?.getTime() ?? 0) - (b.start?.getTime() ?? 0));
}

/** Midnight to midnight of `at`'s day in `zone`, `days` days later. */
export function dayBounds(at: Date, zone: string, days = 0): { from: Date; to: Date } {
  const p = zonedParts(new Date(at.getTime() + days * 86_400_000), zone);
  const from = zonedTimeForward(p.year, p.month, p.day, 0, 0, zone) ?? at;
  const next = zonedParts(new Date(from.getTime() + 26 * 3_600_000), zone);
  const to = zonedTimeForward(next.year, next.month, next.day, 0, 0, zone) ?? new Date(from.getTime() + 86_400_000);
  return { from, to };
}

/** The workspace's Google Calendar connection the right hand may read, or null. */
export async function calendarConnection(db: Database, orgId: string, agentId: string) {
  const found = (await activeConnections(db, orgId))
    .filter((c) => presetForServer(c.serverUrl)?.id === "google-calendar" && c.status === "active")
    .sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime());
  for (const c of found) {
    if (await hasScope(db, orgId, agentId, c.id, customScope(c.id, "read"))) return c;
  }
  return null;
}

/** One day's events through the session (the primary calendar). */
export async function readDay(session: McpSession, from: Date, to: Date): Promise<DayEvent[]> {
  const res = await session.callTool("events_list", {
    calendarId: "primary",
    timeMin: from.toISOString(),
    timeMax: to.toISOString(),
    singleEvents: true,
    orderBy: "startTime",
    maxResults: 50,
  });
  if (res.isError) throw new Error("calendar_read_failed");
  const data = (res as { data?: unknown }).data;
  if (data !== undefined) return eventsOfAnswer(data);
  try {
    return eventsOfAnswer(JSON.parse(res.content));
  } catch {
    return [];
  }
}

export type CalendarReader = (from: Date, to: Date) => Promise<DayEvent[]>;

/**
 * A reader of the right hand's calendar, or null when there is no connection it may read. A read that fails or takes
 * longer than `CALENDAR_READ_MS` gives null: the card is left out, never the brief.
 */
export async function calendarReader(
  deps: ConnectorTriggerDeps | null | undefined,
  orgId: string,
  agentId: string,
): Promise<CalendarReader | null> {
  if (!deps) return null;
  const connection = await calendarConnection(deps.db, orgId, agentId);
  if (!connection) return null;
  return async (from, to) => {
    const read = async () => {
      const session = await (deps.connect ?? connectOverHttp)(connection, await connectionHeaders(deps, connection));
      try {
        return await readDay(session, from, to);
      } finally {
        await session.close().catch(() => undefined);
      }
    };
    const events = await Promise.race([
      read().catch(() => null),
      new Promise<null>((done) => setTimeout(() => done(null), CALENDAR_READ_MS)),
    ]);
    if (!events) throw new Error("calendar_unavailable");
    return events;
  };
}
