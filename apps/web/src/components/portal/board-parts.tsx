import { cx, FactLine, Icon, type IconName, type LineFact, useDragScroll } from "@dougbot/ui";
import {
  type HTMLAttributes,
  type MouseEvent as ReactMouseEvent,
  type ReactNode,
  type PointerEvent as ReactPointerEvent,
  type RefObject,
  useEffect,
  useRef,
  useState,
} from "react";
import { useTranslation } from "react-i18next";
import { awayAt, lightAway } from "@/lib/drop-away";
import type { CardMove, DropResult, IssueDrag } from "@/pages/issue-drag";

export type { CardMove, DropResult };

/**
 * The board's empty space, where a press and a drag slide it sideways (the kit's `useDragScroll` matches the pressed
 * element itself): the board's background, the gaps between columns, a column's own empty area. Never a card, a
 * column's head, a button, a link or a field: those keep their own press, so a pan never starts where a card or a
 * list is picked up.
 */
export const PORTAL_BOARD_SPACE =
  ".issues-boardwrap, .issues-board, .issues-col, .issues-col__cards, .issues-col__empty, .issues-col__drop, .plan-add, .portal-rail";

/** Whether a press on `target` pans the board, rather than picking up a card or a list, or pressing a control. */
export const pansBoard = (target: EventTarget | null) =>
  target instanceof Element && target.matches(PORTAL_BOARD_SPACE);

/**
 * The frame both boards share (ADR 9001): the task board's own sideways scroller, which a mouse drags by its empty
 * space as Trello's (a finger pans it natively, the wheel and the keyboard scroll it as ever). It sits on a canvas
 * of its own, light under the darker columns as on Trello. A board wider than its frame gets a rail above its
 * columns: a full row of empty space to drag it by, there however full the columns are. It is the one bar the board
 * has: a second one at its foot said the same thing twice.
 *
 * On a phone it reads as Trello's app: a column takes the screen less a sliver of the next, a swipe stops on one
 * column at a time, and a row of dots under the board says which one is in view and goes to any other when pressed
 * (`ColumnDots`; the rail, a mouse's shortcut, steps aside there).
 */
export function BoardFrame({ className, children }: { className?: string; children: ReactNode }) {
  const wrap = useRef<HTMLDivElement>(null);
  const [wide, setWide] = useState(false);
  const [names, setNames] = useState<string[]>([]);
  useDragScroll(wrap, PORTAL_BOARD_SPACE);
  useEffect(() => {
    const el = wrap.current;
    if (!el) return;
    const measure = () => {
      setWide(el.scrollWidth > el.clientWidth + 1);
      const next = columnsOf(el).map((c) => c.getAttribute("aria-label") ?? "");
      setNames((was) => (was.join("\n") === next.join("\n") ? was : next));
    };
    measure();
    const watch = typeof ResizeObserver === "function" ? new ResizeObserver(measure) : null;
    watch?.observe(el);
    for (const child of el.children) watch?.observe(child);
    const board = el.querySelector(".portal-board");
    const added = typeof MutationObserver === "function" ? new MutationObserver(measure) : null;
    if (board) added?.observe(board, { childList: true });
    return () => {
      watch?.disconnect();
      added?.disconnect();
    };
  }, []);
  return (
    <div className="issues-boardframe portal-canvas">
      <div className="issues-boardwrap portal-pan" ref={wrap}>
        {/* A mouse's shortcut only: the board scrolls by wheel, keyboard and touch as ever, so it says nothing. */}
        <div className="portal-rail" aria-hidden="true" hidden={!wide}>
          <Icon name="grip" size={16} />
        </div>
        <div className={cx("issues-board portal-board", className)}>{children}</div>
      </div>
      {wide && names.length > 1 && <ColumnDots wrap={wrap} names={names} />}
    </div>
  );
}

/** The board's columns in order (each `BoardColumn` says `data-col`). */
const columnsOf = (wrap: HTMLElement) => [...wrap.querySelectorAll<HTMLElement>("[data-col]")];

/**
 * A dot per column under a board that doesn't fit, as Trello's app shows them: the one in view is filled, and a press
 * on any slides the board to that column.
 */
function ColumnDots({ wrap, names }: { wrap: RefObject<HTMLDivElement | null>; names: string[] }) {
  const { t } = useTranslation();
  const [at, setAt] = useState(0);
  useEffect(() => {
    const el = wrap.current;
    if (!el) return;
    let frame = 0;
    const read = () => {
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(() => {
        const left = el.getBoundingClientRect().left;
        const cols = columnsOf(el);
        let best = 0;
        let gap = Number.POSITIVE_INFINITY;
        cols.forEach((c, i) => {
          const d = Math.abs(c.getBoundingClientRect().left - left);
          if (d < gap) {
            gap = d;
            best = i;
          }
        });
        // At the end of the board the last column is the one read, however far its left edge sits.
        if (el.scrollLeft + el.clientWidth >= el.scrollWidth - 2) best = cols.length - 1;
        setAt(best);
      });
    };
    read();
    el.addEventListener("scroll", read, { passive: true });
    return () => {
      cancelAnimationFrame(frame);
      el.removeEventListener("scroll", read);
    };
  }, [wrap]);
  const go = (i: number) => {
    const el = wrap.current;
    const col = el && columnsOf(el)[i];
    if (!el || !col) return;
    const pad = Number.parseFloat(getComputedStyle(el).scrollPaddingLeft) || 0;
    const left = el.scrollLeft + col.getBoundingClientRect().left - el.getBoundingClientRect().left - pad;
    el.scrollTo({ left, behavior: "smooth" });
  };
  return (
    <nav className="portal-dots" aria-label={t("portal.plan.lists")}>
      {names.map((name, i) => (
        <button
          // biome-ignore lint/suspicious/noArrayIndexKey: two columns may share a name; their place is what tells them apart
          key={i}
          type="button"
          className="portal-dots__dot"
          aria-label={t("portal.plan.goToList", { name })}
          aria-current={i === at || undefined}
          onClick={() => go(i)}
        />
      ))}
    </nav>
  );
}

/**
 * A column of either board: the same panel, head (icon, name, count, what the board puts at its end) and stack of
 * cards. `closed`: a card is moving and this column takes none (the portal decides what is in it).
 */
export function BoardColumn({
  name,
  icon,
  count,
  countKey,
  title,
  headEnd,
  headProps,
  over = false,
  closed = false,
  className,
  children,
  ...rest
}: {
  name: string;
  icon?: IconName;
  count: number;
  /** The drag's group, so its count pops when a card arrives or leaves. */
  countKey?: string;
  /** In place of the plain name (a name pressed to rename it, the field while it is renamed). */
  title?: ReactNode;
  headEnd?: ReactNode;
  headProps?: HTMLAttributes<HTMLDivElement> & Record<`data-${string}`, string | undefined>;
  over?: boolean;
  closed?: boolean;
} & Omit<HTMLAttributes<HTMLElement>, "title">) {
  return (
    <section
      className={cx("issues-col portal-col", over && "is-over", className)}
      aria-label={name}
      data-col
      data-closed={closed || undefined}
      {...rest}
    >
      <div className="issues-col__head" {...headProps}>
        {icon && <Icon name={icon} size={16} />}
        {title ?? <h2>{name}</h2>}
        <span className="tabular" data-count={countKey}>
          {count}
        </span>
        {headEnd && (
          <>
            <span className="issues-col__grow" />
            {headEnd}
          </>
        )}
      </div>
      {children}
    </section>
  );
}

/**
 * A column's cards as the task board's drag wants them: each in its slot, the well where a moving card would land,
 * and what an empty column says.
 */
export function CardSlots<T extends { id: string }>({
  group,
  dnd,
  empty,
  render,
}: {
  group: string;
  dnd: IssueDrag<T>;
  empty: string;
  render: (item: T, picked: boolean) => ReactNode;
}) {
  const entries = dnd.entries(group);
  const shown = entries.some((e) => e.kind === "spot" || e.state !== "hidden");
  return (
    <div className="issues-col__cards" data-drop={group}>
      {entries.map((e) =>
        e.kind === "spot" ? (
          <div key={e.key} className="issue-spot" data-spot style={e.style} aria-hidden="true" />
        ) : (
          <div
            key={e.item.id}
            className="issues-col__slot"
            data-slot={e.item.id}
            hidden={e.state === "hidden" || undefined}
            data-landing={e.state === "landing" || undefined}
          >
            {render(e.item, e.state === "picked")}
          </div>
        ),
      )}
      {!shown && <p className="issues-col__empty">{empty}</p>}
    </div>
  );
}

/** What the drag gives a card (`IssueDrag.card`), with the id of the line that says how to move it by keyboard. */
export type CardDrag = ReturnType<IssueDrag<{ id: string }>["card"]> & { help?: string };

/**
 * A card of either board, in the one look both share: its title beside its own button or menu, a row of chips, a
 * quiet line of facts with the faces of who is on it at its end, then whatever the board adds (a note, a link, its
 * action). With `onOpen` the whole card opens it (a press on a button, a link or a field inside keeps its own job),
 * and Enter does on the focused card. With `drag` it is picked up by a mouse, a finger or Space.
 */
export function CardFace({
  id,
  title,
  label = title,
  headEnd,
  chips,
  facts = [],
  people,
  onOpen,
  onContextMenu,
  drag,
  picked = false,
  className,
  children,
  ...rest
}: {
  id: string;
  title: string;
  /** What a screen reader hears for the card (its title by default). */
  label?: string;
  headEnd?: ReactNode;
  chips?: ReactNode;
  facts?: LineFact[];
  people?: ReactNode;
  onOpen?: () => void;
  /** The card's own menu on a right click. */
  onContextMenu?: (e: ReactMouseEvent) => void;
  drag?: CardDrag;
  picked?: boolean;
  className?: string;
  children?: ReactNode;
} & Record<`data-${string}`, string | undefined>) {
  const active = Boolean(onOpen || drag);
  return (
    <article
      className={cx(
        "issue-card portal-card",
        onOpen && "is-opening",
        drag && "is-movable",
        picked && "is-picked",
        className,
      )}
      aria-label={label}
      aria-describedby={drag?.help}
      tabIndex={active ? 0 : undefined}
      data-card={id}
      draggable={drag?.draggable}
      onDragStart={drag?.onDragStart}
      onPointerDown={drag?.onPointerDown}
      onContextMenu={onContextMenu}
      onClick={(e) => {
        if (onOpen && !(e.target as Element).closest("button, a, input, textarea, select, [role='menu']")) onOpen();
      }}
      onKeyDown={(e) => {
        if (e.target !== e.currentTarget) return;
        drag?.onKeyDown(e);
        if (e.key === "Enter" && !e.defaultPrevented) onOpen?.();
      }}
      {...rest}
    >
      <div className="portal-card__head">
        <span className="issue-card__title">{title}</span>
        {headEnd}
      </div>
      {chips && <div className="portal-card__chips">{chips}</div>}
      {(facts.length > 0 || people) && (
        <div className="portal-card__meta">
          <FactLine facts={facts} />
          {people}
        </div>
      )}
      {children}
    </article>
  );
}

/** `ids` with `id` taken out and put back at `index` among the others: what a list dropped there makes the order. */
export function orderAfterDrop(ids: readonly string[], id: string, index: number): string[] {
  const rest = ids.filter((x) => x !== id);
  if (rest.length === ids.length) return [...ids];
  rest.splice(Math.max(0, Math.min(index, rest.length)), 0, id);
  return rest;
}

const MOUSE_SLOP = 5;
const TOUCH_SLOP = 8;
const HOLD_MS = 260;
const EDGE = 60;
const SCROLL_STEP = 12;

/**
 * Moving the schedule's lists by their head, with a mouse (press and drag) or a finger (hold, then drag): the list
 * follows the pointer sideways, a bar shows between which lists it would land, the board scrolls near its sides and
 * Esc gives it up. A press that doesn't move is still a click (the name pressed to rename it). A press on a button
 * of the kit, a field or a link is never a drag. The list's menu (move left, move right) is the keyboard's way.
 *
 * Reads, under the board: `[data-list="<id>"]` on each column that can move, in order. With `onAway`, a list dropped
 * on a place outside the board marked `[data-drop-away]` (`lib/drop-away.ts`: the other part's tab) goes there with
 * its cards instead.
 */
export function useListDrag({
  ids,
  enabled,
  onOrder,
  onAway,
}: {
  ids: readonly string[];
  enabled: boolean;
  onOrder: (next: string[]) => void;
  onAway?: (id: string, where: string) => void;
}) {
  const [drop, setDrop] = useState<{ id: string; where: "before" | "after" } | null>(null);
  const [lifted, setLifted] = useState<string | null>(null);
  const latest = useRef({ ids, onOrder, onAway });
  latest.current = { ids, onOrder, onAway };
  const stop = useRef<(() => void) | null>(null);
  useEffect(() => () => stop.current?.(), []);

  const onPointerDown = (e: ReactPointerEvent<HTMLElement>, id: string) => {
    if (!enabled || e.button !== 0 || e.ctrlKey || e.metaKey || e.shiftKey || e.altKey || stop.current) return;
    if (e.target instanceof Element && e.target.closest(".ac-btn, input, textarea, select, a")) return;
    const column = e.currentTarget.closest<HTMLElement>("[data-list]");
    const wrap = e.currentTarget.closest<HTMLElement>(".issues-boardwrap");
    if (!column || !wrap) return;
    const touch = e.pointerType === "touch";
    const pointerId = e.pointerId;
    const x0 = e.clientX;
    const y0 = e.clientY;
    const scroll0 = wrap.scrollLeft;
    let x = x0;
    let y = y0;
    let away: string | null = null;
    let started = false;
    let index = latest.current.ids.indexOf(id);
    let frame = 0;
    const hold = touch ? window.setTimeout(() => start(), HOLD_MS) : 0;

    const place = () => {
      column.style.transform = `translateX(${x - x0 + (wrap.scrollLeft - scroll0)}px)`;
      const over = latest.current.onAway ? awayAt(x, y) : null;
      away = over?.where ?? null;
      lightAway(over?.box ?? null);
      if (over) return setDrop(null);
      const others = [...wrap.querySelectorAll<HTMLElement>("[data-list]")].filter((c) => c !== column);
      let at = others.length;
      for (let i = 0; i < others.length; i++) {
        const r = (others[i] as HTMLElement).getBoundingClientRect();
        if (x < r.left + r.width / 2) {
          at = i;
          break;
        }
      }
      index = at;
      const target = others[at] ?? others[at - 1];
      const targetId = target?.dataset.list;
      setDrop(targetId ? { id: targetId, where: at < others.length ? "before" : "after" } : null);
    };
    const tick = () => {
      if (away) {
        frame = requestAnimationFrame(tick);
        return;
      }
      const r = wrap.getBoundingClientRect();
      const was = wrap.scrollLeft;
      if (x > r.right - EDGE) wrap.scrollLeft += SCROLL_STEP;
      else if (x < r.left + EDGE) wrap.scrollLeft -= SCROLL_STEP;
      if (wrap.scrollLeft !== was) place();
      frame = requestAnimationFrame(tick);
    };
    function start() {
      started = true;
      setLifted(id);
      document.body.classList.add("issues-dragging");
      place();
      frame = requestAnimationFrame(tick);
    }
    const end = (commit: boolean) => {
      window.clearTimeout(hold);
      cancelAnimationFrame(frame);
      document.removeEventListener("pointermove", onMove);
      document.removeEventListener("pointerup", onUp);
      document.removeEventListener("pointercancel", onCancel);
      document.removeEventListener("keydown", onKey, true);
      document.removeEventListener("touchmove", onTouch);
      document.body.classList.remove("issues-dragging");
      lightAway(null);
      column.style.transform = "";
      stop.current = null;
      setLifted(null);
      setDrop(null);
      if (!started) return;
      // The press that ends a drag isn't a click on what is under it (the name it would rename).
      const swallow = (click: MouseEvent) => {
        click.stopPropagation();
        click.preventDefault();
      };
      document.addEventListener("click", swallow, { capture: true, once: true });
      window.setTimeout(() => document.removeEventListener("click", swallow, true), 0);
      if (!commit) return;
      if (away) return latest.current.onAway?.(id, away);
      const next = orderAfterDrop(latest.current.ids, id, index);
      if (next.join() !== latest.current.ids.join()) latest.current.onOrder(next);
    };
    const onMove = (m: PointerEvent) => {
      if (m.pointerId !== pointerId) return;
      x = m.clientX;
      y = m.clientY;
      if (!started) {
        const far = Math.hypot(m.clientX - x0, m.clientY - y0);
        // A finger that moves before the hold is scrolling, not picking the list up.
        if (touch) return far > TOUCH_SLOP ? end(false) : undefined;
        if (far < MOUSE_SLOP) return;
        start();
      }
      place();
    };
    const onUp = (u: PointerEvent) => u.pointerId === pointerId && end(true);
    const onCancel = (u: PointerEvent) => u.pointerId === pointerId && end(false);
    const onKey = (k: KeyboardEvent) => {
      if (k.key !== "Escape" || !started) return;
      k.preventDefault();
      k.stopPropagation();
      end(false);
    };
    // While a list is held, a finger moves it instead of the page.
    const onTouch = (t: TouchEvent) => started && t.cancelable && t.preventDefault();
    document.addEventListener("pointermove", onMove);
    document.addEventListener("pointerup", onUp);
    document.addEventListener("pointercancel", onCancel);
    document.addEventListener("keydown", onKey, true);
    document.addEventListener("touchmove", onTouch, { passive: false });
    stop.current = () => end(false);
  };

  return {
    /** The list a moving one would land beside, and on which side. */
    drop,
    /** The list under the pointer. */
    lifted,
    head: (id: string) => ({ onPointerDown: (e: ReactPointerEvent<HTMLElement>) => onPointerDown(e, id) }),
  };
}
