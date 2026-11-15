import {
  type MediaGenerationView,
  type MediaGenKind,
  type MediaModel,
  mediaPrice,
  useGenerateMedia,
  useMediaGenerations,
  useMediaOverview,
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
  const [refs, setRefs] = useState<{ token: string; url: string; name: string }[]>([]);
  const upload = useUploadMediaRef(org.id);
  const generate = useGenerateMedia(org.id);
  const fileInput = useRef<HTMLInputElement>(null);

  // A choice the new model doesn't have falls back to its own default.
  const q = model && quality && model.qualities.includes(quality) ? quality : model?.defaultQuality;
  const a = model && aspect && model.aspects.includes(aspect) ? aspect : model?.aspects[0];
  const durations = useMemo(() => {
    const d = model?.durations;
    if (!d) return [];
    if (d.fixed?.length) return d.fixed;
    return Array.from({ length: d.max - d.min + 1 }, (_, i) => d.min + i);
  }, [model]);
  const s =
    seconds && durations.includes(Number(seconds)) ? Number(seconds) : (model?.durations?.default ?? durations[0]);
  const withSound = model?.audio === "always" ? true : model?.audio === "none" ? false : audio;
  const price = mediaPrice(model, { quality: q, seconds: s, audio: withSound });
  const maxRefs = kind === "image" ? (model?.maxRefs ?? 0) : model?.firstFrame ? 1 : 0;
  const short = price !== null && price > balance;
  const fmt = (n: number) => n.toLocaleString(i18n.language);

  const pick = async (files: FileList | null) => {
    for (const file of Array.from(files ?? []).slice(0, Math.max(0, maxRefs - refs.length))) {
      try {
        const token = await upload.mutateAsync(file);
        setRefs((r) => [...r, { token, url: URL.createObjectURL(file), name: file.name }]);
      } catch (error) {
        toast.show(errorText(t, error, i18n.language));
      }
    }
  };
  const switchKind = (next: MediaGenKind) => {
    setKind(next);
    setModelId(undefined);
    setRefs([]);
  };
  const submit = () => {
    if (!model || !prompt.trim()) return;
    generate.mutate(
      {
        model: model.id,
        prompt: prompt.trim(),
        quality: q,
        aspect: a,
        ...(kind === "video" ? { seconds: s, audio: withSound } : {}),
        ...(kind === "image" ? { refs: refs.map((r) => r.token) } : refs[0] ? { firstFrame: refs[0].token } : {}),
        clientId: crypto.randomUUID(),
      },
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
            onValueChange={setModelId}
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
              onValueChange={setQuality}
              options={(model?.qualities ?? []).map((v) => ({ value: v, label: v }))}
            />
          </Field>
          <Field label={t("mediaGen.aspect")}>
            <Select
              value={a}
              onValueChange={setAspect}
              options={(model?.aspects ?? []).map((v) => ({ value: v, label: v }))}
            />
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
        {maxRefs > 0 && (
          <Field label={kind === "image" ? t("mediaGen.refs", { count: maxRefs }) : t("mediaGen.firstFrame")} group>
            <div className="media-refs">
              {refs.map((r) => (
                <figure key={r.token} className="media-refs__item">
                  <img src={r.url} alt={r.name} />
                  <button
                    type="button"
                    className="media-refs__remove"
                    aria-label={t("mediaGen.removeRef", { name: r.name })}
                    onClick={() => setRefs((all) => all.filter((x) => x.token !== r.token))}
                  >
                    <Icon name="close" size={16} />
                  </button>
                </figure>
              ))}
              {refs.length < maxRefs && (
                <Button
                  variant="default"
                  icon="plus"
                  disabled={upload.isPending}
                  onClick={() => fileInput.current?.click()}
                >
                  {upload.isPending ? t("mediaGen.uploading") : t("mediaGen.addRef")}
                </Button>
              )}
              <input
                ref={fileInput}
                type="file"
                accept="image/jpeg,image/png,image/webp"
                multiple={kind === "image"}
                hidden
                onChange={(e) => {
                  void pick(e.target.files);
                  e.target.value = "";
                }}
              />
            </div>
          </Field>
        )}
      </FormStack>
      <div className="media-form__foot ac-actline">
        <span className={short ? "media-form__price media-form__price--short" : "media-form__price"}>
          {price === null
            ? ""
            : short
              ? t("mediaGen.short", { price: fmt(price), balance: fmt(balance) })
              : t("mediaGen.price", { price: fmt(price) })}
        </span>
        <Button
          variant="primary"
          icon="bolt"
          disabled={!prompt.trim() || !model || short || generate.isPending}
          onClick={submit}
        >
          {generate.isPending ? t("mediaGen.generating") : t("mediaGen.generate")}
        </Button>
      </div>
    </section>
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
