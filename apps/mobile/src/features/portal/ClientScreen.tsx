import type { PortalItem, PortalPlan } from "@agenteschat/client";
import {
  isPortalOff,
  usePortalBoard,
  usePortalOverview,
  usePortalPlan,
  usePortalTasks,
  usePortalToSchedule,
} from "@agenteschat/client";
import {
  portalClientColors,
  portalClientLogos,
  portalClientName,
  portalMonthName,
  portalPostedByMonth,
  portalTaskNumbers,
} from "@agenteschat/client/lib/portal";
import { type ReactElement, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import {
  KeyboardAvoidingView,
  Platform,
  Pressable,
  RefreshControl,
  type RefreshControlProps,
  ScrollView,
  StyleSheet,
  View,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { EmptyState, haptics, Icon, SkeletonList, Text, useClearBarTop, useTheme } from "@/ui";
import { appColors } from "@/ui/palette";
import { ThemeColorsOverride } from "@/ui/theme";
import { useOrgId, usePullRefresh } from "../shared/hooks";
import { PushedHeader } from "../shared/parts";
import { RetryLine } from "../shared/TeamSkyEmpty";
import { usePortalRights, usePortalWords } from "./hooks";
import { boardPaint, cardOfItem, clientCounts, STAGE_COLOR, toScheduleOf } from "./model";
import { PlanBoard } from "./PlanBoard";
import { ClientMark, PortalNotice } from "./parts";
import { ScheduleSheet } from "./ScheduleSheet";
import { PostCard, StageBoard } from "./StageBoard";
import type { PortalWords } from "./words";

type Tab = "board" | "plan" | "posted" | "materials";

/**
 * One client of the portal (ADR 9001), pushed from the Portal tab: its mark, name and counts, its four views as tabs
 * under them, and each view as Trello's app shows a board, the light board with dark lists, one a swipe. The Quadro is
 * a list per stage, from To do to Scheduled, its team cards dragged between To do and In production (`StageBoard`);
 * the schedule and the materials are the team's own lists (`PlanBoard`); Postados is what went out by month, in the
 * same cards. A team card or a post the team made from a card opens that card; a post no card stands for opens itself.
 */
export function ClientScreen({ client, initialTab = "board" }: { client: string; initialTab?: Tab }) {
  const w = usePortalWords();
  const orgId = useOrgId();
  const { colors: c } = useTheme();
  const barTop = useClearBarTop();
  const board = usePortalBoard(orgId, client);
  const plan = usePortalPlan(orgId, client);
  const numbers = portalTaskNumbers(usePortalTasks(orgId).data);
  const [tab, setTab] = useState<Tab>(initialTab);
  const { changes } = usePortalRights();
  // Approved posts nobody released yet, this client's: "Agendar" in the head and on the Quadro's approved cards.
  const toSchedule = toScheduleOf(usePortalToSchedule(orgId, changes).data?.items, client);
  const [scheduling, setScheduling] = useState<{ open: boolean; start: PortalItem | null }>({
    open: false,
    start: null,
  });
  const openSchedule = (start: PortalItem | null) => setScheduling({ open: true, start });
  const pull = usePullRefresh(() => Promise.all([board.refetch(), plan.refetch()]));
  const off = isPortalOff(board.error);
  const posted = board.data?.items.posted.length;
  const lists = tab === "plan" || tab === "materials";
  const shown = lists ? plan : board;
  const refresh = <RefreshControl refreshing={pull.refreshing} onRefresh={pull.onRefresh} />;
  return (
    // The bar is clear on iOS (the route's scroll-under bar) and nothing here scrolls under it: the head, the tabs and
    // the boards start below it, as on Tarefas (`IssuesScreen`). Android's bar is opaque and already holds its room.
    // The name is in the head, under the bar, with the client's mark: the bar keeps only the way back.
    <View style={[styles.screen, { backgroundColor: c.grouped, paddingTop: barTop }]}>
      <PushedHeader title="" grouped />
      <KeyboardAvoidingView
        style={styles.screen}
        behavior={Platform.OS === "ios" ? "padding" : undefined}
        keyboardVerticalOffset={barTop}
      >
        <ClientHead
          w={w}
          client={client}
          toSchedule={toSchedule.length}
          onSchedule={changes ? () => openSchedule(null) : null}
        />
        <ClientTabs w={w} tab={tab} posted={posted} onChange={setTab} />
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
        ) : tab === "board" && board.data ? (
          <View style={styles.screen}>
            <PortalNotice state={board.data.state} />
            <StageBoard
              client={client}
              board={board.data}
              plan={plan.data}
              numbers={numbers}
              refreshing={pull.refreshing}
              onRefresh={pull.onRefresh}
              onSchedule={changes ? openSchedule : null}
            />
          </View>
        ) : board.data ? (
          <Posted
            w={w}
            client={client}
            items={board.data.items.posted}
            plan={plan.data}
            numbers={numbers}
            refresh={refresh}
          />
        ) : null}
      </KeyboardAvoidingView>
      {changes ? (
        <ScheduleSheet
          open={scheduling.open}
          items={toSchedule}
          start={scheduling.start}
          onClose={() => setScheduling((x) => ({ ...x, open: false }))}
        />
      ) : null}
    </View>
  );
}

/**
 * Who the client is, in one row over its tabs: its small mark, its name, its counts as dots and numbers (what is open,
 * with the client, sent back), and, for whoever may schedule, "Agendar" with how many approved posts wait for a date.
 */
function ClientHead({
  w,
  client,
  toSchedule,
  onSchedule,
}: {
  w: PortalWords;
  client: string;
  toSchedule: number;
  onSchedule: (() => void) | null;
}) {
  const orgId = useOrgId();
  const { colors: c } = useTheme();
  const clients = usePortalOverview(orgId).data?.clients;
  const summary = clients?.find((x) => x.client === client);
  const logo = portalClientLogos(clients).get(client);
  const color = portalClientColors(clients).get(client);
  const counts = clientCounts(summary);
  const words = { open: w.open, approval: w.inApproval, adjusting: w.inAdjust };
  return (
    <View style={styles.head}>
      <ClientMark client={client} logo={logo} color={color} size={28} />
      <View style={styles.headWords}>
        <Text variant="subhead" style={styles.headName} numberOfLines={2}>
          {portalClientName(client)}
        </Text>
        {counts.length > 0 ? (
          <View
            style={styles.headCounts}
            accessible
            accessibilityLabel={counts.map((k) => words[k.key](k.count)).join(", ")}
          >
            {counts.map((k) => (
              <View key={k.key} style={styles.headCount}>
                <View style={[styles.headDot, { backgroundColor: COUNT_DOT[k.key] }]} />
                <Text variant="caption" tone="muted" style={styles.tabular}>
                  {String(k.count)}
                </Text>
              </View>
            ))}
          </View>
        ) : null}
      </View>
      {onSchedule && toSchedule > 0 ? (
        <Pressable
          onPress={() => {
            haptics.selection();
            onSchedule();
          }}
          accessibilityRole="button"
          accessibilityLabel={w.toScheduleCount(toSchedule)}
          hitSlop={{ top: 6, bottom: 6 }}
          style={({ pressed }) => [
            styles.schedule,
            { backgroundColor: `${c.amber}22`, borderColor: `${c.amber}55` },
            pressed ? styles.pressed : null,
          ]}
        >
          <Icon name="calendar" size={14} color={c.amberInk} />
          <Text variant="footnote" style={[styles.scheduleWord, { color: c.amberInk }]}>
            {w.scheduleButton}
          </Text>
          <View style={[styles.scheduleCount, { backgroundColor: c.amber }]}>
            <Text variant="caption" style={styles.scheduleCountWord}>
              {String(toSchedule)}
            </Text>
          </View>
        </Pressable>
      ) : null}
    </View>
  );
}

/** A count's dot, as the Portal tab's chips draw it. */
const COUNT_DOT = {
  open: STAGE_COLOR.doing,
  approval: STAGE_COLOR.approval,
  adjusting: STAGE_COLOR.adjusting,
} as const;

/** The four views as tabs under the client's name: the chosen one in ink over a 2 line, the rest muted. */
function ClientTabs({
  w,
  tab,
  posted,
  onChange,
}: {
  w: PortalWords;
  tab: Tab;
  posted: number | undefined;
  onChange: (tab: Tab) => void;
}) {
  const { colors: c } = useTheme();
  const tabs: { key: Tab; label: string; count?: number }[] = [
    { key: "board", label: w.tabs.board },
    { key: "plan", label: w.tabs.plan },
    { key: "posted", label: w.tabs.posted, ...(posted ? { count: posted } : {}) },
    { key: "materials", label: w.tabs.materials },
  ];
  return (
    <View style={[styles.tabsLine, { borderBottomColor: c.line }]}>
      <View style={styles.tabs} accessibilityRole="tablist">
        {tabs.map((t) => {
          const on = t.key === tab;
          return (
            <Pressable
              key={t.key}
              onPress={() => {
                if (on) return;
                haptics.selection();
                onChange(t.key);
              }}
              accessibilityRole="tab"
              accessibilityState={{ selected: on }}
              accessibilityLabel={t.count ? `${t.label}, ${t.count}` : t.label}
              style={styles.tab}
            >
              <View style={styles.tabWords}>
                <Text variant="footnote" style={[styles.tabLabel, { color: on ? c.ink : c.muted }]}>
                  {t.label}
                </Text>
                {t.count ? (
                  <View style={[styles.tabCount, { backgroundColor: on ? c.ink : c.chip }]}>
                    <Text variant="caption" style={[styles.tabCountWord, { color: on ? c.bg : c.muted }]}>
                      {String(t.count)}
                    </Text>
                  </View>
                ) : null}
              </View>
              <View style={[styles.tabBar, { backgroundColor: on ? c.ink : "transparent" }]} />
            </Pressable>
          );
        })}
      </View>
    </View>
  );
}

/** What went out, newest first under the month it went out, as the board's cards on the board's light. */
function Posted({
  w,
  client,
  items,
  plan,
  numbers,
  refresh,
}: {
  w: PortalWords;
  client: string;
  items: PortalItem[];
  plan: PortalPlan | undefined;
  numbers: Map<string, number>;
  refresh: ReactElement<RefreshControlProps>;
}) {
  const { i18n } = useTranslation();
  const { scheme } = useTheme();
  const insets = useSafeAreaInsets();
  const paint = boardPaint(scheme === "dark");
  const listColors = useMemo(() => appColors("dark"), []);
  if (items.length === 0) return <EmptyState size="page" icon="check" title={w.noPosted} />;
  return (
    <ScrollView
      refreshControl={refresh}
      style={{ backgroundColor: paint.board }}
      contentContainerStyle={[styles.posted, { paddingBottom: insets.bottom + 24 }]}
    >
      {portalPostedByMonth(items).map((group) => (
        <View key={group.month ?? "none"} style={[styles.month, { backgroundColor: paint.list }]}>
          <ThemeColorsOverride colors={listColors}>
            <View style={styles.monthHead} accessibilityRole="header">
              <View style={[styles.monthDot, { backgroundColor: STAGE_COLOR.posted }]} />
              <Text variant="subhead" style={styles.monthName}>
                {group.month ? portalMonthName(i18n.language, group.month) : w.noDate}
              </Text>
              <Text variant="footnote" tone="muted" style={styles.tabular}>
                {String(group.items.length)}
              </Text>
            </View>
            <View style={styles.monthCards}>
              {group.items.map((item) => (
                <PostCard
                  key={item.id}
                  w={w}
                  client={client}
                  item={item}
                  card={cardOfItem(plan, item.id)}
                  column="posted"
                  paint={paint}
                  numbers={numbers}
                  posted
                />
              ))}
            </View>
          </ThemeColorsOverride>
        </View>
      ))}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1 },
  in: { paddingHorizontal: 16, paddingTop: 16, gap: 16 },
  intro: { paddingHorizontal: 16, paddingTop: 12 },
  // One row: the 28 mark, the name with its counts under it, "Agendar" at the end; 16 at the sides, 8 over and under.
  head: { flexDirection: "row", alignItems: "center", gap: 10, paddingHorizontal: 16, paddingTop: 4, paddingBottom: 8 },
  headWords: { flex: 1, minWidth: 0 },
  headName: { fontWeight: "700" },
  headCounts: { flexDirection: "row", alignItems: "center", gap: 10, marginTop: 1 },
  headCount: { flexDirection: "row", alignItems: "center", gap: 4 },
  headDot: { width: 6, height: 6, borderRadius: 3 },
  // A 32 control (radius 30% of it), its count a badge inside.
  schedule: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    height: 32,
    paddingLeft: 10,
    paddingRight: 6,
    borderRadius: 10,
    borderWidth: StyleSheet.hairlineWidth,
  },
  scheduleWord: { fontWeight: "600" },
  scheduleCount: {
    minWidth: 20,
    height: 20,
    borderRadius: 6,
    paddingHorizontal: 5,
    alignItems: "center",
    justifyContent: "center",
  },
  scheduleCountWord: { fontWeight: "700", color: "#111111", fontVariant: ["tabular-nums"] },
  pressed: { opacity: 0.7 },
  // The tabs share the row from edge to edge over one hairline, the chosen one's 2 line on it: none is ever cut.
  tabsLine: { borderBottomWidth: StyleSheet.hairlineWidth },
  tabs: { flexDirection: "row", justifyContent: "space-between", paddingHorizontal: 16, gap: 8 },
  tab: { minHeight: 40, justifyContent: "flex-end" },
  tabWords: { flexDirection: "row", alignItems: "center", gap: 5, paddingTop: 6, paddingBottom: 8 },
  tabLabel: { fontWeight: "600" },
  tabCount: {
    minWidth: 20,
    height: 18,
    borderRadius: 6,
    paddingHorizontal: 5,
    alignItems: "center",
    justifyContent: "center",
  },
  tabCountWord: { fontWeight: "700", fontVariant: ["tabular-nums"] },
  tabBar: { height: 2, borderRadius: 1, marginBottom: -StyleSheet.hairlineWidth },
  posted: { padding: 16, gap: 12 },
  month: { borderRadius: 20, overflow: "hidden" },
  monthHead: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    paddingHorizontal: 14,
    paddingTop: 14,
    paddingBottom: 10,
  },
  monthDot: { width: 8, height: 8, borderRadius: 4 },
  monthName: { flex: 1, minWidth: 0, fontWeight: "700" },
  monthCards: { paddingHorizontal: 8, paddingBottom: 8, gap: 8 },
  tabular: { fontVariant: ["tabular-nums"] },
});
