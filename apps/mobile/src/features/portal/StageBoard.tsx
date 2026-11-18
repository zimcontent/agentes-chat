import type { PlanCard, PortalBoard, PortalCard, PortalItem, PortalPlan } from "@agenteschat/client";
import { useMovePortalCardState } from "@agenteschat/client";
import { portalScheduling, portalWhen } from "@agenteschat/client/lib/portal";
import { type ComponentRef, useEffect, useMemo, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { FlatList, Pressable, RefreshControl, ScrollView, StyleSheet, View } from "react-native";
import { GestureDetector, usePanGesture } from "react-native-gesture-handler";
import Animated, { useAnimatedStyle, useReducedMotion, useSharedValue } from "react-native-reanimated";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { Chip, EmptyState, haptics, Icon, type IconName, Text, useTheme, useToast } from "@/ui";
import { appColors } from "@/ui/palette";
import { ThemeColorsOverride } from "@/ui/theme";
import { useOrgId } from "../shared/hooks";
import { usePortalFailed, usePortalRights, usePortalWords } from "./hooks";
import {
  BOARD,
  type BoardColumn,
  boardCardOf,
  boardIndexAt,
  boardListWidth,
  boardPaint,
  cardOfItem,
  columnCount,
  columnDrop,
  edgeScroll,
  isTeamColumn,
  listSlotAt,
  STAGE_COLOR,
  STATUS_LOOK,
  stageColumns,
} from "./model";
import { BoardCard, BoardDots } from "./PlanBoard";
import { openCard, openPost, StagePill } from "./parts";
import type { PortalWords } from "./words";

type Paint = ReturnType<typeof boardPaint>;
type TeamColumn = "todo" | "doing";

/** A long press on a card picks it up (the Cronograma's list takes the same hold). */
const HOLD_MS = 350;
/** The held card's tilt, as Trello's. */
const TILT = "2deg";
/** The held card's lift: one shadow, on the one card in the air (never on the cards in the lists). */
const GHOST_SHADOW = "0px 18px 32px -12px rgba(0, 0, 0, 0.6)";

/**
 * A client's Quadro (ADR 9001) as Trello's app shows a board on a phone, in the Cronograma's look (`PlanBoard`): the
 * light board, a dark list per stage that holds something (To do and In production always, for whoever moves cards),
 * one across the screen with the next one's edge in sight, a swipe stopping on each, dots under them. The team's cards
 * are the Cronograma's cards; a long press lifts one and it is dragged to the other team column, as on the web
 * (`useMovePortalCardState`, shown there at once and put back when the portal refuses). While a card is in the air the
 * portal's columns dim and say they take none: the portal decides what is in them. A post opens its card, or itself
 * when no card stands for it.
 */
export function StageBoard({
  client,
  board,
  plan,
  numbers,
  refreshing,
  onRefresh,
  onSchedule = null,
}: {
  client: string;
  board: PortalBoard;
  plan: PortalPlan | undefined;
  numbers: Map<string, number>;
  refreshing: boolean;
  onRefresh: () => void;
  /** Whoever may schedule: an approved post's "toque para agendar" opens the sheet on it. */
  onSchedule?: ((item: PortalItem) => void) | null;
}) {
  const w = usePortalWords();
  const { scheme } = useTheme();
  const paint = boardPaint(scheme === "dark");
  const listColors = useMemo(() => appColors("dark"), []);
  const orgId = useOrgId();
  const toast = useToast();
  const failed = usePortalFailed();
  const { changes } = usePortalRights();
  const move = useMovePortalCardState(orgId, client);
  const reduced = useReducedMotion();
  const insets = useSafeAreaInsets();
  const [box, setBox] = useState({ width: 0, height: 0 });
  const listWidth = boardListWidth(box.width);
  const step = listWidth + BOARD.gap;
  const [at, setAt] = useState(0);
  const pager = useRef<FlatList<BoardColumn>>(null);
  const boardView = useRef<ComponentRef<typeof View>>(null);
  const columns = stageColumns(board, changes);

  // A held card: its column, the column under the finger. The gesture's callbacks read the ref; the screen draws
  // from the state.
  const [held, setHeld] = useState<{ card: PortalCard; from: TeamColumn; over: number } | null>(null);
  const drag = useRef({ id: "", from: "todo" as TeamColumn, over: -1, x: 0, left: 0, top: 0, scroll: 0, gx: 0, gy: 0 });
  const scrollX = useRef(0);
  const ticker = useRef<ReturnType<typeof setInterval> | null>(null);
  const ghostX = useSharedValue(0);
  const ghostY = useSharedValue(0);

  useEffect(
    () => () => {
      if (ticker.current) clearInterval(ticker.current);
    },
    [],
  );

  const go = (index: number, animated = true) =>
    pager.current?.scrollToOffset({ offset: Math.max(0, index) * step, animated });

  const moveTo = (card: PortalCard, to: TeamColumn) => {
    if (card.state === to) return;
    haptics.success();
    move.mutate(
      { cardId: card.id, state: to },
      { onSuccess: () => toast({ title: w.moved(w.columns[to]), icon: "check" }), onError: failed },
    );
  };

  const measureBoard = () =>
    boardView.current?.measureInWindow((x, y) => {
      drag.current.left = x;
      drag.current.top = y;
    });
  const overNow = () => listSlotAt(drag.current.scroll, drag.current.x, step, columns.length);
  const follow = () => {
    const d = drag.current;
    const over = overNow();
    if (over === d.over) return;
    d.over = over;
    const col = columns[over];
    if (col && columnDrop(col.column, d.from) === "drop") haptics.selection();
    setHeld((h) => (h ? { ...h, over } : h));
  };
  const lift = (card: PortalCard, from: TeamColumn, e: GestureAt) => {
    const d = drag.current;
    measureBoard();
    Object.assign(d, {
      id: card.id,
      from,
      scroll: scrollX.current,
      x: e.absoluteX - d.left,
      // Where the card was on the board when it was picked up: the ghost starts there and follows the finger.
      gx: e.absoluteX - d.left - e.x,
      gy: e.absoluteY - d.top - e.y,
    });
    d.over = overNow();
    ghostX.value = d.gx;
    ghostY.value = d.gy;
    haptics.medium();
    setHeld({ card, from, over: d.over });
    if (ticker.current) clearInterval(ticker.current);
    ticker.current = setInterval(() => {
      const end = Math.max(0, (columns.length - 1) * step);
      const next = Math.min(end, Math.max(0, d.scroll + edgeScroll(d.x, box.width)));
      if (next === d.scroll) return;
      d.scroll = next;
      pager.current?.scrollToOffset({ offset: next, animated: false });
      follow();
    }, 16);
  };
  const dragTo = (e: GestureAt & { translationX: number; translationY: number }) => {
    const d = drag.current;
    if (!d.id) return;
    d.x = e.absoluteX - d.left;
    ghostX.value = d.gx + e.translationX;
    ghostY.value = d.gy + e.translationY;
    follow();
  };
  const drop = (commit: boolean) => {
    const d = drag.current;
    if (ticker.current) clearInterval(ticker.current);
    ticker.current = null;
    if (!d.id) return;
    const card = held?.card ?? [...board.cards.todo, ...board.cards.doing].find((c) => c.id === d.id);
    const target = columns[d.over];
    const { from, over } = d;
    d.id = "";
    setHeld(null);
    if (!commit || !card || !target) return;
    if (isTeamColumn(target.column) && target.column !== from) {
      moveTo(card, target.column);
      go(over);
    } else haptics.light();
  };

  const ghost = useAnimatedStyle(() => ({
    transform: [
      { translateX: ghostX.value },
      { translateY: ghostY.value },
      { rotate: reduced ? "0deg" : TILT },
      { scale: reduced ? 1 : 1.03 },
    ],
  }));

  if (columns.length === 0) return <EmptyState size="page" icon="list" title={w.emptyColumn} />;
  const cardWidth = listWidth - 16;
  return (
    <View
      ref={boardView}
      style={[styles.board, { backgroundColor: paint.board, paddingBottom: insets.bottom }]}
      onLayout={measureBoard}
    >
      <ThemeColorsOverride colors={listColors}>
        <FlatList
          ref={pager}
          horizontal
          data={columns}
          keyExtractor={(col) => col.column}
          renderItem={({ item: col }) => (
            <StageColumn
              w={w}
              client={client}
              col={col}
              plan={plan}
              width={listWidth}
              maxHeight={box.height}
              paint={paint}
              numbers={numbers}
              held={
                held
                  ? { id: held.card.id, state: columnDrop(col.column, held.from), over: columns[held.over] === col }
                  : null
              }
              drag={changes ? { onLift: lift, onDrag: dragTo, onDrop: drop, onMove: moveTo } : null}
              refreshing={refreshing}
              onRefresh={onRefresh}
              onSchedule={onSchedule}
            />
          )}
          ItemSeparatorComponent={Gap}
          contentContainerStyle={styles.lists}
          style={styles.board}
          onLayout={(e) => {
            const { width, height } = e.nativeEvent.layout;
            setBox((b) => (b.width === width && b.height === height ? b : { width, height }));
          }}
          showsHorizontalScrollIndicator={false}
          snapToInterval={step}
          decelerationRate="fast"
          disableIntervalMomentum
          scrollEnabled={!held}
          scrollEventThrottle={32}
          onScroll={(e) => {
            scrollX.current = e.nativeEvent.contentOffset.x;
            if (!drag.current.id) drag.current.scroll = scrollX.current;
            setAt(boardIndexAt(e.nativeEvent.contentOffset.x, step, columns.length));
          }}
        />
        {held ? (
          <Animated.View
            pointerEvents="none"
            style={[styles.ghost, { width: cardWidth, boxShadow: GHOST_SHADOW }, ghost]}
          >
            <BoardCard
              w={w}
              card={boardCardOf(held.card, plan)}
              paint={paint}
              task={numbers.get(held.card.id)}
              material={false}
              onMove={null}
              typeFirst
            />
          </Animated.View>
        ) : null}
      </ThemeColorsOverride>
      <BoardDots
        w={w}
        at={at}
        paint={paint}
        onPick={go}
        items={columns.map((col) => ({ key: col.column, name: w.columns[col.column], color: STAGE_COLOR[col.column] }))}
      />
    </View>
  );
}

function Gap() {
  return <View style={styles.gap} />;
}

type GestureAt = { x: number; y: number; absoluteX: number; absoluteY: number };
type Drag = {
  onLift: (card: PortalCard, from: TeamColumn, e: GestureAt) => void;
  onDrag: (e: GestureAt & { translationX: number; translationY: number }) => void;
  onDrop: (commit: boolean) => void;
  onMove: (card: PortalCard, to: TeamColumn) => void;
};

/**
 * One stage: its dot, name and count, then its cards scrolling inside it. While a card is held it says what it does
 * with it: the other team column lights up and shows where the card lands, the card's own stays as it is, the
 * portal's dim under a lock.
 */
function StageColumn({
  w,
  client,
  col,
  plan,
  width,
  maxHeight,
  paint,
  numbers,
  held,
  drag,
  refreshing,
  onRefresh,
  onSchedule,
}: {
  w: PortalWords;
  client: string;
  col: BoardColumn;
  plan: PortalPlan | undefined;
  width: number;
  maxHeight: number;
  paint: Paint;
  numbers: Map<string, number>;
  held: { id: string; state: "drop" | "home" | "closed"; over: boolean } | null;
  drag: Drag | null;
  refreshing: boolean;
  onRefresh: () => void;
  onSchedule: ((item: PortalItem) => void) | null;
}) {
  const { colors: c } = useTheme();
  const team = isTeamColumn(col.column) ? col.column : null;
  const closed = held?.state === "closed";
  const target = held?.state === "drop";
  const count = columnCount(col);
  return (
    <View
      style={[
        styles.list,
        {
          width,
          maxHeight,
          backgroundColor: paint.list,
          borderColor: target ? (held?.over ? c.green : `${c.green}66`) : "transparent",
          opacity: closed ? 0.55 : 1,
        },
      ]}
    >
      <View style={styles.listHead} accessibilityRole="header">
        <View style={[styles.headDot, { backgroundColor: STAGE_COLOR[col.column] }]} />
        <Text variant="subhead" style={styles.listName}>
          {w.columns[col.column]}
        </Text>
        <Text variant="footnote" tone="muted" style={styles.tabular}>
          {String(count)}
        </Text>
      </View>
      {closed ? (
        <View style={styles.lockLine}>
          <Icon name="lock" size={13} color={c.muted} />
          <Text variant="caption" tone="muted">
            {w.portalOwns}
          </Text>
        </View>
      ) : null}
      <ScrollView
        style={styles.cardsScroll}
        contentContainerStyle={styles.cards}
        showsVerticalScrollIndicator={false}
        scrollEnabled={!held}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} />}
      >
        {col.cards.map((card) =>
          team ? (
            <TeamCard
              key={card.id}
              w={w}
              card={card}
              column={team}
              plan={plan}
              paint={paint}
              task={numbers.get(card.id)}
              lifted={held?.id === card.id}
              drag={drag}
            />
          ) : null,
        )}
        {col.items.map((item) => (
          <PostCard
            key={item.id}
            w={w}
            client={client}
            item={item}
            card={cardOfItem(plan, item.id)}
            column={col.column}
            paint={paint}
            numbers={numbers}
            onSchedule={col.column === "approved" && !item.released && onSchedule ? () => onSchedule(item) : null}
          />
        ))}
        {target ? (
          <View style={[styles.slot, { borderColor: held?.over ? c.green : paint.edge }]}>
            <Text variant="subhead" style={{ color: held?.over ? c.green : c.muted }}>
              {w.dropHere}
            </Text>
          </View>
        ) : count === 0 ? (
          <Text variant="footnote" tone="muted" style={styles.empty}>
            {w.emptyColumn}
          </Text>
        ) : null}
      </ScrollView>
      <View style={styles.listFoot} />
    </View>
  );
}

/** A team card: the Cronograma's card, the type in its pill; a long press lifts it. */
function TeamCard({
  w,
  card,
  column,
  plan,
  paint,
  task,
  lifted,
  drag,
}: {
  w: PortalWords;
  card: PortalCard;
  column: TeamColumn;
  plan: PortalPlan | undefined;
  paint: Paint;
  task: number | undefined;
  lifted: boolean;
  drag: Drag | null;
}) {
  // One config for the gesture's life (a config that changes mid-drag resets the handler): the callbacks read the
  // latest props through a ref.
  const now = useRef({ drag, card, column });
  now.current = { drag, card, column };
  const dragged = useRef(false);
  const enabled = Boolean(drag);
  const config = useMemo(
    () => ({
      enabled,
      activateAfterLongPress: HOLD_MS,
      runOnJS: true,
      onActivate: (e: GestureAt) => {
        dragged.current = true;
        now.current.drag?.onLift(now.current.card, now.current.column, e);
      },
      onUpdate: (e: GestureAt & { translationX: number; translationY: number }) => now.current.drag?.onDrag(e),
      onDeactivate: (e: { canceled: boolean }) => {
        settle(dragged);
        now.current.drag?.onDrop(!e.canceled);
      },
      onFinalize: (e: { canceled: boolean }) => {
        if (!e.canceled) return;
        settle(dragged);
        now.current.drag?.onDrop(false);
      },
    }),
    [enabled],
  );
  const pan = usePanGesture(config);
  const other: TeamColumn = column === "todo" ? "doing" : "todo";
  const face = (
    <View style={lifted ? styles.lifted : null}>
      <BoardCard
        w={w}
        card={boardCardOf(card, plan)}
        paint={paint}
        task={task}
        material={false}
        onMove={null}
        typeFirst
        dragged={dragged}
        onAction={
          drag ? { label: w.moveTo(w.columns[other]), hint: w.holdCard, run: () => drag.onMove(card, other) } : null
        }
      />
    </View>
  );
  return drag ? <GestureDetector gesture={pan}>{face}</GestureDetector> : face;
}

/** A drag's end lets the card be pressed again a moment later (the press it ended on doesn't open it). */
const settle = (dragged: { current: boolean }) => setTimeout(() => (dragged.current = false), 300);

/**
 * A post at the portal, in the team card's look: the type in its stage's pill and where it stands, the title, a line
 * of facts (date, editor, files), what it still lacks, and for one the client sent back, what they asked (outside
 * text, plain words). It opens the card it came from, or the post itself.
 */
export function PostCard({
  w,
  client,
  item,
  card,
  column,
  paint,
  numbers,
  posted = false,
  onSchedule = null,
}: {
  w: PortalWords;
  client: string;
  item: PortalItem;
  card: PlanCard | null;
  column: BoardColumn["column"] | "posted";
  paint: Paint;
  numbers: Map<string, number>;
  /** Postados: the day it went out, not the day it was set for. */
  posted?: boolean;
  /** An approved post not released yet, for whoever may schedule: its own line opens the scheduling sheet. */
  onSchedule?: (() => void) | null;
}) {
  const { i18n } = useTranslation();
  const { colors: c } = useTheme();
  const look = STATUS_LOOK[item.status];
  const day = portalWhen(i18n.language, posted ? (item.publishedAt ?? item.scheduledFor) : item.scheduledFor);
  const task = card ? numbers.get(card.id) : undefined;
  const asked =
    item.lastNote && (item.status === "adjust_requested" || item.status === "adjusting") ? item.lastNote : null;
  const facts: { key: string; icon: IconName; text: string }[] = [
    ...(day ? [{ key: "day", icon: "calendar" as const, text: day }] : []),
    ...(item.editor ? [{ key: "editor", icon: "person" as const, text: item.editor }] : []),
    ...(item.files > 0 ? [{ key: "files", icon: "file" as const, text: String(item.files) }] : []),
  ];
  const spoken = [item.title, w.types[item.type], w.status[item.status], task !== undefined ? `#${task}` : null, day]
    .filter(Boolean)
    .join(", ");
  return (
    <Pressable
      onPress={() => (card ? openCard(client, card.id) : openPost(client, item.id))}
      accessibilityRole="button"
      accessibilityLabel={spoken}
      style={({ pressed }) => [
        styles.card,
        { backgroundColor: paint.card, borderColor: paint.edge },
        pressed ? styles.pressed : null,
      ]}
    >
      <View style={styles.cardTop}>
        <StagePill stage={column} label={w.types[item.type]} />
        <View style={styles.status}>
          <Icon name={look.icon} size={13} color={look.wait ? c.amber : c.muted} />
          <Text variant="caption" style={[styles.statusWord, { color: look.wait ? c.amber : c.muted }]}>
            {w.status[item.status]}
          </Text>
        </View>
        {task !== undefined ? (
          <Text variant="caption" tone="faint" style={[styles.task, styles.tabular]}>
            {`#${task}`}
          </Text>
        ) : null}
      </View>
      <Text variant="subhead" style={styles.title}>
        {item.title}
      </Text>
      {asked ? (
        <View style={[styles.asked, { borderLeftColor: STAGE_COLOR.adjusting }]}>
          <Text variant="caption" style={[styles.askedBy, { color: c.ink }]}>
            {asked.by || w.clientAsked}
          </Text>
          <Text variant="footnote" tone="ink2" numberOfLines={4}>
            {asked.text}
          </Text>
        </View>
      ) : null}
      {portalScheduling(item) || item.missing.length > 0 ? (
        <View style={styles.chips}>
          {portalScheduling(item) ? <Chip icon="clock" label={w.scheduling} /> : null}
          {item.missing.map((m) => (
            <Chip key={m} icon="flag" label={w.missing[m]} />
          ))}
        </View>
      ) : null}
      {facts.length > 0 ? (
        <View style={[styles.facts, { borderTopColor: paint.edge }]}>
          {facts.map((f) => (
            <View key={f.key} style={styles.fact}>
              <Icon name={f.icon} size={13} color={c.muted} />
              <Text variant="caption" tone="muted" style={styles.tabular}>
                {f.text}
              </Text>
            </View>
          ))}
        </View>
      ) : null}
      {onSchedule ? (
        <Pressable
          onPress={() => {
            haptics.selection();
            onSchedule();
          }}
          accessibilityRole="button"
          accessibilityLabel={`${w.tapToSchedule}: ${item.title}`}
          style={({ pressed }) => [
            styles.scheduleLine,
            { backgroundColor: `${c.amber}22`, borderColor: `${c.amber}55` },
            pressed ? styles.pressed : null,
          ]}
        >
          <Icon name="calendar" size={14} color={c.amber} />
          <Text variant="footnote" style={[styles.scheduleWord, { color: c.amber }]}>
            {w.tapToSchedule}
          </Text>
        </Pressable>
      ) : null}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  board: { flex: 1 },
  lists: { paddingHorizontal: BOARD.side, paddingTop: 12, alignItems: "flex-start" },
  gap: { width: BOARD.gap },
  // The Cronograma's list: 20 round, and a 2 ring that shows only while a card can land in it.
  list: { borderRadius: 20, overflow: "hidden", borderWidth: 2 },
  listHead: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    paddingHorizontal: 12,
    paddingTop: 12,
    paddingBottom: 10,
  },
  headDot: { width: 8, height: 8, borderRadius: 4 },
  listName: { flex: 1, minWidth: 0, fontWeight: "700" },
  lockLine: { flexDirection: "row", alignItems: "center", gap: 6, paddingHorizontal: 12, paddingBottom: 8 },
  cardsScroll: { flexGrow: 0, flexShrink: 1 },
  cards: { paddingHorizontal: 6, paddingBottom: 4, gap: 8 },
  listFoot: { height: 6 },
  empty: { paddingHorizontal: 8, paddingVertical: 12 },
  slot: {
    minHeight: 56,
    borderRadius: 12,
    borderWidth: 1.5,
    borderStyle: "dashed",
    alignItems: "center",
    justifyContent: "center",
  },
  lifted: { opacity: 0.25 },
  ghost: { position: "absolute", top: 0, left: 0, borderRadius: 12 },
  // Inside the list's 20 (less its 2 ring), 6 in: 12.
  card: { borderRadius: 12, borderWidth: StyleSheet.hairlineWidth, padding: 12, gap: 8 },
  cardTop: { flexDirection: "row", alignItems: "center", flexWrap: "wrap", gap: 8 },
  status: { flexDirection: "row", alignItems: "center", gap: 4 },
  statusWord: { fontWeight: "600" },
  task: { marginLeft: "auto" },
  title: { fontWeight: "600" },
  asked: { borderLeftWidth: 2, paddingLeft: 10, gap: 2 },
  askedBy: { fontWeight: "700" },
  chips: { flexDirection: "row", flexWrap: "wrap", gap: 6 },
  facts: {
    flexDirection: "row",
    flexWrap: "wrap",
    alignItems: "center",
    columnGap: 12,
    rowGap: 4,
    paddingTop: 8,
    borderTopWidth: StyleSheet.hairlineWidth,
  },
  fact: { flexDirection: "row", alignItems: "center", gap: 4 },
  tabular: { fontVariant: ["tabular-nums"] },
  pressed: { opacity: 0.7 },
  // The card's one action: a 40 line across it, its words wrapping before they are ever cut.
  scheduleLine: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    minHeight: 40,
    paddingHorizontal: 10,
    paddingVertical: 8,
    borderRadius: 8,
    borderWidth: StyleSheet.hairlineWidth,
  },
  scheduleWord: { flexShrink: 1, fontWeight: "600" },
});
