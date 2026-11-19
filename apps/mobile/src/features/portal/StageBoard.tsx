import type { PlanCard, PortalBoard, PortalCard, PortalItem, PortalPlan } from "@dougbot/client";
import { useMovePortalCardState } from "@dougbot/client";
import { portalScheduling, portalWhen } from "@dougbot/client/lib/portal";
import { type ComponentRef, useMemo, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { Pressable, StyleSheet, View } from "react-native";
import { FlatList, type NativeGesture, RefreshControl, ScrollView } from "react-native-gesture-handler";
import Animated, { useAnimatedStyle, useReducedMotion } from "react-native-reanimated";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { Chip, EmptyState, haptics, Icon, type IconName, Text, useTheme, useToast } from "@/ui";
import { appColors } from "@/ui/palette";
import { ThemeColorsOverride } from "@/ui/theme";
import { useOrgId } from "../shared/hooks";
import {
  DragBoard,
  DragCard,
  DragListEnd,
  DragOverlay,
  useBoardDrag,
  useDragged,
  useDragListBox,
  useDropOver,
} from "./BoardDrag";
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
  isTeamColumn,
  STAGE_COLOR,
  STATUS_LOOK,
  stageColumns,
} from "./model";
import { BoardCard, BoardDots } from "./PlanBoard";
import { openCard, openPost, StagePill } from "./parts";
import type { PortalWords } from "./words";

type Paint = ReturnType<typeof boardPaint>;
type TeamColumn = "todo" | "doing";

/** The held card's lift: one shadow, on the one card in the air (never on the cards in the lists). */
const GHOST_SHADOW = "0px 18px 32px -12px rgba(0, 0, 0, 0.6)";
/** The lists' first line on the board (`styles.lists`' top padding), and the ring around a list. */
const LISTS_TOP = 12;
/** Room under the lists, over the dots: a list's foot is never cut. */
const LISTS_BOTTOM = 12;
const RING = 2;

/**
 * A client's Quadro (ADR 9001) as Trello's app shows a board on a phone, in the Cronograma's look (`PlanBoard`): the
 * light board, a dark list per stage that holds something (To do and In production always, for whoever moves cards),
 * one across the screen with the next one's edge in sight, a swipe stopping on each, dots under them. The team's cards
 * are the Cronograma's cards, dragged as there (`BoardDrag`: held anywhere, a tap still opens) between the two team
 * columns, where a card goes last; the move shows at once and is put back when the portal refuses
 * (`useMovePortalCardState`). While a card is in the air the portal's columns dim and say they take none: the portal
 * decides what is in them. A post opens its card, or itself when no card stands for it.
 */
export function StageBoard({
  client,
  board: liveBoard,
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
  const [boardH, setBoardH] = useState(0);
  const listWidth = boardListWidth(box.width);
  const step = listWidth + BOARD.gap;
  const [at, setAt] = useState(0);
  const [boardScroll, setBoardScroll] = useState<NativeGesture | null>(null);
  const pager = useRef<ComponentRef<typeof FlatList<BoardColumn>>>(null);

  // While a card is held the board draws itself as it was at the lift (a read landing mid-drag would move the cards
  // under the finger); the drop's own move is drawn as soon as it is made.
  const frozen = useRef<PortalBoard | null>(null);
  const heldNow = useRef(false);
  const board = heldNow.current && frozen.current ? frozen.current : liveBoard;
  const columns = stageColumns(board, changes);

  const go = (index: number, animated = true) =>
    pager.current?.scrollToOffset({ offset: Math.max(0, index) * step, animated });

  const moveTo = (card: PortalCard, to: TeamColumn) => {
    if (card.state === to) return;
    move.mutate(
      { cardId: card.id, state: to },
      { onSuccess: () => toast({ title: w.moved(w.columns[to]), icon: "check" }), onError: failed },
    );
  };
  const teamCards = [...board.cards.todo, ...board.cards.doing];

  const drag = useBoardDrag({
    pager,
    droppable: columns.map((col) => isTeamColumn(col.column)),
    orderable: false,
    step,
    width: box.width,
    height: boardH,
    reduced,
    version: liveBoard,
    onCardDrop: ({ id, toL }) => {
      const target = columns[toL]?.column;
      const card = teamCards.find((x) => x.id === id);
      if (!card || !target || !isTeamColumn(target) || target === card.state) return false;
      moveTo(card, target);
      return true;
    },
  });
  const held = drag.held;
  if (held && !held.settling) {
    if (!heldNow.current) frozen.current = liveBoard;
    heldNow.current = true;
  } else {
    heldNow.current = false;
    frozen.current = null;
  }
  const heldCard = held ? teamCards.find((x) => x.id === held.id) : undefined;
  const heldFrom = heldCard && isTeamColumn(heldCard.state) ? heldCard.state : null;

  if (columns.length === 0) return <EmptyState size="page" icon="list" title={w.emptyColumn} />;
  return (
    <DragBoard
      engine={drag}
      style={[styles.board, { backgroundColor: paint.board, paddingBottom: insets.bottom }]}
      onLayout={(e) => setBoardH(e.nativeEvent.layout.height)}
    >
      <ThemeColorsOverride colors={listColors}>
        <FlatList
          ref={pager}
          horizontal
          data={columns}
          keyExtractor={(col) => col.column}
          onGestureUpdate_CAN_CAUSE_INFINITE_RERENDER={(g) =>
            setBoardScroll((now) => (now?.handlerTag === g.handlerTag ? now : g))
          }
          renderItem={({ item: col, index }) => (
            <StageColumn
              w={w}
              client={client}
              col={col}
              column={index}
              plan={plan}
              width={listWidth}
              maxHeight={Math.max(0, box.height - LISTS_TOP - LISTS_BOTTOM)}
              paint={paint}
              numbers={numbers}
              held={heldFrom && !held?.settling ? columnDrop(col.column, heldFrom) : null}
              drags={changes}
              boardScroll={boardScroll}
              onMove={changes ? moveTo : null}
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
          scrollEventThrottle={16}
          onScroll={(e) => {
            const x = e.nativeEvent.contentOffset.x;
            drag.boardScrolled(x);
            setAt(boardIndexAt(x, step, columns.length));
          }}
        />
      </ThemeColorsOverride>
      <BoardDots
        w={w}
        at={at}
        paint={paint}
        onPick={go}
        items={columns.map((col) => ({ key: col.column, name: w.columns[col.column], color: STAGE_COLOR[col.column] }))}
      />
      <ThemeColorsOverride colors={listColors}>
        <DragOverlay shadow={GHOST_SHADOW} radius={12}>
          {heldCard ? (
            <BoardCard
              w={w}
              card={boardCardOf(heldCard, plan)}
              paint={paint}
              task={numbers.get(heldCard.id)}
              material={false}
              onMove={null}
              typeFirst
            />
          ) : null}
        </DragOverlay>
      </ThemeColorsOverride>
    </DragBoard>
  );
}

function Gap() {
  return <View style={styles.gap} />;
}

/**
 * One stage: its dot, name and count, then its cards scrolling inside it. While a card is held it says what it does
 * with it: the other team column rings (brighter while the card is over it) and opens a place at its end, the card's
 * own stays as it is, the portal's dim under a lock.
 */
function StageColumn({
  w,
  client,
  col,
  column,
  plan,
  width,
  maxHeight,
  paint,
  numbers,
  held,
  drags,
  boardScroll,
  onMove,
  refreshing,
  onRefresh,
  onSchedule,
}: {
  w: PortalWords;
  client: string;
  col: BoardColumn;
  column: number;
  plan: PortalPlan | undefined;
  width: number;
  maxHeight: number;
  paint: Paint;
  numbers: Map<string, number>;
  /** While a card is held: what this column does with it. */
  held: "drop" | "home" | "closed" | null;
  drags: boolean;
  boardScroll: NativeGesture | null;
  onMove: ((card: PortalCard, to: TeamColumn) => void) | null;
  refreshing: boolean;
  onRefresh: () => void;
  onSchedule: ((item: PortalItem) => void) | null;
}) {
  const { colors: c } = useTheme();
  const team = isTeamColumn(col.column) ? col.column : null;
  const closed = held === "closed";
  const target = held === "drop";
  const count = columnCount(col);
  const dragged = useDragged();
  const [listScroll, setListScroll] = useState<NativeGesture | null>(null);
  const cardsView = useRef<ComponentRef<typeof ScrollView>>(null);
  const over = useDropOver(column);
  const ring = useAnimatedStyle(() => ({
    borderColor: target ? (over.value === 1 ? c.green : `${c.green}66`) : "transparent",
  }));
  // The cards' box starts under the head, inside the list's 2 ring; the cards 6 in from its sides.
  const [headH, setHeadH] = useState(0);
  const box = useDragListBox(column, Boolean(team), cardsView, {
    top: LISTS_TOP + RING + headH,
    left: RING,
    padX: 6,
    padTop: 0,
  });

  return (
    <Animated.View
      style={[styles.list, { width, maxHeight, backgroundColor: paint.list, opacity: closed ? 0.55 : 1 }, ring]}
    >
      <View style={styles.listHead} accessibilityRole="header" onLayout={(e) => setHeadH(e.nativeEvent.layout.height)}>
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
        ref={cardsView}
        style={styles.cardsScroll}
        contentContainerStyle={styles.cards}
        showsVerticalScrollIndicator={false}
        scrollEnabled={!held}
        scrollEventThrottle={16}
        onGestureUpdate_CAN_CAUSE_INFINITE_RERENDER={(g) =>
          setListScroll((now) => (now?.handlerTag === g.handlerTag ? now : g))
        }
        {...box}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} />}
      >
        {col.cards.map((card, k) =>
          team ? (
            <DragCard
              key={card.id}
              id={card.id}
              L={column}
              k={k}
              enabled={drags}
              scrollGestures={[boardScroll, listScroll]}
            >
              <TeamCard
                w={w}
                card={card}
                column={team}
                plan={plan}
                paint={paint}
                task={numbers.get(card.id)}
                dragged={dragged}
                onMove={onMove}
              />
            </DragCard>
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
        {count === 0 && !target ? (
          <Text variant="footnote" tone="muted" style={styles.empty}>
            {w.emptyColumn}
          </Text>
        ) : null}
        {team ? <DragListEnd L={column} color={paint.slot} /> : null}
      </ScrollView>
      <View style={styles.listFoot} />
    </Animated.View>
  );
}

/** A team card: the Cronograma's card, the type in its pill; a screen reader moves it with its action. */
function TeamCard({
  w,
  card,
  column,
  plan,
  paint,
  task,
  dragged,
  onMove,
}: {
  w: PortalWords;
  card: PortalCard;
  column: TeamColumn;
  plan: PortalPlan | undefined;
  paint: Paint;
  task: number | undefined;
  dragged: { current: boolean };
  onMove: ((card: PortalCard, to: TeamColumn) => void) | null;
}) {
  const other: TeamColumn = column === "todo" ? "doing" : "todo";
  return (
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
        onMove
          ? {
              label: w.moveTo(w.columns[other]),
              hint: w.holdCard,
              run: () => {
                haptics.success();
                onMove(card, other);
              },
            }
          : null
      }
    />
  );
}

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
  lists: {
    paddingHorizontal: BOARD.side,
    paddingTop: LISTS_TOP,
    paddingBottom: LISTS_BOTTOM,
    alignItems: "flex-start",
  },
  gap: { width: BOARD.gap },
  // The Cronograma's list: 20 round, and a 2 ring that shows only while a card can land in it.
  list: { borderRadius: 20, overflow: "hidden", borderWidth: RING },
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
