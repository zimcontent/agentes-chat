import {
  fitMediaFiles,
  MEDIA_REF_LIMITS,
  type MediaFileSet,
  type MediaGenKind,
  type MediaInputMode,
  type MediaModel,
  type MediaRefFile,
  mediaModeSpec,
  NO_MEDIA_FILES,
  useGenerateMedia,
  useMediaOverview,
  useMediaQuote,
  useUploadMediaRef,
} from "@agenteschat/client";
import { errorText } from "@agenteschat/client/lib/errors";
import { randomUUID } from "expo-crypto";
import { Image } from "expo-image";
import * as ImagePicker from "expo-image-picker";
import { useLocalSearchParams, usePreventRemove } from "expo-router";
import { useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { ActivityIndicator, Alert, Pressable, ScrollView, StyleSheet, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import {
  Button,
  GroupedFooter,
  GroupedHeader,
  GroupedList,
  GroupedRow,
  Icon,
  Locked,
  Segmented,
  SkeletonList,
  Text,
  useToast,
} from "@/ui";
import { filePart } from "../review/media";
import { useColors, useOrgId } from "../shared/hooks";
import { pickOne } from "../shared/PickerSheet";
import { goBack, PushedHeader, successHaptic } from "../shared/parts";
import { overLimit, TextArea } from "../shared/TextArea";
import {
  hidesModes,
  imageRoom,
  imageTargets,
  type MediaForm,
  mediaForm,
  type PendingRef,
  pickPhoneMode,
  withPending,
} from "./logic";
import { ModelLogo } from "./parts";
import { useMediaWords } from "./words";

/** The prompt's longest, the web's field's. */
const PROMPT_LIMIT = { max: 4000 };
const THUMB = 72;

/**
 * "Gerar mídia" (`/media/new`, docs/adr/doug-0011): image or video, the model (its maker's logo beside its name, as
 * the web's picker), how it goes in (prompt alone, first frame, first and last, references: the phone's pictures), the
 * prompt, then quality, aspect, length and sound where the model has them. The button says the price; generating goes
 * back to the gallery, the new one running there. `?kind&model&prompt` start it from a generation ("Usar este prompt").
 */
export function NewMediaScreen() {
  const w = useMediaWords();
  const c = useColors();
  const orgId = useOrgId();
  const overview = useMediaOverview(orgId);
  const data = overview.data;
  return (
    <View style={[styles.screen, { backgroundColor: c.grouped }]}>
      <PushedHeader title={w.newTitle} solid={false} grouped />
      {data ? (
        <Form models={data.models} balance={data.balance} />
      ) : overview.isLoading ? (
        <View style={styles.in}>
          <SkeletonList rows={4} />
        </View>
      ) : (
        <View style={styles.in}>
          <Text tone="muted" style={styles.centerText}>
            {w.loadFailed}
          </Text>
        </View>
      )}
    </View>
  );
}

function Form({ models, balance }: { models: MediaModel[]; balance: number }) {
  const { t, i18n } = useTranslation();
  const w = useMediaWords();
  const c = useColors();
  const insets = useSafeAreaInsets();
  const toast = useToast();
  const orgId = useOrgId();
  const params = useLocalSearchParams<{ kind?: string; model?: string; prompt?: string }>();
  const [kind, setKind] = useState<MediaGenKind>(params.kind === "video" ? "video" : "image");
  const [modelId, setModelId] = useState<string | undefined>(params.model);
  const [quality, setQuality] = useState<string | undefined>(undefined);
  const [aspect, setAspect] = useState<string | undefined>(undefined);
  const [seconds, setSeconds] = useState<number | undefined>(undefined);
  const [audio, setAudio] = useState(true);
  const [chosenMode, setMode] = useState<MediaInputMode>("text");
  const [stored, setFiles] = useState<MediaFileSet>(NO_MEDIA_FILES);
  const [pending, setPending] = useState<PendingRef[]>([]);
  const [prompt, setPrompt] = useState(typeof params.prompt === "string" ? params.prompt.slice(0, 4000) : "");
  const upload = useUploadMediaRef(orgId);
  const generate = useGenerateMedia(orgId);

  const form = mediaForm(models, {
    kind,
    modelId,
    quality,
    aspect,
    seconds,
    audio,
    mode: chosenMode,
    files: stored,
    prompt,
    uploading: pending.length > 0,
  });
  const { model } = form;
  // The form prices it itself; the server only when the model's price isn't a plain one.
  const needsQuote = form.price === null && Boolean(model) && form.why === null;
  const quote = useMediaQuote(orgId, form.ask, needsQuote);
  const price = form.price ?? (needsQuote ? (quote.data ?? null) : null);
  const quoting = needsQuote && quote.isFetching;
  const short = price !== null && price > balance;
  const fmt = (n: number) => n.toLocaleString(i18n.language);
  const tooLong = overLimit(prompt, PROMPT_LIMIT);
  const ready = Boolean(model) && form.why === null && !short && !quoting && !tooLong && !generate.isPending;

  // What the picker's callbacks read: the latest choice, files and uploads, set as they change.
  const now = useRef({ form, pending });
  now.current = { form, pending };

  // A back swipe with a prompt written asks first, as Nova tarefa does.
  const done = useRef(false);
  usePreventRemove(prompt.trim() !== "" && !params.prompt, ({ repeat }) => {
    if (done.current) return repeat();
    Alert.alert(t("edit.unsaved"), undefined, [
      { text: t("edit.keepEditing"), style: "cancel" },
      { text: t("edit.discard"), style: "destructive", onPress: repeat },
    ]);
  });

  /** Keeps only the files the new choice takes, so one the new model refuses never rides along unseen. */
  const choose = (next: MediaModel | undefined, nextQuality: string | undefined, wanted: MediaInputMode) => {
    const nextMode = pickPhoneMode(next, nextQuality, wanted);
    setMode(nextMode);
    setFiles((f) => fitMediaFiles(f, mediaModeSpec(next, nextQuality, nextMode)));
  };
  const switchKind = (next: MediaGenKind) => {
    if (next === kind) return;
    setKind(next);
    setModelId(undefined);
    setMode("text");
    setFiles(NO_MEDIA_FILES);
  };

  const pickModel = async () => {
    const key = await pickOne({
      title: t("mediaGen.model"),
      value: model?.id ?? null,
      options: form.models.map((m) => ({
        key: m.id,
        label: m.label,
        sub: m.description || undefined,
        subLines: 2,
        leading: { kind: "node" as const, node: <ModelLogo id={m.id} label={m.label} size="sm" /> },
      })),
    });
    const next = form.models.find((m) => m.id === key);
    if (!next) return;
    setModelId(next.id);
    choose(next, quality && next.qualities.includes(quality) ? quality : next.defaultQuality, form.mode);
  };
  const pickFrom = async <T extends string | number>(
    title: string,
    values: readonly T[],
    current: T | undefined,
    word: (v: T) => string,
  ): Promise<T | null> => {
    const key = await pickOne({
      title,
      value: current === undefined ? null : String(current),
      options: values.map((v) => ({ key: String(v), label: word(v) })),
    });
    return values.find((v) => String(v) === key) ?? null;
  };
  const pickQuality = async () => {
    const next = await pickFrom(t("mediaGen.quality"), model?.qualities ?? [], form.quality, (v) => v);
    if (next === null) return;
    setQuality(next);
    choose(model, next, form.mode);
  };
  const pickAspect = async () => {
    const next = await pickFrom(t("mediaGen.aspect"), form.aspects, form.aspect, (v) => v);
    if (next !== null) setAspect(next);
  };
  const pickSeconds = async () => {
    const next = await pickFrom(t("mediaGen.seconds"), form.durations, form.seconds, (v) =>
      t("mediaGen.secondsValue", { count: v }),
    );
    if (next !== null) setSeconds(next);
  };
  const modeHint = (m: MediaInputMode) =>
    m === "references"
      ? t("mediaGen.modes.references.hint", {
          list: t("mediaGen.nImages", { count: mediaModeSpec(model, form.quality, m).images }),
        })
      : t(`mediaGen.modes.${m}.hint`);
  const pickMode = async () => {
    const key = await pickOne({
      title: t("mediaGen.input"),
      value: form.mode,
      options: form.modes.map((m) => ({
        key: m,
        label: t(`mediaGen.modes.${m}.label`),
        sub: modeHint(m),
        subLines: 0,
      })),
    });
    const next = form.modes.find((m) => m === key);
    if (next) choose(model, form.quality, next);
  };

  const place = (target: PendingRef["target"], item: MediaRefFile) =>
    setFiles((f) => (target === "images" ? { ...f, images: [...f.images, item] } : { ...f, [target]: item }));
  const remove = (target: PendingRef["target"], token: string) =>
    setFiles((f) =>
      target === "images" ? { ...f, images: f.images.filter((x) => x.token !== token) } : { ...f, [target]: undefined },
    );

  /**
   * Pictures from the library, sent at once and placed in the order they were picked (each waits for the one before
   * it); `target` is the frame slot that asked, else each goes where the mode has room.
   */
  const addPhotos = async (target?: PendingRef["target"]) => {
    const { form: at, pending: waiting } = now.current;
    const room = withPending(at.files, waiting);
    const most = target ? 1 : imageRoom(at.spec, room);
    if (most <= 0) return;
    let res: ImagePicker.ImagePickerResult;
    try {
      res = await ImagePicker.launchImageLibraryAsync({
        mediaTypes: ["images"],
        quality: 0.9,
        allowsMultipleSelection: most > 1,
        selectionLimit: most,
        orderedSelection: true,
      });
    } catch {
      toast({ title: w.photosBlocked, icon: "x" });
      return;
    }
    if (res.canceled) return;
    const fresh = withPending(now.current.form.files, now.current.pending);
    const targets = target ? [target] : imageTargets(now.current.form.spec, fresh, res.assets.length);
    let before: Promise<unknown> = Promise.resolve();
    res.assets.forEach((a, i) => {
      const where = targets[i];
      const name = a.fileName ?? `foto-${i + 1}.jpg`;
      if (!where) {
        toast({ title: t("mediaGen.noRoom", { name }), icon: "x" });
        return;
      }
      if (a.fileSize !== undefined && a.fileSize > MEDIA_REF_LIMITS.image) {
        toast({ title: t("mediaGen.tooLarge", { name, size: MEDIA_REF_LIMITS.image / (1024 * 1024) }), icon: "x" });
        return;
      }
      const id = randomUUID();
      const entry: PendingRef = { id, target: where, uri: a.uri };
      now.current = { ...now.current, pending: [...now.current.pending, entry] };
      setPending((p) => [...p, entry]);
      const job = upload.mutateAsync(filePart(a.uri, name, a.mimeType ?? "image/jpeg") as unknown as File);
      // Its own failure is told below: the chain only waits for its turn.
      job.catch(() => {});
      const after = before;
      before = (async () => {
        try {
          await after.catch(() => {});
          const ref = await job;
          if (ref.kind !== "image") {
            toast({ title: t("mediaGen.wrongKind", { name }), icon: "x" });
            return;
          }
          place(where, { token: ref.ref, kind: "image", name, url: a.uri });
        } catch (error) {
          toast({ title: errorText(t, error, i18n.language), icon: "x" });
        } finally {
          now.current = { ...now.current, pending: now.current.pending.filter((p) => p.id !== id) };
          setPending((p) => p.filter((x) => x.id !== id));
        }
      })();
    });
  };

  const submit = () => {
    if (!model || !ready) return;
    generate.mutate(
      { ...form.ask, model: model.id, prompt: prompt.trim(), clientId: randomUUID() },
      {
        onSuccess: (r) => {
          if (r.generation.status === "failed") {
            toast({ title: r.generation.error ?? t("mediaGen.failed"), icon: "x" });
            return;
          }
          successHaptic();
          toast({ title: t(kind === "image" ? "mediaGen.startedImage" : "mediaGen.startedVideo"), icon: "sparkle" });
          done.current = true;
          goBack("/media");
        },
        onError: (error) => toast({ title: errorText(t, error, i18n.language), icon: "x" }),
      },
    );
  };

  const priceLine = quoting
    ? t("mediaGen.quoting")
    : needsQuote && quote.isError
      ? t("mediaGen.quoteFailed")
      : short && price !== null
        ? t("mediaGen.short", { price: fmt(price), balance: fmt(balance) })
        : form.why
          ? t(`mediaGen.missing.${form.why}`)
          : null;
  const label = generate.isPending
    ? t("mediaGen.generating")
    : price !== null
      ? `${t("mediaGen.generate")} · ${t("mediaGen.credits", { count: price, formatted: fmt(price) })}`
      : t("mediaGen.generate");

  if (!model)
    return (
      <View style={styles.in}>
        <Segmented
          wide
          value={kind}
          onChange={(v) => switchKind(v as MediaGenKind)}
          items={[
            { key: "image", label: t("mediaGen.image") },
            { key: "video", label: t("mediaGen.video") },
          ]}
        />
        <Text tone="muted" style={styles.centerText}>
          {w.noModels}
        </Text>
      </View>
    );

  return (
    <>
      <ScrollView
        contentInsetAdjustmentBehavior="automatic"
        keyboardShouldPersistTaps="handled"
        keyboardDismissMode="interactive"
        automaticallyAdjustKeyboardInsets
        contentContainerStyle={[styles.in, styles.fill]}
      >
        <Locked when={generate.isPending} style={styles.fields}>
          <Segmented
            wide
            value={kind}
            onChange={(v) => switchKind(v as MediaGenKind)}
            items={[
              { key: "image", label: t("mediaGen.image") },
              { key: "video", label: t("mediaGen.video") },
            ]}
          />
          <View>
            <GroupedList>
              <GroupedRow
                leading={<ModelLogo id={model.id} label={model.label} />}
                label={t("mediaGen.model")}
                value={model.label}
                menu
                onPress={() => void pickModel()}
              />
              {kind === "video" && form.modes.length > 1 ? (
                <GroupedRow
                  icon="image"
                  label={t("mediaGen.input")}
                  value={t(`mediaGen.modes.${form.mode}.label`)}
                  menu
                  onPress={() => void pickMode()}
                />
              ) : null}
            </GroupedList>
            {hidesModes(model, form.quality) ? <GroupedFooter>{w.videoRefsOnWeb}</GroupedFooter> : null}
          </View>
          <Pictures form={form} pending={pending} onAdd={(target) => void addPhotos(target)} onRemove={remove} />
          <View>
            <GroupedHeader>{t("mediaGen.prompt")}</GroupedHeader>
            <TextArea
              value={prompt}
              onChangeText={setPrompt}
              placeholder={t("mediaGen.promptExample")}
              accessibilityLabel={t("mediaGen.prompt")}
              minHeight={120}
              limit={PROMPT_LIMIT}
            />
          </View>
          <GroupedList>
            {model.qualities.length > 0 ? (
              <GroupedRow
                icon="sparkle"
                label={t("mediaGen.quality")}
                value={form.quality ?? ""}
                {...(model.qualities.length > 1 ? { menu: true, onPress: () => void pickQuality() } : {})}
              />
            ) : null}
            {form.aspects.length > 0 ? (
              <GroupedRow
                icon="expand"
                label={t("mediaGen.aspect")}
                value={form.aspect ?? ""}
                {...(form.aspects.length > 1 ? { menu: true, onPress: () => void pickAspect() } : {})}
              />
            ) : null}
            {kind === "video" && form.durations.length > 0 && form.seconds !== undefined ? (
              <GroupedRow
                icon="clock"
                label={t("mediaGen.seconds")}
                value={t("mediaGen.secondsValue", { count: form.seconds })}
                {...(form.durations.length > 1 ? { menu: true, onPress: () => void pickSeconds() } : {})}
              />
            ) : null}
            {form.audioChoice ? (
              <GroupedRow icon="sound" label={t("mediaGen.audio")} toggle={audio} onPress={() => setAudio((v) => !v)} />
            ) : null}
          </GroupedList>
        </Locked>
      </ScrollView>
      <View style={[styles.bar, { paddingBottom: insets.bottom + 10, borderTopColor: c.line2 }]}>
        {priceLine ? (
          <Text variant="footnote" tone={short ? "danger" : "muted"} style={styles.centerText}>
            {priceLine}
          </Text>
        ) : null}
        <Button
          variant="primary"
          wide
          label={label}
          loading={generate.isPending}
          disabled={!ready}
          onPress={submit}
          {...(price !== null ? { hint: t("mediaGen.price", { price: fmt(price) }) } : {})}
        />
      </View>
    </>
  );
}

/**
 * The pictures the mode takes: the first and the last frame as slots of their own, the references as a row of
 * thumbnails with "Adicionar foto" while there is room. One on its way shows its local picture under a spinner.
 */
function Pictures({
  form,
  pending,
  onAdd,
  onRemove,
}: {
  form: MediaForm;
  pending: readonly PendingRef[];
  onAdd: (target?: PendingRef["target"]) => void;
  onRemove: (target: PendingRef["target"], token: string) => void;
}) {
  const { t } = useTranslation();
  const { spec, files } = form;
  if (!spec.firstFrame && spec.images === 0) return null;
  const waiting = (target: PendingRef["target"]) => pending.filter((p) => p.target === target);
  const frame = (target: "firstFrame" | "lastFrame", word: string) => {
    const file = files[target];
    const up = waiting(target)[0];
    return (
      <View style={styles.slot}>
        <Text variant="footnote" tone="muted">
          {word}
        </Text>
        {file ? (
          <Thumb uri={file.url} name={file.name} onRemove={() => onRemove(target, file.token)} />
        ) : up ? (
          <Thumb uri={up.uri} name="" busy />
        ) : (
          <AddTile label={`${word} · ${t("mediaGen.required")}`} onPress={() => onAdd(target)} />
        )}
      </View>
    );
  };
  const refsUp = waiting("images");
  const roomLeft = spec.images - files.images.length - refsUp.length;
  return (
    <View>
      {spec.firstFrame ? (
        <>
          <GroupedHeader>
            {spec.lastFrame ? t("mediaGen.modes.frames.label") : t("mediaGen.modes.first.label")}
          </GroupedHeader>
          <View style={styles.row}>
            {frame("firstFrame", t("mediaGen.firstFrameSlot"))}
            {spec.lastFrame ? frame("lastFrame", t("mediaGen.lastFrameSlot")) : null}
          </View>
        </>
      ) : null}
      {spec.images > 0 ? (
        <>
          <GroupedHeader>
            {`${form.model?.kind === "image" ? t("mediaGen.refsOptional") : t("mediaGen.refsLabel")} · ${t("mediaGen.ofMax", { n: files.images.length + refsUp.length, max: spec.images })}`}
          </GroupedHeader>
          <View style={[styles.row, styles.wrap]}>
            {files.images.map((f) => (
              <Thumb key={f.token} uri={f.url} name={f.name} onRemove={() => onRemove("images", f.token)} />
            ))}
            {refsUp.map((p) => (
              <Thumb key={p.id} uri={p.uri} name="" busy />
            ))}
            {roomLeft > 0 ? <AddTile label={t("mediaGen.refsTitle")} onPress={() => onAdd()} /> : null}
          </View>
        </>
      ) : null}
    </View>
  );
}

function Thumb({
  uri,
  name,
  busy = false,
  onRemove,
}: {
  uri: string;
  name: string;
  busy?: boolean;
  onRemove?: () => void;
}) {
  const { t } = useTranslation();
  const c = useColors();
  return (
    <View style={[styles.thumb, { backgroundColor: c.sunken }]}>
      <Image source={{ uri }} style={StyleSheet.absoluteFill} contentFit="cover" />
      {busy ? (
        <View style={[StyleSheet.absoluteFill, styles.busy]} accessibilityLabel={t("mediaGen.uploading")}>
          <ActivityIndicator color="#fff" />
        </View>
      ) : null}
      {onRemove ? (
        <Pressable
          onPress={onRemove}
          accessibilityRole="button"
          accessibilityLabel={t("mediaGen.removeRef", { name })}
          hitSlop={10}
          style={styles.remove}
        >
          <Icon name="x" size={12} color="#fff" />
        </Pressable>
      ) : null}
    </View>
  );
}

function AddTile({ label, onPress }: { label: string; onPress: () => void }) {
  const w = useMediaWords();
  const c = useColors();
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityHint={w.addPhoto}
      style={({ pressed }) => [styles.thumb, styles.add, { borderColor: c.line2 }, pressed && styles.pressed]}
    >
      <Icon name="plus" size={20} color={c.muted} />
    </Pressable>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1 },
  // A form's 16 pt sides, as Nova tarefa's.
  in: { paddingHorizontal: 16, paddingTop: 8, gap: 16 },
  fill: { paddingBottom: 24 },
  fields: { gap: 16 },
  centerText: { textAlign: "center" },
  row: { flexDirection: "row", gap: 12 },
  wrap: { flexWrap: "wrap", gap: 8 },
  slot: { gap: 6 },
  thumb: { width: THUMB, height: THUMB, borderRadius: 8, overflow: "hidden" },
  busy: { alignItems: "center", justifyContent: "center", backgroundColor: "rgba(0,0,0,0.35)" },
  remove: {
    position: "absolute",
    top: 4,
    right: 4,
    width: 20,
    height: 20,
    borderRadius: 10,
    backgroundColor: "rgba(0,0,0,0.6)",
    alignItems: "center",
    justifyContent: "center",
  },
  add: { borderWidth: 1, borderStyle: "dashed", alignItems: "center", justifyContent: "center" },
  pressed: { opacity: 0.6 },
  bar: { paddingHorizontal: 16, paddingTop: 10, gap: 8, borderTopWidth: StyleSheet.hairlineWidth },
});
