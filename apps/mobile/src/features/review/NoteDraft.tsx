import {
  DESIGN_REVIEW_NOTE_KINDS,
  timecode,
  useAddReviewNote,
  useAddVoiceReviewNote,
  useApi,
  VIDEO_REVIEW_NOTE_KINDS,
  type VideoReview,
  type VideoReviewAttachmentInput,
  type VideoReviewNoteKind,
} from "@agenteschat/client";
import { errorText } from "@agenteschat/client/lib/errors";
import { Image } from "expo-image";
import * as ImagePicker from "expo-image-picker";
import { useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { ActivityIndicator, Pressable, StyleSheet, TextInput, View } from "react-native";
import { Button, Icon, Text, useFieldText, useToast } from "@/ui";
import { useColors, useOrgId } from "../shared/hooks";
import { successHaptic, tapHaptic, useSurface } from "../shared/parts";
import { filePart, useReviewWords } from "./media";
import { useTapRecorder } from "./recorder";

/** The most files and links one note carries (the engine's `REVIEW_NOTE_ATTACHMENTS`). */
const MOST_ATTACHMENTS = 8;

/** A note being written: at a moment and a point, or about the whole video (`atMs` null). */
export interface Draft {
  atMs: number | null;
  endMs: number | null;
  x: number | null;
  y: number | null;
  /**
   * A design piece's slide (docs/adr/doug-0010-design-review.md): `null` the whole piece, absent a video. A piece
   * has no time: no stretch to mark, and its own kinds (text, type, color, image, layout).
   */
  page?: number | null;
}

type Item =
  | {
      key: string;
      type: "file";
      name: string;
      uri: string;
      image: boolean;
      artifactId: string | null;
      state: "up" | "done" | "failed";
    }
  | { key: string; type: "link"; url: string };

let next = 0;

/** The http(s) addresses in what was typed or pasted. */
const linksIn = (text: string) =>
  [...text.matchAll(/https?:\/\/[^\s<>"']+/gi)].map((m) => m[0].replace(/[),.;]+$/, ""));

/**
 * The note being written on the phone (docs/adr/doug-0007-video-review.md): what it is about, the words or a voice
 * note (transcribed by the server), a stretch's end, and what the editor should put in: photos and clips from the
 * phone (uploaded at once as files of the review's conversation, where the agent reaches them) and B-roll links.
 */
export function NoteDraft({
  review,
  version,
  draft,
  now,
  onEnd,
  onClose,
  bare = false,
}: {
  /** Inside a sheet, which is the surface already: no card of its own. */
  bare?: boolean;
  review: VideoReview;
  version: number;
  draft: Draft;
  /** The player's moment now, for "Marcar fim". */
  now: () => number;
  onEnd: (endMs: number | null) => void;
  onClose: () => void;
}) {
  const w = useReviewWords();
  const { t, i18n } = useTranslation();
  const c = useColors();
  const api = useApi();
  const orgId = useOrgId();
  const toast = useToast();
  const surface = useSurface();
  const field = useFieldText("body");
  const add = useAddReviewNote(orgId, review.id);
  const addVoice = useAddVoiceReviewNote(orgId, review.id);
  const [kind, setKind] = useState<VideoReviewNoteKind | null>(null);
  const [body, setBody] = useState("");
  const [link, setLink] = useState("");
  const [items, setItems] = useState<Item[]>([]);
  const { recording, toggle } = useTapRecorder();
  const live = useRef(true);
  useEffect(
    () => () => {
      live.current = false;
    },
    [],
  );

  const design = draft.page !== undefined;
  const whole = design ? draft.page === null : draft.atMs === null;
  const busy = items.some((i) => i.type === "file" && i.state === "up");
  const attachments: VideoReviewAttachmentInput[] = items.flatMap((i): VideoReviewAttachmentInput[] =>
    i.type === "link"
      ? [{ url: i.url }]
      : i.state === "done" && i.artifactId
        ? [{ artifactId: i.artifactId, name: i.name }]
        : [],
  );
  const ready = (body.trim().length > 0 || attachments.length > 0) && !busy && !add.isPending;
  const where = {
    version,
    atMs: design ? null : draft.atMs,
    endMs: design ? null : draft.endMs,
    ...(design ? { page: draft.page ?? null } : {}),
    kind,
    x: draft.x,
    y: draft.y,
    ...(attachments.length > 0 ? { attachments } : {}),
  };
  const failed = (e: unknown) => toast({ title: errorText(t, e), icon: "x" });

  const save = () => {
    if (!ready) return;
    add.mutate(
      { ...where, body: body.trim() },
      {
        onSuccess: () => {
          successHaptic();
          onClose();
        },
        onError: failed,
      },
    );
  };

  const addLinks = (urls: string[]) =>
    setItems((all) => [
      ...all,
      ...urls
        .filter((url) => !all.some((i) => i.type === "link" && i.url === url))
        .map((url) => ({ key: `l${++next}`, type: "link" as const, url })),
    ]);
  const takeLink = () => {
    const urls = linksIn(link.trim());
    if (urls.length === 0) return;
    addLinks(urls);
    setLink("");
  };

  const pick = async () => {
    const room = MOST_ATTACHMENTS - items.length;
    if (room <= 0) return;
    const res = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ["images", "videos"],
      quality: 0.85,
      allowsMultipleSelection: true,
      selectionLimit: room,
      orderedSelection: true,
    });
    if (res.canceled) return;
    for (const a of res.assets) {
      const image = a.type !== "video";
      const name = a.fileName ?? (image ? "foto.jpg" : "video.mp4");
      const type = a.mimeType ?? (image ? "image/jpeg" : "video/mp4");
      const key = `f${++next}`;
      setItems((all) => [...all, { key, type: "file", name, uri: a.uri, image, artifactId: null, state: "up" }]);
      api.artifacts
        .upload(orgId, filePart(a.uri, name, type) as unknown as Parameters<typeof api.artifacts.upload>[1], {
          channelId: review.channelId,
          ...(review.threadId ? { threadId: review.threadId } : {}),
          // Into the review's conversation, for whoever reviews it, reading that conversation or not (doug-0014).
          reviewId: review.id,
        })
        .then((saved) => {
          if (!live.current) return;
          setItems((all) =>
            all.map((i) => (i.key === key && i.type === "file" ? { ...i, artifactId: saved.id, state: "done" } : i)),
          );
        })
        .catch((e: unknown) => {
          if (!live.current) return;
          setItems((all) => all.map((i) => (i.key === key && i.type === "file" ? { ...i, state: "failed" } : i)));
          failed(e);
        });
    }
  };

  /** Tap to start, tap again to stop: the recording goes to be transcribed and becomes the note. */
  const talk = async () => {
    tapHaptic();
    const uri = await toggle();
    if (uri) {
      addVoice.mutate(
        {
          ...where,
          file: filePart(uri, "nota.m4a", "audio/mp4"),
          fileName: "nota.m4a",
          language: i18n.language,
        },
        {
          onSuccess: () => {
            successHaptic();
            onClose();
          },
          onError: failed,
        },
      );
      return;
    }
  };

  const at = design
    ? draft.page === null || draft.page === undefined
      ? w.design.wholeTitle
      : w.design.slideShort(draft.page)
    : draft.atMs === null
      ? w.wholeTitle
      : draft.endMs !== null
        ? w.stretch(`${timecode(draft.atMs)}–${timecode(draft.endMs)}`)
        : w.atTime(timecode(draft.atMs));

  return (
    <View style={[styles.box, bare ? styles.bare : surface]}>
      <View style={styles.head}>
        <Text variant="subhead" style={styles.bold}>
          {at}
        </Text>
        {whole || design ? null : (
          <Pressable
            onPress={() => {
              tapHaptic();
              const end = Math.round(now());
              onEnd(draft.atMs !== null && end > draft.atMs ? end : null);
            }}
            accessibilityRole="button"
            hitSlop={8}
          >
            <Text variant="footnote" tone="muted" style={styles.link}>
              {draft.endMs !== null ? w.remark : w.markEnd}
            </Text>
          </Pressable>
        )}
      </View>

      <View style={styles.kinds} accessibilityLabel={w.kindLabel}>
        {(design ? DESIGN_REVIEW_NOTE_KINDS : VIDEO_REVIEW_NOTE_KINDS).map((k) => {
          const on = kind === k;
          return (
            <Pressable
              key={k}
              onPress={() => {
                tapHaptic();
                setKind(on ? null : k);
              }}
              accessibilityRole="button"
              accessibilityState={{ selected: on }}
              style={[
                styles.kind,
                { backgroundColor: on ? c.chosen : c.chip, borderColor: on ? c.greenText : "transparent" },
              ]}
            >
              <Text variant="footnote" tone={on ? "ink" : "muted"} style={on ? styles.bold : undefined}>
                {w.kinds[k]}
              </Text>
            </Pressable>
          );
        })}
      </View>

      <TextInput
        value={body}
        onChangeText={(text) => {
          // A lone pasted address becomes a link to put in, not the note's words.
          const urls = linksIn(text);
          if (urls.length === 1 && text.trim() === urls[0] && body.trim() === "") {
            addLinks(urls);
            return;
          }
          setBody(text);
        }}
        placeholder={
          kind === "broll"
            ? w.brollPlaceholder
            : whole
              ? design
                ? w.design.wholePlaceholder
                : w.wholePlaceholder
              : w.placeholder
        }
        placeholderTextColor={c.faint}
        accessibilityLabel={w.placeholder}
        multiline
        maxLength={4000}
        editable={!recording}
        style={[styles.input, field, { color: c.ink, backgroundColor: c.sunken }]}
      />

      {items.length > 0 ? (
        <View style={styles.items}>
          {items.map((i) => (
            <View key={i.key} style={[styles.item, { backgroundColor: c.sunken }]}>
              {i.type === "file" && i.image ? (
                <Image source={{ uri: i.uri }} style={styles.thumb} contentFit="cover" />
              ) : (
                <View style={[styles.thumb, styles.icon, { backgroundColor: c.plate }]}>
                  <Icon name={i.type === "link" ? "link" : "play"} size={16} color={c.muted} />
                </View>
              )}
              <Text variant="footnote" numberOfLines={1} style={styles.grow}>
                {i.type === "link" ? i.url : i.name}
              </Text>
              {i.type === "file" && i.state === "up" ? <ActivityIndicator size="small" color={c.muted} /> : null}
              {i.type === "file" && i.state === "failed" ? (
                <Text variant="caption" tone="danger">
                  {w.uploadFailed}
                </Text>
              ) : null}
              <Pressable
                onPress={() => setItems((all) => all.filter((x) => x.key !== i.key))}
                accessibilityRole="button"
                accessibilityLabel={w.removeAttachment}
                hitSlop={10}
              >
                <Icon name="x" size={16} color={c.muted} />
              </Pressable>
            </View>
          ))}
        </View>
      ) : null}

      <View style={styles.attach}>
        <Button variant="secondary" size="sm" label={w.photo} onPress={() => void pick()} />
        <TextInput
          value={link}
          onChangeText={setLink}
          onSubmitEditing={takeLink}
          onBlur={takeLink}
          placeholder={w.linkPlaceholder}
          placeholderTextColor={c.faint}
          accessibilityLabel={w.linkPlaceholder}
          autoCapitalize="none"
          autoCorrect={false}
          keyboardType="url"
          returnKeyType="done"
          style={[styles.linkInput, { color: c.ink, backgroundColor: c.sunken }]}
        />
      </View>

      <View style={styles.acts}>
        <Pressable
          onPress={() => void talk()}
          disabled={addVoice.isPending || busy}
          accessibilityRole="button"
          accessibilityLabel={recording ? w.stop : w.record}
          style={({ pressed }) => [
            styles.mic,
            { backgroundColor: recording ? c.danger : c.plate },
            pressed && styles.pressed,
          ]}
        >
          {addVoice.isPending ? (
            <ActivityIndicator size="small" color={c.muted} />
          ) : (
            <Icon name={recording ? "stop" : "mic"} size={20} color={recording ? "#fff" : c.ink} />
          )}
        </Pressable>
        <Text variant="footnote" tone="muted" style={styles.grow} numberOfLines={1}>
          {recording ? w.recording : addVoice.isPending ? w.transcribing : ""}
        </Text>
        <Button variant="secondary" size="sm" label={w.cancel} onPress={onClose} disabled={recording} />
        <Button
          variant="primary"
          size="sm"
          label={w.save}
          onPress={save}
          disabled={!ready || recording}
          loading={add.isPending}
        />
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  box: { borderRadius: 20, padding: 12, gap: 10 },
  bare: { paddingHorizontal: 16, paddingTop: 4, paddingBottom: 12 },
  head: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: 8 },
  bold: { fontWeight: "600" },
  link: { textDecorationLine: "underline" },
  kinds: { flexDirection: "row", flexWrap: "wrap", gap: 6 },
  kind: { height: 32, paddingHorizontal: 12, borderRadius: 8, justifyContent: "center", borderWidth: 1 },
  input: {
    minHeight: 88,
    maxHeight: 200,
    borderRadius: 12,
    paddingHorizontal: 12,
    paddingTop: 10,
    paddingBottom: 10,
    textAlignVertical: "top",
  },
  items: { gap: 6 },
  item: { flexDirection: "row", alignItems: "center", gap: 8, padding: 6, borderRadius: 10 },
  thumb: { width: 36, height: 36, borderRadius: 8 },
  icon: { alignItems: "center", justifyContent: "center" },
  grow: { flex: 1, minWidth: 0 },
  attach: { flexDirection: "row", alignItems: "center", gap: 8 },
  linkInput: { flex: 1, height: 36, borderRadius: 10, paddingHorizontal: 10, fontSize: 15 },
  acts: { flexDirection: "row", alignItems: "center", gap: 8 },
  mic: { width: 44, height: 44, borderRadius: 22, alignItems: "center", justifyContent: "center" },
  pressed: { opacity: 0.75 },
});
