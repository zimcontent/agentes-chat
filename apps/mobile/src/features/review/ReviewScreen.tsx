import { useApi, useDecideVideoReview, useVideoReview, type VideoReview } from "@agenteschat/client";
import { errorText } from "@agenteschat/client/lib/errors";
import { useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { ActivityIndicator, Alert, Linking, StyleSheet, TextInput, View } from "react-native";
import { KeyboardAwareScrollView, KeyboardStickyView } from "react-native-keyboard-controller";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import {
  Button,
  Chip,
  GroupedHeader,
  GroupedList,
  GroupedRow,
  Segmented,
  Text,
  useFieldText,
  useTheme,
  useToast,
} from "@/ui";
import { useOrgId } from "../shared/hooks";
import { PushedHeader, successHaptic, useSurface } from "../shared/parts";
import { notesOf, reviewOpen, statusIcon, statusTone, unsentOf, versionFile } from "./logic";
import { useReviewWords } from "./media";
import { type Draft, NoteDraft } from "./NoteDraft";
import { ReviewNotes } from "./ReviewNotes";
import { ReviewStage, type StageControls } from "./ReviewStage";

/**
 * One video's Revisor on the phone (docs/adr/doug-0007-video-review.md), the same review as the web's: the player
 * (a tap on the picture pauses it and opens a note at that moment and point), the version's notes, the brief and its
 * links, and while the newest version is in review "Aprovar" or "Pedir ajustes" at the foot. The decision goes back
 * to the agent's conversation as this person's message.
 */
export function ReviewScreen({ id }: { id: string }) {
  const w = useReviewWords();
  const { colors: c } = useTheme();
  const orgId = useOrgId();
  const q = useVideoReview(orgId, id);
  if (!q.data) {
    return (
      <View style={[styles.fill, { backgroundColor: c.grouped }]}>
        <PushedHeader title="" solid={false} grouped />
        <View style={styles.center}>
          {q.isLoading ? (
            <ActivityIndicator color={c.muted} />
          ) : (
            <Text tone="muted" style={styles.centerText}>
              {w.notFound}
            </Text>
          )}
        </View>
      </View>
    );
  }
  return <Detail review={q.data} />;
}

function Detail({ review }: { review: VideoReview }) {
  const w = useReviewWords();
  const { colors: c } = useTheme();
  const api = useApi();
  const orgId = useOrgId();
  const insets = useSafeAreaInsets();
  const surface = useSurface();
  const [version, setVersion] = useState(review.version);
  const [draft, setDraft] = useState<Draft | null>(null);
  const controls = useRef<StageControls | null>(null);
  const scroll = useRef<{ scrollTo: (o: { y: number; animated?: boolean }) => void } | null>(null);
  // A new version (the agent sent the next one) is the one shown.
  const newest = useRef(review.version);
  useEffect(() => {
    if (review.version !== newest.current) {
      newest.current = review.version;
      setVersion(review.version);
      setDraft(null);
    }
  }, [review.version]);

  const file = versionFile(review, version);
  const open = reviewOpen(review, version);
  const notes = notesOf(review.notes, version);
  const shownVersion = review.versions.find((v) => v.version === version);
  const header = [review.client, w.version(version), w.status[review.status]].filter(Boolean).join(" · ");

  const seek = (ms: number) => {
    controls.current?.seek(ms);
    scroll.current?.scrollTo({ y: 0, animated: true });
  };

  return (
    <View style={[styles.fill, { backgroundColor: c.grouped }]}>
      <PushedHeader title={review.title} subtitle={header} solid={false} grouped />
      <KeyboardAwareScrollView
        ref={scroll as never}
        contentInsetAdjustmentBehavior="automatic"
        keyboardShouldPersistTaps="handled"
        bottomOffset={24}
        contentContainerStyle={[styles.content, { paddingBottom: 120 + insets.bottom }]}
      >
        {review.versions.length > 1 ? (
          <Segmented
            wide
            value={String(version)}
            onChange={(v) => {
              setVersion(Number(v));
              setDraft(null);
            }}
            items={review.versions.map((v) => ({ key: String(v.version), label: w.version(v.version) }))}
          />
        ) : null}
        {file ? (
          <ReviewStage
            key={file}
            uri={api.artifacts.fileUrl(orgId, file)}
            notes={notes}
            draft={draft && draft.x !== null && draft.y !== null ? { x: draft.x, y: draft.y } : null}
            controls={controls}
            onPoint={(p) => (open ? setDraft({ atMs: p.atMs, endMs: null, x: p.x, y: p.y }) : undefined)}
          />
        ) : null}
        {shownVersion?.note ? (
          <Text variant="footnote" tone="muted">
            {`${w.versionNote}: ${shownVersion.note}`}
          </Text>
        ) : null}

        {open ? (
          draft ? (
            <NoteDraft
              key={`${draft.atMs}:${draft.x}:${draft.y}`}
              review={review}
              version={version}
              draft={draft}
              now={() => controls.current?.now() ?? 0}
              onEnd={(endMs) => setDraft((d) => (d ? { ...d, endMs } : d))}
              onClose={() => setDraft(null)}
            />
          ) : (
            <View style={styles.row}>
              <View style={styles.grow}>
                <Button
                  variant="secondary"
                  size="sm"
                  wide
                  label={w.noteHere}
                  onPress={() => {
                    controls.current?.pause();
                    setDraft({ atMs: Math.round(controls.current?.now() ?? 0), endMs: null, x: null, y: null });
                  }}
                />
              </View>
              <View style={styles.grow}>
                <Button
                  variant="secondary"
                  size="sm"
                  wide
                  label={w.wholeNote}
                  onPress={() => setDraft({ atMs: null, endMs: null, x: null, y: null })}
                />
              </View>
            </View>
          )
        ) : null}
        {open && !draft ? (
          <Text variant="footnote" tone="faint" style={styles.hint}>
            {w.tapHint}
          </Text>
        ) : null}

        <GroupedHeader>{w.notesTitle}</GroupedHeader>
        {notes.length > 0 ? (
          <ReviewNotes reviewId={review.id} notes={notes} onSeek={seek} />
        ) : (
          <View style={[styles.empty, surface]}>
            <Text variant="footnote" tone="muted">
              {open ? w.noNotes : w.noNotesClosed}
            </Text>
          </View>
        )}

        <GroupedHeader>{w.briefTitle}</GroupedHeader>
        <View style={[styles.empty, surface]}>
          <Text variant="body" tone={review.brief ? "ink" : "muted"} selectable>
            {review.brief || w.noBrief}
          </Text>
        </View>
        {review.links.length > 0 ? (
          <GroupedList>
            {review.links.map((l) => (
              <GroupedRow
                key={l.url}
                icon="link"
                label={l.label || l.url}
                sub={l.label ? l.url : undefined}
                chevron
                onPress={() => void Linking.openURL(l.url)}
              />
            ))}
          </GroupedList>
        ) : null}
        {!review.agent ? (
          <Text variant="footnote" tone="muted">
            {w.agentGone}
          </Text>
        ) : null}
      </KeyboardAwareScrollView>
      {open ? <Decision review={review} /> : <Decided review={review} version={version} />}
    </View>
  );
}

/** Where things stand when the shown version takes no decision: who decided, and what comes next. */
function Decided({ review, version }: { review: VideoReview; version: number }) {
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
function Decision({ review }: { review: VideoReview }) {
  const w = useReviewWords();
  const { t } = useTranslation();
  const { colors: c, shadows } = useTheme();
  const insets = useSafeAreaInsets();
  const orgId = useOrgId();
  const toast = useToast();
  const field = useFieldText("body");
  const decide = useDecideVideoReview(orgId, review.id);
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
              {w.changesHint}
            </Text>
            <TextInput
              value={message}
              onChangeText={setMessage}
              placeholder={w.message}
              placeholderTextColor={c.faint}
              accessibilityLabel={w.message}
              multiline
              maxLength={2000}
              autoFocus
              style={[styles.message, field, { color: c.ink, backgroundColor: c.raised }]}
            />
            <View style={styles.row}>
              <View style={styles.grow}>
                <Button variant="secondary" wide label={w.cancel} onPress={() => setAsking(false)} />
              </View>
              <View style={styles.grow}>
                <Button
                  variant="primary"
                  wide
                  label={w.sendChanges}
                  onPress={() => send("changes")}
                  disabled={unsent === 0 && !message.trim()}
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
  fill: { flex: 1 },
  center: { flex: 1, alignItems: "center", justifyContent: "center", padding: 32 },
  centerText: { textAlign: "center" },
  content: { paddingHorizontal: 16, paddingTop: 8, gap: 12 },
  row: { flexDirection: "row", gap: 8, alignItems: "center" },
  grow: { flex: 1, minWidth: 0 },
  hint: { textAlign: "center" },
  empty: { borderRadius: 16, padding: 12 },
  dock: { position: "absolute", left: 0, right: 0, bottom: 0 },
  dockIn: { paddingHorizontal: 16, paddingTop: 12, gap: 10 },
  decided: { paddingHorizontal: 16, paddingTop: 12, alignItems: "center" },
  message: { minHeight: 64, maxHeight: 140, borderRadius: 12, paddingHorizontal: 12, paddingVertical: 10 },
});
