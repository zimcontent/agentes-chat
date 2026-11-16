import { useApi, type VideoReview, type VideoReviewNote } from "@agenteschat/client";
import { Image } from "expo-image";
import { type ComponentRef, useEffect, useMemo, useRef, useState } from "react";
import {
  Linking,
  type NativeScrollEvent,
  type NativeSyntheticEvent,
  Pressable,
  ScrollView,
  StyleSheet,
  useWindowDimensions,
  View,
} from "react-native";
import { KeyboardAwareScrollView } from "react-native-keyboard-controller";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { Button, GroupedHeader, GroupedList, GroupedRow, Segmented, Sheet, Text, useTheme } from "@/ui";
import { router } from "@/ui/navigation";
import { useOrgId } from "../shared/hooks";
import { PushedHeader, tapHaptic, useSurface } from "../shared/parts";
import { Decided, Decision } from "./Decision";
import { type PieceHandle, PieceView, usePieceSource } from "./DesignPiece";
import { designNotesOf, designVersion, editable, openOn, pinNumbers, pinsOn } from "./design-logic";
import { fraction, reviewOpen } from "./logic";
import { ownSource, useReviewWords } from "./media";
import { type Draft, NoteDraft } from "./NoteDraft";
import { ReviewNotes } from "./ReviewNotes";
import { SendNext } from "./SendWorkScreen";

/*
 * A design piece's Revisor on the phone (docs/adr/doug-0010-design-review.md), the same review as the web's: its
 * slides one at a time (a sideways swipe turns them, the strip under them jumps), each note a numbered pin where it
 * points; a tap on the slide opens a note there. "Editar" opens the piece itself in the editor; the decision goes back
 * to the designer agent as on a video. A version someone edited by hand has no pictures: its page is shown instead.
 */

const GAP = 16;

/** One note's pin: a teardrop whose point (bottom-left) sits on the spot. */
function Pin({ n, sent, draft }: { n: number | null; sent?: boolean; draft?: boolean }) {
  const { colors: c } = useTheme();
  return (
    <View
      style={[
        styles.pin,
        {
          backgroundColor: draft ? c.warn : sent ? c.raised : c.green,
          borderColor: "#fff",
        },
      ]}
      pointerEvents="none"
    >
      <Text variant="caption" style={[styles.pinText, { color: draft ? c.onWarn : sent ? c.muted : c.greenInk }]}>
        {n === null ? "+" : String(n)}
      </Text>
    </View>
  );
}

export function DesignReview({ review }: { review: VideoReview }) {
  const w = useReviewWords();
  const d = w.design;
  const { colors: c } = useTheme();
  const api = useApi();
  const orgId = useOrgId();
  const insets = useSafeAreaInsets();
  const surface = useSurface();
  const { width: screen } = useWindowDimensions();
  const width = screen - 2 * GAP;
  const [version, setVersion] = useState(review.version);
  const [slide, setSlide] = useState(1);
  const [draft, setDraft] = useState<Draft | null>(null);
  const [aspect, setAspect] = useState(4 / 5);
  const [liveSlides, setLiveSlides] = useState(0);
  const pager = useRef<ComponentRef<typeof ScrollView>>(null);
  const piece = useRef<PieceHandle>(null);

  // A new version (the designer sent the next one, or someone saved an edit) is the one shown.
  const newest = useRef(review.version);
  useEffect(() => {
    if (review.version !== newest.current) {
      newest.current = review.version;
      setVersion(review.version);
      setSlide(1);
      setDraft(null);
    }
  }, [review.version]);

  const shown = designVersion(review, version);
  const pages = shown?.pages ?? [];
  const live = pages.length === 0 && Boolean(shown?.source);
  const source = usePieceSource(review.id, version, live);
  const count = Math.max(1, pages.length || liveSlides);
  const open = reviewOpen(review, version);
  const notes = useMemo(() => designNotesOf(review.notes, version), [review.notes, version]);
  const numbers = useMemo(() => pinNumbers(notes), [notes]);
  const pageUrl = (n: number) => api.videoReviews?.pageUrl?.(orgId, review.id, version, n) ?? "";
  const header = [review.client, w.version(version), w.status[review.status]].filter(Boolean).join(" · ");
  const height = width / aspect;

  const go = (n: number, animated = true) => {
    const next = Math.max(1, Math.min(count, n));
    setSlide(next);
    setDraft(null);
    if (live) piece.current?.send({ ed: "slide", slide: next });
    else pager.current?.scrollTo({ x: (next - 1) * width, animated });
  };
  const onPaged = (e: NativeSyntheticEvent<NativeScrollEvent>) => {
    const n = Math.round(e.nativeEvent.contentOffset.x / width) + 1;
    if (n !== slide) {
      setSlide(n);
      setDraft(null);
    }
  };
  const noteAt = (page: number, x: number, y: number) => {
    if (!open) return;
    tapHaptic();
    setDraft({ atMs: null, endMs: null, page, x: fraction(x), y: fraction(y) });
  };
  const pinsHere = (page: number, h: number) => (
    <>
      {pinsOn(notes, page).map((n: VideoReviewNote) => (
        <View key={n.id} style={[styles.pinAt, { left: (n.x ?? 0) * width, top: (n.y ?? 0) * h }]} pointerEvents="none">
          <Pin n={numbers.get(n.id) ?? null} sent={n.sent} />
        </View>
      ))}
      {draft && draft.page === page && draft.x !== null && draft.y !== null ? (
        <View style={[styles.pinAt, { left: draft.x * width, top: draft.y * h }]} pointerEvents="none">
          <Pin n={null} draft />
        </View>
      ) : null}
    </>
  );

  return (
    <View style={[styles.fill, { backgroundColor: c.grouped }]}>
      <PushedHeader title={review.title} subtitle={header} solid={false} grouped />
      <KeyboardAwareScrollView
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
              setSlide(1);
              setDraft(null);
              setLiveSlides(0);
            }}
            items={review.versions.map((v) => ({ key: String(v.version), label: w.version(v.version) }))}
          />
        ) : null}

        <View style={styles.bar}>
          <Button
            variant="ghost"
            size="sm"
            label="‹"
            hint={d.prev}
            disabled={slide <= 1}
            onPress={() => go(slide - 1)}
          />
          <Text variant="subhead" style={styles.count}>
            {d.slide(slide, count)}
          </Text>
          <Button
            variant="ghost"
            size="sm"
            label="›"
            hint={d.next}
            disabled={slide >= count}
            onPress={() => go(slide + 1)}
          />
        </View>

        {live ? (
          source.data ? (
            <View style={[styles.sheet, { width }]}>
              <PieceView
                ref={piece}
                html={source.data}
                width={width}
                slide={slide}
                mode="view"
                onMessage={(m) => {
                  if (m.ed === "ready") setLiveSlides(m.slides);
                }}
              />
              {/* The page shows; a tap over it is where a note goes. */}
              <Pressable
                style={StyleSheet.absoluteFill}
                disabled={!open}
                onPress={(e) => noteAt(slide, e.nativeEvent.locationX / width, e.nativeEvent.locationY / height)}
                onLayout={(e) => setAspect(width / Math.max(1, e.nativeEvent.layout.height))}
                accessibilityRole="button"
                accessibilityLabel={d.tapHint}
              >
                {pinsHere(slide, height)}
              </Pressable>
            </View>
          ) : (
            <View style={[styles.sheet, styles.center, { width, height: width * 1.25, backgroundColor: c.sunken }]}>
              <Text variant="footnote" tone="muted">
                {source.isError ? d.failedLoad : d.loading}
              </Text>
            </View>
          )
        ) : (
          <ScrollView
            ref={pager}
            horizontal
            pagingEnabled
            showsHorizontalScrollIndicator={false}
            onMomentumScrollEnd={onPaged}
            style={[styles.sheet, { width }]}
          >
            {pages.map((_, i) => {
              const n = i + 1;
              return (
                <Pressable
                  key={n}
                  disabled={!open}
                  onPress={(e) => noteAt(n, e.nativeEvent.locationX / width, e.nativeEvent.locationY / height)}
                  accessibilityRole="image"
                  accessibilityLabel={d.slideShort(n)}
                  accessibilityHint={open ? d.tapHint : undefined}
                  style={{ width, height }}
                >
                  <Image
                    source={ownSource(pageUrl(n))}
                    style={{ width, height }}
                    contentFit="contain"
                    transition={120}
                    onLoad={(e) => {
                      if (n === 1 && e.source.width > 0) setAspect(e.source.width / e.source.height);
                    }}
                  />
                  {pinsHere(n, height)}
                </Pressable>
              );
            })}
          </ScrollView>
        )}

        {pages.length > 1 ? (
          <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.strip}>
            {pages.map((_, i) => {
              const n = i + 1;
              const waiting = openOn(notes, n);
              return (
                <Pressable
                  key={n}
                  onPress={() => go(n)}
                  accessibilityRole="button"
                  accessibilityLabel={d.slideShort(n)}
                  accessibilityState={{ selected: n === slide }}
                  style={[styles.thumb, { borderColor: n === slide ? c.green : c.line, aspectRatio: aspect }]}
                >
                  <Image source={ownSource(pageUrl(n))} style={StyleSheet.absoluteFill} contentFit="cover" />
                  {waiting > 0 ? (
                    <View style={[styles.thumbCount, { backgroundColor: c.green }]}>
                      <Text variant="caption" style={[styles.pinText, { color: c.greenInk }]}>
                        {String(waiting)}
                      </Text>
                    </View>
                  ) : null}
                </Pressable>
              );
            })}
          </ScrollView>
        ) : null}

        <SendNext review={review} />
        {shown?.editedBy ? (
          <Text variant="footnote" tone="muted">
            {d.editedBy(shown.editedBy.name)}
          </Text>
        ) : null}
        {shown?.note ? (
          <Text variant="footnote" tone="muted">
            {`${w.versionNote}: ${shown.note}`}
          </Text>
        ) : null}

        <View style={styles.row}>
          {open ? (
            <View style={styles.grow}>
              <Button
                variant="secondary"
                size="sm"
                wide
                label={d.wholeTitle}
                onPress={() => setDraft({ atMs: null, endMs: null, page: null, x: null, y: null })}
              />
            </View>
          ) : null}
          {editable(review, version) ? (
            <View style={styles.grow}>
              <Button
                variant="secondary"
                size="sm"
                wide
                label={d.edit}
                onPress={() => {
                  tapHaptic();
                  router.push(`/review/edit/${review.id}?v=${version}`);
                }}
              />
            </View>
          ) : null}
        </View>
        {open && !draft ? (
          <Text variant="footnote" tone="faint" style={styles.hint}>
            {d.tapHint}
          </Text>
        ) : null}

        <GroupedHeader>{w.notesTitle}</GroupedHeader>
        {notes.length > 0 ? (
          <ReviewNotes reviewId={review.id} notes={notes} onSeek={() => {}} pins={numbers} onSlide={(p) => go(p)} />
        ) : (
          <View style={[styles.empty, surface]}>
            <Text variant="footnote" tone="muted">
              {open ? d.noNotes : w.noNotesClosed}
            </Text>
          </View>
        )}

        <GroupedHeader>{w.briefTitle}</GroupedHeader>
        <View style={[styles.empty, surface]}>
          <Text variant="body" tone={review.brief ? "ink" : "muted"} selectable>
            {review.brief || d.briefNone}
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
            {d.agentGone}
          </Text>
        ) : null}
      </KeyboardAwareScrollView>
      <Sheet open={open && draft !== null} onClose={() => setDraft(null)} solid>
        {draft ? (
          <NoteDraft
            key={`${draft.page}:${draft.x}:${draft.y}`}
            bare
            review={review}
            version={version}
            draft={draft}
            now={() => 0}
            onEnd={() => {}}
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
  content: { paddingHorizontal: GAP, paddingTop: 8, gap: 12 },
  bar: { flexDirection: "row", alignItems: "center", justifyContent: "space-between" },
  count: { fontWeight: "600", fontVariant: ["tabular-nums"] },
  sheet: { borderRadius: 12, overflow: "hidden", alignSelf: "center" },
  center: { alignItems: "center", justifyContent: "center" },
  strip: { gap: 8, paddingVertical: 2 },
  thumb: { height: 64, borderRadius: 8, borderWidth: 2, overflow: "hidden" },
  thumbCount: {
    position: "absolute",
    top: 3,
    right: 3,
    minWidth: 18,
    height: 18,
    borderRadius: 9,
    paddingHorizontal: 4,
    alignItems: "center",
    justifyContent: "center",
  },
  row: { flexDirection: "row", gap: 8, alignItems: "center" },
  grow: { flex: 1, minWidth: 0 },
  hint: { textAlign: "center" },
  empty: { borderRadius: 16, padding: 12 },
  pinAt: { position: "absolute", width: 0, height: 0 },
  pin: {
    position: "absolute",
    left: 0,
    bottom: 0,
    width: 26,
    height: 26,
    borderWidth: 2,
    borderTopLeftRadius: 13,
    borderTopRightRadius: 13,
    borderBottomRightRadius: 13,
    borderBottomLeftRadius: 3,
    alignItems: "center",
    justifyContent: "center",
    boxShadow: "0 3px 8px rgba(0,0,0,0.4)",
  },
  pinText: { fontWeight: "700", fontSize: 12 },
});
