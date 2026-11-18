import type {
  PortalBoard as Board,
  PortalCard,
  PortalCardReview,
  PortalCardState,
  PortalItem,
} from "@agenteschat/client";
import { useDeletePortalCard, useMovePortalCardAcross, useMovePortalCardState } from "@agenteschat/client";
import { can } from "@agenteschat/client/lib/permissions";
import {
  PORTAL_BOARD_COLUMNS,
  PORTAL_STATUS_LOOK,
  portalErrorText,
  portalLink,
  portalMovedAcross,
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
import { useId, useState } from "react";
import { useTranslation } from "react-i18next";
import { useOrg } from "@/components/org-context";
import { awayOf } from "@/lib/drop-away";
import { useToast } from "@/lib/toast";
import { useIssueDrag } from "@/pages/issue-drag";
import { ApproveForClientDialog } from "./ApproveForClientDialog";
import {
  BoardColumn,
  BoardFrame,
  type CardDrag,
  CardFace,
  type CardMove,
  CardSlots,
  type DropResult,
} from "./board-parts";
import { useCopyCardLink } from "./card-link";
import { ItemDialog } from "./ItemDialog";
import { COLUMN_ICON } from "./PortalOverview";
import { ScheduleDialog } from "./ScheduleDialog";
import { StageChip } from "./stage";

/** The two columns the team's own cards move between; the others are the portal's to fill. */
const TEAM_COLUMNS: readonly PortalCardState[] = ["todo", "doing"];
const isTeam = (column: string): column is PortalCardState => (TEAM_COLUMNS as readonly string[]).includes(column);

type BoardCard = PortalCard & { review?: PortalCardReview | null };
/** A card the team approved in Review (ADR 9001, addendum 2026-11-18): it sits under Approved, ready to go up. */
const teamApproved = (card: BoardCard) => card.review?.status === "approved";

/**
 * One client's board (ADR 9001), in the task board's columns: To do and In production hold the team's cards, the
 * other four the posts as the portal has them (Waiting for approval: the client's turn; Adjustment asked and
 * Approved: the team's, to change it or to schedule it; Scheduled: nobody's). A team card is dragged between its two
 * columns (a mouse, a finger, or Space and the arrows), shown there at once and put back when the portal refuses;
 * while one moves, the portal's columns show they take none, since the portal decides what is in them. The board's
 * empty space drags it sideways. `changes`: the person may give agents work, so the cards carry their actions and
 * move; everyone else reads.
 *
 * A card the team approved in Review and nobody sent yet leaves its column for Approved, above the posts the client
 * approved, with "Approved by the team" and "Send for approval" (ADR 9001, addendum 2026-11-18): what is ready to go
 * up is where a person looks for what was approved.
 */
export function PortalBoard({
  board,
  changes,
  onOpen,
  onSend,
}: {
  board: Board;
  changes: boolean;
  /** A team card pressed: it opens in the card's dialog. */
  onOpen: (cardId: string) => void;
  onSend: (card: PortalCard) => void;
}) {
  const { t, i18n } = useTranslation();
  const { org } = useOrg();
  const toast = useToast();
  const helpId = useId();
  const move = useMovePortalCardState(org.id, board.client);
  const across = useMovePortalCardAcross(org.id, board.client);
  const [deleting, setDeleting] = useState<PortalCard | null>(null);
  const [editingItem, setEditingItem] = useState<PortalItem | null>(null);
  const [scheduling, setScheduling] = useState<PortalItem | null>(null);
  const [approving, setApproving] = useState<PortalItem | null>(null);
  // Approving in the client's place is an administrator's last resort (ADR 9001 §19).
  const approves = can(org, "administrator");
  const moveTo = (card: PortalCard, state: PortalCardState) =>
    move.mutate(
      { cardId: card.id, state },
      { onError: (error) => toast.show(portalErrorText(t, error, i18n.language), "error") },
    );
  // The team's columns hold what the team is still making: an approved card is drawn under Approved.
  const making = {
    todo: board.cards.todo.filter((c) => !teamApproved(c)),
    doing: board.cards.doing.filter((c) => !teamApproved(c)),
  };
  const ready = [...board.cards.todo, ...board.cards.doing].filter(teamApproved);
  const onDrop = ({ id, from, to }: CardMove): DropResult => {
    const card = [...making.todo, ...making.doing].find((c) => c.id === id);
    // Dropped on the "Materiais do cliente" tab: it leaves the board for the client's materials (ADR 9001 §20).
    if (changes && card && awayOf(to) === "materials") {
      across.mutate(
        { cardId: card.id, kind: "materials", newList: t("portal.materials.newListName") },
        {
          onError: (error) => toast.show(portalErrorText(t, error, i18n.language), "error"),
          onSuccess: (list) => toast.show(portalMovedAcross(t, "materials", card.title, list)),
        },
      );
      return { changed: true };
    }
    // Inside a column the order is the board's own: only a change of column is a move.
    if (!changes || !card || from === to || !isTeam(to)) return { changed: false };
    moveTo(card, to);
    return { changed: true };
  };
  const name = (column: string) => t(`portal.columns.${column as PortalCardState}`);
  const dnd = useIssueDrag<PortalCard>({
    groups: TEAM_COLUMNS.map((id) => ({ id, items: making[id] })),
    layout: "board",
    onDrop,
    away: changes,
    words: {
      picked: (c) => t("portal.plan.drag.picked", { title: c.title }),
      moved: (c, group, position, total) =>
        t("portal.plan.drag.moved", { title: c.title, group: name(group), position, total }),
      dropped: (c, group) => t("portal.plan.drag.dropped", { title: c.title, group: name(group) }),
      canceled: (c) => t("portal.plan.drag.canceled", { title: c.title }),
    },
  });
  return (
    <div ref={dnd.root} className="portal-quadro">
      <p id={helpId} className="ac-visually-hidden">
        {t("portal.plan.drag.help")}
      </p>
      <p className="ac-visually-hidden" aria-live="assertive">
        {dnd.live}
      </p>
      <BoardFrame>
        {PORTAL_BOARD_COLUMNS.map((column) =>
          isTeam(column) ? (
            <BoardColumn
              key={column}
              name={name(column)}
              icon={COLUMN_ICON[column]}
              count={dnd.count(column)}
              countKey={column}
              over={dnd.over === column}
            >
              <CardSlots
                group={column}
                dnd={dnd}
                empty={t("portal.empty.column")}
                render={(card, picked) => (
                  <TeamCard
                    card={card}
                    changes={changes}
                    picked={picked}
                    drag={changes ? { ...dnd.card(card, column), help: helpId } : undefined}
                    onOpen={() => onOpen(card.id)}
                    onMove={() => moveTo(card, card.state === "todo" ? "doing" : "todo")}
                    onDelete={() => setDeleting(card)}
                    onSend={() => onSend(card)}
                  />
                )}
              />
            </BoardColumn>
          ) : (
            <BoardColumn
              key={column}
              name={name(column)}
              icon={COLUMN_ICON[column]}
              count={board.items[column].length + (column === "approved" ? ready.length : 0)}
              // A card is moving: the portal's columns take none.
              closed={dnd.active}
              data-attention={(column === "adjusting" && board.items[column].length > 0) || undefined}
            >
              <div className="issues-col__cards">
                {column === "approved" &&
                  ready.map((card) => (
                    <TeamCard
                      key={card.id}
                      card={card}
                      changes={changes}
                      picked={false}
                      onOpen={() => onOpen(card.id)}
                      onMove={() => moveTo(card, card.state === "todo" ? "doing" : "todo")}
                      onDelete={() => setDeleting(card)}
                      onSend={() => onSend(card)}
                    />
                  ))}
                {board.items[column].length > 0 || (column === "approved" && ready.length > 0) ? (
                  board.items[column].map((item) => (
                    <PostCard
                      key={item.id}
                      item={item}
                      onEdit={changes ? () => setEditingItem(item) : undefined}
                      // Only what the client approved can be scheduled, only by who may change the board, and only
                      // once: the portal refuses to release a post again.
                      onSchedule={
                        changes && column === "approved" && !item.released ? () => setScheduling(item) : undefined
                      }
                      onApprove={approves && column === "approval" ? () => setApproving(item) : undefined}
                    />
                  ))
                ) : (
                  <p className="issues-col__empty">{t("portal.empty.column")}</p>
                )}
              </div>
            </BoardColumn>
          ),
        )}
      </BoardFrame>
      <ItemDialog item={editingItem} onClose={() => setEditingItem(null)} />
      <ScheduleDialog item={scheduling} onClose={() => setScheduling(null)} />
      <ApproveForClientDialog item={approving} onClose={() => setApproving(null)} />
      <DeleteCardDialog card={deleting} onClose={() => setDeleting(null)} />
    </div>
  );
}

/**
 * A post the team still has to make: its title, type, date, owner, how many files go up with it and a mark when it has
 * a note (read once it is open), then, for who may change it, "Delete" at hand, its menu (copy its link, move, edit,
 * delete) and "Send for approval" (plated, not green: green is the page's one main action). Anyone copies its link. A
 * press on the card opens it; it is dragged to the other column, or moved from its menu.
 */
function TeamCard({
  card,
  changes,
  picked,
  drag,
  onOpen,
  onMove,
  onDelete,
  onSend,
}: {
  card: BoardCard;
  changes: boolean;
  picked: boolean;
  drag?: CardDrag;
  onOpen: () => void;
  onMove: () => void;
  onDelete: () => void;
  onSend: () => void;
}) {
  const { t, i18n } = useTranslation();
  const copyLink = useCopyCardLink();
  const other = card.state === "todo" ? "doing" : "todo";
  const when = portalWhen(i18n.language, card.date);
  const facts: LineFact[] = [
    ...(when ? [{ key: "date", icon: "calendar" as const, text: when }] : []),
    ...(card.owner ? [{ key: "owner", icon: "person" as const, text: card.owner }] : []),
    ...(card.files.length > 0
      ? [{ key: "files", icon: "attach" as const, text: t("portal.files", { count: card.files.length }) }]
      : []),
    // What it says is read once it is open: the closed card only says there is something to read.
    ...(card.note || card.description
      ? [{ key: "desc", icon: "document" as const, text: "", title: t("portal.plan.hasDescription") }]
      : []),
  ];
  return (
    <CardFace
      id={card.id}
      title={card.title}
      picked={picked}
      drag={drag}
      onOpen={onOpen}
      headEnd={
        <>
          {changes && (
            <Button
              size="sm"
              variant="ghost"
              iconOnly
              icon="trash"
              aria-label={t("portal.card.deleteOf", { title: card.title })}
              title={t("portal.delete")}
              onClick={onDelete}
            />
          )}
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
            <MenuItem icon="link" onSelect={() => copyLink(card)}>
              {t("portal.card.copyLink")}
            </MenuItem>
            {changes && !teamApproved(card) && (
              <MenuItem icon="move" onSelect={onMove}>
                {t("portal.moveTo", { column: t(`portal.columns.${other}`) })}
              </MenuItem>
            )}
            {changes && (
              <>
                <MenuItem icon="edit" onSelect={onOpen}>
                  {t("portal.edit")}
                </MenuItem>
                <MenuSeparator />
                <MenuItem icon="trash" danger onSelect={onDelete}>
                  {t("portal.delete")}
                </MenuItem>
              </>
            )}
          </Menu>
        </>
      }
      chips={
        <>
          <Chip>{t(`portal.types.${card.type}`)}</Chip>
          {card.review && <StageChip stage={teamApproved(card) ? "approved" : "doing"} review={card.review} />}
        </>
      }
      facts={facts}
    >
      {changes && (
        <Button size="sm" icon="send" block onClick={onSend}>
          {t("portal.send")}
        </Button>
      )}
    </CardFace>
  );
}

/**
 * A post at the portal: its title, type and where it stands, its date, what it still lacks, and for one the client
 * sent back, what they asked. Everything typed at the portal (title, note, who wrote it) is outside text: plain
 * words only, never formatted. The link opens the post there, in another tab. An approved post carries "Schedule
 * post" (`onSchedule`), with or without a proposed date; one already released (`released`) shows "scheduling…"
 * instead, until the publishing service has it and it moves to Scheduled, which takes a few minutes. A post waiting
 * on the client carries "Approve for the client" (`onApprove`) for an administrator, when the client went quiet.
 */
function PostCard({
  item,
  onEdit,
  onSchedule,
  onApprove,
}: {
  item: PortalItem;
  onEdit?: () => void;
  onSchedule?: () => void;
  onApprove?: () => void;
}) {
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
      {onApprove && (
        <Button size="sm" icon="check" block onClick={onApprove}>
          {t("portal.approveForClient.action")}
        </Button>
      )}
    </article>
  );
}

/** "Delete this card?": its files stay in the Drive, only the card leaves the board. `onDeleted` once it left. */
export function DeleteCardDialog({
  card,
  onClose,
  onDeleted,
}: {
  card: Pick<PortalCard, "id" | "title"> | null;
  onClose: () => void;
  onDeleted?: () => void;
}) {
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
                onDeleted?.();
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
