import { busyWidgets, type Dashboard, dashboardGroups, useDashboards, type Widget } from "@dougbot/client";
import { mayAsk } from "@dougbot/client/lib/audience";
import { agentGrammar } from "@dougbot/client/lib/grammar";
import { rightHandOf } from "@dougbot/client/lib/right-hand";
import { Stack } from "expo-router";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import {
  ActivityIndicator,
  FlatList,
  type NativeScrollEvent,
  type NativeSyntheticEvent,
  Pressable,
  RefreshControl,
  ScrollView,
  StyleSheet,
  useWindowDimensions,
  View,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { DB_FONTES } from "@/brand/tokens";
import { useOrg } from "@/providers/org";
import { Button, EmptyState, Glass, IconButton, PressScale, Text, usePlateEdge, useTheme } from "@/ui";
import { goBack, router } from "@/ui/navigation";
import { useOpenDm } from "../new/useOpenDm";
import { FirstUse, useEmptyLook } from "../shared/FirstUse";
import { useDirectory, useOrgId, usePullRefresh } from "../shared/hooks";
import { pickOne } from "../shared/PickerSheet";
import { SheetHostProvider } from "../shared/SheetHost";
import { useBoard } from "./hooks";
import { HOME, phoneRows, widgetsInOrder } from "./logic";
import { useBoardMenu } from "./menu";
import { ProposalBanner, useBoardByline } from "./parts";
import { dotWindow, TILE_GAP } from "./tile-look";
import { WidgetPeek } from "./WidgetPeek";

/** While a widget is being built or updated, its board is asked again this often (events usually come first). */
const BUSY_POLL_MS = 15_000;

/** "New widget" for a board (`home` for My Home). */
export const newWidgetHref = (dashboardId: string) => `/widget-new?dashboardId=${dashboardId}` as const;

/** Opens "New dashboard". */
export const openNewBoard = () => router.push("/board-new");

/**
 * Dashboards as the iPhone's home screen (ADR 0135): one board per page, side by side, swiped like the iPhone's pages
 * with its dots at the bottom. My Home first (the person's own widgets), then the workspace's boards, the roles' and
 * the person's own, in the list's order. On top, back, the board's name (a tap lists every board to jump to) and
 * "Editar", which holds everything that changes the board: a new widget, Organize, Share, Rename, Pin, Delete and a
 * new dashboard. Each page is the board's widgets as colored tiles (`WidgetTile`). `initial` is the board it opens
 * on (`home` for My Home), even one the list doesn't have yet.
 */
export function BoardPages({ initial = HOME }: { initial?: string }) {
  return (
    <SheetHostProvider>
      <Pages initial={initial} />
    </SheetHostProvider>
  );
}

function Pages({ initial }: { initial: string }) {
  const { t } = useTranslation();
  const { colors: c } = useTheme();
  const insets = useSafeAreaInsets();
  // A page is as wide as the pager itself (the window, on a phone): measured, so it holds in any frame.
  const window = useWindowDimensions();
  const [width, setWidth] = useState(window.width);
  const orgId = useOrgId();
  const list = useDashboards(orgId);
  const pages = useMemo(() => {
    const groups = dashboardGroups(list.data?.dashboards ?? []);
    const ids = [HOME, ...groups.workspace, ...groups.roles, ...groups.mine].map((b) =>
      typeof b === "string" ? b : b.id,
    );
    // A board opened from a link before the list has it still gets its page, right after My Home.
    if (!ids.includes(initial)) ids.splice(1, 0, initial);
    return ids;
  }, [list.data, initial]);
  const [at, setAt] = useState(() => Math.max(0, pages.indexOf(initial)));
  const pager = useRef<FlatList<string>>(null);
  // The list can change under the shown page (a board deleted, another shared): keep showing the same board.
  const shownId = useRef(initial);
  useEffect(() => {
    const i = pages.indexOf(shownId.current);
    const next = i >= 0 ? i : Math.min(at, pages.length - 1);
    if (next !== at) {
      setAt(next);
      pager.current?.scrollToIndex({ index: next, animated: false });
    }
    shownId.current = pages[next] ?? HOME;
  }, [pages, at]);
  const id = pages[at] ?? HOME;
  const { board } = useBoard(id);
  const home = id === HOME;
  const title = home ? t("dashboards.home") : (board?.title ?? "");
  const add = useCallback(() => router.push(newWidgetHref(home ? HOME : (board?.id ?? id))), [home, board, id]);
  const menu = useBoardMenu(board, {
    ...(board?.canEdit ? { add } : {}),
    newBoard: openNewBoard,
    // A deleted board's page goes away with the list: the screen stays, on the board next to it.
    onDeleted: () => void list.refetch(),
  });
  const go = (index: number) => {
    const next = Math.max(0, Math.min(pages.length - 1, index));
    shownId.current = pages[next] ?? HOME;
    setAt(next);
    pager.current?.scrollToIndex({ index: next, animated: true });
  };
  const settled = (e: NativeSyntheticEvent<NativeScrollEvent>) => {
    const index = Math.round(e.nativeEvent.contentOffset.x / width);
    if (index === at || index < 0 || index >= pages.length) return;
    shownId.current = pages[index] ?? HOME;
    setAt(index);
  };
  const byId = useMemo(() => new Map((list.data?.dashboards ?? []).map((b) => [b.id, b])), [list.data]);
  const byline = useBoardByline();
  // Every board with who made it and how many widgets it holds: the list Dashboards had, a tap away.
  const pickBoard = () =>
    void pickOne({
      title: t("dashboards.title"),
      value: id,
      options: pages.map((p) => {
        const b = byId.get(p);
        return {
          key: p,
          label: p === HOME ? t("dashboards.home") : (b?.title ?? ""),
          sub: p === HOME ? t("mobile.dashboards.homeRow") : b ? byline(b) : "",
        };
      }),
    }).then((key) => {
      if (key) go(pages.indexOf(key));
    });
  return (
    <View
      style={[styles.screen, { backgroundColor: c.bg }]}
      onLayout={(e) => {
        const w = Math.round(e.nativeEvent.layout.width);
        if (w > 0 && w !== width) setWidth(w);
      }}
    >
      <Stack.Screen options={{ headerShown: false }} />
      <View style={[styles.top, { paddingTop: insets.top + 6 }]}>
        <IconButton plate icon="back" label={t("mobile.dashboards.back")} onPress={goBack} />
        <Pressable
          style={styles.titleBox}
          onPress={pages.length > 1 ? pickBoard : undefined}
          hitSlop={4}
          disabled={pages.length < 2}
          accessibilityRole={pages.length > 1 ? "button" : "header"}
          accessibilityLabel={title}
          {...(pages.length > 1 ? { accessibilityHint: t("mobile.dashboards.pick") } : {})}
        >
          <Text numberOfLines={1} maxFontSizeMultiplier={1.3} style={[styles.title, { color: c.ink }]}>
            {title}
          </Text>
        </Pressable>
        {menu.any ? (
          <EditPill label={t("mobile.dashboards.editBoard")} onPress={menu.open} />
        ) : (
          <View style={styles.side} />
        )}
      </View>
      <FlatList
        ref={pager}
        data={pages}
        keyExtractor={(p) => p}
        horizontal
        pagingEnabled
        showsHorizontalScrollIndicator={false}
        initialScrollIndex={at}
        extraData={width}
        getItemLayout={(_, index) => ({ length: width, offset: width * index, index })}
        onMomentumScrollEnd={settled}
        windowSize={3}
        initialNumToRender={1}
        renderItem={({ item }) => (
          <View style={{ width }}>
            <Page id={item} alone={pages.length === 1} bottom={insets.bottom + DOTS_ROOM} />
          </View>
        )}
      />
      {pages.length > 1 ? <Dots count={pages.length} at={at} bottom={insets.bottom} /> : null}
    </View>
  );
}

/** "Editar": a word in the bar's round glass, as tall as the back button beside the title. */
function EditPill({ label, onPress }: { label: string; onPress: () => void }) {
  const { colors: c } = useTheme();
  const edge = usePlateEdge();
  return (
    <PressScale
      to={0.94}
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={label}
      hitSlop={4}
      style={styles.pill}
      fill={false}
    >
      <Glass liquid intensity={40} style={[styles.pillGlass, edge]}>
        <Text maxFontSizeMultiplier={1.3} style={[styles.pillText, { color: c.ink }]}>
          {label}
        </Text>
      </Glass>
    </PressScale>
  );
}

/** Room the dots keep under the last widgets. */
const DOTS_ROOM = 40;

/** The pages' dots, the shown one lit; a long run of boards shows only the dots around it. */
function Dots({ count, at, bottom }: { count: number; at: number; bottom: number }) {
  const { t } = useTranslation();
  const { colors: c, scheme } = useTheme();
  const win = dotWindow(count, at);
  const off = scheme === "dark" ? "rgba(255,255,255,0.3)" : "rgba(0,0,0,0.22)";
  return (
    <View
      pointerEvents="none"
      style={[styles.dots, { bottom: Math.max(bottom, 12) + 4 }]}
      accessible
      accessibilityLabel={t("mobile.dashboards.page", { at: at + 1, count })}
    >
      {Array.from({ length: win.count }, (_, i) => win.first + i).map((i) => (
        <View key={i} style={[styles.dot, { backgroundColor: i === at ? c.ink : off }]} />
      ))}
    </View>
  );
}

/** One board's page: its widgets in the iPhone's grid, pulled down to refresh. */
function Page({ id, alone, bottom }: { id: string; alone: boolean; bottom: number }) {
  const { t } = useTranslation();
  const { colors: c } = useTheme();
  const { board, loading, failed, refetch } = useBoard(id);
  const pull = usePullRefresh(refetch);
  const busy = board ? busyWidgets(board.widgets).length > 0 : false;
  useEffect(() => {
    if (!busy) return;
    const timer = setInterval(() => void refetch(), BUSY_POLL_MS);
    return () => clearInterval(timer);
  }, [busy, refetch]);
  if (!board)
    return (
      <View style={styles.center}>
        {loading ? (
          <ActivityIndicator color={c.muted} />
        ) : (
          <>
            <Text tone="muted" style={styles.centerText}>
              {failed ? t("mobile.dashboards.loadFailed") : t("dashboards.errors.notFound")}
            </Text>
            <Button variant="secondary" size="sm" label={t("mobile.common.retry")} onPress={() => void refetch()} />
          </>
        )}
      </View>
    );
  const widgets = widgetsInOrder(board.widgets);
  return (
    <ScrollView
      contentContainerStyle={[styles.page, { paddingBottom: bottom + 16 }]}
      refreshControl={<RefreshControl refreshing={pull.refreshing} onRefresh={pull.onRefresh} />}
    >
      <ProposalBanner board={board} />
      {widgets.length === 0 ? (
        alone && board.kind === "home" ? (
          <FirstBoard />
        ) : (
          <FirstUse
            place="board"
            size="panel"
            acts={board.canEdit}
            label={t("widgets.add.label")}
            onPress={() => router.push(newWidgetHref(board.kind === "home" ? HOME : board.id))}
          />
        )
      ) : (
        <Grid board={board} widgets={widgets} />
      )}
    </ScrollView>
  );
}

/** Two columns: a 2-wide widget takes its row, 1-wide ones pair up, one left alone takes half a row. */
function Grid({ board, widgets }: { board: Dashboard; widgets: Widget[] }) {
  const home = board.kind === "home";
  const rows = phoneRows(widgets.map((w) => ({ w: w.layout.w, widget: w })));
  return (
    <View style={styles.grid}>
      {rows.map((items) => (
        <View key={items.map((x) => x.widget.id).join("+")} style={styles.row}>
          {items.map(({ widget: w }) => (
            <View key={w.id} style={items.length === 1 && w.layout.w < 2 ? styles.half : styles.cell}>
              <WidgetPeek widget={w} canEdit={board.canEdit} board={{ id: home ? HOME : board.id, home }} />
            </View>
          ))}
        </View>
      ))}
    </View>
  );
}

/**
 * No board and nothing on My Home yet: what a dashboard is, with New dashboard and an ask to the right hand, as the
 * web's first look.
 */
function FirstBoard() {
  const { t } = useTranslation();
  const look = useEmptyLook();
  const lodi = rightHandOf(useDirectory().agents);
  const { org } = useOrg();
  const openDm = useOpenDm();
  return (
    <EmptyState
      size="page"
      agent={look}
      title={t("dashboards.first.title")}
      subtitle={t("dashboards.first.text")}
      action={
        <View style={styles.firstActs}>
          <Button variant="primary" size="md" label={t("dashboards.new")} onPress={openNewBoard} />
          {lodi && mayAsk(org, lodi) ? (
            <Button
              variant="secondary"
              size="md"
              label={t("common.askAgent", agentGrammar(lodi.name))}
              onPress={() => openDm({ agentId: lodi.id }, { compose: true, text: t("dashboards.first.ask") })}
            />
          ) : null}
        </View>
      }
    />
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1 },
  top: { flexDirection: "row", alignItems: "center", gap: 8, paddingHorizontal: 16 },
  titleBox: { flex: 1, minWidth: 0, height: 40, alignItems: "center", justifyContent: "center" },
  title: { fontFamily: DB_FONTES.titulo700, fontWeight: "700", fontSize: 17, letterSpacing: -0.17 },
  side: { width: 40 },
  pill: { height: 40, borderRadius: 20 },
  pillGlass: { height: 40, borderRadius: 20, paddingHorizontal: 16, alignItems: "center", justifyContent: "center" },
  pillText: { fontFamily: DB_FONTES.texto600, fontWeight: "600", fontSize: 14 },
  page: { paddingHorizontal: 16, paddingTop: 18, gap: TILE_GAP },
  grid: { gap: TILE_GAP },
  row: { flexDirection: "row", gap: TILE_GAP },
  cell: { flex: 1, minWidth: 0 },
  // A lone half widget as wide as one in a row of two: half the row, less half the gap between them.
  half: { width: "50%", paddingRight: TILE_GAP / 2 },
  center: { flex: 1, alignItems: "center", justifyContent: "center", gap: 12, paddingHorizontal: 32 },
  centerText: { textAlign: "center" },
  dots: { position: "absolute", left: 0, right: 0, flexDirection: "row", justifyContent: "center", gap: 8 },
  dot: { width: 7, height: 7, borderRadius: 3.5 },
  firstActs: { flexDirection: "row", flexWrap: "wrap", justifyContent: "center", gap: 8, flexShrink: 1 },
});
