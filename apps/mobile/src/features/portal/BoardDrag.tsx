import {
  createContext,
  type ReactNode,
  type RefObject,
  use,
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { AppState, type LayoutChangeEvent, StyleSheet, type ViewStyle } from "react-native";
import { GestureDetector, type NativeGesture, usePanGesture } from "react-native-gesture-handler";
import Animated, {
  type AnimatedRef,
  measure,
  type SharedValue,
  useAnimatedReaction,
  useAnimatedRef,
  useAnimatedStyle,
  useSharedValue,
  withTiming,
} from "react-native-reanimated";
import { scheduleOnRN, scheduleOnUI } from "react-native-worklets";
import { haptics } from "@/ui";
import {
  cardShift,
  cardSlotAt,
  columnAt,
  DRAG_GAP,
  DRAG_HOLD_MS,
  DRAG_SCALE,
  DRAG_STILL,
  DRAG_TILT_DEG,
  type DragListGeo,
  listEdge,
  listGrowth,
  PAGE_DWELL_MS,
  PAGE_EVERY_MS,
  pagedTo,
  scrolledBy,
  sideEdge,
  slotTop,
} from "./drag";
import { BOARD, listShift, listSlotAt } from "./model";

/*
 * Dragging on a board as Trello's app drags (ADR 9001): a card, or a list by its head, held still for a moment lifts
 * (tilted, a touch larger, a haptic) and follows the finger; the other cards slide away to open a placeholder where it
 * would land, the board pages to the next list near its sides and a long list scrolls near its top and bottom; letting
 * go flies it into place. A quick swipe still scrolls, a quick tap still opens.
 *
 * The finger is followed on the UI thread: every gesture callback and every card's slide is a worklet reading shared
 * values, so nothing waits on a React render while the finger moves. JS runs at the lift (to draw the lifted copy), at
 * the drop (to save), and while the finger rests at an edge (to scroll). While anything is held nothing changes place
 * in the tree (a view taken out and put back loses the finger): cards slide by a transform, the lifted one is drawn
 * again in an overlay over the board, and the order is saved on the drop.
 */

const IDLE = 0;
/** The finger holds it. */
const HELD = 2;
/** Let go: flying to its place, then waiting for the board to show it there. */
const DROPPING = 3;

const CARD = 0;
const LIST = 1;

type DragState = {
  phase: number;
  kind: number;
  id: string;
  /** Card: the column it came from and its index there. List: its column and its index among the lists. */
  fromL: number;
  fromI: number;
  /** Card: the column and index it would land at. List: the slot among the lists. */
  toL: number;
  toI: number;
  /** The held card's height plus the gap under it: how far the others slide. */
  H: number;
  /** A held list over the trash. */
  trash: boolean;
};
const idle: DragState = { phase: IDLE, kind: CARD, id: "", fromL: -1, fromI: -1, toL: -1, toI: -1, H: 0, trash: false };

type Dims = {
  step: number;
  width: number;
  height: number;
  /** Per column: whether a card can land in it. */
  droppable: boolean[];
  /** Whether a card can land anywhere in a list (the Cronograma) or only at its end (the Quadro). */
  orderable: boolean;
  /** Lists: the columns before the first list ("new list" while it is open), and how many lists there are. */
  lists0: number;
  listCount: number;
  /** How close to the board's foot a held list is over the trash. */
  trashZone: number;
  /** Reduced motion: no tilt, no flights. */
  reduced: boolean;
};

/** What was lifted, for the board to draw it again in the overlay. */
export type Held = { kind: "card" | "list"; id: string; from: number; index: number; width: number; height: number };
export type CardDrop = { id: string; fromL: number; fromI: number; toL: number; toI: number };
export type ListDrop = { id: string; from: number; slot: number; trash: boolean };

type ListEntry = {
  ref: RefObject<{ scrollTo: (o: { y: number; animated?: boolean }) => void } | null>;
  top: number;
  left: number;
  height: number;
  padTop: number;
  /** Where its cards start across the box. */
  padX: number;
  content: number;
  scroll: number;
  /** Each card's place in the list and its height: their tops follow from those (a layout's x and y are not the same
   * thing on every platform, its height is). */
  cards: Map<string, { k: number; h: number }>;
};

export type BoardDragOptions = {
  pager: RefObject<{ scrollToOffset: (o: { offset: number; animated?: boolean }) => void } | null>;
  /** The board's columns, in order: whether each takes a card. */
  droppable: boolean[];
  orderable: boolean;
  step: number;
  width: number;
  height: number;
  lists0?: number;
  listCount?: number;
  trashZone?: number;
  reduced: boolean;
  /** The board's data: when it changes after a drop, the moved card is drawn where it landed and the drag ends. */
  version: unknown;
  /** Saves a card's move; true when a change is on its way (the drag ends when `version` changes). */
  onCardDrop?: (drop: CardDrop) => boolean;
  /** A card held and let go where it was, without moving: its quick actions. */
  onCardHold?: (id: string) => void;
  onListDrop?: (drop: ListDrop) => boolean;
};

export type BoardDrag = ReturnType<typeof useBoardDrag>;
const Ctx = createContext<BoardDrag | null>(null);
export const BoardDragProvider = Ctx.Provider;
/** The board's drag, or null outside a board. */
export const useBoardEngine = () => use(Ctx);
const useEngine = () => {
  const engine = use(Ctx);
  if (!engine) throw new Error("BoardDrag: no board around");
  return engine;
};

/** The longest a drop waits for the board to show the card in its new place before it lets go anyway. */
const SETTLE_MS = 900;
/** The flight into place, and the lift. */
const DROP_MS = 200;
const LIFT_MS = 140;

export function useBoardDrag(o: BoardDragOptions) {
  const opts = useRef(o);
  opts.current = o;
  const boardRef = useAnimatedRef<Animated.View>();
  const state = useSharedValue<DragState>(idle);
  const geo = useSharedValue<(DragListGeo | null)[]>([]);
  const scrolls = useSharedValue<number[]>([]);
  const boardX = useSharedValue(0);
  const finger = useSharedValue({ x: 0, y: 0 });
  const origin = useSharedValue({ x: 0, y: 0 });
  const grab = useSharedValue({ x: 0, y: 0, sx: 0, sy: 0 });
  const moved = useSharedValue(0);
  const edge = useSharedValue({ x: 0, y: 0, L: -1 });
  const ox = useSharedValue(0);
  const oy = useSharedValue(0);
  const lift = useSharedValue(0);
  const ready = useSharedValue(0);
  const dims = useSharedValue<Dims>({
    step: o.step,
    width: o.width,
    height: o.height,
    droppable: o.droppable,
    orderable: o.orderable,
    lists0: o.lists0 ?? 0,
    listCount: o.listCount ?? 0,
    trashZone: o.trashZone ?? 0,
    reduced: o.reduced,
  });
  const droppableKey = o.droppable.join();
  // biome-ignore lint/correctness/useExhaustiveDependencies: the columns' flags change only with their joined key.
  useEffect(() => {
    dims.value = {
      step: o.step,
      width: o.width,
      height: o.height,
      droppable: o.droppable,
      orderable: o.orderable,
      lists0: o.lists0 ?? 0,
      listCount: o.listCount ?? 0,
      trashZone: o.trashZone ?? 0,
      reduced: o.reduced,
    };
  }, [o.step, o.width, o.height, droppableKey, o.orderable, o.lists0, o.listCount, o.trashZone, o.reduced, dims]);

  const [held, setHeld] = useState<(Held & { settling: boolean }) | null>(null);
  /** Set from the lift until a moment after the drop: the press the drag ends on opens nothing. */
  const dragged = useRef(false);
  const boardXjs = useRef(0);
  const lists = useRef(new Map<number, ListEntry>());

  // The lists' layout goes to the UI thread in one write per frame at most, whatever number of cards reported.
  const flushing = useRef<ReturnType<typeof setTimeout> | null>(null);
  const flushNow = useCallback(() => {
    flushing.current = null;
    const out: (DragListGeo | null)[] = [];
    const ys: number[] = [];
    for (const [L, e] of lists.current) {
      const cards: DragListGeo["cards"] = [];
      let y = e.padTop;
      for (const [id, c] of [...e.cards.entries()].sort((a, b) => a[1].k - b[1].k)) {
        cards.push({ id, x: e.padX, y, h: c.h });
        y += c.h + DRAG_GAP;
      }
      out[L] = { top: e.top, left: e.left, height: e.height, padTop: e.padTop, cards };
      ys[L] = e.scroll;
    }
    for (let i = 0; i < out.length; i++) {
      if (out[i] === undefined) out[i] = null;
      if (ys[i] === undefined) ys[i] = 0;
    }
    geo.value = out;
    scrolls.value = ys;
  }, [geo, scrolls]);
  const flush = useCallback(() => {
    if (!flushing.current) flushing.current = setTimeout(flushNow, 16);
  }, [flushNow]);

  // ---- Edges: the board pages while the finger rests at its side; a list scrolls while it is near its top or foot.
  const pageTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const listTimer = useRef<ReturnType<typeof setInterval> | null>(null);
  /** The side the board pages toward now (0: neither), and the list scrolling under the finger and which way. */
  const paging = useRef(0);
  const scrolling = useRef({ y: 0, L: -1 });
  const stopEdges = useCallback(() => {
    if (pageTimer.current) clearTimeout(pageTimer.current);
    if (listTimer.current) clearInterval(listTimer.current);
    pageTimer.current = null;
    listTimer.current = null;
    paging.current = 0;
    scrolling.current = { y: 0, L: -1 };
  }, []);
  const onEdge = useCallback(
    (x: number, y: number, L: number) => {
      // Each timer starts again only when its own side changes. The page under the finger changes the list under it
      // (and its foot), which used to start the dwell again: the board paged every 300 ms past the scroll instead of
      // every second, two lists for one rest at the edge.
      if (x !== paging.current) {
        paging.current = x;
        if (pageTimer.current) clearTimeout(pageTimer.current);
        pageTimer.current = null;
      }
      if (x !== 0 && !pageTimer.current) {
        const page = (wait: number) => {
          pageTimer.current = setTimeout(() => {
            const { step, droppable } = opts.current;
            const to = pagedTo(boardXjs.current, x as -1 | 1, step, droppable.length);
            if (to !== Math.round(boardXjs.current)) {
              opts.current.pager.current?.scrollToOffset({ offset: to, animated: true });
              haptics.selection();
            }
            page(PAGE_EVERY_MS);
          }, wait);
        };
        page(PAGE_DWELL_MS);
      }
      if (y === scrolling.current.y && L === scrolling.current.L) return;
      scrolling.current = { y, L };
      if (listTimer.current) clearInterval(listTimer.current);
      listTimer.current = null;
      const entry = lists.current.get(L);
      if (y !== 0 && entry) {
        listTimer.current = setInterval(() => {
          const next = scrolledBy(entry.scroll, y, entry.content, entry.height);
          if (next === entry.scroll) return;
          entry.scroll = next;
          entry.ref.current?.scrollTo({ y: next, animated: false });
          const ys = [...scrolls.value];
          ys[L] = next;
          scrolls.value = ys;
        }, 16);
      }
    },
    [scrolls],
  );

  // ---- The JS side of a drag: what is drawn at the lift, what is saved at the drop.
  const settleTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const finish = useCallback(() => {
    if (settleTimer.current) clearTimeout(settleTimer.current);
    settleTimer.current = null;
    stopEdges();
    state.value = idle;
    ready.value = 0;
    edge.value = { x: 0, y: 0, L: -1 };
    setHeld(null);
    setTimeout(() => {
      dragged.current = false;
    }, 250);
  }, [state, ready, edge, stopEdges]);
  const overTrash = useCallback(() => haptics.medium(), []);
  const onLift = useCallback((h: Held) => {
    dragged.current = true;
    haptics.medium();
    setHeld({ ...h, settling: false });
  }, []);
  const onDrop = useCallback(
    (kind: number, id: string, fromL: number, fromI: number, toL: number, toI: number, flags: number) => {
      stopEdges();
      const commit = (flags & 1) === 1;
      const still = (flags & 2) === 2;
      const trash = (flags & 4) === 4;
      const o = opts.current;
      let pending = false;
      if (commit && kind === CARD && (toL !== fromL || toI !== fromI))
        pending = o.onCardDrop?.({ id, fromL, fromI, toL, toI }) ?? false;
      if (commit && kind === LIST && (trash || toI !== fromI)) {
        pending = o.onListDrop?.({ id, from: fromI, slot: toI, trash }) ?? false;
        if (trash) pending = false;
      }
      if (pending) {
        haptics.success();
        setHeld((h) => (h ? { ...h, settling: true } : h));
        settleTimer.current = setTimeout(finish, SETTLE_MS);
        return;
      }
      if (commit && !trash) haptics.light();
      finish();
      if (commit && still && kind === CARD) o.onCardHold?.(id);
    },
    [finish, stopEdges],
  );
  // The drop's change reached the board: the card is drawn where it landed, so the slides and the overlay go.
  // biome-ignore lint/correctness/useExhaustiveDependencies: runs when the board's data changes during a drop.
  useLayoutEffect(() => {
    if (held?.settling) finish();
  }, [o.version]);
  useEffect(
    () => () => {
      stopEdges();
      if (settleTimer.current) clearTimeout(settleTimer.current);
      if (flushing.current) clearTimeout(flushing.current);
    },
    [stopEdges],
  );

  // ---- The UI thread: where the held card or list would land, from the finger and the scrolls.
  useAnimatedReaction(
    () => ({ f: finger.value, b: boardX.value, s: scrolls.value, g: geo.value }),
    (now) => {
      const s = state.value;
      if (s.phase !== HELD) return;
      const d = dims.value;
      let ex = sideEdge(now.f.x, d.width) as number;
      let ey = 0;
      let eL = -1;
      if (s.kind === CARD) {
        let L = columnAt(now.b, now.f.x, d.step, d.droppable);
        let I = s.fromI;
        if (L < 0) L = s.fromL;
        else {
          const g = now.g[L];
          if (!d.orderable) {
            let others = 0;
            if (g) for (const c of g.cards) if (c.id !== s.id) others++;
            I = L === s.fromL ? s.fromI : others;
          } else if (g) {
            // The held card's middle, where it is drawn now under the finger.
            const center = now.f.y - grab.value.y + (s.H - DRAG_GAP) / 2 - g.top + (now.s[L] ?? 0);
            I = cardSlotAt(g.cards, s.id, s.H, center, L === s.toL ? s.toI : -1);
            ey = listEdge(now.f.y, g.top, g.height);
            eL = L;
          } else I = 0;
        }
        if (L !== s.toL || I !== s.toI) state.value = { ...s, toL: L, toI: I };
      } else {
        const slot = listSlotAt(now.b - d.lists0 * d.step, now.f.x, d.step, d.listCount);
        const trash = d.trashZone > 0 && now.f.y > d.height - d.trashZone;
        if (trash) ex = 0;
        if (slot !== s.toI || trash !== s.trash) {
          if (trash && !s.trash) scheduleOnRN(overTrash);
          state.value = { ...s, toI: slot, trash };
        }
      }
      const e = edge.value;
      if (e.x !== ex || e.y !== ey || e.L !== eL) {
        edge.value = { x: ex, y: ey, L: eL };
        scheduleOnRN(onEdge, ex, ey, eL);
      }
    },
  );

  const startDrag = useCallback(
    (
      kind: number,
      id: string,
      L: number,
      I: number,
      ref: AnimatedRef<Animated.View>,
      e: { absoluteX: number; absoluteY: number },
    ) => {
      "worklet";
      if (state.value.phase !== IDLE) return;
      const b = measure(boardRef);
      const m = measure(ref);
      if (!b || !m) return;
      origin.value = { x: b.pageX, y: b.pageY };
      ox.value = m.pageX - b.pageX;
      oy.value = m.pageY - b.pageY;
      const fx = e.absoluteX - b.pageX;
      const fy = e.absoluteY - b.pageY;
      grab.value = { x: fx - ox.value, y: fy - oy.value, sx: fx, sy: fy };
      moved.value = 0;
      ready.value = 0;
      state.value = { phase: HELD, kind, id, fromL: L, fromI: I, toL: L, toI: I, H: m.height + DRAG_GAP, trash: false };
      finger.value = { x: fx, y: fy };
      lift.value = withTiming(1, { duration: dims.value.reduced ? 0 : LIFT_MS });
      scheduleOnRN(onLift, {
        kind: kind === CARD ? "card" : "list",
        id,
        from: L,
        index: I,
        width: m.width,
        height: m.height,
      } as Held);
    },
    [state, boardRef, origin, ox, oy, grab, moved, ready, finger, lift, dims, onLift],
  );

  const followDrag = useCallback(
    (id: string, e: { absoluteX: number; absoluteY: number }) => {
      "worklet";
      const s = state.value;
      if (s.phase !== HELD || s.id !== id) return;
      const fx = e.absoluteX - origin.value.x;
      const fy = e.absoluteY - origin.value.y;
      const g = grab.value;
      ox.value = fx - g.x;
      oy.value = fy - g.y;
      const far = Math.hypot(fx - g.sx, fy - g.sy);
      if (far > moved.value) moved.value = far;
      finger.value = { x: fx, y: fy };
    },
    [state, origin, grab, ox, oy, moved, finger],
  );

  const endDrag = useCallback(
    (id: string, canceled: boolean) => {
      "worklet";
      const s = state.value;
      if (s.phase !== HELD || s.id !== id) return;
      const d = dims.value;
      const commit = !canceled;
      const still = moved.value < DRAG_STILL;
      let toL = commit ? s.toL : s.fromL;
      let toI = commit ? s.toI : s.fromI;
      const trash = commit && s.kind === LIST && s.trash;
      let tx = ox.value;
      let ty = oy.value;
      const h = s.H - DRAG_GAP;
      if (s.kind === CARD) {
        const g = geo.value[toL];
        const home = geo.value[s.fromL];
        const me = home?.cards.find((c) => c.id === s.id);
        if (!g || !me) {
          toL = s.fromL;
          toI = s.fromI;
        }
        const target = geo.value[toL];
        if (target && me) {
          tx = BOARD.side + toL * d.step - boardX.value + target.left + me.x;
          const y = target.top + slotTop(target, s.id, s.H, toI) - (scrolls.value[toL] ?? 0);
          // A slot scrolled out of the list's box: the card flies to the box's edge it is behind.
          ty = Math.min(Math.max(y, target.top - h / 2), target.top + Math.max(0, target.height - h / 2));
        }
      } else if (!trash) {
        if (!commit) toI = s.fromI;
        tx = BOARD.side + (toI + d.lists0) * d.step - boardX.value;
        // A list lands back on the lists' line, where it was lifted from.
        ty = grab.value.sy - grab.value.y;
      }
      state.value = { ...s, phase: DROPPING, toL, toI, trash };
      const flags = (commit ? 1 : 0) | (still ? 2 : 0) | (trash ? 4 : 0);
      const duration = trash || d.reduced ? 0 : DROP_MS;
      lift.value = withTiming(0, { duration });
      ox.value = withTiming(tx, { duration });
      oy.value = withTiming(ty, { duration }, () => {
        scheduleOnRN(onDrop, s.kind, s.id, s.fromL, s.fromI, toL, toI, flags);
      });
    },
    [state, dims, moved, ox, oy, geo, boardX, scrolls, grab, lift, onDrop],
  );

  /**
   * Lets go of what is held as a cancel when its gesture can no longer end it: the card or list (`id`, null for any)
   * left the tree while held (a list paged out of the board's window, a refresh), or the app left the screen. It flies
   * home and every shared value goes back to rest, so the board never stays with a card in the air and no drag can
   * start again. A no-op when nothing is held, so a gesture's own cancel arriving after it changes nothing.
   */
  const cancelHeld = useCallback(
    (id: string | null) => {
      "worklet";
      const s = state.value;
      if (s.phase === HELD && (id === null || s.id === id)) endDrag(s.id, true);
    },
    [state, endDrag],
  );
  useEffect(() => {
    const sub = AppState.addEventListener("change", (now) => {
      if (now !== "active") scheduleOnUI(cancelHeld, null);
    });
    return () => sub.remove();
  }, [cancelHeld]);

  /** The board's own scroll, from its `onScroll`. */
  const boardScrolled = useCallback(
    (x: number) => {
      boardXjs.current = x;
      boardX.value = x;
    },
    [boardX],
  );
  /** A list's scrolling box: where it sits on the board, how far it is scrolled, how much it holds. */
  const registerList = useCallback(
    (L: number, entry: Partial<ListEntry>) => {
      const e = lists.current.get(L);
      if (e) Object.assign(e, entry);
      else
        lists.current.set(L, {
          ref: { current: null },
          top: 0,
          left: 0,
          height: 0,
          padTop: 0,
          padX: 0,
          content: 0,
          scroll: 0,
          cards: new Map(),
          ...entry,
        });
      flush();
    },
    [flush],
  );
  const forgetList = useCallback(
    (L: number) => {
      lists.current.delete(L);
      flush();
    },
    [flush],
  );
  const placeCard = useCallback(
    (L: number, id: string, at: { k: number; h: number } | null) => {
      let e = lists.current.get(L);
      if (!e && at) {
        registerList(L, {});
        e = lists.current.get(L);
      }
      if (!e) return;
      if (at) e.cards.set(id, at);
      else e.cards.delete(id);
      flush();
    },
    [flush, registerList],
  );
  return useMemo(
    () => ({
      boardRef,
      state,
      geo,
      dims,
      lift,
      ox,
      oy,
      ready,
      held,
      dragged,
      boardScrolled,
      registerList,
      forgetList,
      placeCard,
      startDrag,
      followDrag,
      endDrag,
      cancelHeld,
    }),
    [
      boardRef,
      state,
      geo,
      dims,
      lift,
      ox,
      oy,
      ready,
      held,
      boardScrolled,
      registerList,
      forgetList,
      placeCard,
      startDrag,
      followDrag,
      endDrag,
      cancelHeld,
    ],
  );
}

/**
 * Held by its own gesture: when the card or list leaves the tree, its gesture goes with it and never ends the drag,
 * so the drag is let go here (`cancelHeld`). Keyed on the id alone: a card that only changes place keeps its drag.
 */
function useLetGoOnUnmount(id: string, cancelHeld: (id: string | null) => void) {
  const cancel = useRef(cancelHeld);
  cancel.current = cancelHeld;
  useEffect(() => () => scheduleOnUI(cancel.current, id), [id]);
}

/**
 * A list's scrolling box of cards, told to the board's drag (`L` its column; `active` false: it takes no part): where
 * it sits on the board (`top`, below the list's head; `left`, inside the list's edge), where its cards start in it, how
 * tall it is, how far it is scrolled and how much it holds. Spread the result on the list's `ScrollView`. It is told
 * again when its column or its place changes.
 */
export function useDragListBox(
  L: number,
  active: boolean,
  ref: ListEntry["ref"],
  at: { top: number; left: number; padX: number; padTop: number },
): {
  onLayout: (e: LayoutChangeEvent) => void;
  onContentSizeChange: (w: number, h: number) => void;
  onScroll: (e: { nativeEvent: { contentOffset: { y: number } } }) => void;
} {
  const engine = use(Ctx);
  const register = engine?.registerList;
  const forget = engine?.forgetList;
  const place = useRef({ height: 0, content: 0, scroll: 0 });
  const { top, left, padX, padTop } = at;
  useEffect(() => {
    if (!active || !register || !forget) return;
    register(L, { ...place.current, top, left, padX, padTop, ref });
    return () => forget(L);
  }, [active, register, forget, L, ref, top, left, padX, padTop]);
  return useMemo(() => {
    const report = (patch: Partial<typeof place.current>) => {
      Object.assign(place.current, patch);
      if (active) register?.(L, { ...patch, ref });
    };
    return {
      onLayout: (e: LayoutChangeEvent) => report({ height: e.nativeEvent.layout.height }),
      onContentSizeChange: (_w: number, h: number) => report({ content: h }),
      onScroll: (e: { nativeEvent: { contentOffset: { y: number } } }) =>
        report({ scroll: e.nativeEvent.contentOffset.y }),
    };
  }, [active, register, L, ref]);
}

/** The board's own box, the one every position of a drag is measured from. */
export function DragBoard({
  engine,
  style,
  onLayout,
  children,
}: {
  engine: BoardDrag;
  style?: ViewStyle | (ViewStyle | false | null | undefined)[];
  onLayout?: (e: LayoutChangeEvent) => void;
  children: ReactNode;
}) {
  return (
    <BoardDragProvider value={engine}>
      <Animated.View ref={engine.boardRef} style={style} onLayout={onLayout} collapsable={false}>
        {children}
      </Animated.View>
    </BoardDragProvider>
  );
}

/**
 * The scroll gestures a held card must win against: the board's and its own list's. They wait for the hold to fail
 * (a finger that moves before the hold scrolls as always) and never start under a held card.
 */
const useBlocks = (gestures: (NativeGesture | null | undefined)[]) => {
  const tags = gestures.map((g) => g?.handlerTag ?? 0).join();
  // biome-ignore lint/correctness/useExhaustiveDependencies: the gestures change only with their tags.
  return useMemo(() => {
    const out = gestures.filter((g): g is NativeGesture => Boolean(g));
    return out.length > 0 ? out : undefined;
  }, [tags]);
};

/**
 * A card that can be dragged: the whole card is the handle (whatever inside it the finger lands on, a button too).
 * A tap still reaches what it lands on; a hold of `DRAG_HOLD_MS` lifts the card and cancels that press.
 */
export function DragCard({
  id,
  L,
  k,
  enabled,
  scrollGestures,
  children,
}: {
  id: string;
  /** Its column on the board and its index in it. */
  L: number;
  k: number;
  enabled: boolean;
  scrollGestures: (NativeGesture | null | undefined)[];
  children: ReactNode;
}) {
  const engine = useEngine();
  const { state, ready, dims, startDrag, followDrag, endDrag, placeCard, cancelHeld } = engine;
  const ref = useAnimatedRef<Animated.View>();
  useLetGoOnUnmount(id, cancelHeld);
  const meta = useSharedValue({ L, k });
  useEffect(() => {
    meta.value = { L, k };
  }, [L, k, meta]);
  // Its height as last laid out: handed again when its place in the list changes without a new layout.
  const height = useRef(0);
  useEffect(() => {
    if (height.current > 0) placeCard(L, id, { k, h: height.current });
    return () => placeCard(L, id, null);
  }, [L, k, id, placeCard]);
  const block = useBlocks(scrollGestures);
  // One config for the gesture's life: a config that changes mid-drag resets the handler (the web's does), so the
  // callbacks read the card's place through a shared value.
  const config = useMemo(
    () => ({
      enabled,
      activateAfterLongPress: DRAG_HOLD_MS,
      shouldCancelWhenOutside: false,
      ...(block ? { block } : {}),
      onActivate: (e: { absoluteX: number; absoluteY: number }) => {
        "worklet";
        startDrag(CARD, id, meta.value.L, meta.value.k, ref, e);
      },
      onUpdate: (e: { absoluteX: number; absoluteY: number }) => {
        "worklet";
        followDrag(id, e);
      },
      onDeactivate: (e: { canceled: boolean }) => {
        "worklet";
        endDrag(id, e.canceled);
      },
    }),
    [enabled, id, block, startDrag, followDrag, endDrag, meta, ref],
  );
  const pan = usePanGesture(config);
  const slid = useAnimatedStyle(() => {
    const s = state.value;
    if (s.phase === IDLE || s.kind !== CARD) return { opacity: 1, transform: [{ translateY: 0 }] };
    const m = meta.value;
    const shift = cardShift(m.L, m.k, s);
    return {
      opacity: s.id === id && ready.value === 1 ? 0 : 1,
      transform: [{ translateY: dims.value.reduced ? shift : withTiming(shift, { duration: 160 }) }],
    };
  });
  return (
    <GestureDetector gesture={pan}>
      <Animated.View
        ref={ref}
        collapsable={false}
        style={slid}
        onLayout={(e) => {
          height.current = e.nativeEvent.layout.height;
          placeCard(L, id, { k, h: height.current });
        }}
      >
        {children}
      </Animated.View>
    </GestureDetector>
  );
}

/**
 * The end of a list's cards, inside its scrolling content: the placeholder where a held card would land, and the room
 * the list gains (or gives back) while one is held over it.
 */
export function DragListEnd({ L, color, radius = 12 }: { L: number; color: string; radius?: number }) {
  const { state, geo, held, dims } = useEngine();
  const room = useAnimatedStyle(() => {
    const s = state.value;
    const grow = s.phase === IDLE || s.kind !== CARD ? 0 : listGrowth(L, s);
    return { marginTop: withTiming(-DRAG_GAP + grow, { duration: s.phase === IDLE || dims.value.reduced ? 0 : 160 }) };
  });
  const width = held?.kind === "card" ? held.width : 0;
  const height = held?.kind === "card" ? held.height : 0;
  const slot = useAnimatedStyle(() => {
    const s = state.value;
    const g = geo.value[L];
    const me = g && s.kind === CARD ? geo.value[s.fromL]?.cards.find((c) => c.id === s.id) : undefined;
    const on = s.phase !== IDLE && s.kind === CARD && s.toL === L && g;
    if (!on || !g) return { opacity: 0, top: 0, left: 0 };
    const top = slotTop(g, s.id, s.H, s.toI);
    return { opacity: 1, left: me ? me.x : 8, top: dims.value.reduced ? top : withTiming(top, { duration: 160 }) };
  });
  return (
    <>
      <Animated.View
        pointerEvents="none"
        style={[styles.slot, { width, height, backgroundColor: color, borderRadius: radius }, slot]}
      />
      <Animated.View pointerEvents="none" style={[styles.room, room]} />
    </>
  );
}

/** A list's head as the handle that lifts the whole list (`listRef`); a tap still reaches its name and its "…". */
export function DragListHead({
  id,
  column,
  index,
  enabled,
  listRef,
  scrollGestures,
  children,
}: {
  id: string;
  column: number;
  /** Its place among the lists. */
  index: number;
  enabled: boolean;
  listRef: AnimatedRef<Animated.View>;
  scrollGestures: (NativeGesture | null | undefined)[];
  children: ReactNode;
}) {
  const { startDrag, followDrag, endDrag, cancelHeld } = useEngine();
  useLetGoOnUnmount(id, cancelHeld);
  const meta = useSharedValue({ column, index });
  useEffect(() => {
    meta.value = { column, index };
  }, [column, index, meta]);
  const block = useBlocks(scrollGestures);
  const config = useMemo(
    () => ({
      enabled,
      activateAfterLongPress: DRAG_HOLD_MS,
      shouldCancelWhenOutside: false,
      ...(block ? { block } : {}),
      onActivate: (e: { absoluteX: number; absoluteY: number }) => {
        "worklet";
        startDrag(LIST, id, meta.value.column, meta.value.index, listRef, e);
      },
      onUpdate: (e: { absoluteX: number; absoluteY: number }) => {
        "worklet";
        followDrag(id, e);
      },
      onDeactivate: (e: { canceled: boolean }) => {
        "worklet";
        endDrag(id, e.canceled);
      },
    }),
    [enabled, id, block, startDrag, followDrag, endDrag, meta, listRef],
  );
  const pan = usePanGesture(config);
  return <GestureDetector gesture={pan}>{children}</GestureDetector>;
}

/** A list's slide while another list is held over its place (the held one's to where it would land). */
export function useListSlide(index: number, step: number) {
  const { state, dims } = useEngine();
  return useAnimatedStyle(() => {
    const s = state.value;
    if (s.phase === IDLE || s.kind !== LIST || index < 0) return { transform: [{ translateX: 0 }] };
    const x = listShift(index, s.fromI, s.toI) * step;
    return { transform: [{ translateX: dims.value.reduced ? x : withTiming(x, { duration: 180 }) }] };
  });
}

/** Whether a held card would land in column `L` now, for a column's ring: 1 over it, 0 not. */
export function useDropOver(L: number): SharedValue<number> {
  const { state } = useEngine();
  const over = useSharedValue(0);
  useAnimatedReaction(
    () => {
      const s = state.value;
      return s.phase === HELD && s.kind === CARD && s.toL === L && s.fromL !== L ? 1 : 0;
    },
    (v) => {
      over.value = v;
    },
  );
  return over;
}

/** 1 while the held list is over the trash, for the trash's look. */
export function useOverTrash(): SharedValue<number> {
  const { state } = useEngine();
  const over = useSharedValue(0);
  useAnimatedReaction(
    () => (state.value.phase === HELD && state.value.kind === LIST && state.value.trash ? 1 : 0),
    (v) => {
      over.value = v;
    },
  );
  return over;
}

/**
 * The lifted card or list, drawn again over the board where the finger holds it: tilted and a touch larger as it
 * lifts, flying back flat into its place on the drop. The only view with a shadow.
 */
export function DragOverlay({ shadow, radius, children }: { shadow: string; radius: number; children: ReactNode }) {
  const { held, ox, oy, lift, ready, state, dims } = useEngine();
  const style = useAnimatedStyle(() => {
    const k = dims.value.reduced ? 0 : lift.value;
    return {
      opacity: state.value.phase !== IDLE && ready.value === 1 ? 1 : 0,
      transform: [
        { translateX: ox.value },
        { translateY: oy.value },
        { rotate: `${k * DRAG_TILT_DEG}deg` },
        { scale: 1 + (DRAG_SCALE - 1) * k },
      ],
    };
  });
  if (!held) return null;
  return (
    <Animated.View
      pointerEvents="none"
      onLayout={() => {
        ready.value = 1;
      }}
      style={[styles.overlay, { width: held.width, borderRadius: radius, boxShadow: shadow }, style]}
    >
      {children}
    </Animated.View>
  );
}

/** Whether a press is the end of a drag (it opens nothing). */
export function useDragged() {
  return use(Ctx)?.dragged ?? NOT_DRAGGED;
}
const NOT_DRAGGED = { current: false };

const styles = StyleSheet.create({
  overlay: { position: "absolute", top: 0, left: 0 },
  slot: { position: "absolute" },
  room: { height: 0 },
});
