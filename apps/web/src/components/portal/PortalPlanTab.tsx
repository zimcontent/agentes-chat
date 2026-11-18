import type { PlanCard, PortalItem, PortalListKind, PortalPlan } from "@agenteschat/client";
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
 *
 * With `section="materials"`, the client's materials instead (ADR 9001 §20): the lists the team keeps logins, links
 * and references in, on the same board with no calendar and no stages; nothing there is anyone's work.
 */
export function PortalPlanTab({
  client,
  view,
  changes,
  onOpen,
  onSend,
  section = "plan",
}: {
  client: string;
  view: "board" | "calendar";
  changes: boolean;
  onOpen: (cardId: string) => void;
  /** A card the team approved in Review, sent from its face. */
  onSend?: (card: PlanCard) => void;
  section?: PortalListKind;
}) {
  const { t } = useTranslation();
  const { org } = useOrg();
  const plan = usePortalPlan(org.id, client);
  const [item, setItem] = useState<PortalItem | null>(null);
  if (plan.isLoading) return <LoadingCards count={3} />;
  if (!plan.data) return <ErrorState error={plan.error} onRetry={() => void plan.refetch()} />;
  const materials = section === "materials";
  // Each part shows its own lists; the cards in no list belong to the schedule.
  const shown: PortalPlan = {
    ...plan.data,
    lists: plan.data.lists.filter((l) => l.kind === section),
    unlisted: materials ? [] : plan.data.unlisted,
    loose: materials ? [] : plan.data.loose,
  };
  const elsewhere = plan.data.lists.filter((l) => l.kind !== section);
  const empty = shown.lists.length === 0 && shown.unlisted.length === 0;
  const openItem = (next: PortalItem) => {
    if (changes) return setItem(next);
    const link = portalLink(next.link);
    if (link) window.open(link, "_blank", "noopener,noreferrer");
  };
  return (
    <div className="portal-plan">
      <PortalNotices state={plan.data.state} />
      {materials && !empty && <p className="muted portal-plan__hint">{t("portal.materials.intro")}</p>}
      {view === "calendar" && !materials ? (
        <PlanCalendar plan={shown} onOpen={onOpen} onItem={openItem} />
      ) : (
        <>
          {empty && !changes && (
            <EmptyState
              size="page"
              icon={materials ? "archive" : "layers"}
              title={t(materials ? "portal.materials.empty" : "portal.plan.empty")}
            >
              {materials ? t("portal.materials.intro") : undefined}
            </EmptyState>
          )}
          {empty && changes && (
            <p className="muted portal-plan__hint">
              {materials
                ? `${t("portal.materials.intro")} ${t("portal.materials.emptyText")}`
                : t("portal.plan.emptyText")}
            </p>
          )}
          {(!empty || changes) && (
            <PlanBoard
              plan={shown}
              changes={changes}
              onOpen={onOpen}
              onSend={onSend}
              section={section}
              elsewhere={elsewhere}
            />
          )}
        </>
      )}
      {!materials && <PlanLegend labels={plan.data.labels} changes={changes} />}
      <ItemDialog item={item} onClose={() => setItem(null)} />
    </div>
  );
}
