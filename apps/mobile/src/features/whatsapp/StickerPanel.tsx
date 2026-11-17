import { useSendWhatsAppSticker, useWhatsAppStickers, whatsappFileUrl } from "@agenteschat/client";
import { Image } from "expo-image";
import { ActivityIndicator, Pressable, Text as RNText, ScrollView, StyleSheet, View } from "react-native";
import { useToast } from "@/ui";
import { useOrgId } from "../shared/hooks";
import { ownFile, useWhatsAppSay } from "./logic";
import { useWa, WA_FONT } from "./look";
import { useWhatsAppWords } from "./words";

const CELL = 76;

/**
 * The number's stickers under the field, where WhatsApp's own panel opens from the smiley: the latest ones it has,
 * sent or received (`…/whatsapp/accounts/{id}/stickers`), one tap sends it. The phone's keyboard has the emoji.
 */
export function StickerPanel({ accountId, chatId, onSent }: { accountId: string; chatId: string; onSent: () => void }) {
  const orgId = useOrgId();
  const wa = useWa();
  const w = useWhatsAppWords();
  const toast = useToast();
  const say = useWhatsAppSay();
  const stickers = useWhatsAppStickers(orgId, accountId, true);
  const send = useSendWhatsAppSticker(orgId, accountId);
  const list = stickers.data?.stickers ?? [];
  return (
    <View style={[styles.panel, { borderTopColor: wa.line }]} accessibilityLabel={w.chat.stickers}>
      {stickers.isPending ? (
        <ActivityIndicator color={wa.sub} style={styles.wait} />
      ) : list.length === 0 ? (
        <RNText style={[styles.none, { color: wa.sub }]}>{w.chat.stickersNone}</RNText>
      ) : (
        <ScrollView contentContainerStyle={styles.grid} keyboardShouldPersistTaps="handled">
          {list.map((sticker) => (
            <Pressable
              key={sticker.messageId}
              onPress={() =>
                send.mutate(
                  { chatId, messageId: sticker.messageId },
                  { onSuccess: onSent, onError: (e) => toast({ title: say(e), icon: "x" }) },
                )
              }
              disabled={send.isPending}
              accessibilityRole="button"
              accessibilityLabel={w.kind.sticker}
              style={({ pressed }) => [styles.cell, pressed ? { backgroundColor: wa.field } : null]}
            >
              <Image
                source={ownFile((base) => whatsappFileUrl(orgId, accountId, sticker.messageId, base))}
                style={styles.sticker}
                contentFit="contain"
              />
            </Pressable>
          ))}
        </ScrollView>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  panel: { height: 240, borderTopWidth: StyleSheet.hairlineWidth, marginHorizontal: -8 },
  wait: { marginTop: 32 },
  none: { fontFamily: WA_FONT.r, fontSize: 14, textAlign: "center", paddingTop: 32, paddingHorizontal: 24 },
  grid: { flexDirection: "row", flexWrap: "wrap", padding: 8, gap: 4 },
  cell: { width: CELL, height: CELL, borderRadius: 12, alignItems: "center", justifyContent: "center" },
  sticker: { width: CELL - 12, height: CELL - 12 },
});
