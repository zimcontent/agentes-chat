/**
 * Início's glance (`HomeGlance`), the pure part: what the editor is on now, and the posts clients sent back.
 */

export interface EditorNow {
  name: string;
  reviewId: string;
  title: string;
  status: "changes" | "in_review" | "approved";
}

/**
 * The editor of the team now: of the videos people sent to Revisão (never mine, never an agent's), the one touched
 * last, and what it says they're on: making changes (changes asked), sent for review, approved. Their first name.
 */
export function editorNow(
  reviews: readonly {
    id: string;
    title: string;
    status: "changes" | "in_review" | "approved";
    updatedAt: string;
    sender?: { id: string; name: string } | null;
  }[],
  meId: string | null | undefined,
): EditorNow | null {
  const theirs = reviews.filter((r) => r.sender && r.sender.id !== meId);
  if (theirs.length === 0) return null;
  const last = theirs.reduce((a, b) => (b.updatedAt > a.updatedAt ? b : a));
  const name = last.sender?.name ?? "";
  return { name: name.split(" ")[0] || name, reviewId: last.id, title: last.title, status: last.status };
}

/** The posts clients sent back for changes at the portal, in all, and the clients with the most first (three). */
export function portalAdjusting(clients: readonly { client: string; counts: { adjusting?: number } }[]): {
  total: number;
  clients: string[];
} {
  const asking = clients
    .map((c) => ({ client: c.client, n: c.counts.adjusting ?? 0 }))
    .filter((c) => c.n > 0)
    .sort((a, b) => b.n - a.n);
  return { total: asking.reduce((sum, c) => sum + c.n, 0), clients: asking.slice(0, 3).map((c) => c.client) };
}

/**
 * Where "Alterações" on Início opens: the one client who asked for changes, on its Quadro (the column of what is
 * being adjusted is there); several, the Portal's list narrowed to them; none, the Portal.
 */
export function adjustmentsHref(clients: readonly { client: string; counts: { adjusting?: number } }[]): string {
  const asking = clients.filter((c) => (c.counts.adjusting ?? 0) > 0);
  const only = asking.length === 1 ? asking[0] : undefined;
  if (only) return `/portal/client/${encodeURIComponent(only.client)}?tab=board`;
  return asking.length > 1 ? "/portal?alteracoes=1" : "/portal";
}
