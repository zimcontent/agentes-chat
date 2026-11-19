import type { PortalItem } from "@dougbot/client";
import { usePortalPlan } from "@dougbot/client";
import {
  portalLink,
  portalMonthName,
  portalPostedAt,
  portalPostedByMonth,
  portalWhen,
} from "@dougbot/client/lib/portal";
import { Chip, EmptyState, GroupHeading, Icon } from "@dougbot/ui";
import { Link } from "@tanstack/react-router";
import { useTranslation } from "react-i18next";
import { useOrg } from "@/components/org-context";

/**
 * What was published for a client (ADR 9001), newest first under the month it went out: its date, its title and the
 * way to the published post. Beside it, the way to its file in the workspace's own Drive: the first file of the
 * card the post came from, for a post that has one with files. Titles are outside text, shown as plain words.
 */
export function PortalPosted({ client, items }: { client: string; items: PortalItem[] }) {
  const { t, i18n } = useTranslation();
  const { org } = useOrg();
  const plan = usePortalPlan(org.id, client).data;
  // The Drive file of each post: the card tied to it (`item`) carries the files that went up.
  const fileOf = new Map(
    [...(plan?.lists.flatMap((list) => list.cards) ?? []), ...(plan?.unlisted ?? [])].flatMap((card) =>
      card.item && card.files[0] ? [[card.item, card.files[0].id] as const] : [],
    ),
  );
  if (items.length === 0) return <EmptyState size="page" icon="stageDone" title={t("portal.empty.posted")} />;
  return (
    <div className="ac-groups portal-posted">
      {portalPostedByMonth(items).map((group) => {
        const title = group.month ? portalMonthName(i18n.language, group.month) : t("portal.empty.noDate");
        return (
          <section key={group.month ?? "none"} aria-label={title}>
            <GroupHeading title={title} count={group.items.length} />
            <ul className="list-card portal-posted__list">
              {group.items.map((item) => {
                const post = portalLink(item.postUrl) ?? portalLink(item.link);
                const file = fileOf.get(item.id);
                return (
                  <li key={item.id} className="portal-posted__row">
                    <span className="portal-posted__text">
                      <span className="portal-posted__title">{item.title}</span>
                      <span className="portal-posted__meta">
                        <Chip>{t(`portal.types.${item.type}`)}</Chip>
                        {post && (
                          <a className="ac-link small" href={post} target="_blank" rel="noopener noreferrer">
                            {t(item.postUrl ? "portal.seePost" : "portal.openAtPortal")}
                            <Icon name="external" size={14} />
                          </a>
                        )}
                        {file && (
                          <Link
                            className="ac-link small"
                            to="/org/$orgId/drive"
                            params={{ orgId: org.id }}
                            search={{ artifact: file }}
                          >
                            {t("portal.seeDrive")}
                            <Icon name="drive" size={14} />
                          </Link>
                        )}
                      </span>
                    </span>
                    <time className="portal-posted__when tabular">
                      {portalWhen(i18n.language, portalPostedAt(item)) ?? t("portal.empty.noDate")}
                    </time>
                  </li>
                );
              })}
            </ul>
          </section>
        );
      })}
    </div>
  );
}
