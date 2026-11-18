import type { PlanCard, PortalLabel, PortalList, PortalListKind, PortalPlan } from "@agenteschat/client";
import { keys, useMovePortalCard, usePortalLists, useSavePortalCard } from "@agenteschat/client";
import {
  portalClientName,
  portalDayOf,
  portalOrderAt,
  portalPlaceAt,
  portalWhen,
} from "@agenteschat/client/lib/portal";
import { useQueryClient } from "@tanstack/react-query";
import { type ComponentRef, useEffect, useMemo, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { Alert, Pressable, StyleSheet, TextInput, View } from "react-native";
import { FlatList, type NativeGesture, RefreshControl, ScrollView } from "react-native-gesture-handler";
import Animated, { FadeIn, FadeOut, useAnimatedRef, useAnimatedStyle, useReducedMotion } from "react-native-reanimated";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import {
  Button,
  EmptyState,
  haptics,
  Icon,
  IconButton,
  type IconName,
  SearchField,
  Text,
  useFieldText,
  useTheme,
  useToast,
} from "@/ui";
import { appColors } from "@/ui/palette";
import { ThemeColorsOverride } from "@/ui/theme";
import { useOrgId } from "../shared/hooks";
import { pickOne, showActionSheet } from "../shared/PickerSheet";
import {
  DragBoard,
  DragCard,
  DragListEnd,
  DragListHead,
  DragOverlay,
  useBoardDrag,
  useDragged,
  useDragListBox,
  useListSlide,
  useOverTrash,
} from "./BoardDrag";
import { usePortalFailed, usePortalRights, usePortalWords, useSendCard } from "./hooks";
import {
  BOARD,
  boardIndexAt,
  boardListWidth,
  boardPaint,
  boardQuery,
  cardBadges,
  cardLabels,
  LABEL_COLOR,
  listsFor,
  orderAfterDrop,
  orderNudged,
  type PlanGroup,
  planGroups,
  readyToSend,
  scheduleDays,
  searchGroups,
  toggledLabels,
} from "./model";
import { openCard, StagePill } from "./parts";
import type { PortalWords } from "./words";

type Paint = ReturnType<typeof boardPaint>;
type Column = { kind: "list"; group: PlanGroup } | { kind: "add" } | { kind: "new" };

/** The dots' row under the lists. */
const DOTS_H = 36;
/** Room under the lists, over the dots, as `LISTS_TOP` over them: a list's foot is never cut. */
const LISTS_BOTTOM = 12;
/** Past this many lists the dots would crowd the row: one line says which list it is instead. */
const DOTS_MAX = 14;
/** The pick that means "in no list" (a list's id is never empty). */
const NO_LIST = "";
/** The trash at the board's foot while a list is held: the finger this far above its own bottom is over it. */
const TRASH_H = 48;
const TRASH_REACH = 40;
/** The lists' first line on the board (`styles.lists`' top padding): a list's cards box starts this far down plus its head. */
const LISTS_TOP = 12;

const columnKey = (col: Column) => (col.kind === "add" ? "+" : col.kind === "new" ? "new" : (col.group.id ?? "none"));

/**
 * A client's schedule, or its materials, as Trello's app shows a board on a phone (ADR 9001): a search and "+" (a new
 * list, first) over the board; the lists side by side, one across the screen with the next one's edge in sight, a
 * swipe stopping on each; dots under them say which one is in front and take you to another. The board is light, the
 * lists and cards dark on it, in both themes.
 *
 * As Trello's: a card's tap opens it; held, it lifts and is dragged anywhere, in its list or to another, the board
 * paging near its sides and a long list scrolling near its ends (`BoardDrag`); held and let go where it was, its quick
 * actions. A list's head held lifts the list to another place or onto the trash; a tap on its name renames it, its "…"
 * holds the rest. Only whoever may change the board sees the ways to change it; a screen reader moves cards and lists
 * with their actions instead of a drag.
 */
export function PlanBoard({
  client,
  plan: livePlan,
  section,
  numbers,
  refreshing,
  onRefresh,
}: {
  client: string;
  plan: PortalPlan;
  section: PortalListKind;
  numbers: Map<string, number>;
  refreshing: boolean;
  onRefresh: () => void;
}) {
  const w = usePortalWords();
  const { colors: c, scheme } = useTheme();
  const paint = boardPaint(scheme === "dark");
  // The lists draw on the dark palette in both themes: their words, icons and buttons read on the dark lists.
  const listColors = useMemo(() => appColors("dark"), []);
  const orgId = useOrgId();
  const qc = useQueryClient();
  const toast = useToast();
  const failed = usePortalFailed();
  const lists = usePortalLists(orgId, client);
  const moveCard = useMovePortalCard(orgId, client);
  const reduced = useReducedMotion();
  const insets = useSafeAreaInsets();
  // The lists' own box, not the window's: a list fits what the board was given (a split screen, a sheet), and a list
  // is never taller than the room above the dots.
  const [box, setBox] = useState({ width: 0, height: 0 });
  const [boardH, setBoardH] = useState(0);
  const listWidth = boardListWidth(box.width);
  const step = listWidth + BOARD.gap;
  const { changes } = usePortalRights();
  const [at, setAt] = useState(0);
  const [search, setSearch] = useState("");
  const [creating, setCreating] = useState(false);
  const [focus, setFocus] = useState<string | null>(null);
  const [boardScroll, setBoardScroll] = useState<NativeGesture | null>(null);
  const pager = useRef<ComponentRef<typeof FlatList<Column>>>(null);
  const query = boardQuery(search);
  const searching = query !== null;
  const lists0 = creating ? 1 : 0;

  // While anything is held the board draws the schedule as it was at the lift: a read landing mid-drag would move
  // the cards under the finger. The drop's own change is drawn as soon as it is made.
  const frozen = useRef<PortalPlan | null>(null);
  const heldNow = useRef(false);
  const plan = heldNow.current && frozen.current ? frozen.current : livePlan;
  const all = planGroups(plan, section);
  const ids = all.flatMap((g) => (g.id ? [g.id] : []));
  const groups = searchGroups(all, query, numbers, plan.labels);
  const columns: Column[] = [
    ...(creating ? [{ kind: "new" as const }] : []),
    ...groups.map((group) => ({ kind: "list" as const, group })),
    ...(changes && !query ? [{ kind: "add" as const }] : []),
  ];
  const go = (index: number, animated = true) =>
    pager.current?.scrollToOffset({ offset: Math.max(0, index) * step, animated });
  const move = useMoveCard(client, plan);
  // Dragging changes the board's order: only whoever may change it, and never on a search's cut of it or while a
  // new list's name is being typed (the columns would not be the board's).
  const drags = changes && !searching && !creating;

  const drag = useBoardDrag({
    pager,
    droppable: columns.map((col) => col.kind === "list"),
    orderable: true,
    step,
    width: box.width,
    height: boardH,
    lists0,
    listCount: ids.length,
    trashZone: insets.bottom + 8 + TRASH_H + TRASH_REACH,
    reduced,
    version: livePlan,
    onCardDrop: ({ id, toL, toI }) => {
      const col = columns[toL];
      if (col?.kind !== "list") return false;
      const others = col.group.cards.filter((x) => x.id !== id);
      moveCard.mutate({ cardId: id, list: col.group.id, ...portalPlaceAt(others, toI) }, { onError: failed });
      return true;
    },
    onCardHold: (id) => {
      const card = all.flatMap((g) => g.cards).find((x) => x.id === id);
      if (card) move(card);
    },
    onListDrop: ({ id, slot, trash }) => {
      const group = all.find((g) => g.id === id);
      if (!group) return false;
      if (trash) {
        remove(group);
        return false;
      }
      const next = orderAfterDrop(ids, id, slot);
      if (next.join() === ids.join()) return false;
      reorder(next);
      go(slot + lists0);
      return true;
    },
  });
  const held = drag.held;
  if (held && !held.settling) {
    if (!heldNow.current) frozen.current = livePlan;
    heldNow.current = true;
  } else {
    heldNow.current = false;
    frozen.current = null;
  }

  // A list just made comes into view as soon as the board has it (the portal puts a new one wherever it puts it).
  const focusAt = focus ? columns.findIndex((col) => col.kind === "list" && col.group.id === focus) : -1;
  // biome-ignore lint/correctness/useExhaustiveDependencies: runs when the new list's place is first known.
  useEffect(() => {
    if (focusAt < 0) return;
    const t = setTimeout(() => {
      go(focusAt);
      setFocus(null);
    }, 60);
    return () => clearTimeout(t);
  }, [focusAt]);

  /** A list the portal made: shown where the board has it, or said plainly when the portal's board doesn't list it. */
  const added = (list: PortalList) => {
    const now = qc.getQueryData<PortalPlan>(keys.portalPlan(orgId, client));
    if (now && !now.lists.some((l) => l.id === list.id)) {
      toast({ title: w.listMissing(list.name), icon: "x" });
      return;
    }
    toast({ title: w.listAdded(list.name), icon: "check" });
    setFocus(list.id);
  };

  const startNew = () => {
    haptics.selection();
    setSearch("");
    setCreating(true);
    go(0);
  };

  function remove(group: PlanGroup) {
    if (!group.id) return;
    const id = group.id;
    const name = group.name ?? "";
    haptics.warning();
    Alert.alert(w.deleteListTitle, section === "materials" ? w.deleteMaterialsText(name) : w.deleteListText(name), [
      { text: w.cancel, style: "cancel" },
      {
        text: w.deleteList,
        style: "destructive",
        onPress: () =>
          lists.remove.mutate(id, {
            onSuccess: () => {
              haptics.success();
              toast({ title: w.listDeleted(name), icon: "check" });
            },
            onError: failed,
          }),
      },
    ]);
  }

  function reorder(next: string[] | null) {
    if (!next || next.join() === ids.join()) return;
    lists.order.mutate(next, { onError: failed });
  }

  const menu = (group: PlanGroup, rename: () => void) => {
    if (!group.id) return;
    const id = group.id;
    const name = group.name ?? "";
    const left = orderNudged(ids, id, -1);
    const right = orderNudged(ids, id, 1);
    const other: PortalListKind = section === "materials" ? "plan" : "materials";
    showActionSheet(w.listActions(name), [
      { label: w.rename, onPress: rename },
      {
        label: other === "materials" ? w.toMaterials : w.toPlan,
        onPress: () =>
          lists.kind.mutate(
            { listId: id, kind: other },
            {
              onSuccess: () =>
                toast({ title: other === "materials" ? w.movedToMaterials(name) : w.movedToPlan(name), icon: "check" }),
              onError: failed,
            },
          ),
      },
      ...(left ? [{ label: w.moveLeft, onPress: () => reorder(left) }] : []),
      ...(right ? [{ label: w.moveRight, onPress: () => reorder(right) }] : []),
      { label: w.deleteList, destructive: true, onPress: () => remove(group) },
    ]);
  };

  const toolbar = (all.length > 0 || changes) && (
    <View style={styles.toolbar}>
      <View style={styles.searchBox}>
        <SearchField
          value={search}
          onChangeText={setSearch}
          placeholder={w.search}
          autoCorrect={false}
          autoCapitalize="none"
          returnKeyType="search"
          raised
        />
      </View>
      {changes ? (
        <Pressable
          onPress={startNew}
          accessibilityRole="button"
          accessibilityLabel={w.newList}
          accessibilityHint={w.newListHint}
          hitSlop={4}
          style={({ pressed }) => [
            styles.plus,
            { backgroundColor: c.raised, borderWidth: StyleSheet.hairlineWidth, borderColor: c.line2 },
            pressed ? styles.pressed : null,
          ]}
        >
          <Icon name="plus" size={20} color={c.ink} />
        </Pressable>
      ) : null}
    </View>
  );

  if (searching && groups.length === 0) {
    return (
      <View style={styles.board}>
        {toolbar}
        <EmptyState
          size="page"
          icon="search"
          title={w.noMatch}
          subtitle={w.noMatchText(search.trim())}
          action={<Button variant="secondary" label={w.clearSearch} onPress={() => setSearch("")} />}
        />
      </View>
    );
  }
  if (columns.length === 0) {
    return section === "materials" ? (
      <EmptyState size="page" icon="archive" title={w.noMaterials} subtitle={w.materialsIntro} />
    ) : (
      <EmptyState size="page" icon="calendar" title={w.noLists} subtitle={w.noListsText} />
    );
  }
  // The lists' box less the room over and under them: a list as tall as the box ran past its foot.
  const listHeight = Math.max(0, box.height - LISTS_TOP - LISTS_BOTTOM);
  const heldList = held?.kind === "list" ? all.find((g) => g.id === held.id) : undefined;
  const heldCard = held?.kind === "card" ? all.flatMap((g) => g.cards).find((x) => x.id === held.id) : undefined;
  const listProps = (group: PlanGroup) => ({
    w,
    client,
    group,
    width: listWidth,
    maxHeight: listHeight,
    step,
    paint,
    numbers,
    material: section === "materials",
    labels: plan.labels,
    onMove: changes ? move : null,
    refreshing,
    onRefresh,
  });
  return (
    <View style={styles.board}>
      {toolbar}
      <DragBoard
        engine={drag}
        style={[styles.pager, { backgroundColor: paint.board, paddingBottom: insets.bottom }]}
        onLayout={(e) => setBoardH(e.nativeEvent.layout.height)}
      >
        <View
          style={styles.pager}
          accessibilityLabel={searching ? w.found(groups.reduce((n, g) => n + g.cards.length, 0)) : undefined}
        >
          <ThemeColorsOverride colors={listColors}>
            <FlatList
              ref={pager}
              horizontal
              data={columns}
              keyExtractor={columnKey}
              onGestureUpdate_CAN_CAUSE_INFINITE_RERENDER={(g) =>
                setBoardScroll((now) => (now?.handlerTag === g.handlerTag ? now : g))
              }
              renderItem={({ item, index }) =>
                item.kind === "add" ? (
                  <AddList
                    w={w}
                    client={client}
                    section={section}
                    width={listWidth}
                    paint={paint}
                    first={false}
                    onAdded={added}
                  />
                ) : item.kind === "new" ? (
                  <AddList
                    w={w}
                    client={client}
                    section={section}
                    width={listWidth}
                    paint={paint}
                    first
                    onAdded={(list) => {
                      setCreating(false);
                      added(list);
                    }}
                    onClose={() => setCreating(false)}
                  />
                ) : (
                  // The held list stays where it is in the tree (its gesture lives in its head), drawn as the hole
                  // where it would land.
                  <ListColumn
                    {...listProps(item.group)}
                    column={index}
                    listIndex={item.group.id ? ids.indexOf(item.group.id) : -1}
                    hole={item.group.id && held?.kind === "list" && item.group.id === held.id ? paint.hole : null}
                    cardDrag={drags}
                    listDrag={drags && Boolean(item.group.id)}
                    boardScroll={boardScroll}
                    held={Boolean(held)}
                    onMenu={changes && item.group.id ? menu : null}
                  />
                )
              }
              ItemSeparatorComponent={Gap}
              contentContainerStyle={styles.lists}
              style={styles.pager}
              onLayout={(e) => {
                const { width, height } = e.nativeEvent.layout;
                setBox((b) => (b.width === width && b.height === height ? b : { width, height }));
              }}
              showsHorizontalScrollIndicator={false}
              snapToInterval={step}
              decelerationRate="fast"
              disableIntervalMomentum
              scrollEnabled={!held}
              keyboardShouldPersistTaps="handled"
              scrollEventThrottle={16}
              onScroll={(e) => {
                const x = e.nativeEvent.contentOffset.x;
                drag.boardScrolled(x);
                setAt(boardIndexAt(x, step, columns.length));
              }}
            />
          </ThemeColorsOverride>
        </View>
        {held?.kind === "list" ? (
          <View style={styles.dots} />
        ) : (
          <Dots w={w} columns={columns} at={at} paint={paint} onPick={go} />
        )}
        <ThemeColorsOverride colors={listColors}>
          <DragOverlay shadow={GHOST_SHADOW} radius={held?.kind === "list" ? 20 : 12}>
            {heldList ? (
              <ListColumn
                {...listProps(heldList)}
                maxHeight={listHeight * 0.8}
                column={-1}
                listIndex={-1}
                cardDrag={false}
                listDrag={false}
                boardScroll={null}
                held
                onMenu={menu}
              />
            ) : heldCard ? (
              <BoardCard
                w={w}
                card={heldCard}
                paint={paint}
                task={numbers.get(heldCard.id)}
                material={section === "materials"}
                onMove={null}
                labels={plan.labels}
              />
            ) : null}
          </DragOverlay>
        </ThemeColorsOverride>
        {/* Over the held list: a list hangs down from the finger, and over the trash it used to hide it just as it
            turned red. */}
        {held?.kind === "list" ? <Trash w={w} reduced={reduced} bottom={insets.bottom + 8} /> : null}
      </DragBoard>
    </View>
  );
}

/** The lifted card's or list's shadow: the only shadow on the board, on the one thing in the air. */
const GHOST_SHADOW = "0px 18px 32px -12px rgba(0, 0, 0, 0.6)";

function Gap() {
  return <View style={styles.gap} />;
}

/** While a list is held: the trash at the board's foot, red when the list is over it. */
function Trash({ w, reduced, bottom }: { w: PortalWords; reduced: boolean; bottom: number }) {
  const over = useOverTrash();
  const look = useAnimatedStyle(() => ({
    backgroundColor: over.value === 1 ? "#DC2626" : "#141414",
    transform: [{ scale: over.value === 1 ? 1.08 : 1 }],
  }));
  return (
    <Animated.View
      entering={reduced ? undefined : FadeIn.duration(140)}
      exiting={reduced ? undefined : FadeOut.duration(140)}
      pointerEvents="none"
      style={[styles.trashRow, { bottom }]}
      accessibilityLiveRegion="polite"
    >
      <Animated.View style={[styles.trash, look]}>
        <Icon name="trash" size={18} color="#FFFFFF" />
        <Text variant="subhead" style={styles.trashWord}>
          {w.dropToDelete}
        </Text>
      </Animated.View>
    </Animated.View>
  );
}

/** Which list is in front, as dots that take you to another; a line of words past `DOTS_MAX` lists. */
function Dots({
  w,
  columns,
  at,
  paint,
  onPick,
}: {
  w: PortalWords;
  columns: Column[];
  at: number;
  paint: Paint;
  onPick: (index: number) => void;
}) {
  return (
    <BoardDots
      w={w}
      at={at}
      paint={paint}
      onPick={onPick}
      items={columns.map((col) => ({
        key: columnKey(col),
        name: col.kind === "add" || col.kind === "new" ? w.addList : (col.group.name ?? w.noList),
        plus: col.kind !== "list",
      }))}
    />
  );
}

/**
 * The dots under a board (the Cronograma's lists, the Quadro's columns): one per column, the one in front long, a
 * press going to it; a line of words past `DOTS_MAX`. `color`: a column's own dot color (the Quadro's stages).
 */
export function BoardDots({
  w,
  items,
  at,
  paint,
  onPick,
}: {
  w: PortalWords;
  items: { key: string; name: string; plus?: boolean; color?: string }[];
  at: number;
  paint: Paint;
  onPick: (index: number) => void;
}) {
  if (items.length < 2) return <View style={styles.dots} />;
  if (items.length > DOTS_MAX) {
    return (
      <View style={styles.dots}>
        <Text variant="footnote" style={{ color: paint.dot }}>
          {w.listOf(at + 1, items.length)}
        </Text>
      </View>
    );
  }
  return (
    <View style={styles.dots}>
      {items.map((item, i) => {
        const on = i === at;
        const tint = on ? (item.color ?? paint.dotOn) : (item.color ?? paint.dot);
        return (
          <Pressable
            key={item.key}
            onPress={() => onPick(i)}
            hitSlop={{ top: 12, bottom: 12, left: 3, right: 3 }}
            accessibilityRole="button"
            accessibilityState={{ selected: on }}
            accessibilityLabel={w.goToList(item.name)}
            style={styles.dotHit}
          >
            {item.plus ? (
              <Icon name="plus" size={10} color={tint} />
            ) : (
              <View
                style={[
                  styles.dot,
                  on ? styles.dotOn : null,
                  { backgroundColor: tint, opacity: item.color && !on ? 0.45 : 1 },
                ]}
              />
            )}
          </Pressable>
        );
      })}
    </View>
  );
}

type ListMenu = (group: PlanGroup, rename: () => void) => void;

/**
 * One list: its head (a tap on the name renames it, the "…" holds the rest, a hold anywhere on it lifts the list), its
 * cards scrolling inside it (each one dragged by itself), and "Adicionar cartão" at its foot. `column` -1: the copy in
 * the air, which takes no part in the board's drag.
 */
function ListColumn({
  w,
  client,
  group,
  width,
  maxHeight,
  step,
  paint,
  numbers,
  material,
  labels,
  onMove,
  refreshing,
  onRefresh,
  column,
  listIndex,
  cardDrag,
  listDrag,
  boardScroll,
  held,
  onMenu = null,
  hole = null,
}: {
  w: PortalWords;
  client: string;
  group: PlanGroup;
  width: number;
  maxHeight: number;
  step: number;
  paint: Paint;
  numbers: Map<string, number>;
  material: boolean;
  labels: readonly PortalLabel[];
  onMove: ((card: PlanCard) => void) | null;
  refreshing: boolean;
  onRefresh: () => void;
  /** Its column on the board, and its place among the lists (-1: not a list of the board). */
  column: number;
  listIndex: number;
  cardDrag: boolean;
  listDrag: boolean;
  boardScroll: NativeGesture | null;
  /** Something on the board is held: the list keeps still. */
  held: boolean;
  onMenu?: ListMenu | null;
  /** Held: only its place shows, in this color. */
  hole?: string | null;
}) {
  const live = column >= 0;
  const listRef = useAnimatedRef<Animated.View>();
  const slid = useListSlide(live ? listIndex : -1, step);
  const [adding, setAdding] = useState(false);
  const [renaming, setRenaming] = useState(false);
  const [listScroll, setListScroll] = useState<NativeGesture | null>(null);
  const dragged = useDragged();
  // While the composer is open, a card just added comes into sight at the list's end, the field still open under it
  // for the next one, as Trello's.
  const cardsView = useRef<ComponentRef<typeof ScrollView>>(null);
  const cardCount = group.cards.length;
  // biome-ignore lint/correctness/useExhaustiveDependencies: runs again when a card lands in the list.
  useEffect(() => {
    if (!adding) return;
    const t = setTimeout(() => cardsView.current?.scrollToEnd({ animated: true }), 60);
    return () => clearTimeout(t);
  }, [adding, cardCount]);
  // Its cards' box on the board, for the drag: kept as last laid out, and handed again when its column changes.
  // The cards' box starts under the head, on the lists' first line; the cards 8 in from the list's sides.
  const [headH, setHeadH] = useState(0);
  const box = useDragListBox(column, live, cardsView, { top: LISTS_TOP + headH, left: 0, padX: 8, padTop: 0 });

  const id = group.id;
  const scrollGestures = [boardScroll, listScroll];
  const head = (
    <View style={styles.listHead} onLayout={(e) => setHeadH(e.nativeEvent.layout.height)}>
      {renaming && id ? (
        <RenameField w={w} client={client} listId={id} name={group.name ?? ""} onClose={() => setRenaming(false)} />
      ) : (
        <Pressable
          onPress={onMenu && id ? () => !dragged.current && setRenaming(true) : undefined}
          disabled={!onMenu || !id}
          accessibilityRole={onMenu ? "button" : "header"}
          accessibilityLabel={group.name ?? w.noList}
          accessibilityHint={onMenu ? `${w.renameList}. ${w.holdList}` : undefined}
          style={styles.listNameHit}
        >
          <Text variant="subhead" style={styles.listName}>
            {group.name ?? w.noList}
          </Text>
        </Pressable>
      )}
      <Text variant="footnote" tone="muted" style={[styles.tabular, styles.listCount]}>
        {String(group.cards.length)}
      </Text>
      {onMenu && id ? (
        <IconButton
          icon="more"
          small
          label={w.listActions(group.name ?? "")}
          onPress={() => !dragged.current && onMenu(group, () => setRenaming(true))}
        />
      ) : null}
    </View>
  );
  return (
    <Animated.View
      ref={listRef}
      collapsable={false}
      style={[styles.list, { width, maxHeight, backgroundColor: hole ?? paint.list }, live ? slid : null]}
    >
      <View style={[styles.listBody, hole ? styles.hidden : null]}>
        {live && listDrag && id ? (
          <DragListHead
            id={id}
            column={column}
            index={listIndex}
            enabled={!renaming}
            listRef={listRef}
            scrollGestures={[boardScroll]}
          >
            {head}
          </DragListHead>
        ) : (
          head
        )}
        <ScrollView
          ref={cardsView}
          style={styles.cardsScroll}
          contentContainerStyle={styles.cards}
          showsVerticalScrollIndicator={false}
          keyboardShouldPersistTaps="handled"
          scrollEnabled={!held}
          scrollEventThrottle={16}
          onGestureUpdate_CAN_CAUSE_INFINITE_RERENDER={(g) =>
            setListScroll((now) => (now?.handlerTag === g.handlerTag ? now : g))
          }
          {...box}
          refreshControl={live ? <RefreshControl refreshing={refreshing} onRefresh={onRefresh} /> : undefined}
        >
          {group.cards.map((card, k) =>
            live ? (
              <DragCard
                key={card.id}
                id={card.id}
                L={column}
                k={k}
                enabled={cardDrag && !renaming}
                scrollGestures={scrollGestures}
              >
                <BoardCard
                  w={w}
                  card={card}
                  paint={paint}
                  task={numbers.get(card.id)}
                  material={material}
                  onMove={onMove}
                  labels={labels}
                  dragged={dragged}
                />
              </DragCard>
            ) : (
              <BoardCard
                key={card.id}
                w={w}
                card={card}
                paint={paint}
                task={numbers.get(card.id)}
                material={material}
                onMove={null}
                labels={labels}
              />
            ),
          )}
          {live ? <DragListEnd L={column} color={paint.slot} /> : null}
        </ScrollView>
        {onMove ? (
          adding ? (
            <AddCard w={w} client={client} group={group} paint={paint} onClose={() => setAdding(false)} />
          ) : (
            <Pressable
              onPress={() => setAdding(true)}
              accessibilityRole="button"
              style={({ pressed }) => [styles.addRow, pressed ? styles.pressed : null]}
            >
              <AddLabel label={w.addCard} />
            </Pressable>
          )
        ) : (
          <View style={styles.listFoot} />
        )}
      </View>
    </Animated.View>
  );
}

/** A list's name in place, as Trello's: saved on return or when the field loses focus, an empty name changes nothing. */
function RenameField({
  w,
  client,
  listId,
  name,
  onClose,
}: {
  w: PortalWords;
  client: string;
  listId: string;
  name: string;
  onClose: () => void;
}) {
  const { colors: c } = useTheme();
  const orgId = useOrgId();
  const failed = usePortalFailed();
  const field = useFieldText("subhead");
  const lists = usePortalLists(orgId, client);
  const [text, setText] = useState(name);
  const done = useRef(false);
  const save = () => {
    if (done.current) return;
    done.current = true;
    const next = text.trim();
    if (next && next !== name) lists.rename.mutate({ listId, name: next }, { onError: failed });
    onClose();
  };
  return (
    <TextInput
      value={text}
      onChangeText={setText}
      accessibilityLabel={w.renameList}
      autoFocus
      selectTextOnFocus
      maxLength={80}
      returnKeyType="done"
      onSubmitEditing={save}
      onBlur={save}
      style={[styles.renameField, field, { color: c.ink, backgroundColor: c.raised2, borderColor: c.green }]}
    />
  );
}

/** "+ Adicionar …": the plus and the words, quiet, as Trello's list foot. */
function AddLabel({ label }: { label: string }) {
  const { colors: c } = useTheme();
  return (
    <View style={styles.addLabel}>
      <Icon name="plus" size={16} color={c.muted} />
      <Text variant="subhead" tone="muted">
        {label}
      </Text>
    </View>
  );
}

/**
 * A card on the board, as the web's (`CardFace`): its title whole first, then where it is (the stage's dot and word,
 * its task's number) and a line of what it holds (the post's date, a description, the checklist, comments, files).
 * No cover picture: the board is for reading the plan at a glance; the pictures are in the card when it opens.
 */
export function BoardCard({
  w,
  card,
  paint,
  task,
  material,
  onMove,
  typeFirst = false,
  dragged,
  onAction,
  labels = [],
}: {
  w: PortalWords;
  card: PlanCard;
  paint: Paint;
  task: number | undefined;
  material: boolean;
  onMove: ((card: PlanCard) => void) | null;
  /** In a column that already names the stage (the Quadro): the pill says the type, in the stage's color. */
  typeFirst?: boolean;
  /** Set while the card is being dragged by a gesture around it: the press that ends the drag opens nothing. */
  dragged?: { current: boolean };
  /** A screen reader's way to do what a drag does. */
  onAction?: { label: string; hint: string; run: () => void } | null;
  /** The board's labels: the card's show as colored bars over its title, as Trello's. */
  labels?: readonly PortalLabel[];
}) {
  const { i18n } = useTranslation();
  const { colors: c } = useTheme();
  const badges = cardBadges(card);
  const tags = cardLabels(card, labels);
  const toast = useToast();
  const { changes } = usePortalRights();
  const ready = changes && readyToSend(card);
  const send = useSendCard(card, () => toast({ title: w.sending(portalClientName(card.client)), icon: "check" }));
  const day = material ? null : portalWhen(i18n.language, card.postOn);
  const stage = card.stage === "posted" ? w.status.published : w.columns[card.stage];
  const facts: { icon: IconName; text?: string; label: string }[] = [
    ...(day ? [{ icon: "calendar" as const, text: day, label: `${w.postOn}: ${day}` }] : []),
    ...(badges.described ? [{ icon: "text" as const, label: w.description }] : []),
    ...(badges.checks
      ? [
          {
            icon: "checkc" as const,
            text: `${badges.checks.done}/${badges.checks.total}`,
            label: w.checks(badges.checks.done, badges.checks.total),
          },
        ]
      : []),
    ...(badges.comments > 0
      ? [{ icon: "message" as const, text: String(badges.comments), label: `${w.comments}: ${badges.comments}` }]
      : []),
    ...(badges.files > 0
      ? [{ icon: "file" as const, text: String(badges.files), label: w.fileCount(badges.files) }]
      : []),
  ];
  const spoken = [
    card.title,
    material ? null : stage,
    typeFirst ? w.types[card.type] : null,
    ...tags.map((l) => l.name),
    card.done ? w.done : null,
    task !== undefined ? `#${task}` : null,
    ...facts.map((f) => f.label),
  ]
    .filter(Boolean)
    .join(", ");
  return (
    <Pressable
      onPress={() => {
        if (!dragged?.current) openCard(card.client, card.id);
      }}
      {...(onAction
        ? {
            accessibilityActions: [{ name: "move", label: onAction.label }],
            onAccessibilityAction: (e: { nativeEvent: { actionName: string } }) => {
              if (e.nativeEvent.actionName === "move") onAction.run();
            },
          }
        : {})}
      {...(onMove
        ? {
            accessibilityActions: [{ name: "move", label: w.moveCard }],
            onAccessibilityAction: (e: { nativeEvent: { actionName: string } }) => {
              if (e.nativeEvent.actionName === "move") onMove(card);
            },
          }
        : {})}
      accessibilityRole="button"
      accessibilityLabel={spoken}
      accessibilityHint={onAction ? onAction.hint : onMove ? w.moveCard : undefined}
      style={({ pressed }) => [
        styles.card,
        { backgroundColor: paint.card, borderColor: paint.edge },
        pressed ? styles.pressed : null,
      ]}
    >
      <View style={card.done && !ready ? styles.done : null}>
        {tags.length > 0 ? (
          <View style={styles.labels}>
            {tags.map((l) => (
              <View key={l.id} style={[styles.label, { backgroundColor: LABEL_COLOR[l.color] }]}>
                {l.name ? (
                  <Text variant="caption" style={styles.labelWord}>
                    {l.name}
                  </Text>
                ) : null}
              </View>
            ))}
          </View>
        ) : null}
        {material && task === undefined && !card.done ? null : (
          <View style={styles.cardTop}>
            {material ? null : <StagePill stage={card.stage} {...(typeFirst ? { label: w.types[card.type] } : {})} />}
            {card.done ? (
              <View style={styles.doneMark}>
                <Icon name="check" size={13} color={c.greenText} />
                <Text variant="caption" style={[styles.stageWord, { color: c.greenText }]}>
                  {w.done}
                </Text>
              </View>
            ) : null}
            {task !== undefined ? (
              <Text variant="caption" tone="faint" style={[styles.task, styles.tabular]}>
                {`#${task}`}
              </Text>
            ) : null}
          </View>
        )}
        <Text variant="subhead" style={styles.title}>
          {card.title}
        </Text>
        {facts.length > 0 ? (
          <View style={styles.facts}>
            {facts.map((f) => (
              <View key={f.icon} style={styles.fact}>
                <Icon name={f.icon} size={13} color={c.muted} />
                {f.text ? (
                  <Text variant="caption" tone="muted" style={styles.tabular}>
                    {f.text}
                  </Text>
                ) : null}
              </View>
            ))}
          </View>
        ) : null}
      </View>
      {/* Done and with its files, the card goes up for approval from here, as from its own screen. */}
      {/* Small on the board: the green pill at the card's start, not the card's whole width. */}
      {ready ? (
        <View style={styles.sendRow}>
          <Button
            variant="primary"
            size="sm"
            icon="send"
            label={w.send}
            onPress={() => {
              if (!dragged?.current) send.confirm();
            }}
            loading={send.pending}
          />
        </View>
      ) : null}
    </Pressable>
  );
}

/**
 * A card's quick actions, when it is held and let go where it was (and a screen reader's "move"), as Trello's: open it, move it to another list, put on or take off a
 * label, set its post date, mark it finished (Trello's archive: a finished card stays in its list as history). Each
 * runs once the menu is gone, so its own picker never lands under it.
 */
function useMoveCard(client: string, plan: PortalPlan) {
  const w = usePortalWords();
  const { i18n } = useTranslation();
  const orgId = useOrgId();
  const toast = useToast();
  const failed = usePortalFailed();
  const move = useMovePortalCard(orgId, client);
  const save = useSavePortalCard(orgId);
  const toList = async (card: PlanCard) => {
    const lists = listsFor(plan, card);
    const options = [
      ...lists.map((l) => ({ key: l.id, label: l.name })),
      ...(card.material ? [] : [{ key: NO_LIST, label: w.noList }]),
    ];
    const key = await pickOne({ title: w.moveCardTitle(card.title), options, value: card.list ?? NO_LIST });
    if (key === null) return;
    const list = key === NO_LIST ? null : key;
    if (list === card.list) return;
    const others = (list === null ? plan.unlisted : (plan.lists.find((l) => l.id === list)?.cards ?? [])).filter(
      (x) => x.id !== card.id,
    );
    const name = options.find((o) => o.key === key)?.label ?? "";
    move.mutate(
      { cardId: card.id, list, order: portalOrderAt(others, others.length) },
      { onSuccess: () => toast({ title: w.moved(name), icon: "check" }), onError: failed },
    );
  };
  const toLabel = async (card: PlanCard) => {
    const key = await pickOne({
      title: w.labelsTitle,
      options: plan.labels.map((l) => ({
        key: l.id,
        label: l.name || w.labels,
        sub: card.labels.includes(l.id) ? w.onCard : undefined,
        leading: {
          kind: "node" as const,
          node: <View style={[styles.swatch, { backgroundColor: LABEL_COLOR[l.color] }]} />,
        },
      })),
    });
    if (key === null) return;
    const label = plan.labels.find((l) => l.id === key);
    const on = !card.labels.includes(key);
    save.mutate(
      { cardId: card.id, labels: toggledLabels(card.labels, key) },
      {
        onSuccess: () =>
          toast({ title: on ? w.labelOn(label?.name ?? "") : w.labelOff(label?.name ?? ""), icon: "check" }),
        onError: failed,
      },
    );
  };
  const toDate = async (card: PlanCard) => {
    const now = new Date();
    const days = scheduleDays(now, 21, portalDayOf(card.date));
    const dayName = (d: string, i: number) =>
      i === 0
        ? w.today
        : i === 1
          ? w.tomorrow
          : new Intl.DateTimeFormat(i18n.language, { weekday: "long", day: "numeric", month: "short" }).format(
              new Date(Number(d.slice(0, 4)), Number(d.slice(5, 7)) - 1, Number(d.slice(8, 10))),
            );
    const key = await pickOne({
      title: w.postOn,
      options: [{ key: NO_LIST, label: w.noDate }, ...days.map((d, i) => ({ key: d, label: dayName(d, i) }))],
      value: portalDayOf(card.date) ?? NO_LIST,
    });
    if (key === null) return;
    const date = key === NO_LIST ? null : key;
    if (date === portalDayOf(card.date)) return;
    save.mutate(
      { cardId: card.id, date },
      {
        onSuccess: () =>
          toast({ title: date ? w.dateSet(portalWhen(i18n.language, date) ?? date) : w.dateCleared, icon: "check" }),
        onError: failed,
      },
    );
  };
  return (card: PlanCard) => {
    showActionSheet(w.cardActions(card.title), [
      { label: w.openCard, onPress: () => openCard(card.client, card.id) },
      { label: w.moveToList, onPress: () => void toList(card) },
      ...(plan.labels.length > 0 ? [{ label: w.labels, onPress: () => void toLabel(card) }] : []),
      ...(card.material ? [] : [{ label: w.postDate, onPress: () => void toDate(card) }]),
      ...(card.material
        ? []
        : [
            {
              label: card.done ? w.reopen : w.markDone,
              onPress: () =>
                save.mutate(
                  { cardId: card.id, done: !card.done },
                  {
                    onSuccess: () => toast({ title: card.done ? w.reopened : w.markedDone, icon: "check" }),
                    onError: failed,
                  },
                ),
            },
          ]),
    ]);
  };
}

/** A new card's title at a list's foot: added at the list's end on Adicionar or the keyboard's return; it stays open. */
function AddCard({
  w,
  client,
  group,
  paint,
  onClose,
}: {
  w: PortalWords;
  client: string;
  group: PlanGroup;
  paint: Paint;
  onClose: () => void;
}) {
  const { colors: c } = useTheme();
  const orgId = useOrgId();
  const failed = usePortalFailed();
  const field = useFieldText("subhead");
  const save = useSavePortalCard(orgId);
  const [title, setTitle] = useState("");
  const add = () => {
    const words = title.trim();
    if (!words) return;
    save.mutate(
      { client, title: words, list: group.id, order: portalOrderAt(group.cards, group.cards.length) },
      { onError: failed },
    );
    setTitle("");
  };
  return (
    <View style={styles.form}>
      <TextInput
        value={title}
        onChangeText={setTitle}
        placeholder={w.cardTitle}
        placeholderTextColor={c.faint}
        accessibilityLabel={w.cardTitle}
        autoFocus
        maxLength={120}
        returnKeyType="done"
        submitBehavior="submit"
        onSubmitEditing={add}
        style={[styles.field, field, { color: c.ink, backgroundColor: paint.card, borderColor: paint.edge }]}
      />
      <View style={styles.formActs}>
        <Button variant="primary" size="sm" label={w.add} onPress={add} disabled={!title.trim()} />
        <IconButton icon="x" small label={w.cancel} onPress={onClose} />
      </View>
    </View>
  );
}

/**
 * A new list's name: at the board's end ("Adicionar lista", the portal puts it last) or, from the "+" over the board,
 * as the first column, open at once (`first`: the list is made first, `createFirst`). Either way the board shows the
 * new list where it lands, by its id (`onAdded`), never by a column count read before the board had it.
 */
function AddList({
  w,
  client,
  section,
  width,
  paint,
  first,
  onAdded,
  onClose,
}: {
  w: PortalWords;
  client: string;
  section: PortalListKind;
  width: number;
  paint: Paint;
  first: boolean;
  onAdded: (list: PortalList) => void;
  onClose?: () => void;
}) {
  const { colors: c } = useTheme();
  const orgId = useOrgId();
  const failed = usePortalFailed();
  const field = useFieldText("subhead");
  const lists = usePortalLists(orgId, client);
  const make = first ? lists.createFirst : lists.create;
  const [open, setOpen] = useState(first);
  const [name, setName] = useState("");
  const close = () => {
    setOpen(false);
    setName("");
    onClose?.();
  };
  const add = () => {
    const words = name.trim();
    if (!words || make.isPending) return;
    make.mutate(
      { name: words, kind: section },
      {
        onSuccess: (list) => {
          setName("");
          if (!first) setOpen(false);
          onAdded(list);
        },
        onError: failed,
      },
    );
  };
  return (
    <View style={[styles.list, styles.addList, { width, backgroundColor: paint.list }]}>
      {open ? (
        <View style={styles.form}>
          <TextInput
            value={name}
            onChangeText={setName}
            placeholder={w.listName}
            placeholderTextColor={c.faint}
            accessibilityLabel={w.listName}
            autoFocus
            maxLength={80}
            returnKeyType="done"
            submitBehavior="submit"
            onSubmitEditing={add}
            style={[styles.field, field, { color: c.ink, backgroundColor: paint.card, borderColor: paint.edge }]}
          />
          <View style={styles.formActs}>
            <Button
              variant="primary"
              size="sm"
              label={w.add}
              onPress={add}
              disabled={!name.trim()}
              loading={make.isPending}
            />
            <IconButton icon="x" small label={w.cancel} onPress={close} />
          </View>
        </View>
      ) : (
        <Pressable
          onPress={() => setOpen(true)}
          accessibilityRole="button"
          style={({ pressed }) => [styles.addRow, pressed ? styles.pressed : null]}
        >
          <AddLabel label={w.addList} />
        </Pressable>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  board: { flex: 1 },
  pager: { flex: 1 },
  // The search and "+" over the board: the screen's 16 at the sides, 12 to the board under them.
  toolbar: { flexDirection: "row", alignItems: "center", gap: 8, paddingHorizontal: 16, paddingBottom: 12 },
  searchBox: { flex: 1, minWidth: 160 },
  // As tall and as round as the search beside it.
  plus: { width: 44, height: 44, borderRadius: 12, alignItems: "center", justifyContent: "center" },
  lists: {
    paddingHorizontal: BOARD.side,
    paddingTop: LISTS_TOP,
    paddingBottom: LISTS_BOTTOM,
    alignItems: "flex-start",
  },
  gap: { width: BOARD.gap },
  list: { borderRadius: 20, overflow: "hidden" },
  listBody: { flexShrink: 1 },
  hidden: { opacity: 0 },
  ghost: { position: "absolute", top: LISTS_TOP, left: 0, borderRadius: 20 },
  // The name's line centred on the 32 "…" beside it: 6 above a 20 line.
  listHead: {
    flexDirection: "row",
    alignItems: "flex-start",
    gap: 4,
    paddingLeft: 12,
    paddingRight: 4,
    paddingTop: 6,
    paddingBottom: 6,
  },
  listNameHit: { flex: 1, minWidth: 0, paddingVertical: 6 },
  listName: { fontWeight: "700" },
  renameField: {
    flex: 1,
    minWidth: 0,
    minHeight: 32,
    borderRadius: 8,
    borderWidth: 2,
    paddingHorizontal: 8,
  },
  tabular: { fontVariant: ["tabular-nums"] },
  // The count's smaller line sits on the name's first line.
  listCount: { paddingTop: 7, paddingHorizontal: 4 },
  cardsScroll: { flexGrow: 0, flexShrink: 1 },
  cards: { paddingHorizontal: 8, paddingBottom: 4, gap: 8 },
  listFoot: { height: 8 },
  // Inside the list's 20, 8 in: 12 (rounded inside rounded).
  // Trello's density: 10 over and under, 12 at the sides.
  card: {
    borderRadius: 12,
    borderWidth: StyleSheet.hairlineWidth,
    paddingVertical: 10,
    paddingHorizontal: 12,
    gap: 10,
  },
  cardTop: { flexDirection: "row", alignItems: "center", flexWrap: "wrap", gap: 8, marginBottom: 6 },
  // Labels as Trello's colored bars: the name inside in white, a bar alone when it has none.
  labels: { flexDirection: "row", flexWrap: "wrap", gap: 4, marginBottom: 8 },
  label: { minWidth: 40, minHeight: 8, borderRadius: 4, paddingHorizontal: 6, justifyContent: "center" },
  labelWord: { color: "#FFFFFF", fontWeight: "700", lineHeight: 16 },
  stageWord: { fontWeight: "600" },
  doneMark: { flexDirection: "row", alignItems: "center", gap: 4 },
  title: { fontWeight: "600" },
  task: { marginLeft: "auto" },
  sendRow: { flexDirection: "row" },
  // What the card holds, as Trello's badges: a quiet line under the title.
  facts: {
    flexDirection: "row",
    flexWrap: "wrap",
    alignItems: "center",
    columnGap: 12,
    rowGap: 4,
    marginTop: 8,
  },
  fact: { flexDirection: "row", alignItems: "center", gap: 4 },
  done: { opacity: 0.6 },
  pressed: { opacity: 0.7 },
  // The plus lines up with the cards' words: the list's 8 to the card, the card's 12 to its words.
  addRow: { minHeight: 44, justifyContent: "center", paddingHorizontal: 20 },
  addLabel: { flexDirection: "row", alignItems: "center", gap: 8 },
  swatch: { width: 28, height: 12, borderRadius: 4 },
  addList: { alignSelf: "flex-start" },
  form: { padding: 8, gap: 8 },
  field: { minHeight: 40, borderRadius: 8, borderWidth: StyleSheet.hairlineWidth, paddingHorizontal: 12 },
  formActs: { flexDirection: "row", alignItems: "center", gap: 8 },
  dots: { height: DOTS_H, flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 6 },
  dotHit: { height: 16, minWidth: 8, alignItems: "center", justifyContent: "center" },
  dot: { width: 6, height: 6, borderRadius: 3 },
  dotOn: { width: 16 },
  // The trash takes the dots' place and rises over the lists' feet, 8 from the board's bottom.
  trashRow: { position: "absolute", left: 0, right: 0, alignItems: "center" },
  trash: {
    height: TRASH_H,
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    paddingHorizontal: 16,
    borderRadius: 14,
  },
  trashWord: { color: "#FFFFFF", fontWeight: "600" },
});
