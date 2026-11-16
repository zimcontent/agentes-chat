import {
  keys,
  useReadWhatsAppChat,
  useSendWhatsApp,
  useSendWhatsAppFile,
  useWhatsApp,
  useWhatsAppChatAgent,
  useWhatsAppMessages,
  useWhatsAppOlderHistory,
  useWhatsAppTyping,
  type WhatsAppChat,
  type WhatsAppMessage,
  whatsappFileUrl,
} from "@agenteschat/client";
import { dayLabel, formatClock } from "@agenteschat/client/lib/format";
import { Image } from "expo-image";
import * as ImagePicker from "expo-image-picker";
import { memo, useEffect, useRef, useState, useSyncExternalStore } from "react";
import { useTranslation } from "react-i18next";
import { ActivityIndicator, FlatList, Pressable, StyleSheet, View } from "react-native";
import { KeyboardAvoidingView, useReanimatedKeyboardAnimation } from "react-native-keyboard-controller";
import Animated, { useAnimatedStyle } from "react-native-reanimated";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { Button, Composer, EmptyState, Icon, type IconName, Text, useToast } from "@/ui";
import { useConversationLook } from "../chat/look";
import { filePart } from "../review/media";
import { useColors, useDirectory, useOrgId } from "../shared/hooks";
import { PushedHeader } from "../shared/parts";
import { playingId, startPlayback, stopPlayback, subscribePlayback } from "../voice/playback";
import {
  chatTitle,
  clockOf,
  FILE_MAX,
  fileShape,
  handedLine,
  ownFile,
  showPhone,
  startsDay,
  useWhatsAppKeepFresh,
  useWhatsAppSay,
} from "./logic";
import { useWhatsAppWords, type WhatsAppWords } from "./words";

/** How often the open conversation is asked again while it is in front (see `useWhatsAppKeepFresh`). */
const CHAT_FRESH_MS = 6_000;
/** A photo's box in a bubble: its width, the height from the picture's own shape within these bounds. */
const PICTURE_W = 220;
const PICTURE_MIN_H = 120;
const PICTURE_MAX_H = 300;
const STICKER = 120;
/** A bubble's corners, the speaker's side cut, as the app's own conversation draws them. */
const BUBBLE_RADIUS = 18;
const BUBBLE_CUT = 6;

const KIND_ICONS: Record<string, IconName> = {
  image: "image",
  video: "play",
  audio: "mic",
  document: "file",
  sticker: "sticker",
  location: "pin",
  contact: "person",
  poll: "list",
};

/**
 * One WhatsApp conversation (docs/adr/doug-0001-whatsapp-numbers.md): its messages from the latest up, ours on the
 * right with their ticks, theirs on the left (a group's with who wrote), photos, stickers and voice messages drawn,
 * any other file a row that names it. Opening it reads it. Words, and a photo from the library, go from the composer
 * while the number is connected.
 */
export function WhatsAppConversationScreen({ accountId, chatId }: { accountId: string; chatId: string }) {
  const w = useWhatsAppWords();
  const { t, i18n } = useTranslation();
  const orgId = useOrgId();
  const c = useColors();
  const toast = useToast();
  const say = useWhatsAppSay();
  const insets = useSafeAreaInsets();
  const keyboard = useReanimatedKeyboardAnimation();
  const overview = useWhatsApp(orgId);
  const account = overview.data?.accounts.find((a) => a.id === accountId);
  const query = useWhatsAppMessages(orgId, accountId, chatId);
  useWhatsAppKeepFresh(keys.whatsappMessages(orgId, accountId, chatId), CHAT_FRESH_MS);
  const send = useSendWhatsApp(orgId, accountId);
  const sendFile = useSendWhatsAppFile(orgId, accountId);
  const read = useReadWhatsAppChat(orgId, accountId);
  const older = useWhatsAppOlderHistory(orgId, accountId);
  const setAgent = useWhatsAppChatAgent(orgId, accountId);
  const typing = useWhatsAppTyping(orgId, accountId, chatId);
  const [sendingPhoto, setSendingPhoto] = useState(false);
  const chat = query.data?.pages[0]?.chat;
  // Pages come the latest first, as the inverted list draws from the bottom up.
  const messages = query.data?.pages.flatMap((page) => page.messages) ?? [];
  const connected = account?.status === "connected";

  // Opening it, or a message arriving while it is open, is reading it.
  const unread = chat?.unread ?? 0;
  const markRead = read.mutate;
  useEffect(() => {
    if (unread > 0) markRead(chatId);
  }, [unread, chatId, markRead]);
  // Leaving with words in the field ends "typing…" on the other side (the hook's functions are new each render: the
  // latest is read when the screen goes).
  const typingNow = useRef(typing);
  typingNow.current = typing;
  useEffect(() => () => typingNow.current.stopped(), []);

  // The safe area under the composer gives way to the keyboard as it rises.
  const foot = useAnimatedStyle(() => ({ paddingBottom: Math.max(8, insets.bottom * (1 - keyboard.progress.value)) }));

  const failed = (e: unknown) => toast({ title: say(e), icon: "x" });
  const onSend = (text: string) => {
    const body = text.trim();
    if (!body || !connected) return;
    typing.stopped();
    send.mutate({ chatId, text: body }, { onError: failed });
  };
  const pickPhoto = async () => {
    if (!connected || sendingPhoto) return;
    const res = await ImagePicker.launchImageLibraryAsync({ mediaTypes: ["images"], quality: 0.8 });
    const asset = res.canceled ? null : res.assets[0];
    if (!asset) return;
    if ((asset.fileSize ?? 0) > FILE_MAX) {
      toast({ title: w.errors.tooLarge, icon: "x" });
      return;
    }
    const name = asset.fileName ?? "photo.jpg";
    const type = asset.mimeType ?? "image/jpeg";
    setSendingPhoto(true);
    sendFile.mutate(
      { chatId, file: filePart(asset.uri, name, type), fileName: name },
      { onError: failed, onSettled: () => setSendingPhoto(false) },
    );
  };

  const title = chat ? chatTitle(chat, w) : "";
  const subtitle = chat ? headerLine(chat, w, i18n.language) : undefined;
  const group = chat?.group ?? false;
  const complete = !query.hasNextPage;

  return (
    <View style={[styles.screen, { backgroundColor: c.bg }]}>
      <PushedHeader title={title} subtitle={subtitle || undefined} />
      <KeyboardAvoidingView behavior="padding" style={styles.screen}>
        {query.isLoading ? (
          <View style={styles.wait}>
            <ActivityIndicator color={c.faint} />
          </View>
        ) : query.isError && !query.data ? (
          <View style={styles.wait}>
            <Text tone="muted" style={styles.centerText}>
              {w.empty.failed}
            </Text>
            <Button
              variant="secondary"
              size="sm"
              label={t("mobile.common.retry")}
              onPress={() => void query.refetch()}
            />
          </View>
        ) : messages.length === 0 ? (
          <View style={styles.wait}>
            <EmptyState size="panel" icon="message" title={w.empty.noMessages} />
          </View>
        ) : (
          <FlatList
            inverted
            data={messages}
            keyExtractor={(m) => m.id}
            keyboardDismissMode="interactive"
            keyboardShouldPersistTaps="handled"
            contentContainerStyle={styles.list}
            onEndReachedThreshold={0.4}
            onEndReached={() => {
              if (query.hasNextPage && !query.isFetchingNextPage) void query.fetchNextPage();
            }}
            renderItem={({ item, index }) => (
              <View>
                {startsDay(messages, index, complete) ? (
                  <Text variant="footnote" tone="faint" style={styles.day}>
                    {dayLabel(t, i18n.language, item.at)}
                  </Text>
                ) : null}
                <Bubble message={item} accountId={accountId} group={group} />
              </View>
            )}
            ListFooterComponent={
              query.isFetchingNextPage ? (
                <ActivityIndicator color={c.faint} style={styles.older} />
              ) : complete && connected ? (
                // Everything kept here is on screen: the phone may still have what came before.
                <View style={styles.older}>
                  <Button
                    variant="ghost"
                    size="sm"
                    label={w.askPhone}
                    loading={older.isPending}
                    onPress={() =>
                      older.mutate(chatId, { onSuccess: () => toast({ title: w.askedPhone }), onError: failed })
                    }
                  />
                </View>
              ) : undefined
            }
          />
        )}
        {chat?.agent === "person" ? (
          <View style={[styles.notice, { borderColor: c.line2, backgroundColor: c.raised }]}>
            <Text variant="footnote" tone="muted">
              {handedLine(chat.agentNote, w)}
            </Text>
            <Button
              variant="secondary"
              size="sm"
              label={w.agent.giveBack}
              loading={setAgent.isPending}
              onPress={() => setAgent.mutate({ chatId, on: true }, { onError: failed })}
            />
          </View>
        ) : null}
        <Animated.View style={[styles.composer, foot]}>
          {connected ? (
            <Composer
              placeholder={w.composer.placeholder}
              onSend={onSend}
              onType={() => typing.typing()}
              onPlus={() => void pickPhoto()}
              draftKey={`whatsapp:${chatId}`}
            />
          ) : (
            <Text variant="footnote" tone="muted" style={styles.offline}>
              {account ? w.composer.offline : ""}
            </Text>
          )}
        </Animated.View>
      </KeyboardAvoidingView>
    </View>
  );
}

/** Under the name in the header: where the number's agent stands here, else the contact's number. */
function headerLine(chat: WhatsAppChat, w: WhatsAppWords, locale: string): string {
  if (chat.agent === "quiet" && chat.agentQuietUntil) return w.agent.quiet(formatClock(locale, chat.agentQuietUntil));
  if (chat.agent) return w.agent[chat.agent === "quiet" ? "on" : chat.agent];
  return chat.name && chat.phone ? showPhone(chat.phone) : "";
}

/** One message: ours on the right in the conversation's own fill with its ticks, theirs on the left. */
const Bubble = memo(function Bubble({
  message: m,
  accountId,
  group,
}: {
  message: WhatsAppMessage;
  accountId: string;
  group: boolean;
}) {
  const w = useWhatsAppWords();
  const { i18n } = useTranslation();
  const c = useColors();
  const look = useConversationLook(true);
  const dir = useDirectory();
  const mine = m.fromMe;
  const shape = fileShape(m);
  const fill = mine ? (look.fill ?? c.bubble) : c.bubble;
  // On the strong tone the fill is solid color: white words on it, as the app's own bubbles.
  const ink = mine && look.tone === "strong" ? "#ffffff" : undefined;
  const author = m.sentByAgentId
    ? dir.nameOf({ type: "agent", id: m.sentByAgentId })
    : m.sentByUserId
      ? dir.nameOf({ type: "person", id: m.sentByUserId })
      : "";
  const tick = mine ? w.tick[m.status] : "";
  const bare = (shape === "sticker" || shape === "picture") && !m.body;
  const stamp = (
    <View style={styles.stamp}>
      {mine && author ? (
        <Text variant="caption" tone="faint" style={ink ? { color: ink } : undefined} numberOfLines={1}>
          {w.sentBy(author)}
        </Text>
      ) : null}
      <Text variant="caption" tone="faint" style={[styles.clock, ink ? { color: ink } : null]}>
        {formatClock(i18n.language, m.at)}
      </Text>
      {mine ? (
        <View accessible accessibilityRole="image" accessibilityLabel={tick}>
          <Icon
            name={m.status === "sent" ? "check" : "checks"}
            size={14}
            color={m.status === "read" ? c.greenText : (ink ?? c.faint)}
          />
        </View>
      ) : null}
    </View>
  );
  if (shape === "sticker") {
    return (
      <View style={[styles.row, mine ? styles.rowMine : null]}>
        <FilePicture message={m} accountId={accountId} sticker />
        {stamp}
      </View>
    );
  }
  return (
    <View style={[styles.row, mine ? styles.rowMine : null]}>
      <View
        style={[
          styles.bubble,
          bare ? styles.bubbleBare : null,
          { backgroundColor: fill },
          mine ? styles.cutMine : styles.cutTheirs,
        ]}
      >
        {group && !mine ? (
          <Text variant="footnote" style={styles.who} numberOfLines={1}>
            {m.senderName || showPhone(m.senderPhone) || w.unknown}
          </Text>
        ) : null}
        {shape === "picture" ? <FilePicture message={m} accountId={accountId} /> : null}
        {shape === "audio" ? <VoiceNote message={m} accountId={accountId} ink={ink} /> : null}
        {shape === "row" ? <FileRow message={m} ink={ink} /> : null}
        {m.kind === "deleted" ? (
          <Text tone="faint" style={styles.gone}>
            {w.kind.deleted}
          </Text>
        ) : null}
        {m.body ? (
          <Text selectable style={[styles.words, bare ? styles.wordsPad : null, ink ? { color: ink } : null]}>
            {m.body}
          </Text>
        ) : null}
        <View style={bare ? styles.stampPad : undefined}>{stamp}</View>
      </View>
    </View>
  );
});

/** A photo or a sticker, loaded with the session; one WhatsApp no longer has turns into a row that says so. */
function FilePicture({
  message: m,
  accountId,
  sticker = false,
}: {
  message: WhatsAppMessage;
  accountId: string;
  sticker?: boolean;
}) {
  const orgId = useOrgId();
  const c = useColors();
  const w = useWhatsAppWords();
  const [ratio, setRatio] = useState(1);
  const [gone, setGone] = useState(false);
  if (gone) return <FileRow message={m} gone />;
  const height = Math.min(PICTURE_MAX_H, Math.max(PICTURE_MIN_H, PICTURE_W / ratio));
  return (
    <Image
      source={ownFile((base) => whatsappFileUrl(orgId, accountId, m.id, base))}
      style={
        sticker
          ? { width: STICKER, height: STICKER }
          : [styles.picture, { width: PICTURE_W, height, backgroundColor: c.sunken }]
      }
      contentFit={sticker ? "contain" : "cover"}
      accessibilityLabel={m.body || w.kind[sticker ? "sticker" : "image"]}
      onLoad={(e) => {
        if (e.source.width > 0 && e.source.height > 0) setRatio(e.source.width / e.source.height);
      }}
      onError={() => setGone(true)}
    />
  );
}

/** Any other file: its kind's icon, its name, and where it opens. */
function FileRow({ message: m, ink, gone = false }: { message: WhatsAppMessage; ink?: string; gone?: boolean }) {
  const w = useWhatsAppWords();
  const c = useColors();
  const kind = m.kind in w.kind ? (m.kind as keyof WhatsAppWords["kind"]) : "other";
  const name = m.media?.fileName || w.kind[kind];
  return (
    <View style={styles.file}>
      <Icon name={KIND_ICONS[m.kind] ?? "message"} size={20} color={ink ?? c.muted} />
      <View style={styles.fileText}>
        <Text variant="subhead" style={[styles.fileName, ink ? { color: ink } : null]} numberOfLines={2}>
          {name}
        </Text>
        {m.media ? (
          <Text variant="caption" tone="faint" style={ink ? { color: ink } : undefined}>
            {gone ? w.fileGone : w.fileOnPhone}
          </Text>
        ) : null}
      </View>
    </View>
  );
}

/** A voice message: play and pause on the app's one player, and its length. */
function VoiceNote({ message: m, accountId, ink }: { message: WhatsAppMessage; accountId: string; ink?: string }) {
  const w = useWhatsAppWords();
  const orgId = useOrgId();
  const c = useColors();
  const playing = useSyncExternalStore(subscribePlayback, () => playingId() === m.id);
  const [at, setAt] = useState(0);
  const [failed, setFailed] = useState(false);
  if (failed) return <FileRow message={m} ink={ink} gone />;
  const seconds = m.media?.seconds ?? 0;
  const toggle = () => {
    if (playing) {
      stopPlayback();
      return;
    }
    void startPlayback({
      id: m.id,
      source: ownFile((base) => whatsappFileUrl(orgId, accountId, m.id, base)),
      durationMs: seconds * 1000,
      from: at >= 1 ? 0 : at,
      speed: 1,
      onProgress: setAt,
      onEnd: () => setAt(0),
      onError: () => setFailed(true),
    }).catch(() => setFailed(true));
  };
  const color = ink ?? c.ink;
  return (
    <View style={styles.voice}>
      <Pressable
        onPress={toggle}
        hitSlop={8}
        accessibilityRole="button"
        accessibilityLabel={playing ? w.pause : w.play}
        style={[styles.play, { borderColor: color }]}
      >
        <Icon name={playing ? "pause" : "play"} size={16} color={color} />
      </Pressable>
      <View style={[styles.track, { backgroundColor: c.line2 }]}>
        <View style={[styles.trackAt, { width: `${Math.round(at * 100)}%`, backgroundColor: color }]} />
      </View>
      <Text variant="caption" tone="muted" style={[styles.clock, ink ? { color: ink } : null]}>
        {clockOf(playing || at > 0 ? seconds * at : seconds)}
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1 },
  wait: { flex: 1, alignItems: "center", justifyContent: "center", gap: 12, padding: 24 },
  centerText: { textAlign: "center" },
  list: { paddingHorizontal: 12, paddingVertical: 12 },
  day: { textAlign: "center", marginVertical: 12 },
  older: { alignItems: "center", paddingVertical: 12 },
  row: { alignItems: "flex-start", marginVertical: 2, paddingRight: 44 },
  rowMine: { alignItems: "flex-end", paddingRight: 0, paddingLeft: 44 },
  bubble: {
    maxWidth: "100%",
    paddingVertical: 8,
    paddingHorizontal: 12,
    borderRadius: BUBBLE_RADIUS,
    gap: 4,
    overflow: "hidden",
  },
  bubbleBare: { padding: 4 },
  cutMine: { borderBottomRightRadius: BUBBLE_CUT },
  cutTheirs: { borderBottomLeftRadius: BUBBLE_CUT },
  who: { fontWeight: "600" },
  words: { fontSize: 17, lineHeight: 24 },
  wordsPad: { paddingHorizontal: 8 },
  gone: { fontStyle: "italic" },
  stamp: { flexDirection: "row", alignItems: "center", alignSelf: "flex-end", gap: 4 },
  stampPad: { paddingHorizontal: 8, paddingBottom: 4 },
  clock: { fontVariant: ["tabular-nums"] },
  picture: { borderRadius: BUBBLE_RADIUS - 4 },
  file: { flexDirection: "row", alignItems: "center", gap: 10, paddingVertical: 4 },
  fileText: { flexShrink: 1, gap: 2 },
  fileName: { fontWeight: "600" },
  voice: { flexDirection: "row", alignItems: "center", gap: 10, minWidth: 200, paddingVertical: 4 },
  play: {
    width: 32,
    height: 32,
    borderRadius: 16,
    borderWidth: 1.5,
    alignItems: "center",
    justifyContent: "center",
  },
  track: { flex: 1, height: 3, borderRadius: 2, overflow: "hidden" },
  trackAt: { height: 3 },
  notice: {
    marginHorizontal: 12,
    marginBottom: 8,
    padding: 12,
    gap: 8,
    borderRadius: 12,
    borderWidth: StyleSheet.hairlineWidth,
    alignItems: "flex-start",
  },
  composer: { paddingHorizontal: 10, paddingTop: 8 },
  offline: { textAlign: "center", paddingVertical: 16 },
});
