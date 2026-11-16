/**
 * Revisão's tabs, by who made the work (docs/adr/doug-0015-team-work-review.md), the same on the web and the phone:
 * "Agentes" (what an agent sent) and "Equipe" (what a person of the team sent, filtered by person), and, for whoever
 * sent work themselves, "Meus ajustes" (the changes asked of them). What it is (a video or a design piece) is a filter
 * inside a tab, not a tab of its own. Pure rules: no React here.
 */

export type ReviewWho = "mine" | "agents" | "team";

interface Row {
  status: string;
  medium: "video" | "design";
  sender?: { id: string; name: string } | null;
}

/** Who made it: a person of the team when one sent it, else an agent. */
export const madeBy = (r: Pick<Row, "sender">): "agents" | "team" => (r.sender ? "team" : "agents");

export interface ReviewTab {
  key: ReviewWho;
  /** How many wait: to review, or for "mine" to change. */
  waiting: number;
}

/** The tabs this person sees: "Meus ajustes" only once they sent work themselves; Agentes and Equipe always. */
export function reviewTabsByWho(reviews: readonly Row[], meId: string): ReviewTab[] {
  const mine = reviews.filter((r) => r.sender?.id === meId);
  const waiting = (who: "agents" | "team") =>
    reviews.filter((r) => madeBy(r) === who && r.status === "in_review").length;
  return [
    ...(mine.length > 0 ? [{ key: "mine" as const, waiting: mine.filter((r) => r.status === "changes").length }] : []),
    { key: "agents", waiting: waiting("agents") },
    { key: "team", waiting: waiting("team") },
  ];
}

/**
 * The tab it opens on: "Meus ajustes" while changes wait on them, else the one with work waiting (the agents' first
 * when both have), else Agentes.
 */
export function firstTab(tabs: readonly ReviewTab[]): ReviewWho {
  const at = (key: ReviewWho) => tabs.find((t) => t.key === key)?.waiting ?? 0;
  if (at("mine") > 0) return "mine";
  if (at("agents") === 0 && at("team") > 0) return "team";
  return "agents";
}

/** The people who sent work, for Equipe's filter (the person looking at it aside), with how many of theirs wait. */
export function teamPeople(reviews: readonly Row[], meId: string): { id: string; name: string; waiting: number }[] {
  const people = new Map<string, { id: string; name: string; waiting: number }>();
  for (const r of reviews) {
    if (!r.sender || r.sender.id === meId) continue;
    const p = people.get(r.sender.id) ?? { id: r.sender.id, name: r.sender.name, waiting: 0 };
    if (r.status === "in_review") p.waiting += 1;
    people.set(r.sender.id, p);
  }
  return [...people.values()];
}

export interface ReviewFilter {
  who: ReviewWho;
  /** Equipe: one person's work, or everyone's (null). */
  person: string | null;
  medium: "all" | "video" | "design";
  /** "open": what waits (to review, or for "mine" to change); "all": everything. */
  status: "open" | "all";
}

/** The rows a tab and its filters show, in the list's order. */
export function filterReviews<R extends Row>(reviews: readonly R[], filter: ReviewFilter, meId: string): R[] {
  return reviews.filter((r) => {
    if (filter.who === "mine" ? r.sender?.id !== meId : madeBy(r) !== filter.who) return false;
    if (filter.who === "team" && filter.person && r.sender?.id !== filter.person) return false;
    if (filter.medium !== "all" && r.medium !== filter.medium) return false;
    if (filter.status === "all") return true;
    return filter.who === "mine" ? r.status === "changes" : r.status === "in_review";
  });
}

/** Whether a tab holds both kinds of work, so its Vídeos/Peças filter is worth showing. */
export const mixedIn = (reviews: readonly Row[], who: ReviewWho, meId: string) =>
  new Set(filterReviews(reviews, { who, person: null, medium: "all", status: "all" }, meId).map((r) => r.medium)).size >
  1;
