import {
  fitMediaFiles,
  MEDIA_REF_ACCEPT,
  MEDIA_REF_LIMITS,
  type MediaFileSet,
  type MediaFileSide,
  type MediaGenerationView,
  type MediaGenKind,
  type MediaModel,
  type MediaRefFile,
  type MediaRefKind,
  mediaAspects,
  mediaInputs,
  mediaPrice,
  NO_MEDIA_FILES,
  useGenerateMedia,
  useMediaGenerations,
  useMediaOverview,
  useMediaQuote,
  useMediaTopup,
  useMediaTopupStatus,
  useUploadMediaRef,
} from "@agenteschat/client";
import { errorText } from "@agenteschat/client/lib/errors";
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
} from "@agenteschat/ui";
import { useNavigate, useSearch } from "@tanstack/react-router";
import { useEffect, useMemo, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { ArtifactCard } from "@/components/artifacts/ArtifactCard";
import { ErrorState, LoadingCards } from "@/components/Loading";
import { useOrg } from "@/components/org-context";
import { useToast } from "@/lib/toast";
import "./media.css";

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

/** Where a file goes in the request. Frames and reference images are pictures. */
type FileRole = "firstFrame" | "lastFrame" | "images" | "videos" | "audios";
const ROLE_KIND: Record<FileRole, MediaRefKind> = {
  firstFrame: "image",
  lastFrame: "image",
  images: "image",
  videos: "video",
  audios: "audio",
};

function MediaForm({ models, balance }: { models: MediaModel[]; balance: number }) {
  const { t, i18n } = useTranslation();
  const { org } = useOrg();
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
  const [stored, setFiles] = useState<MediaFileSet>(NO_MEDIA_FILES);
  const [side, setSide] = useState<MediaFileSide>("frames");
  const [busy, setBusy] = useState<FileRole | null>(null);
  const upload = useUploadMediaRef(org.id);
  const generate = useGenerateMedia(org.id);

  // A choice the new model doesn't have falls back to its own default.
  const q = model && quality && model.qualities.includes(quality) ? quality : model?.defaultQuality;
  const aspects = mediaAspects(model, q);
  const a = aspect && aspects.includes(aspect) ? aspect : aspects[0];
  const durations = useMemo(() => {
    const d = model?.durations;
    if (!d) return [];
    if (d.fixed?.length) return d.fixed;
    return Array.from({ length: d.max - d.min + 1 }, (_, i) => d.min + i);
  }, [model]);
  const s =
    seconds && durations.includes(Number(seconds)) ? Number(seconds) : (model?.durations?.default ?? durations[0]);
  const withSound = model?.audio === "always" ? true : model?.audio === "none" ? false : audio;
  const limits = mediaInputs(model, q);
  const anyRefs = limits.images + limits.videos + limits.audios > 0;
  // With a model that takes frames or references, the person picks which; without, both show.
  const choosing = limits.framesOrRefs && limits.firstFrame && anyRefs;
  const files = fitMediaFiles(stored, limits, side);
  const showFrames = limits.firstFrame && (!choosing || side === "frames");
  const showRefs = !choosing || side === "refs";
  const tokens = {
    ...(files.images.length ? { refs: files.images.map((f) => f.token) } : {}),
    ...(files.firstFrame ? { firstFrame: files.firstFrame.token } : {}),
    ...(files.lastFrame ? { lastFrame: files.lastFrame.token } : {}),
    ...(files.videos.length ? { videoRefs: files.videos.map((f) => f.token) } : {}),
    ...(files.audios.length ? { audioRefs: files.audios.map((f) => f.token) } : {}),
  };
  const ask = {
    model: model?.id ?? "",
    quality: q,
    aspect: a,
    ...(kind === "video" ? { seconds: s, audio: withSound } : {}),
    ...tokens,
  };
  // A reference video's price is the service's (it measures the clip): asked as soon as the video is in.
  const needsQuote = Boolean(model && files.videos.length);
  const quote = useMediaQuote(org.id, ask, needsQuote);
  const price = needsQuote ? (quote.data ?? null) : mediaPrice(model, { quality: q, seconds: s, audio: withSound });
  const quoting = needsQuote && quote.isFetching;
  const short = price !== null && price > balance;
  const fmt = (n: number) => n.toLocaleString(i18n.language);

  /** Keeps only what the new choice takes, so a file the new model refuses never rides along unseen. */
  const refit = (next: MediaModel | undefined, nextQuality: string | undefined, nextSide: MediaFileSide) =>
    setFiles((f) => fitMediaFiles(f, mediaInputs(next, nextQuality), nextSide));
  const chooseModel = (id: string) => {
    const next = ofKind.find((m) => m.id === id);
    setModelId(id);
    refit(next, next && quality && next.qualities.includes(quality) ? quality : next?.defaultQuality, side);
  };
  const chooseQuality = (value: string) => {
    setQuality(value);
    refit(model, value, side);
  };
  const chooseSide = (value: MediaFileSide) => {
    setSide(value);
    refit(model, q, value);
  };
  const switchKind = (next: MediaGenKind) => {
    setKind(next);
    setModelId(undefined);
    setFiles(NO_MEDIA_FILES);
  };

  const room = (role: FileRole) =>
    role === "firstFrame" || role === "lastFrame"
      ? files[role]
        ? 0
        : 1
      : Math.max(0, limits[role] - files[role].length);
  const pick = async (role: FileRole, list: FileList | null) => {
    const want = ROLE_KIND[role];
    setBusy(role);
    try {
      for (const file of Array.from(list ?? []).slice(0, room(role))) {
        if (file.size > MEDIA_REF_LIMITS[want]) {
          toast.show(t("mediaGen.tooLarge", { name: file.name, size: MEDIA_REF_LIMITS[want] / (1024 * 1024) }));
          continue;
        }
        try {
          const ref = await upload.mutateAsync(file);
          if (ref.kind !== want) {
            toast.show(t("mediaGen.wrongKind", { name: file.name }));
            continue;
          }
          const item: MediaRefFile = {
            token: ref.ref,
            kind: ref.kind,
            name: file.name,
            url: URL.createObjectURL(file),
            ...(ref.seconds !== undefined ? { seconds: ref.seconds } : {}),
          };
          setFiles((f) =>
            role === "firstFrame" || role === "lastFrame"
              ? { ...f, [role]: item }
              : { ...f, [role]: [...f[role], item] },
          );
        } catch (error) {
          toast.show(errorText(t, error, i18n.language));
        }
      }
    } finally {
      setBusy(null);
    }
  };
  const remove = (role: FileRole, token: string) =>
    setFiles((f) => {
      if (role === "firstFrame") return { ...f, firstFrame: undefined, lastFrame: undefined };
      if (role === "lastFrame") return { ...f, lastFrame: undefined };
      return { ...f, [role]: f[role].filter((x) => x.token !== token) };
    });
  const slot = (role: FileRole, label: string, max: number, addLabel: string) => (
    <RefSlot
      label={label}
      kind={ROLE_KIND[role]}
      items={role === "firstFrame" || role === "lastFrame" ? (files[role] ? [files[role]] : []) : files[role]}
      max={max}
      busy={busy === role}
      disabled={busy !== null && busy !== role}
      addLabel={addLabel}
      onPick={(list) => void pick(role, list)}
      onRemove={(token) => remove(role, token)}
    />
  );

  const submit = () => {
    if (!model || !prompt.trim()) return;
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
    <section className="ac-card media-form" aria-label={t("mediaGen.form")}>
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
            options={ofKind.map((m) => ({ value: m.id, label: m.label, description: m.description }))}
          />
        </Field>
        <Field label={t("mediaGen.prompt")} example={t("mediaGen.promptExample")}>
          <Textarea value={prompt} onChange={(e) => setPrompt(e.target.value)} rows={5} maxLength={4000} />
        </Field>
        <div className="media-form__row">
          <Field label={t("mediaGen.quality")}>
            <Select
              value={q}
              onValueChange={chooseQuality}
              options={(model?.qualities ?? []).map((v) => ({ value: v, label: v }))}
            />
          </Field>
          <Field label={t("mediaGen.aspect")}>
            <Select value={a} onValueChange={setAspect} options={aspects.map((v) => ({ value: v, label: v }))} />
          </Field>
          {kind === "video" && (
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
        {choosing && (
          <Field
            label={t("mediaGen.side")}
            group
            hint={{ name: t("mediaGen.side"), text: t("mediaGen.sideHint", { model: model?.label ?? "" }) }}
          >
            <Segmented
              block
              label={t("mediaGen.side")}
              value={side}
              onValueChange={chooseSide}
              options={[
                { value: "frames", label: t("mediaGen.sideFrames") },
                { value: "refs", label: t("mediaGen.sideRefs") },
              ]}
            />
          </Field>
        )}
        {showFrames && (
          <div className="media-form__row">
            {slot("firstFrame", t("mediaGen.firstFrame"), 1, t("mediaGen.addRef"))}
            {limits.lastFrame &&
              files.firstFrame &&
              slot("lastFrame", t("mediaGen.lastFrame"), 1, t("mediaGen.addRef"))}
          </div>
        )}
        {showRefs &&
          limits.images > 0 &&
          slot("images", t("mediaGen.refs", { count: limits.images }), limits.images, t("mediaGen.addRef"))}
        {showRefs &&
          limits.videos > 0 &&
          slot("videos", t("mediaGen.videoRefs", { count: limits.videos }), limits.videos, t("mediaGen.addVideo"))}
        {showRefs &&
          limits.audios > 0 &&
          slot("audios", t("mediaGen.audioRefs", { count: limits.audios }), limits.audios, t("mediaGen.addAudio"))}
      </FormStack>
      <div className="media-form__foot ac-actline">
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
          disabled={!prompt.trim() || !model || short || quoting || busy !== null || generate.isPending}
          onClick={submit}
        >
          {generate.isPending ? t("mediaGen.generating") : t("mediaGen.generate")}
        </Button>
      </div>
    </section>
  );
}

/** One kind of file the request takes: what was sent, each with a way out, and a button while there's room. */
function RefSlot({
  label,
  kind,
  items,
  max,
  busy,
  disabled,
  addLabel,
  onPick,
  onRemove,
}: {
  label: string;
  kind: MediaRefKind;
  items: MediaRefFile[];
  max: number;
  busy: boolean;
  disabled: boolean;
  addLabel: string;
  onPick: (files: FileList | null) => void;
  onRemove: (token: string) => void;
}) {
  const { t } = useTranslation();
  const input = useRef<HTMLInputElement>(null);
  return (
    <Field label={label} group>
      <div className="media-refs">
        {items.map((r) => (
          <figure key={r.token} className={`media-refs__item media-refs__item--${r.kind}`}>
            {r.kind === "image" && <img src={r.url} alt={r.name} />}
            {r.kind === "video" && <video src={r.url} muted playsInline preload="metadata" aria-label={r.name} />}
            {r.kind === "audio" && (
              <span className="media-refs__audio" role="img" aria-label={r.name}>
                <Icon name="sound" size={16} />
                {r.seconds !== undefined && <span>{t("mediaGen.secondsValue", { count: Math.round(r.seconds) })}</span>}
              </span>
            )}
            {r.kind === "video" && r.seconds !== undefined && (
              <span className="media-refs__seconds">
                {t("mediaGen.secondsValue", { count: Math.round(r.seconds) })}
              </span>
            )}
            <button
              type="button"
              className="media-refs__remove"
              aria-label={t("mediaGen.removeRef", { name: r.name })}
              onClick={() => onRemove(r.token)}
            >
              <Icon name="close" size={16} />
            </button>
          </figure>
        ))}
        {items.length < max && (
          <Button variant="default" icon="plus" disabled={busy || disabled} onClick={() => input.current?.click()}>
            {busy ? t("mediaGen.uploading") : addLabel}
          </Button>
        )}
        <input
          ref={input}
          type="file"
          accept={MEDIA_REF_ACCEPT[kind]}
          multiple={max - items.length > 1}
          hidden
          onChange={(e) => {
            onPick(e.target.files);
            e.target.value = "";
          }}
        />
      </div>
    </Field>
  );
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
