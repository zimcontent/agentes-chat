import { useMediaGenerations, useMediaOverview } from "@agenteschat/client";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { RefreshControl, StyleSheet, useWindowDimensions, View } from "react-native";
import { Button, EmptyState, GroupedList, GroupedRow, IconButton, Segmented, SkeletonList, Text } from "@/ui";
import { useOrgId, usePullRefresh } from "../shared/hooks";
import { PushedLargeTitle } from "../shared/PushedLargeTitle";
import { useTopUp } from "./hooks";
import { tileSide } from "./logic";
import { openGeneration, openNewMedia } from "./nav";
import { GenerationTile } from "./parts";
import { useMediaWords } from "./words";

const GAP = 4;

/**
 * Mídia on the phone (docs/adr/doug-0011), pushed from the home's tools: the wallet's balance (and "Comprar créditos"
 * for who manages billing), then what was generated, mine or the whole workspace's, as a grid of squares. A running one
 * is checked until its file lands; a tap opens its screen. The "+" opens the form.
 */
export function MediaScreen() {
  const { t, i18n } = useTranslation();
  const w = useMediaWords();
  const orgId = useOrgId();
  const overview = useMediaOverview(orgId);
  const [scope, setScope] = useState<"mine" | "all">("mine");
  const list = useMediaGenerations(orgId, scope === "mine");
  const pull = usePullRefresh(() => Promise.all([overview.refetch(), list.refetch()]));
  const data = overview.data;
  const topUp = useTopUp(orgId, data?.packs ?? []);
  const { width } = useWindowDimensions();
  const side = tileSide(width, 3, GAP);
  const items = list.data ?? [];
  const fmt = (n: number) => n.toLocaleString(i18n.language);

  return (
    <PushedLargeTitle
      title={t("mediaGen.title")}
      grouped
      right={data ? <IconButton icon="plus" label={w.newLabel} onPress={() => openNewMedia()} /> : undefined}
      refreshControl={<RefreshControl refreshing={pull.refreshing} onRefresh={pull.onRefresh} />}
    >
      <View style={styles.in}>
        {overview.isLoading ? (
          <SkeletonList rows={2} />
        ) : !data ? (
          <View style={styles.center}>
            <Text tone="muted" style={styles.centerText}>
              {w.loadFailed}
            </Text>
            <Button
              variant="secondary"
              size="sm"
              label={t("mobile.common.retry")}
              onPress={() => void overview.refetch()}
            />
          </View>
        ) : (
          <GroupedList>
            <GroupedRow
              icon="wallet"
              label={w.balance}
              value={t("mediaGen.credits", { count: data.balance, formatted: fmt(data.balance) })}
              {...(topUp.pending ? { sub: t("mediaGen.topup.pending"), subLines: 0 } : {})}
            />
            {data.canTopUp ? (
              <GroupedRow
                icon="plus"
                label={t("mediaGen.topup.title")}
                disabled={topUp.busy}
                chevron
                onPress={topUp.start}
              />
            ) : null}
          </GroupedList>
        )}
        {data ? (
          <>
            <Segmented
              wide
              value={scope}
              onChange={(v) => setScope(v as "mine" | "all")}
              items={[
                { key: "mine", label: t("mediaGen.mine") },
                { key: "all", label: t("mediaGen.all") },
              ]}
            />
            {list.isLoading ? (
              <SkeletonList rows={3} />
            ) : list.isError && !list.data ? (
              <View style={styles.center}>
                <Text tone="muted" style={styles.centerText}>
                  {w.loadFailed}
                </Text>
                <Button
                  variant="secondary"
                  size="sm"
                  label={t("mobile.common.retry")}
                  onPress={() => void list.refetch()}
                />
              </View>
            ) : items.length === 0 ? (
              <EmptyState
                size="panel"
                icon="image"
                title={t("mediaGen.empty.title")}
                subtitle={t("mediaGen.empty.text")}
                action={<Button variant="primary" label={w.newLabel} onPress={() => openNewMedia()} />}
              />
            ) : (
              <View style={styles.grid} accessibilityLabel={t("mediaGen.gallery")}>
                {items.map((g) => (
                  <GenerationTile key={g.id} g={g} side={side} onPress={() => openGeneration(g.id)} />
                ))}
              </View>
            )}
          </>
        ) : null}
      </View>
    </PushedLargeTitle>
  );
}

const styles = StyleSheet.create({
  in: { paddingHorizontal: 16, gap: 16 },
  center: { alignItems: "center", gap: 12, paddingVertical: 32 },
  centerText: { textAlign: "center" },
  grid: { flexDirection: "row", flexWrap: "wrap", gap: GAP },
});
