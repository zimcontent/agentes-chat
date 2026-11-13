import { useNavigate, useRouterState } from "@tanstack/react-router";
import { useCallback } from "react";

export interface PortalSearch {
  client?: string;
  tab?: "posted";
}

/** What the page shows, in the URL, so a link and Back work: one client's board, and its Posted list. */
export function portalSearch(search: Record<string, unknown>): PortalSearch {
  const client =
    typeof search.client === "string" && /^[a-z0-9][a-z0-9-]{0,63}$/.test(search.client) ? search.client : null;
  return { ...(client ? { client } : {}), ...(client && search.tab === "posted" ? { tab: "posted" as const } : {}) };
}

/**
 * The client and tab the page is on, and the way to another: opening a client is a page of its own in the history
 * (Back returns to the overview), a tab replaces the entry.
 */
export function usePortalSearch() {
  const client = useRouterState({ select: (s) => portalSearch(s.location.search as Record<string, unknown>).client });
  const tab = useRouterState({ select: (s) => portalSearch(s.location.search as Record<string, unknown>).tab });
  const navigate = useNavigate();
  const go = useCallback(
    (next: PortalSearch, replace = false) => void navigate({ to: ".", replace, search: (() => next) as never }),
    [navigate],
  );
  return { client: client ?? null, tab: tab ?? ("board" as const), go };
}
