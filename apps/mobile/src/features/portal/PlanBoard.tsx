import type { PlanCard, PortalList, PortalListKind, PortalPlan } from "@agenteschat/client";
import { keys, useMovePortalCard, usePortalLists, useSavePortalCard } from "@agenteschat/client";
import { portalClientName, portalOrderAt, portalWhen } from "@agenteschat/client/lib/portal";
import { useQueryClient } from "@tanstack/react-query";
import { type ComponentRef, useEffect, useMemo, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { Alert, FlatList, Pressable, RefreshControl, ScrollView, StyleSheet, TextInput, View } from "react-native";
import { GestureDetector, usePanGesture } from "react-native-gesture-handler";
import Animated, {
  FadeIn,
  FadeOut,
  useAnimatedStyle,
  useReducedMotion,
  useSharedValue,
  withTiming,
} from "react-native-reanimated";
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
import { usePortalFailed, usePortalRights, usePortalWords, useSendCard } from "./hooks";
import {
  BOARD,
  boardIndexAt,
  boardListWidth,
  boardPaint,
  boardQuery,
  cardBadges,
  edgeScroll,
  listShift,
  listSlotAt,
  listsFor,
  orderAfterDrop,
  orderNudged,
  type PlanGroup,
  planGroups,
  readyToSend,
  STAGE_COLOR,
  searchGroups,
} from "./model";
import { openCard } from "./parts";
import type { PortalWords } from "./words";

type Paint = ReturnType<typeof boardPaint>;
type Column = { kind: "list"; group: PlanGroup } | { kind: "add" } | { kind: "new" };

/** The dots' row under the lists. */
const DOTS_H = 36;
/** Past this many lists the dots would crowd the row: one line says which list it is instead. */
const DOTS_MAX = 14;
/** The pick that means "in no list" (a list's id is never empty). */
const NO_LIST = "";
/** A long press on a list's name picks the list up (a card's own long press is 350 too, and is a separate target). */
const HOLD_MS = 350;
/** The trash at the board's foot while a list is held: the finger this close to the bottom is over it. */
const TRASH_ZONE = 88;
const TRASH_H = 48;
/** The held list's tilt, as Trello's. */
const TILT = "3deg";

const columnKey = (col: Column) => (col.kind === "add" ? "+" : col.kind === "new" ? "new" : (col.group.id ?? "none"));

/**
 * A client's schedule, or its materials, as Trello's app shows a board on a phone (ADR 9001): a search and "+" (a new
 * list, first) over the board; the lists side by side, one across the screen with the next one's edge in sight, a
 * swipe stopping on each; dots under them say which one is in front and take you to another. The board is light, the
 * lists and cards dark on it, in both themes. A card's press opens it, its long press moves it to another list; a
 * list's name renames it, its "…" holds the rest, and a long press on its name lifts it to drag it to another place
 * or onto the trash. Only whoever may change the board sees the ways to change it.
 */
export function PlanBoard({
  client,
  plan,
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
  const reduced = useReducedMotion();
  const insets = useSafeAreaInsets();
  // The lists' own box, not the window's: a list fits what the board was given (a split screen, a sheet), and a list
  // is never taller than the room above the dots.
  const [box, setBox] = useState({ width: 0, height: 0 });
  const listWidth = boardListWidth(box.width);
  const step = listWidth + BOARD.gap;
  const { changes } = usePortalRights();
  const [at, setAt] = useState(0);
  const [search, setSearch] = useState("");
  const [creating, setCreating] = useState(false);
  const [focus, setFocus] = useState<string | null>(null);
  const pager = useRef<FlatList<Column>>(null);
  const boardView = useRef<ComponentRef<typeof View>>(null);
  const move = useMoveCard(client, plan);
  const query = boardQuery(search);
  const all = planGroups(plan, section);
  const ids = all.flatMap((g) => (g.id ? [g.id] : []));

  // A held list: where it came from, the slot it would land in, whether it is over the trash. The gesture's callbacks
  // read the ref (always the latest); the screen draws from the state.
  const [held, setHeld] = useState<{ id: string; slot: number; trash: boolean } | null>(null);
  const drag = useRef({ id: "", from: 0, slot: 0, trash: false, x: 0, y: 0, grab: 0, left: 0, top: 0, scroll: 0 });
  const scrollX = useRef(0);
  const ticker = useRef<ReturnType<typeof setInterval> | null>(null);
  const ghostX = useSharedValue(0);
  const ghostY = useSharedValue(0);

  // While a list is held nothing changes place in the tree (a view taken out and put back loses the finger): the
  // lists slide aside instead (`listShift`), and the order is saved on the drop.
  const groups = held ? all : searchGroups(all, query, numbers, plan.labels);
  const heldGroup = held ? all.find((g) => g.id === held.id) : undefined;
  const columns: Column[] = [
    ...(creating ? [{ kind: "new" as const }] : []),
    ...groups.map((group) => ({ kind: "list" as const, group })),
    ...(changes && !query ? [{ kind: "add" as const }] : []),
  ];
  const go = (index: number, animated = true) =>
    pager.current?.scrollToOffset({ offset: Math.max(0, index) * step, animated });

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

  useEffect(
    () => () => {
      if (ticker.current) clearInterval(ticker.current);
    },
    [],
  );

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

  const remove = (group: PlanGroup) => {
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
  };

  const reorder = (next: string[] | null) => {
    if (!next || next.join() === ids.join()) return;
    lists.order.mutate(next, { onError: failed });
  };

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

  // Moving a list: picked up by a long press on its name, dragged sideways (the board scrolls near its sides),
  // dropped in its new place or on the trash.
  const lists0 = creating ? 1 : 0;
  const slotNow = () => {
    const d = drag.current;
    return listSlotAt(d.scroll - lists0 * step, d.x, step, ids.length);
  };
  const follow = () => {
    const d = drag.current;
    ghostX.value = d.x - d.grab;
    const slot = slotNow();
    const trash = d.y > box.height - TRASH_ZONE;
    if (slot !== d.slot || trash !== d.trash) {
      if (slot !== d.slot && !trash) haptics.selection();
      if (trash && !d.trash) haptics.medium();
      d.slot = slot;
      d.trash = trash;
      setHeld({ id: d.id, slot, trash });
    }
  };
  const measureBoard = () =>
    boardView.current?.measureInWindow((x, y) => {
      drag.current.left = x;
      drag.current.top = y;
    });
  const lift = (id: string, e: { x: number; absoluteX: number; absoluteY: number }) => {
    const d = drag.current;
    measureBoard();
    const from = ids.indexOf(id);
    Object.assign(d, {
      id,
      from,
      slot: from,
      trash: false,
      grab: e.x,
      scroll: scrollX.current,
      x: e.absoluteX - d.left,
      y: e.absoluteY - d.top,
    });
    ghostX.value = d.x - d.grab;
    ghostY.value = 0;
    haptics.medium();
    setHeld({ id, slot: from, trash: false });
    if (ticker.current) clearInterval(ticker.current);
    ticker.current = setInterval(() => {
      const end = Math.max(0, (columns.length - 1) * step);
      const by = edgeScroll(d.x, box.width);
      const next = Math.min(end, Math.max(0, d.scroll + by));
      if (next === d.scroll) return;
      d.scroll = next;
      pager.current?.scrollToOffset({ offset: next, animated: false });
      follow();
    }, 16);
  };
  const dragTo = (e: { absoluteX: number; absoluteY: number; translationY: number }) => {
    const d = drag.current;
    if (!d.id) return;
    d.x = e.absoluteX - d.left;
    d.y = e.absoluteY - d.top;
    ghostY.value = e.translationY;
    follow();
  };
  const drop = (commit: boolean) => {
    const d = drag.current;
    if (ticker.current) clearInterval(ticker.current);
    ticker.current = null;
    if (!d.id) return;
    const { id, slot, trash, from } = d;
    d.id = "";
    setHeld(null);
    const group = all.find((g) => g.id === id);
    if (!commit || !group) return;
    if (trash) {
      remove(group);
      return;
    }
    if (slot !== from) {
      haptics.success();
      reorder(orderAfterDrop(ids, id, slot));
    } else haptics.light();
    go(slot + lists0);
  };

  const ghost = useAnimatedStyle(() => ({
    transform: [
      { translateX: ghostX.value },
      { translateY: ghostY.value },
      { rotate: reduced ? "0deg" : TILT },
      { scale: reduced ? 1 : 1.03 },
    ],
  }));

  const searching = query !== null;
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
  const listHeight = box.height;
  const liftFor = (group: PlanGroup): Lift | null =>
    changes && group.id && !searching && !creating ? { onLift: lift, onDrag: dragTo, onDrop: drop } : null;
  const listProps = (group: PlanGroup) => ({
    w,
    client,
    group,
    width: listWidth,
    maxHeight: listHeight,
    paint,
    numbers,
    material: section === "materials",
    onMove: changes ? move : null,
    refreshing,
    onRefresh,
  });
  return (
    <View style={styles.board}>
      {toolbar}
      <View
        ref={boardView}
        style={[styles.pager, { backgroundColor: paint.board, paddingBottom: insets.bottom }]}
        onLayout={measureBoard}
        accessibilityLabel={searching ? w.found(groups.reduce((n, g) => n + g.cards.length, 0)) : undefined}
      >
        <ThemeColorsOverride colors={listColors}>
          <FlatList
            ref={pager}
            horizontal
            data={columns}
            keyExtractor={columnKey}
            renderItem={({ item }) =>
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
                // The held list stays where it is in the tree (its gesture lives in its head), drawn as the hole where
                // it would land.
                <ListColumn
                  {...listProps(item.group)}
                  hole={item.group.id && item.group.id === held?.id ? paint.hole : null}
                  shift={
                    held && item.group.id
                      ? listShift(ids.indexOf(item.group.id), ids.indexOf(held.id), held.slot) * step
                      : 0
                  }
                  lift={liftFor(item.group)}
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
            scrollEventThrottle={32}
            onScroll={(e) => {
              scrollX.current = e.nativeEvent.contentOffset.x;
              if (!drag.current.id) drag.current.scroll = scrollX.current;
              setAt(boardIndexAt(e.nativeEvent.contentOffset.x, step, columns.length));
            }}
          />
          {heldGroup ? (
            <Animated.View
              pointerEvents="none"
              style={[styles.ghost, { width: listWidth, boxShadow: GHOST_SHADOW }, ghost]}
            >
              <ListColumn {...listProps(heldGroup)} maxHeight={listHeight * 0.8} lift={null} onMenu={menu} />
            </Animated.View>
          ) : null}
        </ThemeColorsOverride>
        {held ? (
          <>
            <View style={styles.dots} />
            <Trash w={w} over={held.trash} reduced={reduced} bottom={insets.bottom + 8} />
          </>
        ) : (
          <Dots w={w} columns={columns} at={at} paint={paint} onPick={go} />
        )}
      </View>
    </View>
  );
}

/** The held list's lift: a deeper shadow than a card's. */
const GHOST_SHADOW = "0px 18px 32px -12px rgba(0, 0, 0, 0.6)";

function Gap() {
  return <View style={styles.gap} />;
}

/** While a list is held: the trash at the board's foot, red when the list is over it. */
function Trash({ w, over, reduced, bottom }: { w: PortalWords; over: boolean; reduced: boolean; bottom: number }) {
  const red = "#DC2626";
  return (
    <Animated.View
      entering={reduced ? undefined : FadeIn.duration(140)}
      exiting={reduced ? undefined : FadeOut.duration(140)}
      pointerEvents="none"
      style={[styles.trashRow, { bottom }]}
      accessibilityLiveRegion="polite"
    >
      <View
        style={[styles.trash, { backgroundColor: over ? red : "#141414", transform: [{ scale: over ? 1.08 : 1 }] }]}
      >
        <Icon name="trash" size={18} color="#FFFFFF" />
        <Text variant="subhead" style={styles.trashWord}>
          {w.dropToDelete}
        </Text>
      </View>
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
  if (columns.length < 2) return <View style={styles.dots} />;
  if (columns.length > DOTS_MAX) {
    return (
      <View style={styles.dots}>
        <Text variant="footnote" style={{ color: paint.dot }}>
          {w.listOf(at + 1, columns.length)}
        </Text>
      </View>
    );
  }
  return (
    <View style={styles.dots}>
      {columns.map((col, i) => {
        const on = i === at;
        const name = col.kind === "add" || col.kind === "new" ? w.addList : (col.group.name ?? w.noList);
        const tint = on ? paint.dotOn : paint.dot;
        return (
          <Pressable
            key={columnKey(col)}
            onPress={() => onPick(i)}
            hitSlop={{ top: 12, bottom: 12, left: 3, right: 3 }}
            accessibilityRole="button"
            accessibilityState={{ selected: on }}
            accessibilityLabel={w.goToList(name)}
            style={styles.dotHit}
          >
            {col.kind === "add" || col.kind === "new" ? (
              <Icon name="plus" size={10} color={tint} />
            ) : (
              <View style={[styles.dot, on ? styles.dotOn : null, { backgroundColor: tint }]} />
            )}
          </Pressable>
        );
      })}
    </View>
  );
}

type Lift = {
  onLift: (id: string, e: { x: number; absoluteX: number; absoluteY: number }) => void;
  onDrag: (e: { absoluteX: number; absoluteY: number; translationY: number }) => void;
  onDrop: (commit: boolean) => void;
};
/** A drag's end lets the name be pressed again a moment later (the press it ended on is not a rename). */
const settle = (dragged: { current: boolean }) => setTimeout(() => (dragged.current = false), 300);

type ListMenu = (group: PlanGroup, rename: () => void) => void;

/**
 * One list: its name (a press renames it, a long press lifts it), its count and "…", its cards scrolling inside it,
 * and "Adicionar cartão" at its foot.
 */
function ListColumn({
  w,
  client,
  group,
  width,
  maxHeight,
  paint,
  numbers,
  material,
  onMove,
  refreshing,
  onRefresh,
  lift,
  onMenu = null,
  hole = null,
  shift = 0,
}: {
  w: PortalWords;
  client: string;
  group: PlanGroup;
  width: number;
  maxHeight: number;
  paint: Paint;
  numbers: Map<string, number>;
  material: boolean;
  onMove: ((card: PlanCard) => void) | null;
  refreshing: boolean;
  onRefresh: () => void;
  lift: Lift | null;
  onMenu?: ListMenu | null;
  /** Held: only its place shows, in this color. */
  hole?: string | null;
  /** How far it slides aside while another list is held over its place (or, held, to where it would land). */
  shift?: number;
}) {
  const reduced = useReducedMotion();
  const slide = useSharedValue(0);
  useEffect(() => {
    slide.value = reduced ? shift : withTiming(shift, { duration: 180 });
  }, [shift, reduced, slide]);
  const slid = useAnimatedStyle(() => ({ transform: [{ translateX: slide.value }] }));
  const [adding, setAdding] = useState(false);
  const [renaming, setRenaming] = useState(false);
  const id = group.id;
  // One config for the gesture's life: a config that changes on every render resets the handler mid-drag (the web's
  // does), so the callbacks read the latest `lift` through a ref and the config changes only with `enabled`.
  const liftNow = useRef(lift);
  liftNow.current = lift;
  // The press that ends a drag isn't a press on the name (it would open the rename).
  const dragged = useRef(false);
  const enabled = Boolean(lift && id && !renaming);
  const config = useMemo(
    () => ({
      enabled,
      activateAfterLongPress: HOLD_MS,
      runOnJS: true,
      onActivate: (e: { x: number; absoluteX: number; absoluteY: number }) => {
        dragged.current = true;
        if (liftNow.current && id) liftNow.current.onLift(id, e);
      },
      onUpdate: (e: { absoluteX: number; absoluteY: number; translationY: number }) => liftNow.current?.onDrag(e),
      onDeactivate: (e: { canceled: boolean }) => {
        settle(dragged);
        liftNow.current?.onDrop(!e.canceled);
      },
      onFinalize: (e: { canceled: boolean }) => {
        if (!e.canceled) return;
        settle(dragged);
        liftNow.current?.onDrop(false);
      },
    }),
    [enabled, id],
  );
  const pan = usePanGesture(config);
  const head = (
    <View style={styles.listHead}>
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
          onPress={() => onMenu(group, () => setRenaming(true))}
        />
      ) : null}
    </View>
  );
  return (
    <Animated.View style={[styles.list, { width, maxHeight, backgroundColor: hole ?? paint.list }, slid]}>
      <View style={[styles.listBody, hole ? styles.hidden : null]}>
        {lift && id ? <GestureDetector gesture={pan}>{head}</GestureDetector> : head}
        <ScrollView
          style={styles.cardsScroll}
          contentContainerStyle={styles.cards}
          showsVerticalScrollIndicator={false}
          keyboardShouldPersistTaps="handled"
          refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} />}
        >
          {group.cards.map((card) => (
            <BoardCard
              key={card.id}
              w={w}
              card={card}
              paint={paint}
              task={numbers.get(card.id)}
              material={material}
              onMove={onMove}
            />
          ))}
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
/** A stage's color behind its pill: 16% of it. */
const STAGE_TINT = "29";

function BoardCard({
  w,
  card,
  paint,
  task,
  material,
  onMove,
}: {
  w: PortalWords;
  card: PlanCard;
  paint: Paint;
  task: number | undefined;
  material: boolean;
  onMove: ((card: PlanCard) => void) | null;
}) {
  const { i18n } = useTranslation();
  const { colors: c } = useTheme();
  const badges = cardBadges(card);
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
    card.done ? w.done : null,
    task !== undefined ? `#${task}` : null,
    ...facts.map((f) => f.label),
  ]
    .filter(Boolean)
    .join(", ");
  return (
    <Pressable
      onPress={() => openCard(card.client, card.id)}
      {...(onMove
        ? {
            onLongPress: () => {
              haptics.selection();
              onMove(card);
            },
            delayLongPress: HOLD_MS,
            accessibilityActions: [{ name: "move", label: w.moveCard }],
            onAccessibilityAction: (e: { nativeEvent: { actionName: string } }) => {
              if (e.nativeEvent.actionName === "move") onMove(card);
            },
          }
        : {})}
      accessibilityRole="button"
      accessibilityLabel={spoken}
      accessibilityHint={onMove ? w.moveCard : undefined}
      style={({ pressed }) => [
        styles.card,
        { backgroundColor: paint.card, borderColor: paint.edge },
        pressed ? styles.pressed : null,
      ]}
    >
      <View style={card.done && !ready ? styles.done : null}>
        {material && task === undefined && !card.done ? null : (
          <View style={styles.cardTop}>
            {material ? null : (
              <View style={[styles.stage, { backgroundColor: `${STAGE_COLOR[card.stage]}${STAGE_TINT}` }]}>
                <View style={[styles.stageDot, { backgroundColor: STAGE_COLOR[card.stage] }]} />
                <Text variant="caption" style={[styles.stageWord, { color: c.ink }]}>
                  {stage}
                </Text>
              </View>
            )}
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
          <View style={[styles.facts, { borderTopColor: paint.edge }]}>
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
      {ready ? (
        <Button
          variant="primary"
          size="sm"
          wide
          icon="send"
          label={w.send}
          onPress={send.confirm}
          loading={send.pending}
        />
      ) : null}
    </Pressable>
  );
}

/** A long press's move: the lists of the card's own section in the app's sheet, the card at the chosen one's end. */
function useMoveCard(client: string, plan: PortalPlan) {
  const w = usePortalWords();
  const orgId = useOrgId();
  const toast = useToast();
  const failed = usePortalFailed();
  const move = useMovePortalCard(orgId, client);
  return async (card: PlanCard) => {
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
  lists: { paddingHorizontal: BOARD.side, paddingTop: 12, alignItems: "flex-start" },
  gap: { width: BOARD.gap },
  list: { borderRadius: 20, overflow: "hidden" },
  listBody: { flexShrink: 1 },
  hidden: { opacity: 0 },
  ghost: { position: "absolute", top: 12, left: 0, borderRadius: 20 },
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
  card: { borderRadius: 12, borderWidth: StyleSheet.hairlineWidth, padding: 12, gap: 12 },
  cardTop: { flexDirection: "row", alignItems: "center", flexWrap: "wrap", gap: 8, marginBottom: 8 },
  // The stage as a pill of its own color, the card's first line: where the work is, at a glance.
  stage: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    height: 22,
    paddingLeft: 8,
    paddingRight: 10,
    borderRadius: 11,
  },
  stageWord: { fontWeight: "600" },
  stageDot: { width: 7, height: 7, borderRadius: 3.5 },
  doneMark: { flexDirection: "row", alignItems: "center", gap: 4 },
  title: { fontWeight: "600" },
  task: { marginLeft: "auto" },
  // What the card holds, apart from its title by a hairline.
  facts: {
    flexDirection: "row",
    flexWrap: "wrap",
    alignItems: "center",
    columnGap: 12,
    rowGap: 4,
    marginTop: 10,
    paddingTop: 8,
    borderTopWidth: StyleSheet.hairlineWidth,
  },
  fact: { flexDirection: "row", alignItems: "center", gap: 4 },
  done: { opacity: 0.6 },
  pressed: { opacity: 0.7 },
  // The plus lines up with the cards' words: the list's 8 to the card, the card's 12 to its words.
  addRow: { minHeight: 44, justifyContent: "center", paddingHorizontal: 20 },
  addLabel: { flexDirection: "row", alignItems: "center", gap: 8 },
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
