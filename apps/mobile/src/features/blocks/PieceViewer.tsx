import { type ReactNode, useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import {
  FlatList,
  KeyboardAvoidingView,
  Modal,
  Platform,
  ScrollView,
  StyleSheet,
  TextInput,
  useWindowDimensions,
  View,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { Button, fieldText, haptics, IconButton, SCREEN_X, Text } from "@/ui";
import { useColors } from "../shared/hooks";

/** One page of the viewer: the piece drawn large, and how a note about it names it to the agent. */
export interface PiecePage {
  /** "o slide 3 (“Capa”)": goes into the note sent to the agent. */
  about: string;
  /** The piece at the viewer's width. */
  face: (width: number) => ReactNode;
}

/** A note keeps room in the block's reply for the words that say which piece it is about (2000 in all). */
const NOTE_CHARS = 1600;

/**
 * A carousel's slides, a static post or a reel's beats on the whole screen: in the conversation they are a thumbnail
 * wide, too small to read and judge on a phone. Swiped sideways page by page, each with a field whose words go to the
 * agent as the person's answer to the block, naming the piece they are about.
 */
export function PieceViewer({
  visible,
  title,
  pages,
  start,
  agentName,
  onClose,
  onNote,
}: {
  visible: boolean;
  title: string;
  pages: PiecePage[];
  start: number;
  agentName: string;
  onClose: () => void;
  /** Sends the note to the agent; true once it went. */
  onNote: (text: string) => Promise<boolean>;
}) {
  const { t } = useTranslation();
  const c = useColors();
  const insets = useSafeAreaInsets();
  const { width } = useWindowDimensions();
  const list = useRef<FlatList<PiecePage>>(null);
  const [at, setAt] = useState(start);
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  // Which page the last note went about, so "Sent" shows on that page alone.
  const [sentOn, setSentOn] = useState<number | null>(null);

  useEffect(() => {
    if (!visible) return;
    setAt(start);
    setNote("");
    setSentOn(null);
  }, [visible, start]);

  const face = width - SCREEN_X * 2;
  const page = pages[at] ?? pages[0];
  const send = async () => {
    const text = note.trim();
    if (!text || busy || !page) return;
    setBusy(true);
    const ok = await onNote(t("mobile.blocks.noteMessage", { about: page.about, note: text }));
    setBusy(false);
    if (!ok) return;
    haptics.success();
    setNote("");
    setSentOn(at);
  };

  return (
    <Modal
      visible={visible}
      animationType="slide"
      presentationStyle="fullScreen"
      supportedOrientations={["portrait"]}
      onRequestClose={onClose}
    >
      <KeyboardAvoidingView
        behavior={Platform.OS === "ios" ? "padding" : undefined}
        style={[styles.fill, { backgroundColor: c.bg, paddingTop: insets.top }]}
      >
        {/* The home indicator's room on a view of its own: with `padding`, the keyboard view replaces its own. */}
        <View style={[styles.fill, { paddingBottom: insets.bottom }]}>
          <View style={styles.bar}>
            <View style={styles.titles}>
              <Text variant="title" numberOfLines={2}>
                {title}
              </Text>
              {pages.length > 1 ? (
                <Text variant="footnote" tone="muted">
                  {t("mobile.blocks.pieceAt", { at: at + 1, count: pages.length })}
                </Text>
              ) : null}
            </View>
            <IconButton icon="x" label={t("common.close")} onPress={onClose} />
          </View>
          <FlatList
            ref={list}
            data={pages}
            horizontal
            pagingEnabled
            showsHorizontalScrollIndicator={false}
            initialScrollIndex={Math.min(start, Math.max(0, pages.length - 1))}
            getItemLayout={(_, i) => ({ length: width, offset: width * i, index: i })}
            keyExtractor={(_, i) => String(i)}
            keyboardShouldPersistTaps="handled"
            onMomentumScrollEnd={(e) => {
              const next = Math.round(e.nativeEvent.contentOffset.x / width);
              if (next !== at) {
                setAt(next);
                haptics.selection();
              }
            }}
            style={styles.fill}
            renderItem={({ item }) => (
              <ScrollView
                style={{ width }}
                contentContainerStyle={styles.page}
                keyboardShouldPersistTaps="handled"
                keyboardDismissMode="on-drag"
              >
                {item.face(face)}
              </ScrollView>
            )}
          />
          <View style={[styles.foot, { borderTopColor: c.line2 }]}>
            {sentOn === at ? (
              <View style={styles.sent}>
                <View style={[styles.mark, { backgroundColor: c.ok }]} />
                <Text variant="footnote" tone="muted">
                  {t("mobile.blocks.noteSent", { name: agentName })}
                </Text>
              </View>
            ) : null}
            <View style={styles.row}>
              <TextInput
                value={note}
                onChangeText={setNote}
                placeholder={page ? t("mobile.blocks.notePlaceholder", { about: page.about }) : ""}
                placeholderTextColor={c.faint}
                multiline
                maxLength={NOTE_CHARS}
                accessibilityLabel={t("mobile.blocks.noteLabel")}
                style={[
                  styles.field,
                  fieldText("body"),
                  { color: c.ink, backgroundColor: c.raised, borderColor: c.line2 },
                ]}
              />
              <Button
                variant="primary"
                icon="send"
                label={t("mobile.blocks.send")}
                disabled={!note.trim()}
                loading={busy}
                onPress={() => void send()}
              />
            </View>
          </View>
        </View>
      </KeyboardAvoidingView>
    </Modal>
  );
}

const styles = StyleSheet.create({
  fill: { flex: 1 },
  bar: {
    flexDirection: "row",
    alignItems: "flex-start",
    gap: 8,
    paddingLeft: SCREEN_X,
    paddingRight: 8,
    paddingTop: 8,
  },
  titles: { flex: 1, minWidth: 0, gap: 2, paddingTop: 8 },
  page: { paddingHorizontal: SCREEN_X, paddingVertical: 16, alignItems: "center" },
  foot: {
    gap: 8,
    paddingHorizontal: SCREEN_X,
    paddingTop: 12,
    paddingBottom: 8,
    borderTopWidth: StyleSheet.hairlineWidth,
  },
  sent: { flexDirection: "row", alignItems: "center", gap: 8 },
  mark: { width: 5, height: 5 },
  row: { flexDirection: "row", alignItems: "flex-end", gap: 8 },
  field: {
    flex: 1,
    minHeight: 40,
    maxHeight: 120,
    paddingHorizontal: 12,
    paddingTop: 9,
    paddingBottom: 9,
    borderRadius: 12,
    borderWidth: StyleSheet.hairlineWidth,
  },
});
