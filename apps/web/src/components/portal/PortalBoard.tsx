import type { PortalBoard as Board, PortalCard, PortalItem } from "@agenteschat/client";
import { useDeletePortalCard, useSavePortalCard } from "@agenteschat/client";
import {
  PORTAL_BOARD_COLUMNS,
  PORTAL_STATUS_LOOK,
  type PortalBoardColumn,
  portalErrorText,
  portalLink,
  portalScheduling,
  portalWhen,
} from "@agenteschat/client/lib/portal";
import {
  Button,
  Chip,
  Dialog,
  DialogFooter,
  FactLine,
  Icon,
  type LineFact,
  Menu,
  MenuItem,
  MenuSeparator,
} from "@agenteschat/ui";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { useOrg } from "@/components/org-context";
import { useToast } from "@/lib/toast";
import { CardDialog } from "./CardDialog";
import { ItemDialog } from "./ItemDialog";
import { COLUMN_ICON } from "./PortalOverview";
import { ScheduleDialog } from "./ScheduleDialog";

/**
 * One client's board (ADR 9001), in the task board's columns: To do and In production hold the team's cards, the
 * other four the posts as the portal has them (Waiting for approval: the client's turn; Adjustment asked and
 * Approved: the team's, to change it or to schedule it; Scheduled: nobody's). It scrolls sideways where the columns
 * don't fit. `changes`: the person may give agents work, so the cards carry their actions; everyone else reads.
 */
export function PortalBoard({
  board,
  changes,
  onSend,
}: {
  board: Board;
  changes: boolean;
  onSend: (card: PortalCard) => void;
}) {
  const { t } = useTranslation();
  const [editing, setEditing] = useState<PortalCard | null>(null);
  const [deleting, setDeleting] = useState<PortalCard | null>(null);
  const [editingItem, setEditingItem] = useState<PortalItem | null>(null);
  const [scheduling, setScheduling] = useState<PortalItem | null>(null);
  const cards = (column: PortalBoardColumn) =>
    column === "todo" || column === "doing"
      ? board.cards[column].map((card) => (
          <TeamCard
            key={card.id}
            card={card}
            changes={changes}
            onEdit={() => setEditing(card)}
            onDelete={() => setDeleting(card)}
            onSend={() => onSend(card)}
          />
        ))
      : board.items[column].map((item) => (
          <PostCard
            key={item.id}
            item={item}
            onEdit={changes ? () => setEditingItem(item) : undefined}
            // Only what the client approved can be scheduled, only by who may change the board, and only once:
            // the portal refuses to release a post again.
            onSchedule={changes && column === "approved" && !item.released ? () => setScheduling(item) : undefined}
          />
        ));
  return (
    <>
      <div className="issues-boardframe">
        <div className="issues-boardwrap">
          <div className="issues-board portal-board">
            {PORTAL_BOARD_COLUMNS.map((column) => {
              const list = cards(column);
              const name = t(`portal.columns.${column}`);
              return (
                <section
                  key={column}
                  className="issues-col"
                  aria-label={name}
                  data-attention={(column === "adjusting" && list.length > 0) || undefined}
                >
                  <div className="issues-col__head">
                    <Icon name={COLUMN_ICON[column]} size={16} />
                    <h2>{name}</h2>
                    <span className="tabular">{list.length}</span>
                  </div>
                  <div className="issues-col__cards">
                    {list.length > 0 ? list : <p className="issues-col__empty">{t("portal.empty.column")}</p>}
                  </div>
                </section>
              );
            })}
          </div>
        </div>
      </div>
      <CardDialog open={editing !== null} client={board.client} card={editing} onClose={() => setEditing(null)} />
      <ItemDialog item={editingItem} onClose={() => setEditingItem(null)} />
      <ScheduleDialog item={scheduling} onClose={() => setScheduling(null)} />
      <DeleteCardDialog card={deleting} onClose={() => setDeleting(null)} />
    </>
  );
}

/**
 * A post the team still has to make: its title, type, date, owner, how many files go up with it and its note, then,
 * for who may change it, its menu (move, edit, delete) and "Send for approval", the card's own main action.
 */
function TeamCard({
  card,
  changes,
  onEdit,
  onDelete,
  onSend,
}: {
  card: PortalCard;
  changes: boolean;
  onEdit: () => void;
  onDelete: () => void;
  onSend: () => void;
}) {
  const { t, i18n } = useTranslation();
  const { org } = useOrg();
  const toast = useToast();
  const save = useSavePortalCard(org.id);
  const other = card.state === "todo" ? "doing" : "todo";
  const when = portalWhen(i18n.language, card.date);
  const facts: LineFact[] = [
    ...(when ? [{ key: "date", icon: "calendar" as const, text: when }] : []),
    ...(card.owner ? [{ key: "owner", icon: "person" as const, text: card.owner }] : []),
    ...(card.files.length > 0
      ? [{ key: "files", icon: "attach" as const, text: t("portal.files", { count: card.files.length }) }]
      : []),
  ];
  return (
    <article className="issue-card portal-card" aria-label={card.title}>
      <div className="portal-card__head">
        <span className="issue-card__title">{card.title}</span>
        {changes && (
          <Menu
            align="end"
            trigger={
              <Button
                size="sm"
                variant="ghost"
                iconOnly
                icon="more"
                aria-label={t("portal.actionsOf", { title: card.title })}
              />
            }
          >
            <MenuItem
              icon="move"
              disabled={save.isPending}
              onSelect={() =>
                save.mutate(
                  { cardId: card.id, state: other },
                  { onError: (error) => toast.show(portalErrorText(t, error, i18n.language), "error") },
                )
              }
            >
              {t("portal.moveTo", { column: t(`portal.columns.${other}`) })}
            </MenuItem>
            <MenuItem icon="edit" onSelect={onEdit}>
              {t("portal.edit")}
            </MenuItem>
            <MenuSeparator />
            <MenuItem icon="trash" danger onSelect={onDelete}>
              {t("portal.delete")}
            </MenuItem>
          </Menu>
        )}
      </div>
      <div className="portal-card__chips">
        <Chip>{t(`portal.types.${card.type}`)}</Chip>
      </div>
      <FactLine facts={facts} />
      {card.note && <p className="portal-card__note">{card.note}</p>}
      {changes && (
        <Button size="sm" variant="primary" icon="send" block onClick={onSend}>
          {t("portal.send")}
        </Button>
      )}
    </article>
  );
}

/**
 * A post at the portal: its title, type and where it stands, its date, what it still lacks, and for one the client
 * sent back, what they asked. Everything typed at the portal (title, note, who wrote it) is outside text: plain
 * words only, never formatted. The link opens the post there, in another tab. An approved post carries "Schedule
 * post" (`onSchedule`), with or without a proposed date; one already released (`released`) shows "scheduling…"
 * instead, until the publishing service has it and it moves to Scheduled, which takes a few minutes.
 */
function PostCard({ item, onEdit, onSchedule }: { item: PortalItem; onEdit?: () => void; onSchedule?: () => void }) {
  const { t, i18n } = useTranslation();
  const look = PORTAL_STATUS_LOOK[item.status];
  const when = portalWhen(i18n.language, item.scheduledFor);
  const link = portalLink(item.link);
  const facts: LineFact[] = [
    ...(when ? [{ key: "date", icon: "calendar" as const, text: when }] : []),
    ...(item.editor ? [{ key: "editor", icon: "person" as const, text: item.editor }] : []),
    ...(item.files > 0
      ? [{ key: "files", icon: "attach" as const, text: t("portal.files", { count: item.files }) }]
      : []),
  ];
  const asked = item.lastNote && (item.status === "adjust_requested" || item.status === "adjusting");
  return (
    <article className="issue-card portal-card" aria-label={item.title} data-status={item.status}>
      <div className="portal-card__head">
        <span className="issue-card__title">{item.title}</span>
        {onEdit && (
          <Button
            size="sm"
            variant="ghost"
            iconOnly
            icon="edit"
            aria-label={`${t("portal.edit")}: ${item.title}`}
            title={t("portal.edit")}
            onClick={onEdit}
          />
        )}
      </div>
      <div className="portal-card__chips">
        <Chip>{t(`portal.types.${item.type}`)}</Chip>
        <Chip icon={look.icon} tone={look.tone}>
          {t(`portal.status.${item.status}`)}
        </Chip>
        {portalScheduling(item) && (
          // Neutral, as every state nobody has to act on: the clock and the word say it, in both themes.
          <Chip icon="clock">{t("portal.schedule.pending")}</Chip>
        )}
        {item.missing.map((what) => (
          <Chip key={what} icon="alert">
            {t(`portal.missing.${what}`)}
          </Chip>
        ))}
      </div>
      <FactLine facts={facts} />
      {asked && item.lastNote && (
        <p className="portal-card__note portal-card__note--asked">
          <b>{item.lastNote.by || t("portal.clientAsked")}</b>
          {item.lastNote.text}
        </p>
      )}
      {link && (
        <a className="ac-link small portal-card__link" href={link} target="_blank" rel="noopener noreferrer">
          {t("portal.openAtPortal")}
          <Icon name="external" size={14} />
        </a>
      )}
      {onSchedule && (
        <Button size="sm" variant="primary" icon="calendar" block onClick={onSchedule}>
          {t("portal.schedule.action")}
        </Button>
      )}
    </article>
  );
}

/** "Delete this card?": its files stay in the Drive, only the card leaves the board. */
function DeleteCardDialog({ card, onClose }: { card: PortalCard | null; onClose: () => void }) {
  const { t, i18n } = useTranslation();
  const { org } = useOrg();
  const toast = useToast();
  const remove = useDeletePortalCard(org.id);
  return (
    <Dialog
      open={card !== null}
      onOpenChange={(o) => !o && !remove.isPending && onClose()}
      title={t("portal.card.deleteTitle")}
      description={card ? t("portal.card.deleteText", { title: card.title }) : undefined}
      closeLabel={t("common.close")}
      width={440}
    >
      <DialogFooter>
        <Button disabled={remove.isPending} onClick={onClose}>
          {t("common.cancel")}
        </Button>
        <Button
          variant="danger"
          loading={remove.isPending}
          onClick={() =>
            card &&
            remove.mutate(card.id, {
              onSuccess: () => {
                onClose();
                toast.show(t("portal.card.deleted"));
              },
              onError: (error) => toast.show(portalErrorText(t, error, i18n.language), "error"),
            })
          }
        >
          {t("portal.delete")}
        </Button>
      </DialogFooter>
    </Dialog>
  );
}
