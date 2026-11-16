import { useAddVoiceReviewNote, useDecideVideoReview, type VideoReview } from "@agenteschat/client";
import { errorText } from "@agenteschat/client/lib/errors";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { ActivityIndicator, Alert, Pressable, StyleSheet, TextInput, View } from "react-native";
import { KeyboardStickyView } from "react-native-keyboard-controller";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { Button, Chip, Icon, Text, useFieldText, useTheme, useToast } from "@/ui";
import { useOrgId } from "../shared/hooks";
import { successHaptic, tapHaptic } from "../shared/parts";
import { changesHintOf, statusIcon, statusTone, unsentOf } from "./logic";
import { filePart, useReviewWords } from "./media";
import { useTapRecorder } from "./recorder";

/*
 * The decision at the foot of the Revisor, for a video and a design piece alike (docs/adr/doug-0007-video-review.md,
 * docs/adr/doug-0010-design-review.md).
 */

/** Where things stand when the shown version takes no decision: who decided, and what comes next. */
export function Decided({ review, version }: { review: VideoReview; version: number }) {
  const w = useReviewWords();
  const insets = useSafeAreaInsets();
  const { colors: c } = useTheme();
  if (version !== review.version || review.status === "in_review") return null;
  const by = review.decidedBy?.name ?? "";
  const line =
    review.status === "approved"
      ? by
        ? w.approvedBy(by)
        : w.status.approved
      : [by ? w.changesBy(by) : w.status.changes, w.waitingNext(review.version + 1)].join(" ");
  return (
    <View style={[styles.dock, styles.decided, { paddingBottom: insets.bottom + 12, backgroundColor: c.grouped }]}>
      <Chip tone={statusTone(review.status)} icon={statusIcon(review.status)} label={line} />
    </View>
  );
}

/**
 * "Pedir ajustes" and "Aprovar" at the screen's foot. Approving asks first (the agent then delivers to the client);
 * asking for changes opens a word to the agent, and needs a note or that word.
 */
export function Decision({ review }: { review: VideoReview }) {
  const w = useReviewWords();
  const { t } = useTranslation();
  const { colors: c, shadows } = useTheme();
  const insets = useSafeAreaInsets();
  const orgId = useOrgId();
  const toast = useToast();
  const field = useFieldText("body");
  const decide = useDecideVideoReview(orgId, review.id);
  const addVoice = useAddVoiceReviewNote(orgId, review.id);
  const { i18n } = useTranslation();
  const { recording, toggle } = useTapRecorder();
  const [asking, setAsking] = useState(false);
  const [message, setMessage] = useState("");
  const unsent = unsentOf(review);
  const send = (decision: "approve" | "changes") =>
    decide.mutate(
      { decision, ...(message.trim() ? { message: message.trim() } : {}) },
      {
        onSuccess: () => {
          successHaptic();
          setAsking(false);
          setMessage("");
        },
        onError: (e: unknown) => toast({ title: errorText(t, e), icon: "x" }),
      },
    );
  /**
   * "Pedir ajustes" said aloud: tap, speak, tap again. The recording becomes a note about the whole video (transcribed
   * like any voice note) and the changes go at once: the agent starts the next version with it and every other note.
   */
  const sayChanges = async () => {
    tapHaptic();
    const uri = await toggle();
    if (!uri) return;
    addVoice.mutate(
      {
        version: review.version,
        atMs: null,
        file: filePart(uri, "ajustes.m4a", "audio/mp4"),
        fileName: "ajustes.m4a",
        language: i18n.language,
      },
      {
        onSuccess: () => send("changes"),
        onError: (e: unknown) => toast({ title: errorText(t, e), icon: "x" }),
      },
    );
  };
  const approve = () =>
    Alert.alert(w.decideTitle, w.approveConfirm, [
      { text: w.cancel, style: "cancel" },
      { text: w.approve, onPress: () => send("approve") },
    ]);
  return (
    <KeyboardStickyView offset={{ opened: insets.bottom }} style={styles.dock}>
      <View
        style={[
          styles.dockIn,
          { paddingBottom: insets.bottom + 8, backgroundColor: c.grouped, boxShadow: shadows.top },
        ]}
      >
        {asking ? (
          <>
            <Text variant="footnote" tone="muted">
              {changesHintOf(review, w)}
            </Text>
            <Pressable
              onPress={() => void sayChanges()}
              disabled={addVoice.isPending || decide.isPending}
              accessibilityRole="button"
              accessibilityLabel={recording ? w.sayingChanges : w.sayChanges}
              accessibilityHint={w.sayChangesHint}
              style={[styles.say, { backgroundColor: recording ? c.danger : c.raised }]}
            >
              {addVoice.isPending || decide.isPending ? (
                <ActivityIndicator color={c.ink} />
              ) : (
                <Icon name={recording ? "stop" : "mic"} size={20} color={recording ? "#fff" : c.ink} />
              )}
              <Text variant="callout" style={{ color: recording ? "#fff" : c.ink, fontWeight: "600" }}>
                {addVoice.isPending || decide.isPending ? w.sendingChanges : recording ? w.sayingChanges : w.sayChanges}
              </Text>
            </Pressable>
            <TextInput
              value={message}
              onChangeText={setMessage}
              placeholder={w.message}
              placeholderTextColor={c.faint}
              accessibilityLabel={w.message}
              multiline
              maxLength={2000}
              editable={!recording}
              style={[styles.message, field, { color: c.ink, backgroundColor: c.raised }]}
            />
            <View style={styles.row}>
              <View style={styles.grow}>
                <Button
                  variant="secondary"
                  wide
                  label={w.cancel}
                  onPress={() => setAsking(false)}
                  disabled={recording || addVoice.isPending}
                />
              </View>
              <View style={styles.grow}>
                <Button
                  variant="primary"
                  wide
                  label={w.sendChanges}
                  onPress={() => send("changes")}
                  disabled={(unsent === 0 && !message.trim()) || recording || addVoice.isPending}
                  loading={decide.isPending}
                />
              </View>
            </View>
          </>
        ) : (
          <View style={styles.row}>
            <View style={styles.grow}>
              <Button
                variant="secondary"
                wide
                label={unsent > 0 ? `${w.changes} (${unsent})` : w.changes}
                onPress={() => setAsking(true)}
                disabled={decide.isPending}
              />
            </View>
            <View style={styles.grow}>
              <Button variant="primary" wide label={w.approve} onPress={approve} loading={decide.isPending} />
            </View>
          </View>
        )}
      </View>
    </KeyboardStickyView>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: "row", gap: 8, alignItems: "center" },
  grow: { flex: 1, minWidth: 0 },
  dock: { position: "absolute", left: 0, right: 0, bottom: 0 },
  dockIn: { paddingHorizontal: 16, paddingTop: 12, gap: 10 },
  decided: { paddingHorizontal: 16, paddingTop: 12, alignItems: "center" },
  message: { minHeight: 64, maxHeight: 140, borderRadius: 12, paddingHorizontal: 12, paddingVertical: 10 },
  say: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 10,
    minHeight: 52,
    borderRadius: 14,
    paddingHorizontal: 16,
  },
});
