import type { PortalPipelineEntry } from "@agenteschat/client";
import { isPortalOff, usePortalOverview, usePortalPipeline } from "@agenteschat/client";
import {
  PORTAL_FOCI,
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
import { useTranslation } from "react-i18next";
import { RefreshControl, StyleSheet, View } from "react-native";
import {
  EmptyState,
  GroupedHeader,
  GroupedList,
  GroupedRow,
  LargeTitleScreen,
  PULL_TINT,
  PullOrbit,
  SkeletonList,
  Text,
  useTheme,
} from "@/ui";
import { useOrgId, usePullRefresh } from "../shared/hooks";
import { RetryLine } from "../shared/TeamSkyEmpty";
import { useTabHeader } from "../shared/tabHeader";
import { usePortalKnown, usePortalOn, usePortalWords } from "./hooks";
import { statusLine, summaryStatus } from "./model";
import { ClientMark, HeaderCount, openClient, PortalNotice } from "./parts";

/**
 * Portal (ADR 9001) as a tab: every client at a glance, as the web's overview. On top what waits on the team now (four
 * numbers across every client), then a row per client with its mark, its one most pressing line (in the waiting tone
 * when it waits on the team), how many it has open and its next post; who waits on the team first. A row opens the
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
  // The pipeline knows what is late; until it answers, the overview's counts say the rest.
  const rows = entries
    ? pipelineClients(
        clients.map((c) => c.client),
        entries,
      ).map((r) => ({ client: r.client, status: r.status, own: r.entries as PortalPipelineEntry[] }))
    : sortPortalClients(clients).map((c) => ({ client: c.client, status: summaryStatus(c), own: null }));
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
              <GroupedHeader aside={<HeaderCount count={rows.length} />}>{w.clients}</GroupedHeader>
              <GroupedList>
                {rows.map(({ client, status, own }) => {
                  const summary = summaries.get(client);
                  const next =
                    own && pipeline.data ? pipelineNextPost(own, pipeline.data.day) : (summary?.next ?? null);
                  const nextWhen = portalWhen(i18n.language, next);
                  const open = own ? own.length : (summary?.open ?? 0);
                  const facts = [open > 0 ? w.open(open) : null, nextWhen ? w.next(nextWhen) : null].filter(
                    (f): f is string => Boolean(f),
                  );
                  return (
                    <GroupedRow
                      key={client}
                      label={portalClientName(client)}
                      sub={statusLine(w, status)}
                      subTone={portalStatusWaits(status) ? "amber" : "faint"}
                      {...(facts.length > 0 ? { belowText: facts.join(" · ") } : {})}
                      leading={<ClientMark client={client} logo={logos.get(client)} color={colors.get(client)} />}
                      faint={status.kind === "idle"}
                      chevron
                      onPress={() => openClient(client)}
                    />
                  );
                })}
              </GroupedList>
            </View>
          </>
        )}
      </View>
    </LargeTitleScreen>
  );
}

/**
 * "Agora": four numbers across every client, two by two: what needs the team (an adjustment asked or work past its
 * production day), what is being made, what is with the client, what is approved and waits for a date. Only "Needs
 * you" takes the waiting tone, and only while it counts something.
 */
function Tiles({ entries }: { entries: PortalPipelineEntry[] }) {
  const w = usePortalWords();
  const { colors: c, shadows } = useTheme();
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
              style={[styles.tile, { backgroundColor: c.raised, boxShadow: shadows.e1 }]}
            >
              <Text variant="title2" style={[styles.num, attention ? { color: c.amber } : null]}>
                {String(n[key])}
              </Text>
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

const styles = StyleSheet.create({
  in: { paddingHorizontal: 16, gap: 16 },
  tiles: { flexDirection: "row", flexWrap: "wrap", gap: 8 },
  tile: { flexBasis: "48%", flexGrow: 1, borderRadius: 16, paddingHorizontal: 16, paddingVertical: 14, gap: 2 },
  num: { fontVariant: ["tabular-nums"] },
});
