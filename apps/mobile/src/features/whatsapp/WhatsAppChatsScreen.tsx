import { keys, useWhatsApp, useWhatsAppChats, type WhatsAppChat, whatsappPhotoUrl } from "@agenteschat/client";
import { Stack } from "expo-router";
import { memo, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import {
  ActivityIndicator,
  FlatList,
  Pressable,
  RefreshControl,
  Text as RNText,
  StyleSheet,
  TextInput,
  View,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { Button, EmptyState, IconButton, SkeletonList, Text } from "@/ui";
import { goBack, router } from "@/ui/navigation";
import { Face } from "../shared/Face";
import { useDirectory, useOrgId, usePullRefresh, useWhen } from "../shared/hooks";
import { pickOne } from "../shared/PickerSheet";
import {
  accountsInOrder,
  agentAnswering,
  agentHere,
  type ChatFilter,
  chatTitle,
  filterChats,
  lastLine,
  openWhatsAppChat,
  ownFile,
  previewOf,
  showPhone,
  unreadChats,
  useWhatsAppKeepFresh,
} from "./logic";
import { useWa, WA_FONT, type WaColors, WaGlyph, WaPhoto, WaTicks, WhatsAppMark } from "./look";
import { openWhatsAppNumber } from "./WhatsAppNumberScreen";
import { useWhatsAppWords, type WhatsAppWords } from "./words";

/** How often the list is asked again while it is in front (see `useWhatsAppKeepFresh`). */
const LIST_FRESH_MS = 20_000;
/** WhatsApp's row: 76 tall, the photo 52, 14 between it and the words. */
const ROW_H = 76;
const PHOTO = 52;
const FILTERS: ChatFilter[] = ["all", "unread", "groups"];

/**
 * A number's conversations (docs/adr/doug-0001-whatsapp-numbers.md) drawn as the phone's WhatsApp: the number at
 * the top (a tap switches to another of the person's numbers), the large "Conversas", the search, the filters, then
 * each conversation with its photo, name, time, last line with our ticks and what is unread. Where the number's
 * agent answers, its face sits on the photo's corner, and while it is answering the line says so by its name.
 */
export function WhatsAppChatsScreen({ accountId }: { accountId: string }) {
  const w = useWhatsAppWords();
  const { t } = useTranslation();
  const wa = useWa();
  const orgId = useOrgId();
  const insets = useSafeAreaInsets();
  const dir = useDirectory();
  const overview = useWhatsApp(orgId);
  const account = overview.data?.accounts.find((a) => a.id === accountId);
  const mine = account?.mine ?? false;
  const chats = useWhatsAppChats(orgId, mine ? accountId : null);
  useWhatsAppKeepFresh(mine ? keys.whatsappChats(orgId, accountId) : null, LIST_FRESH_MS);
  const pull = usePullRefresh(() => Promise.all([overview.refetch(), mine ? chats.refetch() : null]));
  const [filter, setFilter] = useState<ChatFilter>("all");
  const [query, setQuery] = useState("");
  const all = useMemo(() => chats.data?.pages.flatMap((page) => page.chats) ?? [], [chats.data]);
  const list = useMemo(() => filterChats(all, filter, query, w), [all, filter, query, w]);
  const unread = unreadChats(all);
  const agentId = account?.agentOn ? account.agentId : null;
  const agentName = agentId ? dir.nameOf({ type: "agent", id: agentId }) || w.chat.theAi : "";
  const numbers = accountsInOrder(overview.data?.accounts ?? []).filter((a) => a.mine);

  const switchNumber = async () => {
    const picked = await pickOne({
      title: w.list.pickNumber,
      options: numbers.map((a) => ({
        key: a.id,
        label: a.label,
        sub: showPhone(a.phone) || w.status[a.status],
        leading: { kind: "icon" as const, name: "phone" as const },
      })),
      value: accountId,
    });
    if (picked && picked !== accountId) router.replace(`/whatsapp/${picked}`);
  };

  const retry = (refetch: () => unknown) => (
    <View style={styles.center}>
      <Text style={[styles.centerText, { color: wa.sub }]}>{w.empty.failed}</Text>
      <Button variant="secondary" size="sm" label={t("mobile.common.retry")} onPress={() => void refetch()} />
    </View>
  );

  const head = (
    <View>
      <RNText accessibilityRole="header" style={[styles.title, { color: wa.ink }]}>
        {w.list.title}
      </RNText>
      {account && mine ? (
        <>
          <View style={[styles.search, { backgroundColor: wa.field }]}>
            <WaGlyph name="search" size={17} color={wa.sub} />
            <TextInput
              value={query}
              onChangeText={setQuery}
              placeholder={w.list.search}
              placeholderTextColor={wa.sub}
              style={[styles.searchText, { color: wa.ink }]}
              returnKeyType="search"
              clearButtonMode="while-editing"
              autoCorrect={false}
              accessibilityLabel={w.list.search}
            />
          </View>
          <View style={styles.chips} accessibilityRole="tablist">
            {FILTERS.map((f) => {
              const on = f === filter;
              return (
                <Pressable
                  key={f}
                  onPress={() => setFilter(f)}
                  accessibilityRole="tab"
                  accessibilityState={{ selected: on }}
                  hitSlop={{ top: 6, bottom: 6 }}
                  style={[styles.chip, { backgroundColor: on ? wa.chosen : wa.field }]}
                >
                  <RNText style={[styles.chipText, { color: on ? wa.chosenInk : wa.soft }]}>{w.list.filters[f]}</RNText>
                  {f === "unread" && unread > 0 ? (
                    <RNText style={[styles.chipCount, { color: on ? wa.chosenInk : wa.soft }]}>{unread}</RNText>
                  ) : null}
                </Pressable>
              );
            })}
          </View>
        </>
      ) : null}
      {account && account.status !== "connected" ? (
        <View style={[styles.notice, { borderColor: wa.line }]}>
          <RNText style={[styles.noticeTitle, { color: wa.ink }]}>{w.status[account.status]}</RNText>
          <RNText style={[styles.noticeText, { color: wa.sub }]}>{w.reconnectOnWeb}</RNText>
        </View>
      ) : null}
    </View>
  );

  const body = overview.isLoading ? (
    <SkeletonList rows={6} />
  ) : !overview.data ? (
    retry(overview.refetch)
  ) : !account ? (
    <EmptyState size="page" icon="phone" title={w.empty.gone} />
  ) : !mine ? (
    <EmptyState size="page" icon="lock" title={w.empty.notMineTitle} subtitle={w.empty.notMineText} />
  ) : chats.isLoading ? (
    <SkeletonList rows={6} />
  ) : chats.isError && !chats.data ? (
    retry(chats.refetch)
  ) : all.length === 0 ? (
    <EmptyState size="page" icon="message" title={w.empty.noChatsTitle} subtitle={w.empty.noChatsText} />
  ) : list.length === 0 ? (
    <Text style={[styles.noMatch, { color: wa.sub }]}>{w.list.noMatch}</Text>
  ) : null;

  return (
    <View style={[styles.screen, { backgroundColor: wa.bg, paddingTop: insets.top }]}>
      <Stack.Screen options={{ headerShown: false, title: account?.label || w.title }} />
      <View style={styles.bar}>
        <IconButton icon="back" label={t("mobile.common.back")} plate onPress={() => goBack("/whatsapp")} />
        <Pressable
          style={styles.number}
          disabled={numbers.length < 2}
          hitSlop={{ top: 4, bottom: 4 }}
          onPress={() => void switchNumber()}
          accessibilityRole={numbers.length < 2 ? "header" : "button"}
          accessibilityLabel={numbers.length < 2 ? account?.label : `${account?.label ?? ""}, ${w.list.pickNumber}`}
        >
          <WhatsAppMark size={20} />
          <View style={styles.numberText}>
            <RNText numberOfLines={1} style={[styles.numberName, { color: wa.ink }]}>
              {account?.label || w.title}
            </RNText>
            {account?.phone ? (
              <RNText numberOfLines={1} style={[styles.numberPhone, { color: wa.soft }]}>
                {showPhone(account.phone)}
              </RNText>
            ) : null}
          </View>
          {numbers.length > 1 ? <WaGlyph name="down" size={15} color={wa.soft} /> : null}
        </Pressable>
        {account?.manage ? (
          <Pressable
            onPress={() => openWhatsAppNumber(accountId)}
            accessibilityRole="button"
            accessibilityLabel={w.settings.open(account.label)}
            style={styles.plus}
          >
            <WaGlyph name="sliders" size={22} color={wa.soft} />
          </Pressable>
        ) : null}
        {mine && account?.status === "connected" ? (
          <Pressable
            onPress={() => router.push(`/whatsapp/new?account=${encodeURIComponent(accountId)}`)}
            accessibilityRole="button"
            accessibilityLabel={w.list.newChat}
            style={[styles.plus, { backgroundColor: wa.green }]}
          >
            <WaGlyph name="plus" size={20} weight={2.2} color={wa.onGreen} />
          </Pressable>
        ) : (
          <View style={styles.plus} />
        )}
      </View>
      <FlatList
        data={body ? [] : list}
        keyExtractor={(chat) => chat.id}
        ListHeaderComponent={
          <>
            {head}
            {body}
          </>
        }
        renderItem={({ item }) => (
          <ChatRow chat={item} accountId={accountId} agentId={agentId} agentName={agentName} wa={wa} w={w} />
        )}
        keyboardShouldPersistTaps="handled"
        keyboardDismissMode="on-drag"
        contentContainerStyle={{ paddingBottom: insets.bottom + 24 }}
        refreshControl={<RefreshControl refreshing={pull.refreshing} onRefresh={pull.onRefresh} />}
        onEndReachedThreshold={0.5}
        onEndReached={() => {
          if (chats.hasNextPage && !chats.isFetchingNextPage) void chats.fetchNextPage();
        }}
        ListFooterComponent={
          chats.isFetchingNextPage ? <ActivityIndicator color={wa.sub} style={styles.more} /> : undefined
        }
      />
    </View>
  );
}

/** One conversation, as WhatsApp's row. */
const ChatRow = memo(function ChatRow({
  chat,
  accountId,
  agentId,
  agentName,
  wa,
  w,
}: {
  chat: WhatsAppChat;
  accountId: string;
  agentId: string | null;
  agentName: string;
  wa: WaColors;
  w: WhatsAppWords;
}) {
  const orgId = useOrgId();
  const when = useWhen();
  const title = chatTitle(chat, w);
  const photo = chat.photo ? ownFile((base) => whatsappPhotoUrl(orgId, accountId, chat, base) ?? "") : null;
  const unread = chat.unread > 0;
  const answering = agentId && agentAnswering(chat);
  const badge = agentId && agentHere(chat);
  const kind = chat.lastKind;
  // A voice, a photo or a file in the last line shows its kind's glyph, as WhatsApp's list does.
  const glyph = !chat.lastText && kind === "audio" ? "mic" : !chat.lastText && kind === "image" ? "camera" : null;
  const words = answering
    ? w.list.answering(agentName)
    : chat.lastFromMe && chat.lastStatus
      ? previewOf(kind, chat.lastText, w)
      : lastLine(chat, w);
  return (
    <Pressable
      onPress={() => openWhatsAppChat(accountId, chat.id)}
      accessibilityRole="button"
      accessibilityLabel={[title, words, unread ? String(chat.unread) : ""].filter(Boolean).join(", ")}
      style={({ pressed }) => [styles.row, pressed ? { backgroundColor: wa.field } : null]}
    >
      <View>
        <WaPhoto id={chat.id} title={title} size={PHOTO} photo={photo} />
        {badge ? (
          <View
            style={[styles.agentBadge, { backgroundColor: wa.bg }]}
            accessible
            accessibilityLabel={w.list.agentBadge(agentName)}
          >
            <Face who={{ type: "agent", id: agentId }} size={18} live={false} />
          </View>
        ) : null}
      </View>
      <View style={[styles.rowText, { borderBottomColor: wa.line }]}>
        <View style={styles.line1}>
          <RNText numberOfLines={1} style={[styles.name, { color: wa.ink }]}>
            {title}
          </RNText>
          {chat.lastAt ? (
            <RNText style={[styles.time, { color: unread ? wa.green : wa.sub }]}>{when.short(chat.lastAt)}</RNText>
          ) : null}
        </View>
        <View style={styles.line2}>
          {!answering && chat.lastFromMe && chat.lastStatus ? (
            <WaTicks status={chat.lastStatus} color={wa.sub} read={wa.read} />
          ) : null}
          {!answering && glyph ? <WaGlyph name={glyph} size={15} color={wa.sub} /> : null}
          <RNText numberOfLines={1} style={[styles.last, { color: answering ? wa.green : wa.sub }]}>
            {words}
          </RNText>
          {unread ? (
            <View style={[styles.count, { backgroundColor: wa.green }]}>
              <RNText style={[styles.countText, { color: wa.onGreen }]}>
                {chat.unread > 99 ? "99+" : chat.unread}
              </RNText>
            </View>
          ) : null}
        </View>
      </View>
    </Pressable>
  );
});

const styles = StyleSheet.create({
  screen: { flex: 1 },
  bar: { flexDirection: "row", alignItems: "center", gap: 8, paddingHorizontal: 16, paddingTop: 6 },
  number: {
    flex: 1,
    minHeight: 40,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 8,
  },
  numberText: { flexShrink: 1 },
  numberName: { fontFamily: WA_FONT.s, fontSize: 14.5, lineHeight: 17 },
  numberPhone: { fontFamily: WA_FONT.r, fontSize: 12, lineHeight: 15 },
  plus: { width: 40, height: 40, borderRadius: 20, alignItems: "center", justifyContent: "center" },
  title: {
    fontFamily: WA_FONT.b,
    fontSize: 32,
    lineHeight: 39,
    letterSpacing: -0.64,
    paddingHorizontal: 16,
    paddingTop: 12,
    paddingBottom: 8,
  },
  search: {
    marginHorizontal: 16,
    height: 38,
    borderRadius: 12,
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    paddingLeft: 12,
    paddingRight: 8,
  },
  searchText: { flex: 1, fontFamily: WA_FONT.r, fontSize: 16, paddingVertical: 0, height: 38 },
  chips: { flexDirection: "row", gap: 8, paddingHorizontal: 16, paddingTop: 12, paddingBottom: 8 },
  chip: {
    height: 32,
    paddingHorizontal: 14,
    borderRadius: 16,
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
  },
  chipText: { fontFamily: WA_FONT.m, fontSize: 14 },
  chipCount: { fontFamily: WA_FONT.m, fontSize: 12 },
  notice: {
    marginHorizontal: 16,
    marginVertical: 8,
    padding: 12,
    gap: 4,
    borderRadius: 12,
    borderWidth: StyleSheet.hairlineWidth,
  },
  noticeTitle: { fontFamily: WA_FONT.s, fontSize: 14 },
  noticeText: { fontFamily: WA_FONT.r, fontSize: 13, lineHeight: 18 },
  row: { flexDirection: "row", alignItems: "center", gap: 14, paddingHorizontal: 16, height: ROW_H },
  agentBadge: {
    position: "absolute",
    right: -3,
    bottom: -3,
    width: 22,
    height: 22,
    borderRadius: 7,
    alignItems: "center",
    justifyContent: "center",
  },
  rowText: {
    flex: 1,
    alignSelf: "stretch",
    justifyContent: "center",
    borderBottomWidth: 1,
  },
  line1: { flexDirection: "row", alignItems: "baseline", gap: 8 },
  name: { flex: 1, fontFamily: WA_FONT.s, fontSize: 16.5, lineHeight: 21 },
  time: { fontFamily: WA_FONT.r, fontSize: 13, fontVariant: ["tabular-nums"] },
  line2: { flexDirection: "row", alignItems: "center", gap: 4, marginTop: 3, minHeight: 21 },
  last: { flex: 1, fontFamily: WA_FONT.r, fontSize: 14.5, lineHeight: 19 },
  count: {
    minWidth: 21,
    height: 21,
    paddingHorizontal: 6,
    borderRadius: 11,
    alignItems: "center",
    justifyContent: "center",
    marginLeft: 4,
  },
  countText: { fontFamily: WA_FONT.b, fontSize: 12, fontVariant: ["tabular-nums"] },
  center: { alignItems: "center", gap: 12, paddingVertical: 32, paddingHorizontal: 16 },
  centerText: { textAlign: "center" },
  noMatch: { textAlign: "center", paddingVertical: 32, paddingHorizontal: 16 },
  more: { paddingVertical: 12 },
});
