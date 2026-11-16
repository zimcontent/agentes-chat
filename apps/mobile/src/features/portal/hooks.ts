import { useAuthConfig } from "@agenteschat/client";
import { can } from "@agenteschat/client/lib/permissions";
import { portalErrorText } from "@agenteschat/client/lib/portal";
import { portalHere } from "@agenteschat/client/lib/sidebar-items";
import { useCallback } from "react";
import { useTranslation } from "react-i18next";
import { useOrg } from "@/providers/org";
import { useToast } from "@/ui";
import { type PortalWords, portalWords } from "./words";

/**
 * Whether the server's approval portal is this workspace's (ADR 9001 §18), as the web's sidebar decides it: the
 * server has one and the workspace didn't turn it off. Off, the Portal tab says so instead of a board.
 */
export function usePortalOn(): boolean {
  const { org } = useOrg();
  return portalHere(org, useAuthConfig().data?.approvalPortal);
}

/** Whether the server answered whether it has a portal (false while it is being asked). */
export const usePortalKnown = () => useAuthConfig().data !== undefined;

/** The portal's words in the person's language. */
export function usePortalWords(): PortalWords {
  const { i18n } = useTranslation();
  return portalWords(i18n.language);
}

/**
 * What the person may do at the portal: `changes`, whoever may give agents work (lists, cards, moves, sends);
 * `approves`, an administrator, the only one who may approve in the client's place (ADR 9001 §19); `comments`, whoever
 * may post.
 */
export function usePortalRights() {
  const { org } = useOrg();
  return {
    changes: can(org, "assign_work"),
    approves: can(org, "administrator"),
    comments: can(org, "post"),
  };
}

/** A failed portal call as a toast, in the portal's own words when it refused. */
export function usePortalFailed() {
  const { t, i18n } = useTranslation();
  const toast = useToast();
  return useCallback(
    (error: unknown) => toast({ title: portalErrorText(t, error, i18n.language), icon: "x" }),
    [t, i18n.language, toast],
  );
}
