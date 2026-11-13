import type { PortalCard } from "@agenteschat/client";
import { isPortalOff, usePortalBoard, usePortalOverview } from "@agenteschat/client";
import { can } from "@agenteschat/client/lib/permissions";
import { portalClientName, portalTotals } from "@agenteschat/client/lib/portal";
import { Button, EmptyState, PageHeader, Segmented } from "@agenteschat/ui";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { ErrorState, LoadingCards } from "@/components/Loading";
import { useOrg } from "@/components/org-context";
import { CardDialog } from "@/components/portal/CardDialog";
import { PortalBoard } from "@/components/portal/PortalBoard";
import { PortalNotices } from "@/components/portal/PortalNotices";
import { PortalOverview } from "@/components/portal/PortalOverview";
import { PortalPosted } from "@/components/portal/PortalPosted";
import { SendDialog } from "@/components/portal/SendDialog";
import { usePortalSearch } from "@/components/portal/search";
import { useRightHandLook } from "@/hooks/useRightHandLook";
import "./issues.css";
import "./portal.css";

/** What "Send for approval" starts from: a card of the board (its fields and files go along), or nothing. */
type Sending = { card: PortalCard | null };

/**
 * The approval portal (ADR 9001): with no client picked, every client at a glance (what waits on the team first);
 * with one (`?client=`), its board from To do to Ready and the list of what was published. Any member reads it;
 * whoever may give agents work (`assign_work`) makes cards, moves them and sends for approval. A server with no
 * portal says so, and one that didn't answer offers another try. While the portal itself doesn't answer, the server
 * shows its last good read: the page says so, with when it was read, and how many changes still wait to reach it.
 */
export function PortalPage() {
  const { t } = useTranslation();
  const { org } = useOrg();
  const { client, tab, go } = usePortalSearch();
  const changes = can(org, "assign_work");
  const overview = usePortalOverview(org.id);
  const board = usePortalBoard(org.id, client);
  const look = useRightHandLook();
  const [creating, setCreating] = useState(false);
  const [sending, setSending] = useState<Sending | null>(null);

  const shown = client ? board : overview;
  const off = isPortalOff(overview.error) || isPortalOff(board.error);
  const clients = overview.data?.clients ?? [];
  const totals = portalTotals(clients);
  const summary = clients.find((c) => c.client === client);
  const known = clients.map((c) => c.client);
  const actions = changes && !off && (client ? board.data : clients.length > 0) && (
    <>
      <Button icon="send" onClick={() => setSending({ card: null })}>
        {t("portal.send")}
      </Button>
      {client && (
        <Button variant="primary" icon="plus" onClick={() => setCreating(true)}>
          {t("portal.newCard")}
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
          <div className="portal-tabs">
            <Segmented
              label={portalClientName(client)}
              value={tab}
              onValueChange={(next) => go(next === "posted" ? { client, tab: "posted" } : { client }, true)}
              options={[
                { value: "board", label: t("portal.board") },
                { value: "posted", label: t("portal.columns.posted"), count: board.data.items.posted.length },
              ]}
            />
          </div>
        )}
      </PageHeader>

      {off ? (
        <EmptyState size="page" icon="approve" title={t("portal.off.title")}>
          {t("portal.off.text")}
        </EmptyState>
      ) : (
        <>
          <PortalNotices state={shown.data?.state} />
          {shown.isLoading && <LoadingCards count={3} />}
          {shown.isError && !shown.data && <ErrorState error={shown.error} onRetry={() => void shown.refetch()} />}
          {!client &&
            overview.data &&
            (clients.length === 0 ? (
              <EmptyState size="page" agent={look} title={t("portal.empty.clients")}>
                {t("portal.empty.clientsText")}
              </EmptyState>
            ) : (
              <PortalOverview clients={clients} totals={totals.counts} />
            ))}
          {client &&
            board.data &&
            (tab === "posted" ? (
              <PortalPosted items={board.data.items.posted} />
            ) : (
              <PortalBoard board={board.data} changes={changes} onSend={(card) => setSending({ card })} />
            ))}
        </>
      )}

      {client && <CardDialog open={creating} client={client} card={null} onClose={() => setCreating(false)} />}
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
