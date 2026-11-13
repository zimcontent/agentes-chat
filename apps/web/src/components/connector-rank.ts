/**
 * Doug: how well a catalog entry fits a search. 0: the name starts with it, 1: the name contains it, 2: only the key,
 * description or category does, null: no match. A blank search matches everything at 2 (nothing to rank).
 */
export function matchRank(name: string, haystack: string, query: string): 0 | 1 | 2 | null {
  const q = query.trim().toLowerCase();
  if (!q) return 2;
  const n = name.toLowerCase();
  if (n.startsWith(q)) return 0;
  if (n.includes(q)) return 1;
  return haystack.toLowerCase().includes(q) ? 2 : null;
}
