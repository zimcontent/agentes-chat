/** A channel as people see it: its display name (free text) when it has one, else its name. `#name` still mentions it. */
export const channelTitle = (c: { name: string; displayName?: string | null }) => c.displayName?.trim() || c.name;

/** Lower case without accents: "Comunicação" finds "comunicacao". */
const fold = (s: string) => s.normalize("NFD").replace(/\p{M}/gu, "").toLowerCase();

/** Whether a channel matches a search: by its name or its display name, ignoring case and accents. */
export function channelMatches(c: { name: string; displayName?: string | null }, query: string) {
  const q = fold(query.trim().replace(/^#/, ""));
  return !q || fold(c.name).includes(q) || (c.displayName ? fold(c.displayName).includes(q) : false);
}
