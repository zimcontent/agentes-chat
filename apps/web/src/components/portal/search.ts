import { PORTAL_FOCI, type PortalFocus } from "@dougbot/client/lib/portal";
import { useNavigate, useRouterState } from "@tanstack/react-router";
import { useCallback } from "react";

const CLIENT = /^[a-z0-9][a-z0-9-]{0,63}$/;

export type PortalTab = "board" | "posted" | "plan" | "materials";

export interface PortalSearch {
  client?: string;
  tab?: "posted" | "plan" | "materials";
  /** The schedule as a calendar instead of its lists; the overview's pipeline as a list instead of its board. */
  view?: "calendar" | "list";
  /** The overview's pipeline, filtered: one client's work, one person's (`me`: mine), one of the four tiles'. */
  of?: string;
  who?: string;
  stage?: PortalFocus;
  /** The card open in its dialog. */
  card?: string;
}

/**
 * What the page shows, in the URL, so a link and Back work: one client's board, its Posted list, its strategic
 * schedule (`tab=plan`, `view=calendar` for its calendar) or its materials (`tab=materials`), and the card open in its dialog (`card=<id>`). With no
 * client, the overview's pipeline as it is filtered (`of`, `who`, `stage`) and shown (`view=list`).
 */
export function portalSearch(search: Record<string, unknown>): PortalSearch {
  const client = typeof search.client === "string" && CLIENT.test(search.client) ? search.client : null;
  if (!client) {
    const of = typeof search.of === "string" && CLIENT.test(search.of) ? search.of : undefined;
    const who = typeof search.who === "string" && /^[A-Za-z0-9_-]{1,64}$/.test(search.who) ? search.who : undefined;
    const stage = PORTAL_FOCI.find((f) => f === search.stage);
    return {
      ...(of ? { of } : {}),
      ...(who ? { who } : {}),
      ...(stage ? { stage } : {}),
      ...(search.view === "list" ? { view: "list" as const } : {}),
    };
  }
  const tab = search.tab === "posted" || search.tab === "plan" || search.tab === "materials" ? search.tab : undefined;
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
    view: search.view === "calendar" ? ("calendar" as const) : ("board" as const),
    card: search.card ?? null,
    search,
    go,
    openCard,
  };
}
