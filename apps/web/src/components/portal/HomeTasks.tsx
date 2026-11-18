import type { PlanCard } from "@agenteschat/client";
import { usePortalMine } from "@agenteschat/client";
import { portalClientName, portalWhen } from "@agenteschat/client/lib/portal";
import { Chip, GroupHeading } from "@agenteschat/ui";
import { Link } from "@tanstack/react-router";
import { useTranslation } from "react-i18next";
import { useOrg } from "@/components/org-context";
import { usePortalOn } from "@/components/SidebarSetup";
import { StageChip } from "./stage";
import "@/pages/portal.css";

/** How many of what comes next Home shows: the rest is on each client's schedule. */
const NEXT_SHOWN = 5;

/**
 * "Your tasks" on Home (ADR 9001 §8): the cards the person is on that aren't out yet, by the day they are to be made:
 * late ones first and standing out, then today's, the next five, and the ones with no production date. Each row says
 * the client, the post, its type and stage, the day it is made and the day it goes out, and opens the card on that
 * client's schedule. Only on a server with an approval portal, and only while the person has something: with nothing
 * to make, Home shows nothing here. Asked again every 5 minutes and when the window comes back.
 */
export function HomeTasks() {
  const { t } = useTranslation();
  const { org } = useOrg();
  // Only in the workspace the portal is (ADR 9001 §18).
  const on = usePortalOn();
  const mine = usePortalMine(org.id, on).data;
  if (!on || !mine) return null;
  const groups = [
    { key: "late" as const, cards: mine.late },
    { key: "today" as const, cards: mine.today },
    { key: "next" as const, cards: mine.next.slice(0, NEXT_SHOWN) },
    { key: "undated" as const, cards: mine.undated },
  ].filter((g) => g.cards.length > 0);
  if (groups.length === 0) return null;
  const count = mine.late.length + mine.today.length + mine.next.length + mine.undated.length;
  return (
    <section className="home-sec home-tasks" aria-label={t("portal.mine.title")}>
      <GroupHeading title={t("portal.mine.title")} count={count} />
      <div className="list-card home-tasks__card">
        {groups.map((g) => (
          <section key={g.key} className="home-tasks__group" data-group={g.key} aria-label={t(`portal.mine.${g.key}`)}>
            <h3 className="home-tasks__name">
              {t(`portal.mine.${g.key}`)}
              <span className="tabular">{g.cards.length}</span>
            </h3>
            <ul className="home-tasks__list">
              {g.cards.map((card) => (
                <TaskRow key={card.id} card={card} />
              ))}
            </ul>
          </section>
        ))}
      </div>
    </section>
  );
}

function TaskRow({ card }: { card: PlanCard }) {
  const { t, i18n } = useTranslation();
  const { org } = useOrg();
  const produce = portalWhen(i18n.language, card.produceOn);
  const post = portalWhen(i18n.language, card.postOn);
  return (
    <li>
      <Link
        className="home-tasks__row"
        to="/org/$orgId/portal"
        params={{ orgId: org.id }}
        search={{ client: card.client, tab: "plan", card: card.id }}
      >
        <span className="home-tasks__text">
          <span className="home-tasks__title">{card.title}</span>
          <span className="home-tasks__meta">
            <span>{portalClientName(card.client)}</span>
            {produce && <span>{t("portal.mine.produce", { when: produce })}</span>}
            {post && <span>{t("portal.mine.post", { when: post })}</span>}
          </span>
        </span>
        <span className="home-tasks__chips">
          <Chip>{t(`portal.types.${card.type}`)}</Chip>
          <StageChip stage={card.stage} review={card.review} />
        </span>
      </Link>
    </li>
  );
}
