import type { PlanCard } from "@dougbot/client";
import { useAuthConfig, usePortalToSchedule, useSendForApproval } from "@dougbot/client";
import { can } from "@dougbot/client/lib/permissions";
import { portalClientName, portalErrorText } from "@dougbot/client/lib/portal";
import { portalHere } from "@dougbot/client/lib/sidebar-items";
import { useCallback, useMemo } from "react";
import { useTranslation } from "react-i18next";
import { Alert } from "react-native";
import { useOrg } from "@/providers/org";
import { useToast } from "@/ui";
import { useOrgId } from "../shared/hooks";
import { sendInputOf } from "./model";
import { toScheduleRows } from "./schedule";
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

/**
 * Approved posts nobody scheduled yet (ADR 9001, addendum 2026-11-17), for who may schedule them: the web's gate, the
 * portal on here and `assign_work`. Pendentes lists them under "Pronto para agendar" and its tab's badge counts them,
 * both from this one list. Asked nothing while the person may not schedule (`shown` false, no rows).
 */
export function useToSchedule() {
  const orgId = useOrgId();
  const on = usePortalOn();
  const { changes } = usePortalRights();
  const shown = on && changes;
  const list = usePortalToSchedule(orgId, shown);
  const items = useMemo(() => (shown ? toScheduleRows(list.data?.items ?? []) : []), [shown, list.data]);
  return { shown, items };
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

/**
 * "Subir para aprovação" for a card, on its screen and on the board: asked first (the client, how many files), then
 * sent with what the card knows (`sendInputOf`, one press never sends twice); `onStarted` gets the send's job to follow.
 */
export function useSendCard(card: PlanCard, onStarted: (jobId: string) => void) {
  const w = usePortalWords();
  const orgId = useOrgId();
  const failed = usePortalFailed();
  const send = useSendForApproval(orgId);
  const confirm = () =>
    Alert.alert(w.sendTitle(portalClientName(card.client)), w.sendText(card.files.length), [
      { text: w.cancel, style: "cancel" },
      {
        text: w.send,
        onPress: () =>
          send.mutate(sendInputOf(card, `${card.id}-${Date.now().toString(36)}`), {
            onSuccess: (started) => onStarted(started.id),
            onError: failed,
          }),
      },
    ]);
  return { confirm, pending: send.isPending };
}
