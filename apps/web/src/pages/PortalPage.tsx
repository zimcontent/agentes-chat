import type { PortalCard } from "@agenteschat/client";
import { isPortalOff, usePortalBoard, usePortalOverview } from "@agenteschat/client";
import { can } from "@agenteschat/client/lib/permissions";
import { portalClientName, portalTotals } from "@agenteschat/client/lib/portal";
import { Button, EmptyState, PageHeader, Segmented } from "@agenteschat/ui";
import { useLayoutEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { ErrorState, LoadingCards } from "@/components/Loading";
import { useOrg } from "@/components/org-context";
import { CardDetailDialog } from "@/components/portal/CardDetailDialog";
import { ClientColorMenu } from "@/components/portal/client-color";
import { HiddenClients } from "@/components/portal/client-edit";
import { NewListDialog } from "@/components/portal/NewListDialog";
import { PortalBoard } from "@/components/portal/PortalBoard";
import { PortalNotices } from "@/components/portal/PortalNotices";
import { PortalOverview } from "@/components/portal/PortalOverview";
import { PortalPlanTab } from "@/components/portal/PortalPlanTab";
import { PortalPosted } from "@/components/portal/PortalPosted";
import { SendDialog } from "@/components/portal/SendDialog";
import { usePortalSearch } from "@/components/portal/search";
import { useRightHandLook } from "@/hooks/useRightHandLook";
import { useScrollEdges } from "@/lib/scroll-edges";
import "./issues.css";
import "./portal.css";

/** What "Send for approval" starts from: a card of the board (its fields and files go along), or nothing. */
type Sending = { card: PortalCard | null };

/**
 * The approval portal (ADR 9001): with no client picked, every client at a glance (what waits on the team first);
 * with one (`?client=`), its board from To do to Scheduled, its strategic schedule (`tab=plan`: the team's lists, or
 * a calendar) and the list of what was published. A card opens in its own dialog (`card=<id>`). Any member reads it;
 * whoever may give agents work (`assign_work`) makes lists (the head's "New list" puts one first in the schedule) and
 * cards in them, moves them and sends for approval. A server with no
 * portal says so, and one that didn't answer offers another try. While the portal itself doesn't answer, the server
 * shows its last good read: the page says so, with when it was read, and how many changes still wait to reach it.
 */
export function PortalPage() {
  const { t } = useTranslation();
  const { org } = useOrg();
  const { client, tab, view, card, go, openCard } = usePortalSearch();
  const changes = can(org, "assign_work");
  const overview = usePortalOverview(org.id);
  const board = usePortalBoard(org.id, client);
  const look = useRightHandLook();
  const [newList, setNewList] = useState(false);
  const [sending, setSending] = useState<Sending | null>(null);
  // The tabs' track slides sideways on a phone: its edges fade where there are more tabs (portal.css).
  const tabsRow = useRef<HTMLDivElement>(null);
  const tabsTrack = useRef<HTMLElement | null>(null);
  const tabsShown = Boolean(client && board.data);
  useLayoutEffect(() => {
    tabsTrack.current = tabsShown ? (tabsRow.current?.querySelector<HTMLElement>(".ac-seg") ?? null) : null;
  }, [tabsShown]);
  useScrollEdges(tabsTrack, [tabsShown, tab], "x");

  const shown = client ? board : overview;
  const off = isPortalOff(overview.error) || isPortalOff(board.error);
  const clients = overview.data?.clients ?? [];
  const totals = portalTotals(clients);
  const summary = clients.find((c) => c.client === client);
  const known = clients.map((c) => c.client);
  const actions = changes && !off && (client ? board.data : clients.length > 0) && (
    <>
      {client && <ClientColorMenu client={client} onHidden={() => go({})} />}
      <Button icon="send" title={t("portal.send")} onClick={() => setSending({ card: null })}>
        <span className="portal-act__words">{t("portal.send")}</span>
      </Button>
      {client && (
        <Button variant="primary" icon="plus" title={t("portal.plan.newList")} onClick={() => setNewList(true)}>
          <span className="portal-act__words">{t("portal.plan.newList")}</span>
        </Button>
      )}
    </>
  );

  return (
    <div className="page page--list portal">
      <PageHeader
        title={client ? portalClientName(client) : t("portal.title")}
        meta={
          client
            ? summary
              ? t("portal.open", { count: summary.open })
              : false
            : clients.length > 0
              ? `${t("portal.clients", { count: clients.length })} · ${t("portal.open", { count: totals.open })}`
              : t("portal.subtitle")
        }
        lead={
          client && (
            <Button
              variant="ghost"
              iconOnly
              icon="chevronLeft"
              aria-label={t("portal.allClients")}
              title={t("portal.allClients")}
              onClick={() => go({})}
            />
          )
        }
        actions={actions}
      >
        {client && board.data && (
          <div className="portal-tabs" ref={tabsRow}>
            <Segmented
              label={portalClientName(client)}
              value={tab}
              onValueChange={(next) => go(next === "board" ? { client } : { client, tab: next }, true)}
              options={[
                { value: "board", label: t("portal.board") },
                {
                  value: "plan",
                  // On a phone the short name, so the tabs and the schedule's two views share one row.
                  // On the materials, a card or a list dragged onto it goes back to the schedule (ADR 9001 §20).
                  label: (
                    <span data-drop-away={changes && tab === "materials" ? "plan" : undefined}>
                      <span className="portal-tab__long">{t("portal.plan.tab")}</span>
                      <span className="portal-tab__short">{t("portal.plan.tabShort")}</span>
                    </span>
                  ),
                },
                { value: "posted", label: t("portal.columns.posted"), count: board.data.items.posted.length },
                {
                  value: "materials",
                  // A card or a list dragged onto it from the board or the schedule goes to the materials.
                  label: (
                    <span data-drop-away={changes && tab !== "materials" ? "materials" : undefined}>
                      {t("portal.materials.tab")}
                    </span>
                  ),
                },
              ]}
            />
            {/* The schedule's two views, at the end of its tabs' row: its lists, or a calendar. */}
            {tab === "plan" && (
              <fieldset className="portal-views" aria-label={t("portal.plan.view")}>
                <Button
                  size="sm"
                  variant="ghost"
                  iconOnly
                  icon="grid"
                  aria-label={t("portal.plan.viewBoard")}
                  title={t("portal.plan.viewBoard")}
                  aria-pressed={view === "board"}
                  onClick={() => go({ client, tab: "plan" }, true)}
                />
                <Button
                  size="sm"
                  variant="ghost"
                  iconOnly
                  icon="calendar"
                  aria-label={t("portal.plan.viewCalendar")}
                  title={t("portal.plan.viewCalendar")}
                  aria-pressed={view === "calendar"}
                  onClick={() => go({ client, tab: "plan", view: "calendar" }, true)}
                />
              </fieldset>
            )}
          </div>
        )}
      </PageHeader>

      {off ? (
        <EmptyState size="page" icon="approve" title={t("portal.off.title")}>
          {t("portal.off.text")}
        </EmptyState>
      ) : (
        <>
          {tab !== "plan" && tab !== "materials" && <PortalNotices state={shown.data?.state} />}
          {shown.isLoading && <LoadingCards count={3} />}
          {shown.isError && !shown.data && <ErrorState error={shown.error} onRetry={() => void shown.refetch()} />}
          {!client &&
            overview.data &&
            (clients.length === 0 ? (
              <>
                <EmptyState size="page" agent={look} title={t("portal.empty.clients")}>
                  {t("portal.empty.clientsText")}
                </EmptyState>
                {changes && <HiddenClients hidden={overview.data.hidden ?? []} />}
              </>
            ) : (
              <PortalOverview clients={clients} hidden={changes ? (overview.data.hidden ?? []) : []} />
            ))}
          {client &&
            board.data &&
            (tab === "posted" ? (
              <PortalPosted client={client} items={board.data.items.posted} />
            ) : tab === "plan" || tab === "materials" ? (
              <PortalPlanTab
                key={tab}
                client={client}
                view={view}
                changes={changes}
                onOpen={openCard}
                section={tab === "materials" ? "materials" : "plan"}
              />
            ) : (
              <PortalBoard
                board={board.data}
                changes={changes}
                onOpen={openCard}
                onSend={(card) => setSending({ card })}
              />
            ))}
        </>
      )}

      {/* "New list": made first in the schedule, which then shows it; cards are made in the list itself. */}
      {client && (
        <NewListDialog
          open={newList}
          client={client}
          kind={tab === "materials" ? "materials" : "plan"}
          onClose={() => setNewList(false)}
          onMade={() => {
            setNewList(false);
            go({ client, tab: tab === "materials" ? "materials" : "plan" }, true);
          }}
        />
      )}
      {/* A card opened, from the board or the schedule (`?card=<id>`): closed while it is being sent. */}
      {client && (
        <CardDetailDialog
          client={client}
          cardId={sending ? null : card}
          onClose={() => openCard(null)}
          onSend={(sent) => setSending({ card: sent })}
        />
      )}
      <SendDialog
        open={sending !== null}
        client={sending?.card?.client ?? client}
        clients={known}
        card={sending?.card ?? null}
        onClose={() => setSending(null)}
      />
    </div>
  );
}
