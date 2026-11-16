import { useWhatsApp, type WhatsAppAccount } from "@agenteschat/client";
import { Redirect } from "expo-router";
import { useTranslation } from "react-i18next";
import { RefreshControl, StyleSheet, View } from "react-native";
import { Button, Chip, EmptyState, GroupedList, GroupedRow, SkeletonList, Text } from "@/ui";
import { useOrgId, usePullRefresh } from "../shared/hooks";
import { PushedLargeTitle } from "../shared/PushedLargeTitle";
import { accountsInOrder, onlyAccount, openWhatsAppAccount, showPhone } from "./logic";
import { useWhatsAppWords } from "./words";

/**
 * WhatsApp on the phone (docs/adr/doug-0001-whatsapp-numbers.md), pushed from the home: the workspace's numbers this
 * person may use, each with whether it is connected. With one number it opens straight on its conversations.
 * Connecting is reading a QR code with the number's own phone, so it stays on the web: here the empty state says so.
 */
export function WhatsAppScreen() {
  const w = useWhatsAppWords();
  const { t } = useTranslation();
  const orgId = useOrgId();
  const overview = useWhatsApp(orgId);
  const pull = usePullRefresh(overview.refetch);
  const data = overview.data;
  const only = data?.on ? onlyAccount(data.accounts) : null;
  if (only) return <Redirect href={`/whatsapp/${only}`} />;
  return (
    <PushedLargeTitle
      title={w.title}
      grouped
      refreshControl={<RefreshControl refreshing={pull.refreshing} onRefresh={pull.onRefresh} />}
    >
      <View style={styles.in}>
        {overview.isLoading ? (
          <SkeletonList rows={2} />
        ) : !data ? (
          <View style={styles.center}>
            <Text tone="muted" style={styles.centerText}>
              {w.empty.failed}
            </Text>
            <Button
              variant="secondary"
              size="sm"
              label={t("mobile.common.retry")}
              onPress={() => void overview.refetch()}
            />
          </View>
        ) : !data.on ? (
          <EmptyState size="page" icon="message" title={w.empty.offTitle} />
        ) : data.accounts.length === 0 ? (
          <EmptyState
            size="page"
            icon="phone"
            title={w.empty.noneTitle}
            subtitle={data.manage ? w.empty.noneWeb : w.empty.noneAsk}
          />
        ) : (
          <GroupedList>
            {accountsInOrder(data.accounts).map((account) => (
              <AccountRow key={account.id} account={account} />
            ))}
          </GroupedList>
        )}
      </View>
    </PushedLargeTitle>
  );
}

/** One number: its name, its digits once connected, and a chip while it isn't. */
function AccountRow({ account: a }: { account: WhatsAppAccount }) {
  const w = useWhatsAppWords();
  const connected = a.status === "connected";
  const sub = connected ? showPhone(a.phone) || w.status.connected : a.mine ? "" : w.empty.notMineTitle;
  return (
    <GroupedRow
      label={a.label}
      sub={sub || undefined}
      subLines={2}
      icon="phone"
      below={
        connected ? undefined : (
          <View style={styles.chip}>
            <Chip tone="wait" label={w.status[a.status]} />
          </View>
        )
      }
      chevron
      onPress={() => openWhatsAppAccount(a.id)}
    />
  );
}

const styles = StyleSheet.create({
  in: { paddingHorizontal: 16, gap: 16 },
  center: { alignItems: "center", gap: 12, paddingVertical: 32 },
  centerText: { textAlign: "center" },
  chip: { marginTop: 6 },
});
