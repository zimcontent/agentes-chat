import {
  timecode,
  useApi,
  useDeleteReviewNote,
  type VideoReviewAttachment,
  type VideoReviewNote,
} from "@dougbot/client";
import { errorText } from "@dougbot/client/lib/errors";
import { Image } from "expo-image";
import { useTranslation } from "react-i18next";
import { Linking, Pressable, ScrollView, StyleSheet, View } from "react-native";
import { Icon, Text, useToast } from "@/ui";
import { router } from "@/ui/navigation";
import { useColors, useMeId, useOrgId } from "../shared/hooks";
import { tapHaptic, useSurface } from "../shared/parts";
import { ownSource, useReviewWords } from "./media";

/**
 * A version's notes on the phone (docs/adr/doug-0007-video-review.md), by time: a tap takes the player to the note's
 * moment. Each says where, what about, who and whether it was said aloud, with what it hands the editor; its author
 * removes it until it is sent.
 */
export function ReviewNotes({
  reviewId,
  notes,
  onSeek,
  pins,
  onSlide,
}: {
  reviewId: string;
  notes: VideoReviewNote[];
  onSeek: (ms: number) => void;
  /** A design piece (docs/adr/doug-0010-design-review.md): each pinned note's number, as the slide shows it. */
  pins?: Map<string, number>;
  /** A design piece: a tap takes the screen to the note's slide. */
  onSlide?: (page: number) => void;
}) {
  return (
    <View style={styles.list}>
      {notes.map((n) => (
        <NoteRow key={n.id} reviewId={reviewId} note={n} onSeek={onSeek} pin={pins?.get(n.id)} onSlide={onSlide} />
      ))}
    </View>
  );
}

function NoteRow({
  reviewId,
  note: n,
  onSeek,
  pin,
  onSlide,
}: {
  reviewId: string;
  note: VideoReviewNote;
  onSeek: (ms: number) => void;
  pin?: number;
  onSlide?: (page: number) => void;
}) {
  const w = useReviewWords();
  const { t } = useTranslation();
  const c = useColors();
  const surface = useSurface();
  const toast = useToast();
  const orgId = useOrgId();
  const meId = useMeId();
  const remove = useDeleteReviewNote(orgId, reviewId);
  const design = onSlide !== undefined;
  const where = design
    ? n.page === null
      ? w.design.whole
      : `${pin ?? ""} · ${w.design.slideShort(n.page)}`
    : n.atMs === null
      ? w.whole
      : n.endMs !== null
        ? `${timecode(n.atMs)}–${timecode(n.endMs)}`
        : timecode(n.atMs);
  const goes = design ? n.page !== null : n.atMs !== null;
  const facts = [n.kind ? w.kinds[n.kind] : "", n.author?.name ?? "", n.voice ? w.voice : "", n.sent ? w.sent : ""]
    .filter(Boolean)
    .join(" · ");
  const mine = n.author?.id === meId && !n.sent;
  return (
    <Pressable
      onPress={() => {
        if (!goes) return;
        tapHaptic();
        if (design && n.page !== null) onSlide?.(n.page);
        else if (n.atMs !== null) onSeek(n.atMs);
      }}
      accessibilityRole={goes ? "button" : undefined}
      style={({ pressed }) => [styles.note, surface, pressed && goes && styles.pressed]}
    >
      <View style={styles.head}>
        <View style={[styles.time, { backgroundColor: c.chip }]}>
          <Text variant="caption" style={styles.mono}>
            {where}
          </Text>
        </View>
        {n.x !== null && n.y !== null ? <Icon name="target" size={14} color={c.muted} /> : null}
        <Text variant="caption" tone="muted" numberOfLines={1} style={styles.grow}>
          {facts}
        </Text>
        {mine ? (
          <Pressable
            onPress={() =>
              remove.mutate(n.id, { onError: (e: unknown) => toast({ title: errorText(t, e), icon: "x" }) })
            }
            disabled={remove.isPending}
            accessibilityRole="button"
            accessibilityLabel={w.remove}
            hitSlop={12}
          >
            <Icon name="trash" size={16} color={c.muted} />
          </Pressable>
        ) : null}
      </View>
      {n.body.trim() ? (
        <Text variant="body" tone="ink" selectable>
          {n.body}
        </Text>
      ) : null}
      {n.attachments.length > 0 ? <NoteAttachments items={n.attachments} /> : null}
    </Pressable>
  );
}

/** What a note hands the editor: photos as thumbnails, the rest as chips; a tap opens the file's screen, or the link. */
export function NoteAttachments({ items }: { items: VideoReviewAttachment[] }) {
  const api = useApi();
  const orgId = useOrgId();
  const c = useColors();
  const w = useReviewWords();
  return (
    <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.attach}>
      {items.map((a) => {
        const url = a.type === "file" ? api.artifacts.fileUrl(orgId, a.artifactId) : a.url;
        const label = a.type === "file" ? a.name : a.label && a.label !== a.url ? a.label : a.url;
        return (
          <Pressable
            key={a.type === "file" ? a.artifactId : a.url}
            onPress={() => (a.type === "link" ? void Linking.openURL(a.url) : router.push(`/file/${a.artifactId}`))}
            accessibilityRole="link"
            accessibilityLabel={`${w.attachments}: ${label}`}
            style={({ pressed }) => [styles.chip, { backgroundColor: c.sunken }, pressed && styles.pressed]}
          >
            {a.type === "file" && a.media === "image" ? (
              <Image source={ownSource(url)} style={styles.thumb} contentFit="cover" />
            ) : (
              <View style={[styles.thumb, styles.icon, { backgroundColor: c.plate }]}>
                <Icon
                  name={
                    a.type === "link" ? "link" : a.media === "video" ? "play" : a.media === "audio" ? "sound" : "file"
                  }
                  size={14}
                  color={c.muted}
                />
              </View>
            )}
            <Text variant="footnote" numberOfLines={1} style={styles.chipText}>
              {label}
            </Text>
          </Pressable>
        );
      })}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  list: { gap: 8 },
  note: { borderRadius: 16, padding: 12, gap: 6 },
  pressed: { opacity: 0.75 },
  head: { flexDirection: "row", alignItems: "center", gap: 8 },
  time: { paddingHorizontal: 8, paddingVertical: 2, borderRadius: 6 },
  mono: { fontVariant: ["tabular-nums"], fontWeight: "600" },
  grow: { flex: 1, minWidth: 0 },
  attach: { gap: 6, paddingTop: 2 },
  chip: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    padding: 4,
    paddingRight: 10,
    borderRadius: 10,
    maxWidth: 220,
  },
  thumb: { width: 32, height: 32, borderRadius: 6 },
  icon: { alignItems: "center", justifyContent: "center" },
  chipText: { flexShrink: 1 },
});
