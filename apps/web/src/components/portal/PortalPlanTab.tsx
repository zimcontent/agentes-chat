import type { PortalItem } from "@agenteschat/client";
import { usePortalPlan } from "@agenteschat/client";
import { portalLink } from "@agenteschat/client/lib/portal";
import { EmptyState } from "@agenteschat/ui";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { ErrorState, LoadingCards } from "@/components/Loading";
import { useOrg } from "@/components/org-context";
import { ItemDialog } from "./ItemDialog";
import { PlanBoard } from "./PlanBoard";
import { PlanCalendar } from "./PlanCalendar";
import { PlanLegend } from "./PlanLegend";
import { PortalNotices } from "./PortalNotices";

/**
 * A client's strategic schedule (ADR 9001 §8): its lists as a board, or the same cards on a calendar, with the
 * legend of stages and labels at the foot. A card opens in its dialog (`onOpen`); a post at the portal no card
 * stands for opens the post's own dialog for who may change it, and at the portal for everyone else.
 */
export function PortalPlanTab({
  client,
  view,
  changes,
  onOpen,
}: {
  client: string;
  view: "board" | "calendar";
  changes: boolean;
  onOpen: (cardId: string) => void;
}) {
  const { t } = useTranslation();
  const { org } = useOrg();
  const plan = usePortalPlan(org.id, client);
  const [item, setItem] = useState<PortalItem | null>(null);
  if (plan.isLoading) return <LoadingCards count={3} />;
  if (!plan.data) return <ErrorState error={plan.error} onRetry={() => void plan.refetch()} />;
  const empty = plan.data.lists.length === 0 && plan.data.unlisted.length === 0;
  const openItem = (next: PortalItem) => {
    if (changes) return setItem(next);
    const link = portalLink(next.link);
    if (link) window.open(link, "_blank", "noopener,noreferrer");
  };
  return (
    <div className="portal-plan">
      <PortalNotices state={plan.data.state} />
      {view === "calendar" ? (
        <PlanCalendar plan={plan.data} onOpen={onOpen} onItem={openItem} />
      ) : (
        <>
          {empty && !changes && <EmptyState size="page" icon="layers" title={t("portal.plan.empty")} />}
          {empty && changes && <p className="muted portal-plan__hint">{t("portal.plan.emptyText")}</p>}
          {(!empty || changes) && <PlanBoard plan={plan.data} changes={changes} onOpen={onOpen} />}
        </>
      )}
      <PlanLegend labels={plan.data.labels} changes={changes} />
      <ItemDialog item={item} onClose={() => setItem(null)} />
    </div>
  );
}
