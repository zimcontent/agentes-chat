import type { PortalItem } from "@agenteschat/client";
import {
  portalLink,
  portalMonthName,
  portalPostedAt,
  portalPostedByMonth,
  portalWhen,
} from "@agenteschat/client/lib/portal";
import { Chip, EmptyState, GroupHeading, Icon } from "@agenteschat/ui";
import { useTranslation } from "react-i18next";

/**
 * What was published for a client (ADR 9001), newest first under the month it went out: its date, its title and the
 * way to the published post. Titles are outside text, shown as plain words.
 */
export function PortalPosted({ items }: { items: PortalItem[] }) {
  const { t, i18n } = useTranslation();
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
