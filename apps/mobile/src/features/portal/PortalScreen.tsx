import type { PortalClientColor, PortalPipelineEntry } from "@agenteschat/client";
import { isPortalOff, usePortalOverview, usePortalPipeline } from "@agenteschat/client";
import {
  PORTAL_FOCI,
  type PortalClientStatus,
  pipelineClients,
  pipelineNextPost,
  pipelineTiles,
  portalClientColors,
  portalClientLogos,
  portalClientName,
  portalStatusWaits,
  portalWhen,
  sortPortalClients,
} from "@agenteschat/client/lib/portal";
import { useLocalSearchParams } from "expo-router";
import { useTranslation } from "react-i18next";
import { Pressable, RefreshControl, StyleSheet, View } from "react-native";
import {
  EmptyState,
  GroupedHeader,
  Icon,
  LargeTitleScreen,
  PULL_TINT,
  PullOrbit,
  SkeletonList,
  Text,
  useTheme,
} from "@/ui";
import { router } from "@/ui/navigation";
import { useOrgId, usePullRefresh } from "../shared/hooks";
import { RetryLine } from "../shared/TeamSkyEmpty";
import { useTabHeader } from "../shared/tabHeader";
import { usePortalKnown, usePortalOn, usePortalWords } from "./hooks";
import { clientCounts, STAGE_COLOR, statusLine, summaryStatus } from "./model";
import { ClientMark, CountChips, HeaderCount, openClient, PortalNotice } from "./parts";

/**
 * Portal (ADR 9001) as a tab: every client at a glance, as the web's overview. On top what waits on the team now (four
 * numbers across every client), then a card per client with its mark, its one most pressing line (in the waiting tone
 * when it waits on the team), its counts and its next post; who waits on the team first. A row opens the
 * client's board. Nothing here changes anything. Off where the server has no portal or the workspace turned it off.
 */
export function PortalScreen() {
  const w = usePortalWords();
  const { i18n } = useTranslation();
  const orgId = useOrgId();
  const on = usePortalOn();
  const known = usePortalKnown();
  const overview = usePortalOverview(orgId, on);
  const pipeline = usePortalPipeline(orgId, on);
  const pull = usePullRefresh(() => Promise.all([overview.refetch(), pipeline.refetch()]));
  const off = (known && !on) || isPortalOff(overview.error);
  const clients = overview.data?.clients ?? [];
  const colors = portalClientColors(clients);
  const logos = portalClientLogos(clients);
  const summaries = new Map(clients.map((c) => [c.client, c]));
  const entries = pipeline.data?.entries;
  // Início's "Alterações" with several clients asking: only them, until "Ver todos".
  const { alteracoes } = useLocalSearchParams<{ alteracoes?: string }>();
  const onlyAsking = alteracoes === "1";
  const asking = (client: string) => (summaries.get(client)?.counts.adjusting ?? 0) > 0;
  // The pipeline knows what is late; until it answers, the overview's counts say the rest.
  const rows = entries
    ? pipelineClients(
        clients.map((c) => c.client),
        entries,
      ).map((r) => ({ client: r.client, status: r.status, own: r.entries as PortalPipelineEntry[] }))
    : sortPortalClients(clients).map((c) => ({ client: c.client, status: summaryStatus(c), own: null }));
  const shown = onlyAsking ? rows.filter((r) => asking(r.client)) : rows;
  return (
    <LargeTitleScreen
      title={w.title}
      {...useTabHeader()}
      grouped
      refreshControl={<RefreshControl refreshing={pull.refreshing} onRefresh={pull.onRefresh} tintColor={PULL_TINT} />}
      pullMark={<PullOrbit refreshing={pull.refreshing} />}
    >
      <View style={styles.in}>
        {off ? (
          <EmptyState size="page" icon="check" title={w.off} subtitle={w.offText} />
        ) : !known || overview.isLoading ? (
          <SkeletonList rows={5} />
        ) : !overview.data ? (
          <RetryLine onRetry={() => void overview.refetch()} />
        ) : clients.length === 0 ? (
          <EmptyState size="page" agent title={w.noClients} subtitle={w.noClientsText} />
        ) : (
          <>
            <PortalNotice state={overview.data.state} />
            {entries && <Tiles entries={entries} />}
            <View>
              <GroupedHeader aside={<HeaderCount count={shown.length} />}>
                {onlyAsking ? w.asked : w.clients}
              </GroupedHeader>
              {onlyAsking ? (
                <Pressable
                  onPress={() => router.setParams({ alteracoes: undefined })}
                  accessibilityRole="button"
                  style={styles.seeAll}
                >
                  <Text variant="footnote" tone="muted">
                    {w.seeAllClients}
                  </Text>
                </Pressable>
              ) : null}
              <View style={styles.cards}>
                {shown.map(({ client, status, own }) => {
                  const summary = summaries.get(client);
                  const next =
                    own && pipeline.data ? pipelineNextPost(own, pipeline.data.day) : (summary?.next ?? null);
                  return (
                    <ClientCard
                      key={client}
                      client={client}
                      status={status}
                      counts={clientCounts(summary)}
                      next={portalWhen(i18n.language, next)}
                      logo={logos.get(client)}
                      color={colors.get(client)}
                    />
                  );
                })}
              </View>
            </View>
          </>
        )}
      </View>
    </LargeTitleScreen>
  );
}

/**
 * A client on the Portal tab, as a card: its mark, its name and its one most pressing line (in the waiting tone when
 * it waits on the team), then its counts as chips and its next post. A quiet client fades back. A press opens its board.
 */
function ClientCard({
  client,
  status,
  counts,
  next,
  logo,
  color,
}: {
  client: string;
  status: PortalClientStatus;
  counts: ReturnType<typeof clientCounts>;
  next: string | null;
  logo: string | undefined;
  color: PortalClientColor | undefined;
}) {
  const w = usePortalWords();
  const { colors: c } = useTheme();
  const name = portalClientName(client);
  const waits = portalStatusWaits(status);
  const line = statusLine(w, status);
  return (
    <Pressable
      onPress={() => openClient(client)}
      accessibilityRole="button"
      accessibilityLabel={[name, line, ...counts.map((k) => String(k.count)), next ? w.next(next) : null]
        .filter(Boolean)
        .join(", ")}
      accessibilityHint={w.clientCard(name)}
      style={({ pressed }) => [
        styles.card,
        { backgroundColor: c.raised, borderColor: waits ? `${c.amber}55` : c.line },
        status.kind === "idle" ? styles.idle : null,
        pressed ? styles.pressed : null,
      ]}
    >
      <View style={styles.cardHead}>
        <ClientMark client={client} logo={logo} color={color} size={44} />
        <View style={styles.cardWords}>
          <Text variant="body" style={styles.cardName}>
            {name}
          </Text>
          <View style={styles.statusLine}>
            {waits ? <View style={[styles.waitDot, { backgroundColor: c.amber }]} /> : null}
            <Text variant="footnote" style={{ color: waits ? c.amberInk : c.muted }}>
              {line}
            </Text>
          </View>
        </View>
        <Icon name="right" size={18} color={c.faint} />
      </View>
      {counts.length > 0 || next ? (
        <View style={[styles.cardFoot, { borderTopColor: c.line }]}>
          {counts.length > 0 ? <CountChips w={w} counts={counts} /> : null}
          {next ? (
            <View style={styles.next}>
              <Icon name="calendar" size={13} color={c.muted} />
              <Text variant="caption" tone="muted">
                {w.next(next)}
              </Text>
            </View>
          ) : null}
        </View>
      ) : null}
    </Pressable>
  );
}

/**
 * "Agora": four numbers across every client, two by two: what needs the team (an adjustment asked or work past its
 * production day), what is being made, what is with the client, what is approved and waits for a date. Only "Needs
 * you" takes the waiting tone, and only while it counts something.
 */
function Tiles({ entries }: { entries: PortalPipelineEntry[] }) {
  const w = usePortalWords();
  const { colors: c } = useTheme();
  const n = pipelineTiles(entries);
  return (
    <View>
      <GroupedHeader>{w.now}</GroupedHeader>
      <View style={styles.tiles}>
        {PORTAL_FOCI.map((key) => {
          const attention = key === "you" && n.you > 0;
          return (
            <View
              key={key}
              accessible
              accessibilityLabel={`${w.tiles[key]}: ${n[key]}`}
              // Filled and edged, no shadow: four boxes side by side would be four offscreen layers on iOS.
              style={[styles.tile, { backgroundColor: c.raised, borderColor: attention ? `${c.amber}66` : c.line }]}
            >
              <View style={styles.tileTop}>
                <View style={[styles.tileDot, { backgroundColor: attention ? c.amber : TILE_DOT[key] }]} />
                <Text variant="title2" style={[styles.num, attention ? { color: c.amber } : null]}>
                  {String(n[key])}
                </Text>
              </View>
              <Text variant="footnote" tone="muted" numberOfLines={2}>
                {w.tiles[key]}
              </Text>
            </View>
          );
        })}
      </View>
    </View>
  );
}

/** Each number's dot, in the stage it counts (the board's colors). */
const TILE_DOT: Record<(typeof PORTAL_FOCI)[number], string> = {
  you: STAGE_COLOR.adjusting,
  making: STAGE_COLOR.doing,
  client: STAGE_COLOR.approval,
  schedule: STAGE_COLOR.approved,
};

const styles = StyleSheet.create({
  seeAll: { alignSelf: "flex-start", minHeight: 32, justifyContent: "center", marginBottom: 4 },
  in: { paddingHorizontal: 16, gap: 16 },
  tiles: { flexDirection: "row", flexWrap: "wrap", gap: 8 },
  tile: {
    flexBasis: "48%",
    flexGrow: 1,
    borderRadius: 16,
    borderWidth: StyleSheet.hairlineWidth,
    paddingHorizontal: 16,
    paddingVertical: 14,
    gap: 2,
  },
  tileTop: { flexDirection: "row", alignItems: "center", gap: 8 },
  tileDot: { width: 8, height: 8, borderRadius: 4 },
  num: { fontVariant: ["tabular-nums"] },
  cards: { gap: 8 },
  // A client as a card: 16 inside, 16 round, its edge amber while it waits on the team.
  card: { borderRadius: 16, borderWidth: StyleSheet.hairlineWidth, padding: 16, gap: 12 },
  cardHead: { flexDirection: "row", alignItems: "center", gap: 12 },
  cardWords: { flex: 1, minWidth: 0, gap: 2 },
  cardName: { fontWeight: "700" },
  statusLine: { flexDirection: "row", alignItems: "center", gap: 6 },
  waitDot: { width: 6, height: 6, borderRadius: 3 },
  cardFoot: { gap: 8, paddingTop: 12, borderTopWidth: StyleSheet.hairlineWidth },
  next: { flexDirection: "row", alignItems: "center", gap: 6 },
  idle: { opacity: 0.6 },
  pressed: { opacity: 0.7 },
});
