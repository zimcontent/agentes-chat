import { keys, useWhatsApp, useWhatsAppChats, type WhatsAppChat, whatsappPhotoUrl } from "@agenteschat/client";
import { useTranslation } from "react-i18next";
import { RefreshControl, StyleSheet, View } from "react-native";
import { Button, Chip, Count, EmptyState, LIST_AVATAR, ListRow, PersonAvatar, SkeletonList, Text } from "@/ui";
import { useColors, useOrgId, usePullRefresh, useWhen } from "../shared/hooks";
import { PushedLargeTitle } from "../shared/PushedLargeTitle";
import { chatTitle, lastLine, openWhatsAppChat, ownFile, useWhatsAppKeepFresh } from "./logic";
import { useWhatsAppWords } from "./words";

/** How often the list is asked again while it is in front (see `useWhatsAppKeepFresh`). */
const LIST_FRESH_MS = 20_000;

/**
 * A number's conversations (docs/adr/doug-0001-whatsapp-numbers.md), the latest first, as the home's list draws its
 * own: the contact's photo or initial, the name, the time, the last line and what is unread. A group says so under
 * its name. More come a page at a time at the end.
 */
export function WhatsAppChatsScreen({ accountId }: { accountId: string }) {
  const w = useWhatsAppWords();
  const { t } = useTranslation();
  const orgId = useOrgId();
  const c = useColors();
  const overview = useWhatsApp(orgId);
  const account = overview.data?.accounts.find((a) => a.id === accountId);
  const mine = account?.mine ?? false;
  const chats = useWhatsAppChats(orgId, mine ? accountId : null);
  useWhatsAppKeepFresh(mine ? keys.whatsappChats(orgId, accountId) : null, LIST_FRESH_MS);
  const pull = usePullRefresh(() => Promise.all([overview.refetch(), mine ? chats.refetch() : null]));
  const list = chats.data?.pages.flatMap((page) => page.chats) ?? [];
  const retry = (refetch: () => unknown) => (
    <View style={styles.center}>
      <Text tone="muted" style={styles.centerText}>
        {w.empty.failed}
      </Text>
      <Button variant="secondary" size="sm" label={t("mobile.common.retry")} onPress={() => void refetch()} />
    </View>
  );
  return (
    <PushedLargeTitle
      title={account?.label || w.title}
      refreshControl={<RefreshControl refreshing={pull.refreshing} onRefresh={pull.onRefresh} />}
    >
      {overview.isLoading ? (
        <SkeletonList rows={6} />
      ) : !overview.data ? (
        retry(overview.refetch)
      ) : !account ? (
        <EmptyState size="page" icon="phone" title={w.empty.gone} />
      ) : (
        <>
          {account.status !== "connected" ? (
            <View style={[styles.notice, { borderColor: c.line2 }]}>
              <Chip tone="wait" label={w.status[account.status]} />
              <Text variant="footnote" tone="muted">
                {w.reconnectOnWeb}
              </Text>
            </View>
          ) : null}
          {!mine ? (
            <EmptyState size="page" icon="lock" title={w.empty.notMineTitle} subtitle={w.empty.notMineText} />
          ) : chats.isLoading ? (
            <SkeletonList rows={6} />
          ) : chats.isError && !chats.data ? (
            retry(chats.refetch)
          ) : list.length === 0 ? (
            <EmptyState size="page" icon="message" title={w.empty.noChatsTitle} subtitle={w.empty.noChatsText} />
          ) : (
            <View>
              {list.map((chat, i) => (
                <ChatRow key={chat.id} chat={chat} accountId={accountId} divider={i > 0} />
              ))}
              {chats.hasNextPage ? (
                <View style={styles.more}>
                  <Button
                    variant="ghost"
                    size="sm"
                    label={w.loadMoreChats}
                    loading={chats.isFetchingNextPage}
                    onPress={() => void chats.fetchNextPage()}
                  />
                </View>
              ) : null}
            </View>
          )}
        </>
      )}
    </PushedLargeTitle>
  );
}

/** One conversation in the list. */
function ChatRow({ chat, accountId, divider }: { chat: WhatsAppChat; accountId: string; divider: boolean }) {
  const w = useWhatsAppWords();
  const orgId = useOrgId();
  const when = useWhen();
  const title = chatTitle(chat, w);
  const photo = chat.photo ? ownFile((base) => whatsappPhotoUrl(orgId, accountId, chat, base) ?? "") : null;
  const unread = chat.unread > 0;
  const turn = chat.agent === "person";
  return (
    <ListRow
      divider={divider}
      leading={<PersonAvatar name={title} size={LIST_AVATAR} photo={photo} />}
      title={title}
      time={chat.lastAt ? when.short(chat.lastAt) : null}
      over={
        chat.group ? (
          <Text variant="footnote" tone="faint">
            {w.group}
          </Text>
        ) : undefined
      }
      sub={lastLine(chat, w)}
      subLines={1}
      unread={unread}
      trailing={
        turn || unread ? (
          <View style={styles.trailing}>
            {turn ? <Chip tone="wait" label={w.agent.yourTurn} /> : null}
            {unread ? <Count value={chat.unread} inverted max={99} /> : null}
          </View>
        ) : undefined
      }
      accessibilityRole="button"
      onPress={() => openWhatsAppChat(accountId, chat.id)}
    />
  );
}

const styles = StyleSheet.create({
  center: { alignItems: "center", gap: 12, paddingVertical: 32, paddingHorizontal: 16 },
  centerText: { textAlign: "center" },
  notice: {
    marginHorizontal: 16,
    marginBottom: 12,
    padding: 12,
    gap: 8,
    borderRadius: 12,
    borderWidth: StyleSheet.hairlineWidth,
    alignItems: "flex-start",
  },
  more: { alignItems: "center", paddingVertical: 12 },
  trailing: { flexDirection: "row", alignItems: "center", gap: 8 },
});
