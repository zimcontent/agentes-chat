import { useApi, useVideoReview, type VideoReview } from "@agenteschat/client";
import { useEffect, useRef, useState } from "react";
import { ActivityIndicator, Linking, StyleSheet, View } from "react-native";
import { KeyboardAwareScrollView } from "react-native-keyboard-controller";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { Button, GroupedHeader, GroupedList, GroupedRow, Segmented, Sheet, Text, useTheme } from "@/ui";
import { useOrgId } from "../shared/hooks";
import { PushedHeader, useSurface } from "../shared/parts";
import { Decided, Decision } from "./Decision";
import { DesignReview } from "./DesignReview";
import { notesOf, reviewOpen, versionFile } from "./logic";
import { useReviewWords } from "./media";
import { type Draft, NoteDraft } from "./NoteDraft";
import { ReviewNotes } from "./ReviewNotes";
import { ReviewStage, type StageControls } from "./ReviewStage";
import { SendNext } from "./SendWorkScreen";

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
  // A design piece has slides, not a player (docs/adr/doug-0010-design-review.md).
  if (q.data.medium === "design") return <DesignReview review={q.data} />;
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
  // The light copy plays (4G); HD swaps to the original at the same place.
  const [hd, setHd] = useState(false);
  const startAt = useRef(0);
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
              startAt.current = 0;
            }}
            items={review.versions.map((v) => ({ key: String(v.version), label: w.version(v.version) }))}
          />
        ) : null}
        {file ? (
          <ReviewStage
            key={`${file}:${hd}`}
            uri={
              api.videoReviews?.videoUrl(orgId, review.id, version, { original: hd }) ??
              api.artifacts.fileUrl(orgId, file)
            }
            startMs={startAt.current}
            notes={notes}
            draft={draft && draft.x !== null && draft.y !== null ? { x: draft.x, y: draft.y } : null}
            controls={controls}
            onPoint={(p) => (open ? setDraft({ atMs: p.atMs, endMs: null, x: p.x, y: p.y }) : undefined)}
          />
        ) : null}
        {shownVersion?.light ? (
          <Button
            variant={hd ? "primary" : "secondary"}
            size="sm"
            label={w.hd}
            hint={hd ? w.hdOn : w.hdOff}
            onPress={() => {
              startAt.current = controls.current?.now() ?? 0;
              setHd((on) => !on);
            }}
          />
        ) : null}
        <SendNext review={review} />
        {shownVersion?.note ? (
          <Text variant="footnote" tone="muted">
            {`${w.versionNote}: ${shownVersion.note}`}
          </Text>
        ) : null}

        {open ? (
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
        {!review.agent && !review.sender ? (
          <Text variant="footnote" tone="muted">
            {w.agentGone}
          </Text>
        ) : null}
      </KeyboardAwareScrollView>
      {/* A note opens over the video, where the finger is, not at the foot of the screen; the picture's ring stays. */}
      <Sheet open={open && draft !== null} onClose={() => setDraft(null)} solid>
        {draft ? (
          <NoteDraft
            key={`${draft.atMs}:${draft.x}:${draft.y}`}
            bare
            review={review}
            version={version}
            draft={draft}
            now={() => controls.current?.now() ?? 0}
            onEnd={(endMs) => setDraft((d) => (d ? { ...d, endMs } : d))}
            onClose={() => setDraft(null)}
          />
        ) : null}
      </Sheet>
      {open ? <Decision review={review} /> : <Decided review={review} version={version} />}
    </View>
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
