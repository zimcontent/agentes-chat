import {
  keys,
  useMe,
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
  whatsappPhotoUrl,
} from "@dougbot/client";
import { formatClock } from "@dougbot/client/lib/format";
import * as DocumentPicker from "expo-document-picker";
import { Image } from "expo-image";
import * as ImagePicker from "expo-image-picker";
import { Stack } from "expo-router";
import { memo, useEffect, useMemo, useRef, useState, useSyncExternalStore } from "react";
import { useTranslation } from "react-i18next";
import {
  ActivityIndicator,
  FlatList,
  Linking,
  Platform,
  Pressable,
  Text as RNText,
  StyleSheet,
  TextInput,
  type TextInputInstance,
  View,
} from "react-native";
import { KeyboardAvoidingView, useReanimatedKeyboardAnimation } from "react-native-keyboard-controller";
import Animated, { useAnimatedStyle } from "react-native-reanimated";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { Button, Icon, IconButton, type IconName, useToast } from "@/ui";
import { goBack } from "@/ui/navigation";
import { filePart } from "../review/media";
import { Face } from "../shared/Face";
import { useDirectory, useOrgId, useWhen } from "../shared/hooks";
import { playingId, startPlayback, stopPlayback, subscribePlayback } from "../voice/playback";
import {
  agentStoppable,
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
import { useWa, WA_FONT, type WaColors, WaGlyph, WaPhoto, WaTicks, WaWall } from "./look";
import { useWhatsAppTake } from "./recorder";
import { StickerPanel } from "./StickerPanel";
import { useWhatsAppWords, type WhatsAppWords } from "./words";

/** How often the open conversation is asked again while it is in front (see `useWhatsAppKeepFresh`). */
const CHAT_FRESH_MS = 6_000;
/** A photo's box in a bubble: its width, the height from the picture's own shape within these bounds. */
const PICTURE_W = 240;
const PICTURE_MIN_H = 120;
const PICTURE_MAX_H = 320;
const STICKER = 130;
/** WhatsApp's bubble: radius 9, the first of a run with its tail at the top corner on the speaker's side. */
const RADIUS = 9;
const TAIL = 8;
/** A voice message's bars. */
const BARS = 28;

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
 * One WhatsApp conversation (docs/adr/doug-0001-whatsapp-numbers.md) as the phone's WhatsApp draws it: its bar with
 * the contact's photo and name, the doodled wall, the day between days, theirs on the left and ours on the right in
 * WhatsApp's colors with the tail on the first of each run, the time and ticks inside, photos, stickers and voice
 * messages drawn. A message the number's agent wrote says so inside it ("Enviada por ROSA"). Above the field, a strip
 * says where the agent stands here and stops it in one tap; touching the field while it answers says what writing
 * does. The field is WhatsApp's: stickers, words, a document, the camera, and the green mic.
 */
export function WhatsAppConversationScreen({ accountId, chatId }: { accountId: string; chatId: string }) {
  const w = useWhatsAppWords();
  const { t, i18n } = useTranslation();
  const wa = useWa();
  const orgId = useOrgId();
  const toast = useToast();
  const say = useWhatsAppSay();
  const dir = useDirectory();
  const me = useMe().data?.user.id ?? null;
  const when = useWhen();
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
  const [text, setText] = useState("");
  const [focused, setFocused] = useState(false);
  const [stickers, setStickers] = useState(false);
  const [sending, setSending] = useState(false);
  const input = useRef<TextInputInstance | null>(null);
  const chat = query.data?.pages[0]?.chat;
  // Pages come the latest first, as the inverted list draws from the bottom up.
  const messages = useMemo(() => query.data?.pages.flatMap((page) => page.messages) ?? [], [query.data]);
  const connected = account?.status === "connected";
  const agentId = account?.agentId ?? null;
  const agentName = (agentId && dir.nameOf({ type: "agent", id: agentId })) || w.chat.theAi;

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

  // The safe area under the field gives way to the keyboard as it rises.
  const foot = useAnimatedStyle(() => ({ paddingBottom: Math.max(8, insets.bottom * (1 - keyboard.progress.value)) }));

  const failed = (e: unknown) => toast({ title: say(e), icon: "x" });
  const take = useWhatsAppTake({
    onBlocked: () => toast({ title: w.chat.micBlocked, icon: "x" }),
    onFull: () => void sendTake(),
  });

  const upload = (uri: string, name: string, type: string, size: number | null | undefined, voice = false) => {
    if ((size ?? 0) > FILE_MAX) {
      toast({ title: w.errors.tooLarge, icon: "x" });
      return;
    }
    setSending(true);
    sendFile.mutate(
      { chatId, file: filePart(uri, name, type), fileName: name, voice },
      { onError: failed, onSettled: () => setSending(false) },
    );
  };
  const sendText = () => {
    const body = text.trim();
    if (!body || !connected) return;
    typing.stopped();
    setText("");
    send.mutate(
      { chatId, text: body },
      {
        // What didn't go comes back to the field, unless the person already wrote something else there.
        onError: (e) => {
          failed(e);
          setText((now) => now || body);
        },
      },
    );
  };
  async function sendTake() {
    const done = await take.stop();
    if (!done) {
      toast({ title: w.chat.tooShort, icon: "x" });
      return;
    }
    upload(done.uri, "voice.m4a", "audio/mp4", null, true);
  }
  const pickMedia = async () => {
    if (!connected || sending) return;
    const res = await ImagePicker.launchImageLibraryAsync({ mediaTypes: ["images", "videos"], quality: 0.8 });
    const asset = res.canceled ? null : res.assets[0];
    if (!asset) return;
    const video = asset.type === "video";
    upload(
      asset.uri,
      asset.fileName ?? (video ? "video.mp4" : "photo.jpg"),
      asset.mimeType ?? (video ? "video/mp4" : "image/jpeg"),
      asset.fileSize,
    );
  };
  const shoot = async () => {
    if (!connected || sending) return;
    const allowed = await ImagePicker.requestCameraPermissionsAsync();
    if (!allowed.granted) return;
    const res = await ImagePicker.launchCameraAsync({ mediaTypes: ["images"], quality: 0.8 });
    const asset = res.canceled ? null : res.assets[0];
    if (asset) upload(asset.uri, asset.fileName ?? "photo.jpg", asset.mimeType ?? "image/jpeg", asset.fileSize);
  };
  const pickFile = async () => {
    if (!connected || sending) return;
    const res = await DocumentPicker.getDocumentAsync({ copyToCacheDirectory: true, multiple: false });
    const file = res.canceled ? null : res.assets[0];
    if (file) upload(file.uri, file.name, file.mimeType ?? "application/octet-stream", file.size);
  };

  const title = chat ? chatTitle(chat, w) : "";
  const sub = chat ? (chat.group ? w.group : chat.name && chat.phone ? showPhone(chat.phone) : "") : "";
  const photo = chat?.photo === true ? ownFile((base) => whatsappPhotoUrl(orgId, accountId, chat, base) ?? "") : null;
  const group = chat?.group ?? false;
  const complete = !query.hasNextPage;
  const phone = chat && !chat.group ? chat.phone : null;
  const quietMinutes = account?.agentStyle.quietMinutes ?? 60;
  // While the agent answers here, the field held by the person says what writing does.
  const warn = focused && agentStoppable(chat);

  return (
    <View style={[styles.screen, { backgroundColor: wa.wall }]}>
      <Stack.Screen options={{ headerShown: false, title }} />
      <WaWall />
      <View style={[styles.bar, { paddingTop: insets.top, backgroundColor: wa.bar, borderBottomColor: wa.line }]}>
        <IconButton
          icon="back"
          label={t("mobile.common.back")}
          plate
          onPress={() => goBack(`/whatsapp/${accountId}`)}
        />
        {chat ? <WaPhoto id={chat.id} title={title} size={38} photo={photo} /> : null}
        <View style={styles.barText} accessible accessibilityRole="header">
          <RNText numberOfLines={1} style={[styles.barName, { color: wa.ink }]}>
            {title}
          </RNText>
          {sub ? (
            <RNText numberOfLines={1} style={[styles.barSub, { color: wa.sub }]}>
              {sub}
            </RNText>
          ) : null}
        </View>
        {phone ? (
          <Pressable
            onPress={() => void Linking.openURL(`tel:+${phone}`)}
            accessibilityRole="button"
            accessibilityLabel={w.chat.call(title)}
            hitSlop={8}
            style={styles.barButton}
          >
            <WaGlyph name="phone" size={21} color={wa.ink} />
          </Pressable>
        ) : null}
      </View>
      <KeyboardAvoidingView behavior="padding" style={styles.screen}>
        {query.isLoading ? (
          <View style={styles.wait}>
            <ActivityIndicator color={wa.sub} />
          </View>
        ) : query.isError && !query.data ? (
          <View style={styles.wait}>
            <RNText style={[styles.waitText, { color: wa.sub }]}>{w.empty.failed}</RNText>
            <Button
              variant="secondary"
              size="sm"
              label={t("mobile.common.retry")}
              onPress={() => void query.refetch()}
            />
          </View>
        ) : messages.length === 0 ? (
          <View style={styles.wait}>
            <View style={[styles.day, { backgroundColor: wa.dayFill }]}>
              <RNText style={[styles.dayText, { color: wa.dayInk }]}>{w.empty.noMessages}</RNText>
            </View>
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
            renderItem={({ item, index }) => {
              const day = startsDay(messages, index, complete);
              const before = messages[index + 1];
              const first =
                day || !before || before.fromMe !== item.fromMe || (group && before.senderPhone !== item.senderPhone);
              return (
                <View>
                  {day ? (
                    <View style={[styles.day, { backgroundColor: wa.dayFill }]}>
                      <RNText style={[styles.dayText, { color: wa.dayInk }]}>{when.day(item.at)}</RNText>
                    </View>
                  ) : null}
                  <Bubble
                    message={item}
                    accountId={accountId}
                    group={group}
                    first={first}
                    me={me}
                    chat={chat ?? null}
                    title={title}
                    photo={photo}
                  />
                </View>
              );
            }}
            ListFooterComponent={
              query.isFetchingNextPage ? (
                <ActivityIndicator color={wa.sub} style={styles.older} />
              ) : complete && connected ? (
                // Everything kept here is on screen: the phone may still have what came before.
                <View style={styles.older}>
                  <Pressable
                    onPress={() =>
                      older.mutate(chatId, { onSuccess: () => toast({ title: w.askedPhone }), onError: failed })
                    }
                    disabled={older.isPending}
                    accessibilityRole="button"
                    style={[styles.day, { backgroundColor: wa.dayFill }]}
                  >
                    <RNText style={[styles.dayText, { color: wa.dayInk }]}>{w.askPhone}</RNText>
                  </Pressable>
                </View>
              ) : undefined
            }
          />
        )}
        <Animated.View style={[styles.bottom, foot]}>
          {chat?.agent ? (
            <AgentStrip
              chat={chat}
              agentId={agentId}
              line={
                warn
                  ? w.chat.takeOver(agentName, quietMinutes)
                  : chat.agent === "on"
                    ? w.chat.strip(agentName)
                    : chat.agent === "quiet" && chat.agentQuietUntil
                      ? w.chat.stripQuiet(agentName, formatClock(i18n.language, chat.agentQuietUntil))
                      : chat.agent === "quiet"
                        ? w.chat.strip(agentName)
                        : chat.agent === "off"
                          ? w.chat.stripOff
                          : handedLine(chat.agentNote, w)
              }
              action={agentStoppable(chat) ? w.chat.stop : chat.agent === "off" ? w.chat.turnOn : w.agent.giveBack}
              busy={setAgent.isPending}
              onPress={() => setAgent.mutate({ chatId, on: !agentStoppable(chat) }, { onError: failed })}
              wa={wa}
            />
          ) : null}
          {connected ? (
            <View style={styles.composer}>
              {take.recording ? (
                <>
                  <Pressable
                    onPress={() => void take.cancel()}
                    accessibilityRole="button"
                    accessibilityLabel={w.chat.deleteTake}
                    style={styles.side}
                  >
                    <WaGlyph name="trash" size={22} color={wa.danger} />
                  </Pressable>
                  <View style={[styles.field, { backgroundColor: wa.field }]}>
                    <View style={[styles.recDot, { backgroundColor: wa.danger }]} />
                    <RNText style={[styles.fieldText, styles.recClock, { color: wa.ink }]}>
                      {clockOf(take.ms / 1000)}
                    </RNText>
                    <RNText style={[styles.fieldText, { color: wa.sub }]}>{w.chat.recording}</RNText>
                  </View>
                  <RoundButton glyph="send" label={w.chat.sendTake} wa={wa} onPress={() => void sendTake()} />
                </>
              ) : (
                <>
                  <Pressable
                    onPress={() => void pickMedia()}
                    accessibilityRole="button"
                    accessibilityLabel={w.chat.photos}
                    style={styles.side}
                  >
                    <WaGlyph name="plus" size={24} color={wa.ink} />
                  </Pressable>
                  <View style={[styles.field, { backgroundColor: wa.field }]}>
                    <TextInput
                      ref={input}
                      value={text}
                      onChangeText={(next) => {
                        setText(next);
                        if (next) typing.typing();
                        else typing.stopped();
                      }}
                      onFocus={() => {
                        setFocused(true);
                        setStickers(false);
                      }}
                      onBlur={() => setFocused(false)}
                      placeholder={w.composer.placeholder}
                      placeholderTextColor={wa.sub}
                      multiline
                      // One line at first on the web too (its text area starts at two rows).
                      {...(Platform.OS === "web" ? ({ rows: 1 } as object) : null)}
                      style={[styles.input, { color: wa.ink }]}
                      accessibilityLabel={w.composer.placeholder}
                    />
                    <Pressable
                      onPress={() => {
                        input.current?.blur();
                        setStickers((open) => !open);
                      }}
                      accessibilityRole="button"
                      accessibilityLabel={w.chat.stickers}
                      accessibilityState={{ expanded: stickers }}
                      hitSlop={8}
                      style={styles.inField}
                    >
                      <WaGlyph name="smile" size={21} color={stickers ? wa.green : wa.soft} />
                    </Pressable>
                  </View>
                  <Pressable
                    onPress={() => void pickFile()}
                    accessibilityRole="button"
                    accessibilityLabel={w.chat.file}
                    style={styles.icon}
                  >
                    <WaGlyph name="clip" size={21} color={wa.ink} />
                  </Pressable>
                  {text.trim() ? null : (
                    <Pressable
                      onPress={() => void shoot()}
                      accessibilityRole="button"
                      accessibilityLabel={w.chat.camera}
                      style={styles.icon}
                    >
                      <WaGlyph name="camera" size={22} color={wa.ink} />
                    </Pressable>
                  )}
                  {sending ? (
                    <View style={[styles.round, { backgroundColor: wa.green }]}>
                      <ActivityIndicator color={wa.onGreen} />
                    </View>
                  ) : text.trim() ? (
                    <RoundButton glyph="send" label={w.chat.send} wa={wa} onPress={sendText} />
                  ) : (
                    <RoundButton glyph="mic" label={w.chat.record} wa={wa} onPress={() => void take.start()} />
                  )}
                </>
              )}
            </View>
          ) : (
            <RNText style={[styles.offline, { color: wa.sub }]}>{account ? w.composer.offline : ""}</RNText>
          )}
          {stickers && connected ? (
            <StickerPanel accountId={accountId} chatId={chatId} onSent={() => setStickers(false)} />
          ) : null}
        </Animated.View>
      </KeyboardAvoidingView>
    </View>
  );
}

/** The green round button at the field's end: the mic, or send once there are words. */
function RoundButton({
  glyph,
  label,
  wa,
  onPress,
}: {
  glyph: "mic" | "send";
  label: string;
  wa: WaColors;
  onPress: () => void;
}) {
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={label}
      style={({ pressed }) => [styles.round, { backgroundColor: wa.green, opacity: pressed ? 0.85 : 1 }]}
    >
      <WaGlyph name={glyph} size={21} weight={2} color={wa.onGreen} />
    </Pressable>
  );
}

/** Where the number's agent stands here, by its name, with the one action that changes it. */
function AgentStrip({
  chat,
  agentId,
  line,
  action,
  busy,
  onPress,
  wa,
}: {
  chat: WhatsAppChat;
  agentId: string | null;
  line: string;
  action: string;
  busy: boolean;
  onPress: () => void;
  wa: WaColors;
}) {
  return (
    <View
      style={[styles.strip, { backgroundColor: wa.bar, borderColor: wa.stripEdge }]}
      accessibilityLiveRegion="polite"
    >
      {agentId && chat.agent !== "person" ? <Face who={{ type: "agent", id: agentId }} size={20} live={false} /> : null}
      <RNText style={[styles.stripText, { color: wa.soft }]}>{line}</RNText>
      <Pressable
        onPress={onPress}
        disabled={busy}
        accessibilityRole="button"
        accessibilityLabel={action}
        hitSlop={{ top: 7, bottom: 7 }}
        style={({ pressed }) => [
          styles.stripButton,
          { backgroundColor: wa.stripButton, opacity: busy ? 0.6 : pressed ? 0.85 : 1 },
        ]}
      >
        <RNText style={[styles.stripButtonText, { color: wa.stripButtonInk }]}>{action}</RNText>
      </Pressable>
    </View>
  );
}

/** One message as WhatsApp's bubble. */
const Bubble = memo(function Bubble({
  message: m,
  accountId,
  group,
  first,
  me,
  chat,
  title,
  photo,
}: {
  message: WhatsAppMessage;
  accountId: string;
  group: boolean;
  first: boolean;
  me: string | null;
  chat: WhatsAppChat | null;
  title: string;
  photo: { uri: string; headers?: Record<string, string> } | null;
}) {
  const w = useWhatsAppWords();
  const wa = useWa();
  const { i18n } = useTranslation();
  const dir = useDirectory();
  const mine = m.fromMe;
  const shape = fileShape(m);
  const fill = mine ? wa.bubbleOut : wa.bubbleIn;
  const meta = mine ? wa.metaOut : wa.sub;
  // Who wrote it in the app, when it wasn't the person reading: the agent by its name, or a colleague.
  const author = m.sentByAgentId
    ? dir.nameOf({ type: "agent", id: m.sentByAgentId }) || w.chat.theAi
    : m.sentByUserId && m.sentByUserId !== me
      ? dir.nameOf({ type: "person", id: m.sentByUserId })
      : "";
  const clock = formatClock(i18n.language, m.at);
  const stamp = (
    <View style={styles.stamp} accessible accessibilityLabel={[clock, mine ? w.tick[m.status] : ""].join(" ")}>
      <RNText style={[styles.clock, { color: meta }]}>{clock}</RNText>
      {mine ? <WaTicks status={m.status} color={meta} read={wa.read} /> : null}
    </View>
  );
  if (shape === "sticker") {
    return (
      <View style={[styles.row, mine ? styles.rowMine : null]}>
        <FilePicture message={m} accountId={accountId} sticker />
        <View style={[styles.stickerStamp, { backgroundColor: wa.dayFill }]}>{stamp}</View>
      </View>
    );
  }
  const bare = shape === "picture" && !m.body;
  // Room for the time and ticks at the end of the last line, as WhatsApp leaves it: an invisible copy of them.
  const room = (
    <RNText style={styles.room} accessible={false}>
      {`\u2002${clock}${mine ? "\u00A0\u2003\u2002" : ""}`}
    </RNText>
  );
  return (
    <View style={[styles.row, mine ? styles.rowMine : null, first ? styles.rowFirst : null]}>
      <View
        style={[
          styles.bubble,
          shape === "audio" ? styles.bubbleVoice : null,
          bare ? styles.bubbleBare : null,
          { backgroundColor: fill },
          first ? (mine ? styles.firstMine : styles.firstTheirs) : null,
        ]}
      >
        {first ? (
          <View
            style={[
              styles.tail,
              mine
                ? { right: -TAIL + 1, borderTopColor: fill, borderRightColor: "transparent", borderRightWidth: TAIL }
                : { left: -TAIL + 1, borderTopColor: fill, borderLeftColor: "transparent", borderLeftWidth: TAIL },
            ]}
          />
        ) : null}
        {group && !mine && first ? (
          <RNText numberOfLines={1} style={[styles.who, { color: wa.green }]}>
            {m.senderName || showPhone(m.senderPhone) || w.unknown}
          </RNText>
        ) : null}
        {mine && author ? (
          <RNText numberOfLines={1} style={[styles.by, { color: wa.byOut }]}>
            {w.sentBy(author)}
          </RNText>
        ) : null}
        {shape === "picture" ? <FilePicture message={m} accountId={accountId} /> : null}
        {shape === "audio" ? (
          <VoiceNote
            message={m}
            accountId={accountId}
            face={!mine && chat ? <WaPhoto id={chat.id} title={title} size={34} photo={photo} /> : null}
            stamp={stamp}
          />
        ) : null}
        {shape === "row" ? <FileRow message={m} /> : null}
        {m.kind === "deleted" ? (
          <RNText style={[styles.words, styles.gone, { color: wa.sub }]}>
            {w.kind.deleted}
            {room}
          </RNText>
        ) : null}
        {m.body ? (
          <RNText selectable style={[styles.words, { color: wa.ink }, shape === "picture" ? styles.caption : null]}>
            {m.body}
            {room}
          </RNText>
        ) : shape === "row" ? (
          <RNText style={styles.words}>{room}</RNText>
        ) : null}
        {shape === "audio" ? null : (
          <View style={[styles.stampAt, bare ? [styles.stampOver, { backgroundColor: "rgba(11,20,26,0.45)" }] : null]}>
            {bare ? (
              <View style={styles.stamp}>
                <RNText style={[styles.clock, { color: "#FFFFFF" }]}>{clock}</RNText>
                {mine ? <WaTicks status={m.status} color="#FFFFFF" read={wa.read} /> : null}
              </View>
            ) : (
              stamp
            )}
          </View>
        )}
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
  const wa = useWa();
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
          : [styles.picture, { width: PICTURE_W, height, backgroundColor: wa.field }]
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
function FileRow({ message: m, gone = false }: { message: WhatsAppMessage; gone?: boolean }) {
  const w = useWhatsAppWords();
  const wa = useWa();
  const kind = m.kind in w.kind ? (m.kind as keyof WhatsAppWords["kind"]) : "other";
  const name = m.media?.fileName || w.kind[kind];
  return (
    <View style={[styles.file, { backgroundColor: m.fromMe ? "rgba(0,0,0,0.12)" : "rgba(255,255,255,0.04)" }]}>
      <Icon name={KIND_ICONS[m.kind] ?? "message"} size={22} color={wa.soft} />
      <View style={styles.fileText}>
        <RNText numberOfLines={2} style={[styles.fileName, { color: wa.ink }]}>
          {name}
        </RNText>
        {m.media ? (
          <RNText style={[styles.fileSub, { color: m.fromMe ? wa.metaOut : wa.sub }]}>
            {gone ? w.fileGone : w.fileOnPhone}
          </RNText>
        ) : null}
      </View>
    </View>
  );
}

/** A voice message's bars: WhatsApp draws the recording's loudness; ours, a fixed shape of its own per message. */
function barsOf(id: string): number[] {
  let seed = 0;
  for (let i = 0; i < id.length; i++) seed = (seed * 31 + id.charCodeAt(i)) >>> 0;
  return Array.from({ length: BARS }, (_, i) => {
    seed = (seed * 1103515245 + 12345) >>> 0;
    const wave = (seed % 1000) / 1000;
    return 5 + Math.round((i % 2 === 0 ? 0.35 + wave * 0.65 : wave * 0.6) * 16);
  });
}

/** A voice message: play and pause on the app's one player, its bars filling as it plays, its length. */
function VoiceNote({
  message: m,
  accountId,
  face,
  stamp,
}: {
  message: WhatsAppMessage;
  accountId: string;
  face: React.ReactNode;
  stamp: React.ReactNode;
}) {
  const w = useWhatsAppWords();
  const wa = useWa();
  const orgId = useOrgId();
  const playing = useSyncExternalStore(subscribePlayback, () => playingId() === m.id);
  const [at, setAt] = useState(0);
  const [failed, setFailed] = useState(false);
  const bars = useMemo(() => barsOf(m.id), [m.id]);
  if (failed) return <FileRow message={m} gone />;
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
  const played = Math.round(at * BARS);
  return (
    <View style={styles.voice}>
      <Pressable
        onPress={toggle}
        hitSlop={10}
        accessibilityRole="button"
        accessibilityLabel={`${playing ? w.pause : w.play}, ${clockOf(seconds)}`}
        style={styles.play}
      >
        <WaGlyph name={playing ? "pause" : "playBox"} size={22} color={wa.soft} />
      </Pressable>
      <View style={styles.voiceMid}>
        <View style={styles.bars}>
          {bars.map((h, i) => (
            <View
              // biome-ignore lint/suspicious/noArrayIndexKey: the bars are a fixed row, by position
              key={i}
              style={[styles.barOne, { height: h, backgroundColor: i < played ? wa.played : wa.sub }]}
            />
          ))}
        </View>
        <View style={styles.voiceFoot}>
          <RNText style={[styles.clock, { color: m.fromMe ? wa.metaOut : wa.sub }]}>
            {clockOf(playing || at > 0 ? seconds * at : seconds)}
          </RNText>
          {stamp}
        </View>
      </View>
      {face}
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1 },
  bar: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    paddingHorizontal: 12,
    paddingBottom: 9,
    borderBottomWidth: 1,
  },
  barText: { flex: 1, minWidth: 0 },
  barName: { fontFamily: WA_FONT.s, fontSize: 16, lineHeight: 20 },
  barSub: { fontFamily: WA_FONT.r, fontSize: 12.5, lineHeight: 16 },
  barButton: { width: 44, height: 44, alignItems: "center", justifyContent: "center" },
  wait: { flex: 1, alignItems: "center", justifyContent: "center", gap: 12, padding: 24 },
  waitText: { fontFamily: WA_FONT.r, fontSize: 15, textAlign: "center" },
  list: { paddingHorizontal: 10, paddingVertical: 8 },
  day: {
    alignSelf: "center",
    borderRadius: 8,
    paddingHorizontal: 12,
    paddingVertical: 5,
    marginTop: 8,
    marginBottom: 6,
  },
  dayText: { fontFamily: WA_FONT.m, fontSize: 12.5 },
  older: { alignItems: "center", paddingVertical: 8 },
  row: { alignItems: "flex-start", marginTop: 3, paddingLeft: 6 },
  rowMine: { alignItems: "flex-end", paddingLeft: 0, paddingRight: 6 },
  rowFirst: { marginTop: 6 },
  bubble: {
    maxWidth: "79%",
    paddingTop: 6,
    paddingBottom: 7,
    paddingLeft: 10,
    paddingRight: 9,
    borderRadius: RADIUS,
  },
  bubbleVoice: { width: "76%", paddingTop: 6, paddingBottom: 6 },
  bubbleBare: { padding: 3 },
  firstMine: { borderTopRightRadius: 0 },
  firstTheirs: { borderTopLeftRadius: 0 },
  tail: { position: "absolute", top: 0, width: 0, height: 0, borderTopWidth: 9 },
  who: { fontFamily: WA_FONT.s, fontSize: 13, lineHeight: 18, marginBottom: 1 },
  by: { fontFamily: WA_FONT.s, fontSize: 12.5, lineHeight: 17, marginBottom: 2 },
  words: { fontFamily: WA_FONT.r, fontSize: 15.5, lineHeight: 21 },
  caption: { paddingHorizontal: 4, paddingTop: 4 },
  room: { fontFamily: WA_FONT.r, fontSize: 11.5, color: "transparent" },
  gone: { fontStyle: "italic" },
  stampAt: { position: "absolute", right: 9, bottom: 5 },
  stampOver: { right: 8, bottom: 8, borderRadius: 8, paddingHorizontal: 5, paddingVertical: 1 },
  stamp: { flexDirection: "row", alignItems: "center", gap: 3 },
  stickerStamp: { borderRadius: 8, paddingHorizontal: 6, paddingVertical: 2, marginTop: 2 },
  clock: { fontFamily: WA_FONT.r, fontSize: 11.5, fontVariant: ["tabular-nums"] },
  picture: { borderRadius: RADIUS - 3 },
  file: { flexDirection: "row", alignItems: "center", gap: 10, padding: 8, borderRadius: 6, marginBottom: 2 },
  fileText: { flexShrink: 1, gap: 2 },
  fileName: { fontFamily: WA_FONT.m, fontSize: 14.5 },
  fileSub: { fontFamily: WA_FONT.r, fontSize: 12 },
  voice: { flexDirection: "row", alignItems: "center", gap: 8 },
  play: { width: 32, height: 36, alignItems: "center", justifyContent: "center" },
  voiceMid: { flex: 1, gap: 0, paddingTop: 6 },
  bars: { flexDirection: "row", alignItems: "center", gap: 2, height: 24 },
  barOne: { width: 2.5, borderRadius: 2 },
  voiceFoot: { flexDirection: "row", justifyContent: "space-between", alignItems: "center" },
  bottom: { paddingHorizontal: 8, paddingTop: 8, gap: 8 },
  strip: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    minHeight: 44,
    paddingVertical: 6,
    paddingLeft: 12,
    paddingRight: 6,
    marginHorizontal: 2,
    borderRadius: 12,
    borderWidth: 1,
  },
  stripText: { flex: 1, fontFamily: WA_FONT.r, fontSize: 13.5, lineHeight: 18 },
  stripButton: { height: 32, paddingHorizontal: 12, borderRadius: 16, alignItems: "center", justifyContent: "center" },
  stripButtonText: { fontFamily: WA_FONT.s, fontSize: 13 },
  composer: { flexDirection: "row", alignItems: "flex-end", gap: 4 },
  side: { width: 40, height: 44, alignItems: "center", justifyContent: "center" },
  icon: { width: 36, height: 44, alignItems: "center", justifyContent: "center" },
  field: {
    flex: 1,
    minHeight: 42,
    borderRadius: 21,
    flexDirection: "row",
    alignItems: "center",
    paddingLeft: 16,
    paddingRight: 6,
    gap: 6,
  },
  input: {
    flex: 1,
    fontFamily: WA_FONT.r,
    fontSize: 16,
    lineHeight: 21,
    maxHeight: 120,
    paddingTop: 10,
    paddingBottom: 10,
  },
  inField: { width: 34, height: 44, alignItems: "center", justifyContent: "center" },
  fieldText: { fontFamily: WA_FONT.r, fontSize: 16 },
  recDot: { width: 10, height: 10, borderRadius: 5 },
  recClock: { fontVariant: ["tabular-nums"], marginRight: 6 },
  round: { width: 44, height: 44, borderRadius: 22, alignItems: "center", justifyContent: "center", marginLeft: 2 },
  offline: { fontFamily: WA_FONT.r, fontSize: 14, textAlign: "center", paddingVertical: 16 },
});
