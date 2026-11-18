import type { PlanCard, PortalListKind, PortalPlan } from "@agenteschat/client";
import { useMovePortalCard, usePortalLists, useSavePortalCard } from "@agenteschat/client";
import { portalClientName, portalOrderAt, portalWhen } from "@agenteschat/client/lib/portal";
import { useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { FlatList, Pressable, RefreshControl, ScrollView, StyleSheet, TextInput, View } from "react-native";
import {
  Button,
  EmptyState,
  haptics,
  Icon,
  IconButton,
  type IconName,
  Text,
  useFieldText,
  useTheme,
  useToast,
} from "@/ui";
import { useOrgId } from "../shared/hooks";
import { pickOne } from "../shared/PickerSheet";
import { usePortalFailed, usePortalRights, usePortalWords, useSendCard } from "./hooks";
import {
  BOARD,
  boardIndexAt,
  boardListWidth,
  boardPaint,
  cardBadges,
  listsFor,
  type PlanGroup,
  planGroups,
  readyToSend,
  STAGE_COLOR,
} from "./model";
import { openCard } from "./parts";
import type { PortalWords } from "./words";

type Paint = ReturnType<typeof boardPaint>;
type Column = { kind: "list"; group: PlanGroup } | { kind: "add" };

/** The dots' row under the lists. */
const DOTS_H = 36;
/** Past this many lists the dots would crowd the row: one line says which list it is instead. */
const DOTS_MAX = 14;
/** The pick that means "in no list" (a list's id is never empty). */
const NO_LIST = "";

/**
 * A client's schedule, or its materials, as Trello's app shows a board on a phone (ADR 9001): the lists side by side,
 * one across the screen with the next one's edge in sight, a swipe stopping on each; dots under them say which one is
 * in front and take you to another. Each list scrolls its own cards, light board, darker lists, white cards. A card
 * shows its cover, where it is, its title and what it holds; a press opens it, a long press moves it to another list.
 * Whoever may change the board adds a card at a list's foot and a list at the board's end.
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
  const paint = boardPaint(scheme === "dark", c);
  // The lists' own box, not the window's: a list fits what the board was given (a split screen, a sheet), and a list
  // is never taller than the room above the dots. The lists take that room first and are measured after, so their
  // size never depends on their own content.
  const [box, setBox] = useState({ width: 0, height: 0 });
  const listWidth = boardListWidth(box.width);
  const step = listWidth + BOARD.gap;
  const { changes } = usePortalRights();
  const [at, setAt] = useState(0);
  const pager = useRef<FlatList<Column>>(null);
  const move = useMoveCard(client, plan);
  const groups = planGroups(plan, section);
  const columns: Column[] = [
    ...groups.map((group) => ({ kind: "list" as const, group })),
    ...(changes ? [{ kind: "add" as const }] : []),
  ];
  if (columns.length === 0) {
    return section === "materials" ? (
      <EmptyState size="page" icon="archive" title={w.noMaterials} subtitle={w.materialsIntro} />
    ) : (
      <EmptyState size="page" icon="calendar" title={w.noLists} subtitle={w.noListsText} />
    );
  }
  const go = (index: number) => pager.current?.scrollToOffset({ offset: index * step, animated: true });
  const listHeight = box.height;
  return (
    <View style={styles.board}>
      <FlatList
        ref={pager}
        horizontal
        data={columns}
        keyExtractor={(col) => (col.kind === "add" ? "+" : (col.group.id ?? "none"))}
        renderItem={({ item }) =>
          item.kind === "add" ? (
            <AddList
              w={w}
              client={client}
              section={section}
              width={listWidth}
              paint={paint}
              onAdded={() => setTimeout(() => go(groups.length), 400)}
            />
          ) : (
            <ListColumn
              w={w}
              client={client}
              group={item.group}
              width={listWidth}
              maxHeight={listHeight}
              paint={paint}
              numbers={numbers}
              material={section === "materials"}
              onMove={changes ? move : null}
              refreshing={refreshing}
              onRefresh={onRefresh}
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
        keyboardShouldPersistTaps="handled"
        scrollEventThrottle={32}
        onScroll={(e) => setAt(boardIndexAt(e.nativeEvent.contentOffset.x, step, columns.length))}
      />
      <Dots w={w} columns={columns} at={at} onPick={go} />
    </View>
  );
}

function Gap() {
  return <View style={styles.gap} />;
}

/** Which list is in front, as dots that take you to another; a line of words past `DOTS_MAX` lists. */
function Dots({
  w,
  columns,
  at,
  onPick,
}: {
  w: PortalWords;
  columns: Column[];
  at: number;
  onPick: (index: number) => void;
}) {
  const { colors: c } = useTheme();
  if (columns.length < 2) return <View style={styles.dots} />;
  if (columns.length > DOTS_MAX) {
    return (
      <View style={styles.dots}>
        <Text variant="footnote" tone="muted">
          {w.listOf(at + 1, columns.length)}
        </Text>
      </View>
    );
  }
  return (
    <View style={styles.dots}>
      {columns.map((col, i) => {
        const on = i === at;
        const name = col.kind === "add" ? w.addList : (col.group.name ?? w.noList);
        return (
          <Pressable
            key={col.kind === "add" ? "+" : (col.group.id ?? "none")}
            onPress={() => onPick(i)}
            hitSlop={{ top: 12, bottom: 12, left: 3, right: 3 }}
            accessibilityRole="button"
            accessibilityState={{ selected: on }}
            accessibilityLabel={w.goToList(name)}
            style={styles.dotHit}
          >
            {col.kind === "add" ? (
              <Icon name="plus" size={10} color={on ? c.ink : c.faint} />
            ) : (
              <View style={[styles.dot, on ? styles.dotOn : null, { backgroundColor: on ? c.ink : c.faint }]} />
            )}
          </Pressable>
        );
      })}
    </View>
  );
}

/** One list: its name and count, its cards scrolling inside it, and "Adicionar cartão" at its foot. */
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
}) {
  const [adding, setAdding] = useState(false);
  return (
    <View style={[styles.list, { width, maxHeight, backgroundColor: paint.list }]}>
      <View style={styles.listHead}>
        <Text variant="subhead" style={styles.listName}>
          {group.name ?? w.noList}
        </Text>
        <Text variant="footnote" tone="muted" style={[styles.tabular, styles.listCount]}>
          {String(group.cards.length)}
        </Text>
      </View>
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
/** The card's lift off its list: a soft shadow under it. */
const CARD_SHADOW = "0px 6px 16px -10px rgba(0, 0, 0, 0.55)";

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
            delayLongPress: 350,
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
        { backgroundColor: paint.card, borderColor: paint.edge, boxShadow: CARD_SHADOW },
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

/** The board's last column: "Adicionar lista", which opens its name's field; the new list comes into view. */
function AddList({
  w,
  client,
  section,
  width,
  paint,
  onAdded,
}: {
  w: PortalWords;
  client: string;
  section: PortalListKind;
  width: number;
  paint: Paint;
  onAdded: () => void;
}) {
  const { colors: c } = useTheme();
  const orgId = useOrgId();
  const failed = usePortalFailed();
  const field = useFieldText("subhead");
  const lists = usePortalLists(orgId, client);
  const [open, setOpen] = useState(false);
  const [name, setName] = useState("");
  const add = () => {
    const words = name.trim();
    if (!words || lists.create.isPending) return;
    lists.create.mutate(
      { name: words, kind: section },
      {
        onSuccess: () => {
          setName("");
          setOpen(false);
          onAdded();
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
              loading={lists.create.isPending}
            />
            <IconButton icon="x" small label={w.cancel} onPress={() => setOpen(false)} />
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
  lists: { paddingHorizontal: BOARD.side, alignItems: "flex-start" },
  gap: { width: BOARD.gap },
  list: { borderRadius: 20, overflow: "hidden" },
  listHead: {
    flexDirection: "row",
    alignItems: "flex-start",
    gap: 8,
    paddingHorizontal: 12,
    paddingTop: 12,
    paddingBottom: 8,
  },
  listName: { flex: 1, minWidth: 0, fontWeight: "700" },
  tabular: { fontVariant: ["tabular-nums"] },
  // The count's smaller line sits on the name's first line.
  listCount: { paddingTop: 1 },
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
});
