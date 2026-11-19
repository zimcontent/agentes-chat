import { usePortalBoard } from "@dougbot/client";
import { portalClientName } from "@dougbot/client/lib/portal";
import { ActivityIndicator, RefreshControl, StyleSheet, View } from "react-native";
import { Text } from "@/ui";
import { useColors, useOrgId, usePullRefresh } from "../shared/hooks";
import { PushedLargeTitle } from "../shared/PushedLargeTitle";
import { PushedHeader } from "../shared/parts";
import { usePortalWords } from "./hooks";
import { findItem } from "./model";
import { PostPanel } from "./PostPanel";

/**
 * A post at the portal no card stands for (ADR 9001): sent from elsewhere, so it has no files, task or comments here.
 * Its panel says where it stands and offers what the phone can do with it.
 */
export function PostScreen({ client, itemId }: { client: string; itemId: string }) {
  const w = usePortalWords();
  const c = useColors();
  const orgId = useOrgId();
  const board = usePortalBoard(orgId, client);
  const pull = usePullRefresh(board.refetch);
  const found = findItem(board.data, itemId);
  if (!found) {
    return (
      <View style={[styles.fill, { backgroundColor: c.grouped }]}>
        <PushedHeader title="" solid={false} grouped />
        <View style={styles.center}>
          {board.isLoading ? (
            <ActivityIndicator color={c.muted} />
          ) : (
            <Text tone="muted" style={styles.centerText}>
              {w.postNotFound}
            </Text>
          )}
        </View>
      </View>
    );
  }
  return (
    <PushedLargeTitle
      title={found.item.title}
      grouped
      keyboard
      refreshControl={<RefreshControl refreshing={pull.refreshing} onRefresh={pull.onRefresh} />}
    >
      <View style={styles.in}>
        <Text variant="subhead" tone="muted">
          {`${portalClientName(client)} · ${w.types[found.item.type]}`}
        </Text>
        <PostPanel client={client} item={found.item} column={found.column} />
      </View>
    </PushedLargeTitle>
  );
}

const styles = StyleSheet.create({
  fill: { flex: 1 },
  center: { flex: 1, alignItems: "center", justifyContent: "center", padding: 32 },
  centerText: { textAlign: "center" },
  in: { paddingHorizontal: 16, gap: 16 },
});
