import {
  useApi,
  useChannels,
  useIssues,
  useSendWork,
  useVideoReview,
  type VideoReviewSummary,
} from "@agenteschat/client";
import { channelTitle } from "@agenteschat/client/lib/channel-name";
import * as DocumentPicker from "expo-document-picker";
import { Image } from "expo-image";
import * as ImagePicker from "expo-image-picker";
import { usePreventRemove } from "expo-router";
import { useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { ActivityIndicator, Alert, ScrollView, StyleSheet, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { Button, GroupedFooter, GroupedHeader, GroupedList, GroupedRow, Locked, Segmented, Text, useToast } from "@/ui";
import { goBack, router } from "@/ui/navigation";
import { useColors, useErrorToast, useMeId, useOrgId } from "../shared/hooks";
import { pickOne, showActionSheet } from "../shared/PickerSheet";
import { PushedHeader, successHaptic } from "../shared/parts";
import { TextArea } from "../shared/TextArea";
import { sendsNext } from "./logic";
import { streamedPart, useReviewWords } from "./media";
import {
  checkWork,
  MAX_SLIDES,
  type PickedFile,
  percent,
  pickedFile,
  sendableGroups,
  sendableTasks,
  workReady,
} from "./team-logic";

type Medium = "video" | "design";
type Stage = { i: number; pct: number } | "registering" | null;

/** Opens "Mandar para revisão"; with a review of mine, its next version. */
export const openSendWork = (next?: string) => router.push(next ? `/review/send?next=${next}` : "/review/send");

/**
 * "Mandar a V3" on a review I sent that isn't approved: the form for its next version (its kind, its conversation).
 */
export function SendNext({ review }: { review: Pick<VideoReviewSummary, "id" | "version" | "status" | "sender"> }) {
  const w = useReviewWords();
  const meId = useMeId();
  if (!sendsNext(review, meId)) return null;
  return (
    <Button
      variant={review.status === "changes" ? "primary" : "secondary"}
      size="sm"
      wide
      icon="plus"
      label={w.team.sendNext(review.version + 1)}
      hint={w.team.sendNextHint}
      onPress={() => openSendWork(review.id)}
    />
  );
}

/**
 * "Mandar para revisão" on the phone (docs/adr/doug-0015-team-work-review.md): any member sends their own work, a
 * video or a design piece's slides, from the phone's library (or Files), to a group they're in or a task. The files
 * upload first to the conversation the work lives in, each with its progress, then the review opens in place of this
 * form. With `next` (a review I sent), the same form sends its next version: the kind is that review's, the files go
 * to its conversation, and it goes back to the review.
 */
export function SendWorkScreen({ next }: { next?: string }) {
  const nextReview = useVideoReview(useOrgId(), next ?? "");
  if (next && !nextReview.data) return <Waiting failed={!nextReview.isLoading} />;
  return <SendWorkForm next={next ? (nextReview.data ?? null) : null} />;
}

function Waiting({ failed }: { failed: boolean }) {
  const w = useReviewWords();
  const c = useColors();
  return (
    <View style={[styles.screen, { backgroundColor: c.grouped }]}>
      <PushedHeader title={w.team.send} solid={false} grouped />
      <View style={styles.center}>
        {failed ? (
          <Text tone="muted" style={styles.centerText}>
            {w.notFound}
          </Text>
        ) : (
          <ActivityIndicator color={c.muted} />
        )}
      </View>
    </View>
  );
}

function SendWorkForm({ next }: { next: VideoReviewSummary | null }) {
  const w = useReviewWords();
  const tw = w.team;
  const { t } = useTranslation();
  const c = useColors();
  const insets = useSafeAreaInsets();
  const toast = useToast();
  const failed = useErrorToast();
  const api = useApi();
  const orgId = useOrgId();
  const send = useSendWork(orgId);
  const groups = sendableGroups(useChannels(orgId).data ?? []);
  const tasks = sendableTasks(useIssues(orgId).data ?? []);
  const [medium, setMedium] = useState<Medium>(next?.medium ?? "video");
  const [files, setFiles] = useState<PickedFile[]>([]);
  const [title, setTitle] = useState("");
  const [where, setWhere] = useState<"group" | "task">("group");
  const [groupId, setGroupId] = useState<string | null>(null);
  const [taskId, setTaskId] = useState<string | null>(null);
  const [note, setNote] = useState("");
  const [stage, setStage] = useState<Stage>(null);
  const stopper = useRef<AbortController | null>(null);
  const done = useRef(false);
  const busy = stage !== null;
  const place = where === "group" ? groupId : taskId;
  const ready =
    !busy && workReady({ files: files.length, next: next !== null, title, where, place: next ? next.id : place });
  const group = groups.find((g) => g.id === groupId);
  const task = tasks.find((x) => x.id === taskId);

  // A back swipe with work picked or words typed asks first; leaving mid-upload stops it.
  usePreventRemove(files.length > 0 || title.trim() !== "" || note.trim() !== "", ({ repeat }) => {
    if (done.current) return repeat();
    Alert.alert(t("edit.unsaved"), undefined, [
      { text: t("edit.keepEditing"), style: "cancel" },
      {
        text: t("edit.discard"),
        style: "destructive",
        onPress: () => {
          stopper.current?.abort();
          done.current = true;
          repeat();
        },
      },
    ]);
  });

  const take = (picked: PickedFile[]) => {
    if (picked.length === 0) return;
    const problem = checkWork(medium, picked, tw);
    if (problem) {
      toast({ title: problem, icon: "x" });
      return;
    }
    setFiles(picked);
  };
  const fromPhotos = async () => {
    const res = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: medium === "video" ? ["videos"] : ["images"],
      allowsMultipleSelection: medium === "design",
      selectionLimit: medium === "design" ? MAX_SLIDES : 1,
      // The slides in the order they were tapped: the piece's order.
      orderedSelection: true,
      // The editor's export as it is (no transcoding); a picture as a JPEG the server takes (never a HEIC).
      preferredAssetRepresentationMode:
        medium === "video"
          ? ImagePicker.UIImagePickerPreferredAssetRepresentationMode.Current
          : ImagePicker.UIImagePickerPreferredAssetRepresentationMode.Compatible,
    });
    if (res.canceled) return;
    take(res.assets.map((a, i) => pickedFile(a, medium === "video" ? "video" : `slide-${i + 1}`)));
  };
  const fromFiles = async () => {
    const res = await DocumentPicker.getDocumentAsync({
      type: medium === "video" ? "video/*" : ["image/png", "image/jpeg", "image/webp"],
      multiple: medium === "design",
      copyToCacheDirectory: true,
    });
    if (res.canceled) return;
    take(
      res.assets.map((a, i) =>
        pickedFile(
          { uri: a.uri, fileName: a.name, mimeType: a.mimeType ?? null, fileSize: a.size ?? null },
          medium === "video" ? "video" : `slide-${i + 1}`,
        ),
      ),
    );
  };
  const pick = () => {
    const from = [
      { label: t("mobile.plus.photos"), onPress: () => void fromPhotos() },
      { label: t("mobile.plus.file"), onPress: () => void fromFiles() },
    ];
    if (!showActionSheet(medium === "video" ? tw.pickVideo : tw.pickSlides, from)) void fromPhotos();
  };

  const pickGroup = () =>
    void pickOne({
      title: tw.pickGroup,
      value: groupId,
      search: true,
      options: groups.map((g) => ({ key: g.id, label: channelTitle(g), leading: { kind: "icon", name: "hash" } })),
    }).then((key) => {
      if (key !== null) setGroupId(key);
    });
  const pickTask = () =>
    void pickOne({
      title: tw.pickTask,
      value: taskId,
      search: true,
      options: tasks.map((x) => ({
        key: x.id,
        label: x.title,
        sub: `#${x.number}`,
        leading: { kind: "icon", name: "issue" },
      })),
    }).then((key) => {
      if (key !== null) setTaskId(key);
    });

  const submit = async () => {
    if (!ready) return;
    const problem = checkWork(medium, files, tw);
    if (problem) {
      toast({ title: problem, icon: "x" });
      return;
    }
    const stop = new AbortController();
    stopper.current = stop;
    setStage({ i: 1, pct: 0 });
    try {
      // The files go first to the conversation the work lives in: the review's, a task's thread, or the group.
      let target: { channelId: string; threadId?: string; reviewId?: string };
      if (next)
        target = {
          channelId: next.channelId,
          ...(next.threadId ? { threadId: next.threadId } : {}),
          reviewId: next.id,
        };
      else if (where === "task" && taskId) {
        const conversation = await api.issues.conversation(orgId, taskId);
        target = { channelId: conversation.channelId, threadId: conversation.rootId };
      } else target = { channelId: groupId ?? "" };
      const ids: string[] = [];
      for (const [at, file] of files.entries()) {
        setStage({ i: at + 1, pct: 0 });
        const part = streamedPart(file.uri, file.name, file.type) as unknown as Parameters<
          typeof api.artifacts.upload
        >[1];
        const saved = await api.artifacts.upload(orgId, part, {
          ...target,
          signal: stop.signal,
          onProgress: (sent) => setStage({ i: at + 1, pct: percent(sent) }),
        });
        ids.push(saved.id);
      }
      setStage("registering");
      const words = note.trim();
      const sent = await send.mutateAsync({
        medium,
        files: ids,
        ...(next ? { reviewId: next.id } : where === "task" && taskId ? { taskId } : { channelId: groupId ?? "" }),
        ...(!next && title.trim() ? { title: title.trim() } : {}),
        ...(words ? { note: words } : {}),
      });
      done.current = true;
      successHaptic();
      toast({ title: tw.sent });
      // A next version goes back to its review; new work opens its review in place of this form.
      if (next) goBack(`/review/${next.id}`);
      else router.replace(`/review/${sent.review.id}`);
    } catch (e) {
      if (!stop.signal.aborted) failed(e);
    } finally {
      stopper.current = null;
      if (!done.current) setStage(null);
    }
  };

  const fileLabel =
    files.length === 0
      ? medium === "video"
        ? tw.pickVideo
        : tw.pickSlides
      : medium === "video"
        ? (files[0]?.name ?? "")
        : tw.slides(files.length);
  const progress =
    stage === "registering" ? tw.registering : stage ? tw.uploading(stage.i, files.length, stage.pct) : null;

  return (
    <View style={[styles.screen, { backgroundColor: c.grouped }]}>
      <PushedHeader
        title={next ? tw.sendNext(next.version + 1) : tw.send}
        subtitle={next?.title}
        solid={false}
        grouped
        action={{ label: tw.submit, disabled: !ready, onPress: () => void submit() }}
      />
      <ScrollView
        contentInsetAdjustmentBehavior="automatic"
        keyboardShouldPersistTaps="handled"
        automaticallyAdjustKeyboardInsets
        contentContainerStyle={[styles.in, { paddingBottom: 24 + insets.bottom }]}
      >
        {progress ? (
          <View style={[styles.progress, { backgroundColor: c.raised }]}>
            <Text variant="subhead">{progress}</Text>
            <View style={[styles.track, { backgroundColor: c.sunken }]}>
              <View
                style={[
                  styles.fill,
                  {
                    backgroundColor: c.green,
                    width: `${stage === "registering" ? 100 : stage ? stage.pct : 0}%`,
                  },
                ]}
              />
            </View>
            {stage !== "registering" ? (
              <Button variant="secondary" size="sm" wide label={tw.cancel} onPress={() => stopper.current?.abort()} />
            ) : null}
          </View>
        ) : null}
        <Locked when={busy} style={styles.fields}>
          {next ? null : (
            <View style={styles.field}>
              <GroupedHeader>{tw.kindLabel}</GroupedHeader>
              <Segmented
                wide
                value={medium}
                onChange={(m) => {
                  if (m === medium) return;
                  // What was picked was for the other kind.
                  setMedium(m as Medium);
                  setFiles([]);
                }}
                items={[
                  { key: "video", label: tw.kinds.video },
                  { key: "design", label: tw.kinds.design },
                ]}
              />
            </View>
          )}
          <View>
            <GroupedList>
              <GroupedRow
                icon={medium === "video" ? "play" : "image"}
                label={fileLabel}
                labelLines={2}
                {...(files.length > 0 ? { value: tw.change } : {})}
                chevron
                onPress={pick}
              />
            </GroupedList>
            {medium === "design" && files.length > 0 ? (
              <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.strip}>
                {files.map((f) => (
                  <Image
                    key={f.uri}
                    source={{ uri: f.uri }}
                    style={[styles.thumb, { backgroundColor: c.sunken }]}
                    contentFit="cover"
                  />
                ))}
              </ScrollView>
            ) : null}
            <GroupedFooter>{medium === "video" ? tw.videoHint : tw.slidesHint}</GroupedFooter>
          </View>
          {next ? null : (
            <View style={styles.field}>
              <GroupedHeader>{tw.name}</GroupedHeader>
              <TextArea
                value={title}
                onChangeText={setTitle}
                placeholder={where === "task" && task ? task.title : tw.namePlaceholder}
                accessibilityLabel={tw.name}
                multiline={false}
                minHeight={50}
                returnKeyType="next"
                maxLength={200}
              />
            </View>
          )}
          {next ? null : (
            <View style={styles.field}>
              <GroupedHeader>{tw.whereLabel}</GroupedHeader>
              <Segmented
                wide
                value={where}
                onChange={(v) => setWhere(v as "group" | "task")}
                items={[
                  { key: "group", label: tw.where.group },
                  { key: "task", label: tw.where.task },
                ]}
              />
              <GroupedList>
                {where === "group" ? (
                  <GroupedRow
                    icon="hash"
                    label={tw.group}
                    value={group ? channelTitle(group) : tw.pickGroup}
                    chevron
                    onPress={pickGroup}
                  />
                ) : (
                  <GroupedRow
                    icon="issue"
                    label={tw.task}
                    value={task ? `#${task.number} ${task.title}` : tw.pickTask}
                    chevron
                    onPress={pickTask}
                  />
                )}
              </GroupedList>
            </View>
          )}
          <View style={styles.field}>
            <GroupedHeader>{next ? tw.nextNoteLabel : tw.noteLabel}</GroupedHeader>
            <TextArea
              value={note}
              onChangeText={setNote}
              accessibilityLabel={next ? tw.nextNoteLabel : tw.noteLabel}
              minHeight={96}
              maxLength={2000}
            />
          </View>
        </Locked>
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1 },
  center: { flex: 1, alignItems: "center", justifyContent: "center", padding: 32 },
  centerText: { textAlign: "center" },
  // A form's 16 pt sides, as Nova tarefa's.
  in: { paddingHorizontal: 16, paddingTop: 8, gap: 16 },
  fields: { gap: 16 },
  field: { gap: 4 },
  progress: { borderRadius: 16, padding: 16, gap: 12 },
  track: { height: 4, borderRadius: 2, overflow: "hidden" },
  fill: { height: 4, borderRadius: 2 },
  strip: { gap: 8, paddingTop: 8 },
  thumb: { width: 48, height: 60, borderRadius: 8 },
});
