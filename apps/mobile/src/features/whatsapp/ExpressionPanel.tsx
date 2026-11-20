import { useSendWhatsAppSticker, useWhatsAppStickers, whatsappFileUrl } from "@dougbot/client";
import { EMOJI_CATEGORIES, EMOJIS, type EmojiCategoryId } from "@dougbot/ui/emoji-data";
import { Image } from "expo-image";
import { useMemo, useState } from "react";
import {
  ActivityIndicator,
  FlatList,
  Pressable,
  Text as RNText,
  ScrollView,
  StyleSheet,
  useWindowDimensions,
  View,
} from "react-native";
import { useToast } from "@/ui";
import { useOrgId } from "../shared/hooks";
import { ownFile, useWhatsAppSay } from "./logic";
import { useWa, WA_FONT, WaGlyph } from "./look";
import { useWhatsAppWords } from "./words";

const CELL = 76;
const EMOJI_COLS = 8;
const PANEL_H = 280;
/** The tab last open, kept while the app runs: WhatsApp opens the panel where it was. */
let lastTab: "emoji" | "stickers" = "emoji";

/** Each category's first emoji, the tab that jumps to it. */
const CATEGORY_MARKS: Record<EmojiCategoryId, string> = Object.fromEntries(
  EMOJI_CATEGORIES.map((id) => [id, EMOJIS.find((e) => e.category === id)?.emoji ?? "🙂"]),
) as Record<EmojiCategoryId, string>;

/**
 * What opens from the smiley under the field, as in WhatsApp: the emoji (a tap writes one in the field, ⌫ erases the
 * last) and the number's stickers (the latest it sent or received, `…/whatsapp/accounts/{id}/stickers`; a tap sends one).
 */
export function ExpressionPanel({
  accountId,
  chatId,
  onEmoji,
  onErase,
  onSent,
}: {
  accountId: string;
  chatId: string;
  onEmoji: (emoji: string) => void;
  onErase: () => void;
  onSent: () => void;
}) {
  const wa = useWa();
  const w = useWhatsAppWords();
  const [tab, setTab] = useState(lastTab);
  const pick = (next: typeof tab) => {
    lastTab = next;
    setTab(next);
  };
  return (
    <View style={[styles.panel, { borderTopColor: wa.line }]}>
      <View style={styles.tabs} accessibilityRole="tablist">
        {(["emoji", "stickers"] as const).map((id) => (
          <Pressable
            key={id}
            onPress={() => pick(id)}
            accessibilityRole="tab"
            accessibilityState={{ selected: tab === id }}
            hitSlop={{ top: 6, bottom: 6 }}
            style={[styles.tab, tab === id ? { backgroundColor: wa.field } : null]}
          >
            <RNText style={[styles.tabText, { color: tab === id ? wa.ink : wa.sub }]}>
              {id === "emoji" ? w.chat.emoji : w.chat.stickers}
            </RNText>
          </Pressable>
        ))}
        <View style={styles.grow} />
        {tab === "emoji" ? (
          <Pressable
            onPress={onErase}
            onLongPress={onErase}
            accessibilityRole="button"
            accessibilityLabel={w.chat.erase}
            hitSlop={8}
            style={styles.erase}
          >
            <WaGlyph name="erase" size={22} color={wa.soft} />
          </Pressable>
        ) : null}
      </View>
      {tab === "emoji" ? (
        <EmojiGrid onEmoji={onEmoji} />
      ) : (
        <Stickers accountId={accountId} chatId={chatId} onSent={onSent} />
      )}
    </View>
  );
}

function EmojiGrid({ onEmoji }: { onEmoji: (emoji: string) => void }) {
  const wa = useWa();
  const { width } = useWindowDimensions();
  const size = Math.floor((width - 16) / EMOJI_COLS);
  const [category, setCategory] = useState<EmojiCategoryId>(EMOJI_CATEGORIES[0] ?? "smileys");
  const list = useMemo(() => EMOJIS.filter((e) => e.category === category), [category]);
  return (
    <View style={styles.grow}>
      <FlatList
        key={category}
        data={list}
        numColumns={EMOJI_COLS}
        keyExtractor={(e) => e.emoji}
        keyboardShouldPersistTaps="always"
        contentContainerStyle={styles.emojiGrid}
        renderItem={({ item }) => (
          <Pressable
            onPress={() => onEmoji(item.emoji)}
            accessibilityRole="button"
            accessibilityLabel={item.name}
            style={({ pressed }) => [
              { width: size, height: size },
              styles.emojiCell,
              pressed ? { backgroundColor: wa.field } : null,
            ]}
          >
            <RNText style={styles.emoji}>{item.emoji}</RNText>
          </Pressable>
        )}
      />
      <View style={[styles.categories, { borderTopColor: wa.line }]}>
        {EMOJI_CATEGORIES.map((id) => (
          <Pressable
            key={id}
            onPress={() => setCategory(id)}
            accessibilityRole="tab"
            accessibilityState={{ selected: id === category }}
            accessibilityLabel={id}
            style={[styles.category, id === category ? { backgroundColor: wa.field } : null]}
          >
            <RNText style={[styles.categoryMark, id === category ? null : styles.categoryOff]}>
              {CATEGORY_MARKS[id]}
            </RNText>
          </Pressable>
        ))}
      </View>
    </View>
  );
}

function Stickers({ accountId, chatId, onSent }: { accountId: string; chatId: string; onSent: () => void }) {
  const orgId = useOrgId();
  const wa = useWa();
  const w = useWhatsAppWords();
  const toast = useToast();
  const say = useWhatsAppSay();
  const stickers = useWhatsAppStickers(orgId, accountId, true);
  const send = useSendWhatsAppSticker(orgId, accountId);
  const [sendingId, setSendingId] = useState<string | null>(null);
  const list = stickers.data?.stickers ?? [];
  if (stickers.isPending) return <ActivityIndicator color={wa.sub} style={styles.wait} />;
  if (list.length === 0) return <RNText style={[styles.none, { color: wa.sub }]}>{w.chat.stickersNone}</RNText>;
  return (
    <ScrollView contentContainerStyle={styles.grid} keyboardShouldPersistTaps="handled">
      {list.map((sticker) => (
        <Pressable
          key={sticker.messageId}
          onPress={() => {
            setSendingId(sticker.messageId);
            send.mutate(
              { chatId, messageId: sticker.messageId },
              {
                onSuccess: onSent,
                onError: (e) => toast({ title: say(e), icon: "x" }),
                onSettled: () => setSendingId(null),
              },
            );
          }}
          disabled={send.isPending}
          accessibilityRole="button"
          accessibilityLabel={w.kind.sticker}
          accessibilityState={{ busy: sendingId === sticker.messageId }}
          style={({ pressed }) => [styles.cell, pressed ? { backgroundColor: wa.field } : null]}
        >
          <Image
            source={ownFile((base) => whatsappFileUrl(orgId, accountId, sticker.messageId, base))}
            style={[styles.sticker, sendingId === sticker.messageId ? styles.sendingSticker : null]}
            contentFit="contain"
          />
          {sendingId === sticker.messageId ? <ActivityIndicator color={wa.green} style={styles.spin} /> : null}
        </Pressable>
      ))}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  panel: { height: PANEL_H, borderTopWidth: StyleSheet.hairlineWidth, marginHorizontal: -8 },
  tabs: { flexDirection: "row", alignItems: "center", gap: 8, paddingHorizontal: 12, paddingVertical: 8 },
  tab: { height: 32, paddingHorizontal: 12, borderRadius: 16, justifyContent: "center" },
  tabText: { fontFamily: WA_FONT.s, fontSize: 14 },
  grow: { flex: 1 },
  erase: { width: 40, height: 32, alignItems: "center", justifyContent: "center" },
  emojiGrid: { paddingHorizontal: 8 },
  emojiCell: { alignItems: "center", justifyContent: "center", borderRadius: 8 },
  emoji: { fontSize: 28 },
  categories: {
    flexDirection: "row",
    justifyContent: "space-around",
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderTopWidth: StyleSheet.hairlineWidth,
  },
  category: { width: 36, height: 32, borderRadius: 8, alignItems: "center", justifyContent: "center" },
  categoryMark: { fontSize: 18 },
  categoryOff: { opacity: 0.55 },
  wait: { marginTop: 32 },
  none: { fontFamily: WA_FONT.r, fontSize: 14, textAlign: "center", paddingTop: 32, paddingHorizontal: 24 },
  grid: { flexDirection: "row", flexWrap: "wrap", padding: 8, gap: 4 },
  cell: { width: CELL, height: CELL, borderRadius: 12, alignItems: "center", justifyContent: "center" },
  sticker: { width: CELL - 12, height: CELL - 12 },
  sendingSticker: { opacity: 0.4 },
  spin: { position: "absolute" },
});
