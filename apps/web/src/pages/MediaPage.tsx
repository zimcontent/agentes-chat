import {
  fitMediaFiles,
  MEDIA_REF_LIMITS,
  MEDIA_TARGET_KIND,
  type MediaFileSet,
  type MediaFileTarget,
  type MediaGenerationView,
  type MediaGenKind,
  type MediaInputMode,
  type MediaModel,
  type MediaModeSpec,
  type MediaRef,
  type MediaRefFile,
  type MediaRefKind,
  mediaAspects,
  mediaDropTarget,
  mediaMissing,
  mediaModeFor,
  mediaModeSpec,
  mediaModes,
  mediaPrice,
  mediaRequestFiles,
  mediaServiceMode,
  NO_MEDIA_FILES,
  pickMediaMode,
  useDriveMediaRef,
  useGenerateMedia,
  useMediaGenerations,
  useMediaOverview,
  useMediaQuote,
  useMediaTopup,
  useMediaTopupStatus,
  useUploadMediaRef,
} from "@dougbot/client";
import { errorText } from "@dougbot/client/lib/errors";
import {
  Button,
  Dialog,
  DialogBody,
  DialogFooter,
  EmptyState,
  Field,
  FormStack,
  Icon,
  PageHeader,
  Segmented,
  Select,
  Switch,
  Textarea,
} from "@dougbot/ui";
import { useNavigate, useSearch } from "@tanstack/react-router";
import { useEffect, useMemo, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { useApi } from "@/api/context";
import { ArtifactCard } from "@/components/artifacts/ArtifactCard";
import { ErrorState, LoadingCards } from "@/components/Loading";
import { useOrg } from "@/components/org-context";
import { useToast } from "@/lib/toast";
import { dragHasFiles, MediaInput, type PendingFile } from "./media/MediaInput";
import { MediaLibrary } from "./media/MediaLibrary";
import "./media.css";
import { ModelMark } from "./media/ModelMark";

/**
 * Mídia (ADR doug-0011): generate an image or a video with the workspace's credits, see what people and agents made,
 * and top the wallet up through Mercado Pago. The models and prices are the Zim Mídia service's; the server is the only
 * one that talks to it.
 */
export function MediaPage() {
  const { t, i18n } = useTranslation();
  const { org } = useOrg();
  const overview = useMediaOverview(org.id);
  const [buying, setBuying] = useState(false);
  const search = useSearch({ strict: false }) as { topup?: string };
  const navigate = useNavigate();
  const toast = useToast();
  const topup = useMediaTopupStatus(org.id, search.topup ?? null);
  const fmt = (n: number) => n.toLocaleString(i18n.language);

  // Back from Mercado Pago: say how it went once, then drop `?topup` from the address.
  const status = topup.data?.topup.status;
  const credits = topup.data?.topup.credits;
  const announced = useRef<string | null>(null);
  useEffect(() => {
    if (!search.topup || !status || status === "pending" || announced.current === search.topup) return;
    announced.current = search.topup;
    toast.show(
      status === "approved"
        ? t("mediaGen.topup.approved", { credits: (credits ?? 0).toLocaleString(i18n.language) })
        : t("mediaGen.topup.rejected"),
    );
    void navigate({ to: "/org/$orgId/media", params: { orgId: org.id }, search: {}, replace: true });
  }, [search.topup, status, credits, toast, t, i18n.language, navigate, org.id]);

  const data = overview.data;
  return (
    <div className="page page--list media-page">
      <PageHeader
        title={t("mediaGen.title")}
        meta={t("mediaGen.subtitle")}
        actions={
          data && (
            <div className="media-wallet">
              <span className="media-wallet__balance">
                <Icon name="coin" size={16} />
                {t("mediaGen.credits", { count: data.balance, formatted: fmt(data.balance) })}
              </span>
              {data.canTopUp && (
                <Button variant="default" icon="plus" onClick={() => setBuying(true)}>
                  {t("mediaGen.topup.button")}
                </Button>
              )}
            </div>
          )
        }
      />
      {status === "pending" && <p className="media-note">{t("mediaGen.topup.pending")}</p>}
      {overview.isLoading && <LoadingCards count={2} />}
      {overview.isError && !data && <ErrorState error={overview.error} onRetry={() => void overview.refetch()} />}
      {data && (
        <div className="media-layout">
          <MediaForm models={data.models} balance={data.balance} />
          <MediaGallery models={data.models} />
        </div>
      )}
      {data && <TopupDialog open={buying} onOpenChange={setBuying} packs={data.packs} />}
    </div>
  );
}

/** A file's kind from what the browser says, or its name (a dropped file can come without a type). */
function kindOfFile(file: File): MediaRefKind | null {
  if (file.type.startsWith("image/")) return "image";
  if (file.type.startsWith("video/")) return "video";
  if (file.type.startsWith("audio/")) return "audio";
  const ext = file.name.split(".").pop()?.toLowerCase() ?? "";
  if (["jpg", "jpeg", "png", "webp"].includes(ext)) return "image";
  if (["mp4", "mov", "webm"].includes(ext)) return "video";
  if (["mp3", "wav", "m4a", "aac", "ogg"].includes(ext)) return "audio";
  return null;
}

const SINGLE: MediaFileTarget[] = ["firstFrame", "lastFrame", "video"];
const isSingle = (t: MediaFileTarget): t is "firstFrame" | "lastFrame" | "video" => SINGLE.includes(t);

/** The files with the ones on their way counted in, for the room a new drop finds. */
function withPending(files: MediaFileSet, pending: PendingFile[]): MediaFileSet {
  const next: MediaFileSet = {
    ...files,
    images: [...files.images],
    videos: [...files.videos],
    audios: [...files.audios],
  };
  for (const p of pending) {
    const stand: MediaRefFile = { token: p.id, kind: p.kind, name: p.name, url: "" };
    if (isSingle(p.target)) next[p.target] = stand;
    else next[p.target].push(stand);
  }
  return next;
}

function MediaForm({ models, balance }: { models: MediaModel[]; balance: number }) {
  const { t, i18n } = useTranslation();
  const { org } = useOrg();
  const api = useApi();
  const toast = useToast();
  const [kind, setKind] = useState<MediaGenKind>("image");
  const ofKind = models.filter((m) => m.kind === kind);
  const [modelId, setModelId] = useState<string | undefined>(undefined);
  const model = ofKind.find((m) => m.id === modelId) ?? ofKind[0];
  const [quality, setQuality] = useState<string | undefined>(undefined);
  const [aspect, setAspect] = useState<string | undefined>(undefined);
  const [seconds, setSeconds] = useState<string | undefined>(undefined);
  const [audio, setAudio] = useState(true);
  const [prompt, setPrompt] = useState("");
  const [chosenMode, setMode] = useState<MediaInputMode>("text");
  const [stored, setFiles] = useState<MediaFileSet>(NO_MEDIA_FILES);
  const [pending, setPending] = useState<PendingFile[]>([]);
  const [over, setOver] = useState(false);
  const [library, setLibrary] = useState<MediaFileTarget | "refs" | null>(null);
  const upload = useUploadMediaRef(org.id);
  const fromDrive = useDriveMediaRef(org.id);
  const generate = useGenerateMedia(org.id);

  // A choice the new model doesn't have falls back to its own default.
  const q = model && quality && model.qualities.includes(quality) ? quality : model?.defaultQuality;
  const aspects = mediaAspects(model, q);
  // The Zim Studio's default: 16:9 for a video, square for an image, when the model offers it.
  const preferred = kind === "video" ? "16:9" : "1:1";
  const a = aspect && aspects.includes(aspect) ? aspect : aspects.includes(preferred) ? preferred : aspects[0];
  const durations = useMemo(() => {
    const d = model?.durations;
    if (!d) return [];
    if (d.fixed?.length) return d.fixed;
    return Array.from({ length: d.max - d.min + 1 }, (_, i) => d.min + i);
  }, [model]);
  const s =
    seconds && durations.includes(Number(seconds)) ? Number(seconds) : (model?.durations?.default ?? durations[0]);
  const withSound = model?.audio === "always" ? true : model?.audio === "none" ? false : audio;
  const modes = mediaModes(model, q);
  const mode: MediaInputMode = kind === "image" ? "references" : pickMediaMode(model, q, chosenMode);
  const spec = mediaModeSpec(model, q, mode);
  const files = fitMediaFiles(stored, spec);
  // An edit follows its clip: its length and shape are the clip's, so neither is asked (the Studio's rule).
  const clipDecides = mode === "edit";
  const missing = kind === "video" ? mediaMissing(spec, files) : null;
  const ask = {
    model: model?.id ?? "",
    quality: q,
    ...(clipDecides ? {} : { aspect: a }),
    ...(kind === "video" ? { ...(clipDecides ? {} : { seconds: s }), audio: withSound } : {}),
    ...mediaRequestFiles(files),
    // The service works the mode out by itself for a model that lists none.
    ...(kind === "video" && model?.modesByQuality?.[q ?? ""] ? { mode: mediaServiceMode(mode) } : {}),
  };
  // A reference video's price is the service's (it measures the clip): asked as soon as the video is in.
  const needsQuote = Boolean(model && ask.videoRefs?.length && !missing);
  const quote = useMediaQuote(org.id, ask, needsQuote);
  // Shown while something is still missing too, unless only the service can price it (a clip not sent yet).
  const price = needsQuote
    ? (quote.data ?? null)
    : spec.video
      ? null
      : mediaPrice(model, { quality: q, seconds: s, audio: withSound });
  const quoting = needsQuote && quote.isFetching;
  const short = price !== null && price > balance;
  const fmt = (n: number) => n.toLocaleString(i18n.language);
  const why = pending.length ? "uploading" : (missing ?? (prompt.trim() ? null : "prompt"));

  // What the drop and paste handlers read: the latest choice, files and uploads, set as they change.
  const now = useRef({ model, q, mode, spec, files, pending });
  now.current = { model, q, mode, spec, files, pending };

  /** Keeps only what the new choice takes, so a file the new model refuses never rides along unseen. */
  const choose = (next: MediaModel | undefined, nextQuality: string | undefined, wanted: MediaInputMode) => {
    const nextMode = next?.kind === "image" ? "references" : pickMediaMode(next, nextQuality, wanted);
    const nextSpec = mediaModeSpec(next, nextQuality, nextMode);
    setMode(nextMode);
    setFiles((f) => fitMediaFiles(f, nextSpec));
    now.current = { ...now.current, mode: nextMode, spec: nextSpec, files: fitMediaFiles(now.current.files, nextSpec) };
  };
  const chooseModel = (id: string) => {
    const next = ofKind.find((m) => m.id === id);
    setModelId(id);
    choose(next, next && quality && next.qualities.includes(quality) ? quality : next?.defaultQuality, mode);
  };
  const chooseQuality = (value: string) => {
    setQuality(value);
    choose(model, value, mode);
  };
  const switchKind = (next: MediaGenKind) => {
    setKind(next);
    setModelId(undefined);
    setMode("text");
    setFiles(NO_MEDIA_FILES);
  };

  const place = (target: MediaFileTarget, item: MediaRefFile) =>
    setFiles((f) => (isSingle(target) ? { ...f, [target]: item } : { ...f, [target]: [...f[target], item] }));

  /**
   * Sends one file and puts it where it goes, showing it there on its way. Files sent together upload at once but
   * land in the order they were picked: each waits for the one before it (`after`).
   */
  const send = async (
    target: MediaFileTarget,
    kindWanted: MediaRefKind,
    name: string,
    go: () => Promise<MediaRef>,
    url: () => string,
    after: Promise<unknown> = Promise.resolve(),
  ) => {
    const id = crypto.randomUUID();
    const entry: PendingFile = { id, target, kind: kindWanted, name };
    now.current = { ...now.current, pending: [...now.current.pending, entry] };
    setPending((p) => [...p, entry]);
    const job = go();
    // Its own failure is told below: the chain only waits for its turn.
    job.catch(() => {});
    try {
      await after.catch(() => {});
      const ref = await job;
      if (ref.kind !== kindWanted) {
        toast.show(t("mediaGen.wrongKind", { name }));
        return;
      }
      place(target, {
        token: ref.ref,
        kind: ref.kind,
        name,
        url: url(),
        ...(ref.seconds !== undefined ? { seconds: ref.seconds } : {}),
      });
    } catch (error) {
      toast.show(errorText(t, error, i18n.language));
    } finally {
      now.current = { ...now.current, pending: now.current.pending.filter((p) => p.id !== id) };
      setPending((p) => p.filter((x) => x.id !== id));
    }
  };

  /**
   * Files from a slot (`target`), the picker, a drop on the form or a paste. Without a target each goes where its
   * kind goes in the mode as it is; a file the mode takes nothing of switches to the mode that does (a picture
   * dropped on "Vídeo por prompt" opens "Primeiro quadro").
   */
  const addFiles = (list: File[], target?: MediaFileTarget) => {
    let { spec: at } = now.current;
    const { model: m, q: mq } = now.current;
    const kinds = list.map(kindOfFile);
    const takes = (sp: MediaModeSpec, k: MediaRefKind) =>
      k === "image" ? sp.firstFrame || sp.images > 0 : k === "video" ? sp.video || sp.videos > 0 : sp.audios > 0;
    const firstKind = kinds.find((k): k is MediaRefKind => k !== null);
    if (!target && firstKind && m?.kind === "video" && !takes(at, firstKind)) {
      const next = mediaModeFor(m, mq, firstKind);
      if (next) {
        choose(m, mq, next);
        at = now.current.spec;
      }
    }
    let room = withPending(now.current.files, now.current.pending);
    let before: Promise<unknown> = Promise.resolve();
    list.forEach((file, i) => {
      const k = kinds[i];
      if (!k) {
        toast.show(t("mediaGen.wrongKind", { name: file.name }));
        return;
      }
      if (target && MEDIA_TARGET_KIND[target] !== k) {
        toast.show(t("mediaGen.wrongKind", { name: file.name }));
        return;
      }
      const where =
        target && (isSingle(target) || room[target].length < at[target])
          ? target
          : target
            ? null
            : mediaDropTarget(at, room, k);
      if (!where) {
        toast.show(t("mediaGen.noRoom", { name: file.name }));
        return;
      }
      if (file.size > MEDIA_REF_LIMITS[k]) {
        toast.show(t("mediaGen.tooLarge", { name: file.name, size: MEDIA_REF_LIMITS[k] / (1024 * 1024) }));
        return;
      }
      const stand: MediaRefFile = { token: `pending-${i}`, kind: k, name: file.name, url: "" };
      room = isSingle(where) ? { ...room, [where]: stand } : { ...room, [where]: [...room[where], stand] };
      before = send(
        where,
        k,
        file.name,
        () => upload.mutateAsync(file),
        () => URL.createObjectURL(file),
        before,
      );
    });
  };
  const add = useRef(addFiles);
  add.current = addFiles;

  // Ctrl/Cmd+V with a picture (or a clip, a sound) anywhere on the page puts it where it goes.
  useEffect(() => {
    const onPaste = (e: ClipboardEvent) => {
      const list = Array.from(e.clipboardData?.files ?? []).filter((f) => kindOfFile(f) !== null);
      if (!list.length) return;
      e.preventDefault();
      add.current(list);
    };
    document.addEventListener("paste", onPaste);
    return () => document.removeEventListener("paste", onPaste);
  }, []);

  /** A generation from the library: the server sends its Drive file to the service. */
  const pickFromLibrary = (g: MediaGenerationView & { artifactId: string }) => {
    const target = library;
    setLibrary(null);
    const k: MediaRefKind = g.kind;
    const { spec: at } = now.current;
    const room = withPending(now.current.files, now.current.pending);
    const where = target && target !== "refs" ? target : mediaDropTarget(at, room, k);
    if (!where) {
      toast.show(t("mediaGen.noRoom", { name: g.prompt }));
      return;
    }
    const name = fileTitleOf(g);
    void send(
      where,
      k,
      name,
      () => fromDrive.mutateAsync(g.artifactId),
      () => api.artifacts.fileUrl(org.id, g.artifactId),
    );
  };
  const libraryKinds: MediaRefKind[] =
    library === null
      ? []
      : library === "refs"
        ? (["image", "video"] as const).filter((k) => (k === "image" ? spec.images : spec.videos) > 0)
        : [MEDIA_TARGET_KIND[library]];

  const remove = (target: MediaFileTarget, token: string) =>
    setFiles((f) =>
      isSingle(target) ? { ...f, [target]: undefined } : { ...f, [target]: f[target].filter((x) => x.token !== token) },
    );
  const swap = () => setFiles((f) => ({ ...f, firstFrame: f.lastFrame, lastFrame: f.firstFrame }));
  const reorder = (target: "images" | "videos" | "audios", from: string, to: string) =>
    setFiles((f) => {
      const items = [...f[target]];
      const i = items.findIndex((x) => x.token === from);
      const j = items.findIndex((x) => x.token === to);
      if (i < 0 || j < 0) return f;
      const [moved] = items.splice(i, 1);
      if (moved) items.splice(j, 0, moved);
      return { ...f, [target]: items };
    });

  const submit = () => {
    if (!model || why) return;
    generate.mutate(
      { ...ask, model: model.id, prompt: prompt.trim(), clientId: crypto.randomUUID() },
      {
        onSuccess: (r) =>
          toast.show(
            r.generation.status === "failed"
              ? (r.generation.error ?? t("mediaGen.failed"))
              : t(kind === "image" ? "mediaGen.startedImage" : "mediaGen.startedVideo"),
          ),
        onError: (error) => toast.show(errorText(t, error, i18n.language)),
      },
    );
  };

  return (
    <section
      className="ac-card media-form"
      aria-label={t("mediaGen.form")}
      // The whole form takes a dropped file; each slot inside takes one for itself first.
      onDragOver={(e) => {
        if (!dragHasFiles(e)) return;
        e.preventDefault();
        if (!over) setOver(true);
      }}
      onDragLeave={(e) => {
        if (e.currentTarget.contains(e.relatedTarget as Node | null)) return;
        setOver(false);
      }}
      onDrop={(e) => {
        if (!dragHasFiles(e)) return;
        e.preventDefault();
        setOver(false);
        addFiles(Array.from(e.dataTransfer.files));
      }}
    >
      <Segmented
        block
        label={t("mediaGen.kind")}
        value={kind}
        onValueChange={switchKind}
        options={[
          { value: "image", label: t("mediaGen.image") },
          { value: "video", label: t("mediaGen.video") },
        ]}
      />
      <FormStack>
        <Field label={t("mediaGen.model")}>
          <Select
            value={model?.id}
            onValueChange={chooseModel}
            options={ofKind.map((m) => ({
              value: m.id,
              label: m.label,
              leading: <ModelMark id={m.id} label={m.label} />,
            }))}
          />
        </Field>
        <MediaInput
          kind={kind}
          modes={modes}
          mode={mode}
          spec={spec}
          refsSpec={mediaModeSpec(model, q, "references")}
          files={files}
          pending={pending}
          aspect={a}
          over={over}
          onMode={(next) => choose(model, q, next)}
          onFiles={addFiles}
          onRemove={remove}
          onSwap={swap}
          onReorder={reorder}
          onLibrary={setLibrary}
        />
        <Field label={t("mediaGen.prompt")} example={t("mediaGen.promptExample")}>
          <Textarea value={prompt} onChange={(e) => setPrompt(e.target.value)} rows={4} maxLength={4000} />
        </Field>
        <div className="media-form__row">
          <Field label={t("mediaGen.quality")}>
            <Select
              value={q}
              onValueChange={chooseQuality}
              options={(model?.qualities ?? []).map((v) => ({ value: v, label: v }))}
            />
          </Field>
          {!clipDecides && (
            <Field label={t("mediaGen.aspect")}>
              <Select value={a} onValueChange={setAspect} options={aspects.map((v) => ({ value: v, label: v }))} />
            </Field>
          )}
          {kind === "video" && !clipDecides && (
            <Field label={t("mediaGen.seconds")}>
              <Select
                value={String(s)}
                onValueChange={setSeconds}
                options={durations.map((d) => ({ value: String(d), label: t("mediaGen.secondsValue", { count: d }) }))}
              />
            </Field>
          )}
        </div>
        {kind === "video" && model?.audio === "optional" && (
          <div className="media-form__switch">
            <span id="media-audio">{t("mediaGen.audio")}</span>
            <Switch checked={audio} onCheckedChange={setAudio} aria-label={t("mediaGen.audio")} />
          </div>
        )}
      </FormStack>
      <div className="media-form__foot">
        {why && <p className="media-form__why">{t(`mediaGen.missing.${why}`)}</p>}
        <div className="media-form__go">
          <span className={short ? "media-form__price media-form__price--short" : "media-form__price"}>
            {quoting
              ? t("mediaGen.quoting")
              : needsQuote && quote.isError
                ? t("mediaGen.quoteFailed")
                : price === null
                  ? ""
                  : short
                    ? t("mediaGen.short", { price: fmt(price), balance: fmt(balance) })
                    : t("mediaGen.price", { price: fmt(price) })}
          </span>
          <Button
            variant="primary"
            icon="bolt"
            disabled={!model || why !== null || short || quoting || generate.isPending}
            onClick={submit}
          >
            {generate.isPending ? t("mediaGen.generating") : t("mediaGen.generate")}
          </Button>
        </div>
      </div>
      <MediaLibrary
        open={library !== null}
        onOpenChange={(open) => !open && setLibrary(null)}
        kinds={libraryKinds}
        onPick={pickFromLibrary}
      />
    </section>
  );
}

/** A generation's name as a reference: its prompt, whole (the caption wraps it). */
function fileTitleOf(g: MediaGenerationView): string {
  return g.prompt.replace(/\s+/g, " ").trim() || g.id;
}

function MediaGallery({ models }: { models: MediaModel[] }) {
  const { t } = useTranslation();
  const { org } = useOrg();
  const [scope, setScope] = useState<"mine" | "all">("mine");
  const list = useMediaGenerations(org.id, scope === "mine");
  const label = (id: string) => models.find((m) => m.id === id)?.label ?? id;
  return (
    <section className="media-gallery" aria-label={t("mediaGen.gallery")}>
      <Segmented
        label={t("mediaGen.gallery")}
        value={scope}
        onValueChange={setScope}
        options={[
          { value: "mine", label: t("mediaGen.mine") },
          { value: "all", label: t("mediaGen.all") },
        ]}
      />
      {list.isLoading && <LoadingCards count={2} />}
      {list.isError && <ErrorState error={list.error} onRetry={() => void list.refetch()} />}
      {list.data && list.data.length === 0 && (
        <EmptyState title={t("mediaGen.empty.title")}>{t("mediaGen.empty.text")}</EmptyState>
      )}
      {list.data && list.data.length > 0 && (
        <ul className="media-grid">
          {list.data.map((g) => (
            <GenerationItem key={g.id} g={g} label={label(g.model)} />
          ))}
        </ul>
      )}
    </section>
  );
}

function GenerationItem({ g, label }: { g: MediaGenerationView; label: string }) {
  const { t, i18n } = useTranslation();
  const facts = [
    label,
    g.options.quality,
    g.kind === "video" && g.options.seconds ? t("mediaGen.secondsValue", { count: g.options.seconds }) : null,
    t("mediaGen.credits", { count: g.credits, formatted: g.credits.toLocaleString(i18n.language) }),
  ]
    .filter(Boolean)
    .join(" · ");
  return (
    <li className="media-item">
      {g.status === "succeeded" && g.artifactId ? (
        <ArtifactCard artifact={{ id: g.artifactId, version: 1 }} />
      ) : (
        <div className={`media-item__state media-item__state--${g.status}`} role="status">
          <Icon name={g.status === "failed" ? "alert" : g.kind === "video" ? "video" : "image"} size={16} />
          <span>
            {g.status === "failed"
              ? (g.error ?? t("mediaGen.failed"))
              : t(g.kind === "video" ? "mediaGen.runningVideo" : "mediaGen.runningImage")}
          </span>
        </div>
      )}
      <p className="media-item__prompt">{g.prompt}</p>
      <p className="media-item__facts">{facts}</p>
    </li>
  );
}

function TopupDialog({
  open,
  onOpenChange,
  packs,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  packs: { id: string; brl: number; credits: number; highlight?: boolean }[];
}) {
  const { t, i18n } = useTranslation();
  const { org } = useOrg();
  const toast = useToast();
  const buy = useMediaTopup(org.id);
  const [pack, setPack] = useState<string | undefined>(packs.find((p) => p.highlight)?.id ?? packs[0]?.id);
  const brl = (n: number) => n.toLocaleString(i18n.language, { style: "currency", currency: "BRL" });
  const go = () => {
    if (!pack) return;
    // Opened at the click, so the browser doesn't block it; the checkout's address fills it once the server answers.
    const tab = window.open("about:blank", "_blank");
    buy.mutate(pack, {
      onSuccess: ({ checkoutUrl }) => {
        if (tab) tab.location.href = checkoutUrl;
        else window.location.href = checkoutUrl;
        onOpenChange(false);
      },
      onError: (error) => {
        tab?.close();
        toast.show(errorText(t, error, i18n.language));
      },
    });
  };
  return (
    <Dialog
      open={open}
      onOpenChange={onOpenChange}
      title={t("mediaGen.topup.title")}
      closeLabel={t("common.close")}
      description={t("mediaGen.topup.text")}
    >
      <DialogBody>
        <div className="media-packs">
          {packs.map((p) => (
            <button
              key={p.id}
              type="button"
              aria-pressed={pack === p.id}
              className="media-pack"
              onClick={() => setPack(p.id)}
            >
              <span className="media-pack__credits">
                {t("mediaGen.credits", { count: p.credits, formatted: p.credits.toLocaleString(i18n.language) })}
              </span>
              <span className="media-pack__price">{brl(p.brl)}</span>
            </button>
          ))}
        </div>
      </DialogBody>
      <DialogFooter>
        <Button variant="default" onClick={() => onOpenChange(false)}>
          {t("common.cancel")}
        </Button>
        <Button variant="primary" disabled={!pack || buy.isPending} onClick={go}>
          {t("mediaGen.topup.pay")}
        </Button>
      </DialogFooter>
    </Dialog>
  );
}
