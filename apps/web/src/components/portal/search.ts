import { useNavigate, useRouterState } from "@tanstack/react-router";
import { useCallback } from "react";

export type PortalTab = "board" | "posted" | "plan";

export interface PortalSearch {
  client?: string;
  tab?: "posted" | "plan";
  /** The schedule as a calendar instead of its lists. */
  view?: "calendar";
  /** The card open in its dialog. */
  card?: string;
}

/**
 * What the page shows, in the URL, so a link and Back work: one client's board, its Posted list or its strategic
 * schedule (`tab=plan`, `view=calendar` for its calendar), and the card open in its dialog (`card=<id>`).
 */
export function portalSearch(search: Record<string, unknown>): PortalSearch {
  const client =
    typeof search.client === "string" && /^[a-z0-9][a-z0-9-]{0,63}$/.test(search.client) ? search.client : null;
  if (!client) return {};
  const tab = search.tab === "posted" || search.tab === "plan" ? search.tab : undefined;
  const card = typeof search.card === "string" && /^c-[0-9a-f]{6,32}$/.test(search.card) ? search.card : undefined;
  return {
    client,
    ...(tab ? { tab } : {}),
    ...(tab === "plan" && search.view === "calendar" ? { view: "calendar" as const } : {}),
    ...(card ? { card } : {}),
  };
}

/**
 * The client, tab, view and open card the page is on, and the way to another: opening a client is a page of its own
 * in the history (Back returns to the overview), a tab, a view or a card replaces the entry.
 */
export function usePortalSearch() {
  const now = useRouterState({
    select: (s) => JSON.stringify(portalSearch(s.location.search as Record<string, unknown>)),
  });
  const search = JSON.parse(now) as PortalSearch;
  const navigate = useNavigate();
  const go = useCallback(
    (next: PortalSearch, replace = false) => void navigate({ to: ".", replace, search: (() => next) as never }),
    [navigate],
  );
  /** Opens a card's dialog (null closes it), where the page is. */
  const openCard = useCallback(
    (card: string | null) => {
      const { card: _was, ...rest } = JSON.parse(now) as PortalSearch;
      go(card ? { ...rest, card } : rest, true);
    },
    [go, now],
  );
  return {
    client: search.client ?? null,
    tab: (search.tab ?? "board") as PortalTab,
    view: search.view ?? ("board" as const),
    card: search.card ?? null,
    search,
    go,
    openCard,
  };
}
