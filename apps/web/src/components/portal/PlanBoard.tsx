import type { PlanCard, PortalLabel, PortalPlan } from "@agenteschat/client";
import { useMovePortalCard, usePortalLists, useSavePortalCard } from "@agenteschat/client";
import {
  PORTAL_NO_LIST,
  portalChecks,
  portalErrorText,
  portalLink,
  portalOrderAt,
  portalWhen,
} from "@agenteschat/client/lib/portal";
import {
  Button,
  Chip,
  Dialog,
  DialogFooter,
  Icon,
  Input,
  type LineFact,
  Menu,
  MenuItem,
  MenuSeparator,
} from "@agenteschat/ui";
import { useId, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { useOrg } from "@/components/org-context";
import { useToast } from "@/lib/toast";
import { useIssueDrag } from "@/pages/issue-drag";
import {
  BoardColumn,
  BoardFrame,
  type CardDrag,
  CardFace,
  type CardMove,
  CardSlots,
  type DropResult,
  useListDrag,
} from "./board-parts";
import { MemberFaces } from "./members";
import { LabelChip, StageChip, stageName } from "./stage";

type Column = { id: string; name: string; cards: PlanCard[]; list: boolean };

/**
 * The strategic schedule as a board (ADR 9001 §8), in the very columns and cards of the client's board: a column per
 * list the team named (usually a week), in the team's order, then the cards in no list when there are some, then
 * "Add a list". Cards move between and inside lists as on the task board (a mouse, a finger, or Space and the
 * arrows; a well shows where one lands, the board scrolls near its edges, Esc gives up), shown where they land at
 * once and put back when the portal refuses. Lists move by their head, or from their menu. The board's empty space
 * drags it sideways. `changes`: the person may give agents work; everyone else reads.
 */
export function PlanBoard({
  plan,
  changes,
  onOpen,
}: {
  plan: PortalPlan;
  changes: boolean;
  onOpen: (cardId: string) => void;
}) {
  const { t, i18n } = useTranslation();
  const { org } = useOrg();
  const toast = useToast();
  const helpId = useId();
  const move = useMovePortalCard(org.id, plan.client);
  const lists = usePortalLists(org.id, plan.client);
  const [renaming, setRenaming] = useState<string | null>(null);
  const [deleting, setDeleting] = useState<Column | null>(null);
  const failed = (error: unknown) => toast.show(portalErrorText(t, error, i18n.language), "error");

  const columns: Column[] = [
    ...plan.lists.map((l) => ({ ...l, list: true })),
    ...(plan.unlisted.length > 0
      ? [{ id: PORTAL_NO_LIST, name: t("portal.plan.noList"), cards: plan.unlisted, list: false }]
      : []),
  ];
  const nameOf = (id: string) => columns.find((c) => c.id === id)?.name ?? "";
  const moveTo = (card: PlanCard, to: string, index: number) => {
    const others = (columns.find((c) => c.id === to)?.cards ?? []).filter((c) => c.id !== card.id);
    move.mutate(
      { cardId: card.id, list: to === PORTAL_NO_LIST ? null : to, order: portalOrderAt(others, index) },
      { onError: failed },
    );
  };
  const onDrop = ({ id, from, to, index, fromIndex }: CardMove): DropResult => {
    const card = columns.flatMap((c) => c.cards).find((c) => c.id === id);
    if (!changes || !card || (from === to && index === fromIndex)) return { changed: false };
    moveTo(card, to, index);
    return { changed: true };
  };
  const dnd = useIssueDrag<PlanCard>({
    groups: columns.map((c) => ({ id: c.id, items: c.cards })),
    layout: "board",
    onDrop,
    words: {
      picked: (c) => t("portal.plan.drag.picked", { title: c.title }),
      moved: (c, group, position, total) =>
        t("portal.plan.drag.moved", { title: c.title, group: nameOf(group), position, total }),
      dropped: (c, group) => t("portal.plan.drag.dropped", { title: c.title, group: nameOf(group) }),
      canceled: (c) => t("portal.plan.drag.canceled", { title: c.title }),
    },
  });

  const ids = plan.lists.map((l) => l.id);
  const reorder = (next: string[]) => {
    if (next.join() !== ids.join()) lists.order.mutate(next, { onError: failed });
  };
  const shift = (id: string, by: -1 | 1) => {
    const i = ids.indexOf(id);
    const j = i + by;
    if (i < 0 || j < 0 || j >= ids.length) return;
    const next = [...ids];
    [next[i], next[j]] = [next[j] as string, id];
    reorder(next);
  };
  const listDrag = useListDrag({ ids, enabled: changes, onOrder: reorder });

  return (
    <div ref={dnd.root} className="plan">
      <p id={helpId} className="ac-visually-hidden">
        {t("portal.plan.drag.help")}
      </p>
      <p className="ac-visually-hidden" aria-live="assertive">
        {dnd.live}
      </p>
      <BoardFrame className="plan-board">
        {columns.map((col, i) => {
          const movable = changes && col.list && renaming !== col.id;
          return (
            <BoardColumn
              key={col.id}
              className="plan-col"
              name={col.name}
              count={dnd.count(col.id)}
              countKey={col.id}
              over={dnd.over === col.id}
              data-list={col.list ? col.id : undefined}
              data-lifted={listDrag.lifted === col.id || undefined}
              data-list-drop={listDrag.drop?.id === col.id ? listDrag.drop.where : undefined}
              headProps={movable ? { ...listDrag.head(col.id), "data-grab": "" } : undefined}
              title={
                renaming === col.id ? (
                  <ListName
                    label={t("portal.plan.listName")}
                    start={col.name}
                    onDone={(name) => {
                      setRenaming(null);
                      if (name && name !== col.name) lists.rename.mutate({ listId: col.id, name }, { onError: failed });
                    }}
                  />
                ) : changes && col.list ? (
                  <h2>
                    <button
                      type="button"
                      className="plan-col__name"
                      title={t("portal.plan.rename")}
                      onClick={() => setRenaming(col.id)}
                    >
                      {col.name}
                    </button>
                  </h2>
                ) : undefined
              }
              headEnd={
                movable && (
                  <Menu
                    align="end"
                    trigger={
                      <Button
                        size="sm"
                        variant="ghost"
                        iconOnly
                        icon="more"
                        aria-label={t("portal.plan.listActions", { name: col.name })}
                      />
                    }
                  >
                    <MenuItem icon="edit" onSelect={() => setRenaming(col.id)}>
                      {t("portal.plan.rename")}
                    </MenuItem>
                    <MenuItem icon="chevronLeft" disabled={i === 0} onSelect={() => shift(col.id, -1)}>
                      {t("portal.plan.moveLeft")}
                    </MenuItem>
                    <MenuItem
                      icon="chevronRight"
                      disabled={i === plan.lists.length - 1}
                      onSelect={() => shift(col.id, 1)}
                    >
                      {t("portal.plan.moveRight")}
                    </MenuItem>
                    <MenuSeparator />
                    <MenuItem icon="trash" danger onSelect={() => setDeleting(col)}>
                      {t("portal.plan.deleteList")}
                    </MenuItem>
                  </Menu>
                )
              }
            >
              <CardSlots
                group={col.id}
                dnd={dnd}
                empty={t("portal.empty.column")}
                render={(card, picked) => (
                  <PlanCardFace
                    card={card}
                    labels={plan.labels}
                    picked={picked}
                    drag={changes ? { ...dnd.card(card, col.id), help: helpId } : undefined}
                    onOpen={() => onOpen(card.id)}
                    moves={
                      changes
                        ? columns
                            .filter((c) => c.id !== col.id)
                            .map((c) => ({ name: c.name, go: () => moveTo(card, c.id, c.cards.length) }))
                        : []
                    }
                  />
                )}
              />
              {changes && col.list && <AddCard client={plan.client} list={col.id} cards={col.cards} />}
            </BoardColumn>
          );
        })}
        {changes && (
          <section className="plan-add" aria-label={t("portal.plan.addList")}>
            <AddList onAdd={(name) => lists.create.mutate(name, { onError: failed })} />
          </section>
        )}
      </BoardFrame>
      <Dialog
        open={deleting !== null}
        onOpenChange={(o) => !o && setDeleting(null)}
        title={t("portal.plan.deleteListTitle")}
        description={deleting ? t("portal.plan.deleteListText", { name: deleting.name }) : undefined}
        closeLabel={t("common.close")}
        width={440}
      >
        <DialogFooter>
          <Button onClick={() => setDeleting(null)}>{t("common.cancel")}</Button>
          <Button
            variant="danger"
            onClick={() => {
              if (deleting) lists.remove.mutate(deleting.id, { onError: failed });
              setDeleting(null);
            }}
          >
            {t("portal.plan.deleteList")}
          </Button>
        </DialogFooter>
      </Dialog>
    </div>
  );
}

/** A list's name being typed: Enter or leaving the field keeps it, Esc gives it up. */
function ListName({ label, start, onDone }: { label: string; start: string; onDone: (name: string | null) => void }) {
  const [name, setName] = useState(start);
  const gone = useRef(false);
  const done = (value: string | null) => {
    if (gone.current) return;
    gone.current = true;
    onDone(value);
  };
  return (
    <Input
      className="issues-col__rename"
      aria-label={label}
      value={name}
      maxLength={80}
      autoFocus
      onChange={(e) => setName(e.target.value)}
      onBlur={() => done(name.trim() || null)}
      onKeyDown={(e) => {
        if (e.key === "Enter") done(name.trim() || null);
        if (e.key === "Escape") done(null);
      }}
    />
  );
}

/** "Add a list" at the board's end: a name, Enter to add; it stays open for the next one. */
function AddList({ onAdd }: { onAdd: (name: string) => void }) {
  const { t } = useTranslation();
  const [open, setOpen] = useState(false);
  const [name, setName] = useState("");
  if (!open) {
    return (
      <Button variant="ghost" icon="plus" block onClick={() => setOpen(true)}>
        {t("portal.plan.addList")}
      </Button>
    );
  }
  return (
    <form
      className="plan-add__form"
      onSubmit={(e) => {
        e.preventDefault();
        if (!name.trim()) return;
        onAdd(name.trim());
        setName("");
      }}
    >
      <Input
        aria-label={t("portal.plan.listName")}
        placeholder={t("portal.plan.listName")}
        value={name}
        maxLength={80}
        autoFocus
        onChange={(e) => setName(e.target.value)}
        onKeyDown={(e) => e.key === "Escape" && setOpen(false)}
      />
      <span className="plan-add__acts">
        <Button type="submit" size="sm" disabled={!name.trim()}>
          {t("portal.plan.addList")}
        </Button>
        <Button
          size="sm"
          variant="ghost"
          iconOnly
          icon="close"
          aria-label={t("common.close")}
          onClick={() => setOpen(false)}
        />
      </span>
    </form>
  );
}

/** "Add a card" at a list's foot: a title, Enter to add at the list's end; it stays open for the next one. */
function AddCard({ client, list, cards }: { client: string; list: string; cards: PlanCard[] }) {
  const { t, i18n } = useTranslation();
  const { org } = useOrg();
  const toast = useToast();
  const save = useSavePortalCard(org.id);
  const [open, setOpen] = useState(false);
  const [title, setTitle] = useState("");
  if (!open) {
    return (
      <Button size="sm" variant="ghost" icon="plus" className="plan-col__add" onClick={() => setOpen(true)}>
        {t("portal.plan.addCard")}
      </Button>
    );
  }
  return (
    <form
      className="plan-add__form"
      onSubmit={(e) => {
        e.preventDefault();
        if (!title.trim()) return;
        save.mutate(
          { client, title: title.trim(), list, order: portalOrderAt(cards, cards.length) },
          { onError: (error) => toast.show(portalErrorText(t, error, i18n.language), "error") },
        );
        setTitle("");
      }}
    >
      <Input
        aria-label={t("portal.plan.cardTitle")}
        placeholder={t("portal.plan.cardTitle")}
        value={title}
        maxLength={120}
        autoFocus
        onChange={(e) => setTitle(e.target.value)}
        onKeyDown={(e) => e.key === "Escape" && setOpen(false)}
      />
      <span className="plan-add__acts">
        <Button type="submit" size="sm" disabled={!title.trim()}>
          {t("portal.plan.addCard")}
        </Button>
        <Button
          size="sm"
          variant="ghost"
          iconOnly
          icon="close"
          aria-label={t("common.close")}
          onClick={() => setOpen(false)}
        />
      </span>
    </form>
  );
}

/**
 * A card of the schedule, in the board's own card: its title, then its type, its stage (the board's chip, with the
 * stage's colour the legend explains) and the team's labels as chips; then what it holds as a line of facts (the day
 * its post goes out, the day it is made, comments, the checklist's progress, files, a description) with who is on it
 * at the line's end; and, once it was sent, the way to its post at the portal. A press opens it; its menu moves it to
 * another list (`moves`), the way that needs neither a drag nor the arrows.
 */
export function PlanCardFace({
  card,
  labels,
  picked = false,
  drag,
  moves = [],
  onOpen,
}: {
  card: PlanCard;
  labels: PortalLabel[];
  picked?: boolean;
  drag?: CardDrag;
  moves?: { name: string; go: () => void }[];
  onOpen: () => void;
}) {
  const { t, i18n } = useTranslation();
  const mine = card.labels.flatMap((id) => labels.find((l) => l.id === id) ?? []);
  const checks = portalChecks(card);
  const post = portalWhen(i18n.language, card.postOn);
  const produce = portalWhen(i18n.language, card.produceOn);
  const link = portalLink(card.link);
  const facts: LineFact[] = [
    ...(post
      ? [{ key: "post", icon: "calendar" as const, text: post, title: t("portal.plan.postOn", { when: post }) }]
      : []),
    ...(produce
      ? [
          {
            key: "produce",
            icon: "clock" as const,
            text: produce,
            title: t("portal.plan.produceOn", { when: produce }),
          },
        ]
      : []),
    ...(card.comments.length > 0
      ? [
          {
            key: "comments",
            icon: "message" as const,
            text: card.comments.length,
            title: t("portal.plan.comments", { count: card.comments.length }),
          },
        ]
      : []),
    ...(checks
      ? [
          {
            key: "checks",
            icon: "checks" as const,
            text: `${checks.done}/${checks.total}`,
            title: t("portal.plan.checks", checks),
            ...(checks.done === checks.total ? { tone: "ok" as const } : {}),
          },
        ]
      : []),
    ...(card.files.length > 0
      ? [
          {
            key: "files",
            icon: "attach" as const,
            text: card.files.length,
            title: t("portal.files", { count: card.files.length }),
          },
        ]
      : []),
    ...(card.description
      ? [{ key: "desc", icon: "document" as const, text: "", title: t("portal.plan.hasDescription") }]
      : []),
  ];
  return (
    <CardFace
      id={card.id}
      title={card.title}
      label={`${card.title}, ${stageName(t, card.stage)}`}
      className="plan-card"
      data-stage={card.stage}
      picked={picked}
      drag={drag}
      onOpen={onOpen}
      headEnd={
        moves.length > 0 && (
          <Menu
            align="end"
            label={t("portal.plan.moveCard")}
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
            {moves.map((m) => (
              <MenuItem key={m.name} icon="move" onSelect={m.go}>
                {t("portal.moveTo", { column: m.name })}
              </MenuItem>
            ))}
          </Menu>
        )
      }
      chips={
        <>
          <Chip>{t(`portal.types.${card.type}`)}</Chip>
          <StageChip stage={card.stage} />
          {mine.map((label) => (
            <LabelChip key={label.id} label={label} />
          ))}
        </>
      }
      facts={facts}
      people={<MemberFaces ids={card.members} className="portal-card__who" />}
    >
      {link && (
        <a className="ac-link small portal-card__link" href={link} target="_blank" rel="noopener noreferrer">
          {t("portal.openAtPortal")}
          <Icon name="external" size={14} />
        </a>
      )}
    </CardFace>
  );
}
