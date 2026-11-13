import type { PortalClientSummary, PortalColumn } from "@agenteschat/client";
import { PORTAL_COLUMNS, portalClientName, portalWhen, sortPortalClients } from "@agenteschat/client/lib/portal";
import { Chip, FactLine, GroupHeading, type IconName, type LineFact } from "@agenteschat/ui";
import { Link } from "@tanstack/react-router";
import type { TFunction } from "i18next";
import { useTranslation } from "react-i18next";
import { useOrg } from "@/components/org-context";

/** Each column's icon: the stages of the team's work, then whose turn it is at the portal. */
export const COLUMN_ICON: Record<PortalColumn, IconName> = {
  todo: "stageTodo",
  doing: "stageProgress",
  approval: "eye",
  adjusting: "alert",
  approved: "check",
  scheduled: "calendar",
  posted: "stageDone",
};

/**
 * How many each column holds, as one quiet line of facts that wraps between them: only adjustments asked call for
 * care (they wait on the team).
 */
const countFacts = (t: TFunction, counts: Record<PortalColumn, number>): LineFact[] =>
  PORTAL_COLUMNS.map((column) => ({
    key: column,
    icon: COLUMN_ICON[column],
    text: (
      <>
        {t(`portal.columns.${column}`)} <b className="tabular">{counts[column]}</b>
      </>
    ),
    ...(column === "adjusting" && counts.adjusting > 0 ? { tone: "warn" as const } : {}),
  }));

/**
 * The whole business at a glance (ADR 9001): every column's total on top, then a card per client with how many it
 * has open, its counts and its next date. Clients who asked for adjustments come first and say so.
 */
export function PortalOverview({
  clients,
  totals,
}: {
  clients: PortalClientSummary[];
  totals: Record<PortalColumn, number>;
}) {
  const { t, i18n } = useTranslation();
  const { org } = useOrg();
  return (
    <section className="portal-overview" aria-label={t("portal.overview")}>
      <GroupHeading title={t("portal.overview")} />
      <div className="portal-totals">
        <FactLine facts={countFacts(t, totals)} />
      </div>
      <div className="portal-clients">
        {sortPortalClients(clients).map((c) => {
          const next = portalWhen(i18n.language, c.next);
          return (
            <Link
              key={c.client}
              to="/org/$orgId/portal"
              params={{ orgId: org.id }}
              search={{ client: c.client }}
              className="ac-card ac-card--interactive portal-client"
              data-attention={c.counts.adjusting > 0 || undefined}
            >
              <span className="portal-client__head">
                <span className="portal-client__name">{portalClientName(c.client)}</span>
                <span className="portal-client__open">{t("portal.open", { count: c.open })}</span>
              </span>
              {c.counts.adjusting > 0 && (
                <Chip icon="alert" tone="waiting">
                  {t("portal.adjustments", { count: c.counts.adjusting })}
                </Chip>
              )}
              <FactLine facts={countFacts(t, c.counts)} />
              {next && <span className="portal-client__next">{t("portal.next", { when: next })}</span>}
            </Link>
          );
        })}
      </div>
    </section>
  );
}
