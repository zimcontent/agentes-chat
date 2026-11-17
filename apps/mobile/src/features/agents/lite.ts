import type { WorkItem } from "@agenteschat/client/lib/working";
import type { DidLine } from "./logic";

/*
 * The light profile's and "Seu time agora"'s rules, pure (unit-tested): what an agent's day holds, how much of its
 * month is used, and one line per agent of what it is doing for the team now.
 */

/** Rows of "Hoje" at most: what it is on, then what it did. */
export const TODAY_SHOWN = 5;

/** The start of `now`'s local day. */
const dayStart = (now: number) => {
  const d = new Date(now);
  d.setHours(0, 0, 0, 0);
  return d.getTime();
};

export type TodayRow = { kind: "work"; key: string; work: WorkItem } | { kind: "did"; key: string; did: DidLine };

/**
 * An agent's day: the work it is on now (its newest first), then what it did for the viewer since midnight, newest
 * first, at most `TODAY_SHOWN` in all.
 */
export function todayRows(work: readonly WorkItem[], did: readonly DidLine[], now: number): TodayRow[] {
  const from = dayStart(now);
  const rows: TodayRow[] = [
    ...work.map((w) => ({ kind: "work" as const, key: w.key, work: w })),
    ...did
      .filter((d) => Date.parse(d.at) >= from)
      .sort((a, b) => b.at.localeCompare(a.at))
      .map((d) => ({ kind: "did" as const, key: d.key, did: d })),
  ];
  return rows.slice(0, TODAY_SHOWN);
}

/**
 * "Este mês" as one share, 0–100: on a plan its busiest window's use, else the budget's (the money spent over the
 * budget where the API gives it). Null when there is nothing to measure.
 */
export function monthShare(input: {
  planUsed: number | null;
  spend: { kind: "money"; fraction: number } | { kind: "percent"; percent: number } | null;
}): number | null {
  if (input.planUsed !== null) return clamp(input.planUsed);
  if (!input.spend) return null;
  return clamp(input.spend.kind === "money" ? input.spend.fraction * 100 : input.spend.percent);
}

const clamp = (n: number) => Math.max(0, Math.min(100, Math.round(n)));

/** What an agent shows in "Seu time agora". */
export type TeamNow =
  | { kind: "working"; work: WorkItem; progress: number | null }
  | { kind: "waiting"; what: string | null }
  | { kind: "free" }
  | { kind: "stopped"; why: "out" | "offline" };

/**
 * One agent's line for the team: waiting on you first (a run stopped on your ok or answer, or a request of its own),
 * then at work (its newest work, a bar when it has a plan), then stopped (out of office, held or without an AI),
 * else free.
 */
export function teamNowOf(input: {
  presence: "online" | "working" | "waiting" | "out" | "offline" | null;
  work: readonly WorkItem[];
  waiting: readonly { title: string }[];
}): TeamNow {
  const stuck = input.work.find((w) => w.waiting);
  if (stuck || input.waiting.length > 0 || input.presence === "waiting")
    return { kind: "waiting", what: stuck?.what ?? input.waiting[0]?.title ?? null };
  const at = input.work[0];
  if (at) return { kind: "working", work: at, progress: progressOf(at.plan) };
  if (input.presence === "out" || input.presence === "offline") return { kind: "stopped", why: input.presence };
  return { kind: "free" };
}

/** A plan's share done, 0–1; null without one. */
export const progressOf = (plan: WorkItem["plan"]): number | null =>
  plan && plan.total > 0 ? Math.max(0, Math.min(1, plan.done / plan.total)) : null;

/** The team's order: at work or waiting on you, then free, then stopped; inside each, as the directory lists them. */
export const TEAM_ORDER: Record<TeamNow["kind"], number> = { waiting: 0, working: 0, free: 1, stopped: 2 };
