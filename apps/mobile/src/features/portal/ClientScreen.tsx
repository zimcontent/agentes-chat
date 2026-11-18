import type { PlanCard, PortalCard, PortalItem, PortalPlan } from "@agenteschat/client";
import { isPortalOff, usePortalBoard, usePortalOverview, usePortalPlan, usePortalTasks } from "@agenteschat/client";
import {
  portalClientName,
  portalMonthName,
  portalPostedAt,
  portalPostedByMonth,
  portalScheduling,
  portalTaskNumbers,
  portalWhen,
} from "@agenteschat/client/lib/portal";
import { type ReactNode, useState } from "react";
import { useTranslation } from "react-i18next";
import { KeyboardAvoidingView, Platform, RefreshControl, ScrollView, StyleSheet, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import {
  Chip,
  EmptyState,
  GroupedHeader,
  GroupedList,
  GroupedRow,
  Segmented,
  SkeletonList,
  Text,
  useClearBarTop,
  useTheme,
} from "@/ui";
import { useOrgId, usePullRefresh } from "../shared/hooks";
import { PushedHeader } from "../shared/parts";
import { RetryLine } from "../shared/TeamSkyEmpty";
import { usePortalWords } from "./hooks";
import { boardColumns, cardOfItem, columnCount } from "./model";
import { PlanBoard } from "./PlanBoard";
import { CardCover, HeaderCount, openCard, openPost, PortalNotice, StatusChip } from "./parts";
import type { PortalWords } from "./words";

type Tab = "board" | "plan" | "posted" | "materials";

/**
 * One client of the portal (ADR 9001), pushed from the Portal tab, its name in the bar and its four views under it:
 * its board as the web's columns, from To do to Scheduled (a column with nothing in it isn't drawn); its schedule and
 * its materials (logins, links, references) as Trello's app shows a board, the lists side by side, one a swipe
 * (`PlanBoard`); and what was posted by month. A team card or a post the team made from a card opens that card; a
 * post no card stands for opens the post itself.
 */
export function ClientScreen({ client, initialTab = "board" }: { client: string; initialTab?: Tab }) {
  const w = usePortalWords();
  const orgId = useOrgId();
  const { colors: c } = useTheme();
  const insets = useSafeAreaInsets();
  const barTop = useClearBarTop();
  const board = usePortalBoard(orgId, client);
  const plan = usePortalPlan(orgId, client);
  const summary = usePortalOverview(orgId).data?.clients.find((x) => x.client === client);
  const numbers = portalTaskNumbers(usePortalTasks(orgId).data);
  const [tab, setTab] = useState<Tab>(initialTab);
  const pull = usePullRefresh(() => Promise.all([board.refetch(), plan.refetch()]));
  const off = isPortalOff(board.error);
  const posted = board.data?.items.posted.length;
  const lists = tab === "plan" || tab === "materials";
  const shown = lists ? plan : board;
  const refresh = <RefreshControl refreshing={pull.refreshing} onRefresh={pull.onRefresh} />;
  return (
    // The bar is clear on iOS (the route's scroll-under bar) and nothing here scrolls under it: the tabs and the
    // lists start below it, as on Tarefas (`IssuesScreen`). Android's bar is opaque and already holds its room.
    <View style={[styles.screen, { backgroundColor: c.grouped, paddingTop: barTop }]}>
      <PushedHeader
        title={portalClientName(client)}
        {...(summary && summary.open > 0 ? { subtitle: w.open(summary.open) } : {})}
        grouped
      />
      <KeyboardAvoidingView
        style={styles.screen}
        behavior={Platform.OS === "ios" ? "padding" : undefined}
        keyboardVerticalOffset={barTop}
      >
        <View style={styles.tabs}>
          <Segmented
            wide="fit"
            value={tab}
            onChange={(v) => setTab(v as Tab)}
            items={[
              { key: "board", label: w.tabs.board },
              { key: "plan", label: w.tabs.plan },
              { key: "posted", label: w.tabs.posted, ...(posted ? { count: posted } : {}) },
              { key: "materials", label: w.tabs.materials },
            ]}
          />
        </View>
        {off ? (
          <EmptyState size="page" icon="check" title={w.off} subtitle={w.offText} />
        ) : shown.isLoading ? (
          <View style={styles.in}>
            <SkeletonList rows={5} />
          </View>
        ) : !shown.data ? (
          <View style={styles.in}>
            <RetryLine onRetry={() => void shown.refetch()} />
          </View>
        ) : lists && plan.data ? (
          <View style={styles.screen}>
            <PortalNotice state={plan.data.state} />
            {tab === "materials" ? (
              <Text variant="footnote" tone="muted" style={styles.intro}>
                {w.materialsIntro}
              </Text>
            ) : null}
            <PlanBoard
              key={tab}
              client={client}
              plan={plan.data}
              section={tab === "materials" ? "materials" : "plan"}
              numbers={numbers}
              refreshing={pull.refreshing}
              onRefresh={pull.onRefresh}
            />
          </View>
        ) : (
          <ScrollView
            refreshControl={refresh}
            contentContainerStyle={[styles.in, { paddingBottom: insets.bottom + 24 }]}
          >
            {tab === "board" && board.data ? (
              <>
                <PortalNotice state={board.data.state} />
                <Board w={w} client={client} board={board.data} plan={plan.data} numbers={numbers} />
              </>
            ) : board.data ? (
              <Posted w={w} client={client} items={board.data.items.posted} plan={plan.data} />
            ) : null}
          </ScrollView>
        )}
      </KeyboardAvoidingView>
    </View>
  );
}

/** The board's columns that hold something, each a group; nothing anywhere: one empty state. */
function Board({
  w,
  client,
  board,
  plan,
  numbers,
}: {
  w: PortalWords;
  client: string;
  board: NonNullable<ReturnType<typeof usePortalBoard>["data"]>;
  plan: PortalPlan | undefined;
  numbers: Map<string, number>;
}) {
  const when = useDayWords();
  const columns = boardColumns(board).filter((c) => columnCount(c) > 0);
  if (columns.length === 0) return <EmptyState size="page" icon="list" title={w.emptyColumn} />;
  return (
    <>
      {columns.map((col) => (
        <View key={col.column}>
          <GroupedHeader aside={<HeaderCount count={columnCount(col)} />}>{w.columns[col.column]}</GroupedHeader>
          <GroupedList>
            {col.cards.map((card) => teamRow(w, when, card, numbers.get(card.id)))}
            {col.items.map((item) => postRow(w, when, client, item, cardOfItem(plan, item.id), numbers))}
          </GroupedList>
        </View>
      ))}
    </>
  );
}

/** What went out, newest first under the month it went out. */
function Posted({
  w,
  client,
  items,
  plan,
}: {
  w: PortalWords;
  client: string;
  items: PortalItem[];
  plan: PortalPlan | undefined;
}) {
  const { i18n } = useTranslation();
  if (items.length === 0) return <EmptyState size="page" icon="check" title={w.noPosted} />;
  return (
    <>
      {portalPostedByMonth(items).map((group) => (
        <View key={group.month ?? "none"}>
          <GroupedHeader aside={<HeaderCount count={group.items.length} />}>
            {group.month ? portalMonthName(i18n.language, group.month) : w.noDate}
          </GroupedHeader>
          <GroupedList>
            {group.items.map((item) => {
              const card = cardOfItem(plan, item.id);
              const day = portalWhen(i18n.language, portalPostedAt(item));
              return (
                <GroupedRow
                  key={item.id}
                  label={item.title}
                  labelLines={2}
                  sub={[w.types[item.type], day ?? w.noDate].join(" · ")}
                  media
                  leading={<CardCover files={card?.files ?? []} />}
                  chevron
                  onPress={() => (card ? openCard(client, card.id) : openPost(client, item.id))}
                />
              );
            })}
          </GroupedList>
        </View>
      ))}
    </>
  );
}

type DayWords = (date: string | null | undefined) => string | null;

/** A portal date as the lists say it ("20 de nov., 14:00"), in the portal's own clock. */
function useDayWords(): DayWords {
  const { i18n } = useTranslation();
  return (date) => portalWhen(i18n.language, date);
}

/** A card the team still makes: its picture, title, type, post date and files; its task's number at the end. */
function teamRow(w: PortalWords, when: DayWords, card: PortalCard, task: number | undefined) {
  const day = when(card.date);
  const facts = [w.types[card.type], day, card.files.length > 0 ? w.fileCount(card.files.length) : null].filter(
    (f): f is string => Boolean(f),
  );
  return (
    <GroupedRow
      key={card.id}
      label={card.title}
      labelLines={2}
      sub={facts.join(" · ")}
      media
      leading={<CardCover files={card.files} />}
      {...(task !== undefined ? { value: `#${task}` } : {})}
      chevron
      onPress={() => openCard(card.client, card.id)}
    />
  );
}

/**
 * A post at the portal: where it stands, what it still lacks, and for one the client sent back, what they asked
 * (outside text, plain words). It opens the card it came from when there is one.
 */
function postRow(
  w: PortalWords,
  when: DayWords,
  client: string,
  item: PortalItem,
  card: PlanCard | null,
  numbers: Map<string, number>,
) {
  const day = when(item.scheduledFor);
  const facts = [w.types[item.type], day, item.editor].filter((f): f is string => Boolean(f));
  const asked =
    item.lastNote && (item.status === "adjust_requested" || item.status === "adjusting") ? item.lastNote : null;
  const task = card ? numbers.get(card.id) : undefined;
  return (
    <GroupedRow
      key={item.id}
      label={item.title}
      labelLines={2}
      sub={facts.join(" · ")}
      media
      leading={<CardCover files={card?.files ?? []} />}
      {...(task !== undefined ? { value: `#${task}` } : {})}
      below={
        <Chips>
          <StatusChip status={item.status} />
          {portalScheduling(item) ? <Chip icon="clock" label={w.scheduling} /> : null}
          {item.missing.map((m) => (
            <Chip key={m} icon="flag" label={w.missing[m]} />
          ))}
          {asked ? (
            <Text variant="footnote" tone="ink2" numberOfLines={3} style={styles.asked}>
              {`${asked.by || w.clientAsked}: ${asked.text}`}
            </Text>
          ) : null}
        </Chips>
      }
      chevron
      onPress={() => (card ? openCard(client, card.id) : openPost(client, item.id))}
    />
  );
}

function Chips({ children }: { children: ReactNode }) {
  return <View style={styles.chips}>{children}</View>;
}

const styles = StyleSheet.create({
  screen: { flex: 1 },
  tabs: { paddingHorizontal: 16, paddingTop: 8, paddingBottom: 12 },
  in: { paddingHorizontal: 16, gap: 16 },
  chips: { flexDirection: "row", flexWrap: "wrap", gap: 6, marginTop: 6 },
  asked: { flexBasis: "100%" },
  intro: { paddingHorizontal: 16, paddingBottom: 12 },
});
