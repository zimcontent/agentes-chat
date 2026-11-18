import {
  type BrandInput,
  type BrandView,
  brandFields,
  brandMissing,
  keys,
  useBrand,
} from "@agenteschat/client";
import { errorText } from "@agenteschat/client/lib/errors";
import { Button, ChipButton, Field, Icon, Input, Locked, Textarea } from "@agenteschat/ui";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { useApi } from "@/api/context";
import "./brand-step.css";

/** What `GET …/brand` answers, as the step holds it (the hook's `data`, and what it keeps after a save). */
type BrandData = NonNullable<ReturnType<typeof useBrand>["data"]>;

/**
 * "Ensine a sua marca ao time" (docs/adr/doug-0020-time-doug.md), required once the Doug team was made: the company's
 * name and tone of voice are required, the site, the profile, the audience and the brand manual (a file, in the Drive,
 * or a link) optional. It saves the workspace skill "Marca <empresa>" (`orgs.saveBrand`), which ROSA, SONY, the Social
 * Media and CHESS read; the server refuses to finish the onboarding while it waits (`onboarding.brand_pending`).
 */
export function BrandStep({
  orgId,
  state,
  onSaved,
}: {
  orgId: string;
  /** The step's data: the brand already said, the tones to tap, and whether it still waits. */
  state: BrandData | undefined;
  /** Saved (or the workspace's brand already was): the step is answered. */
  onSaved: () => void;
}) {
  const { t, i18n } = useTranslation();
  const api = useApi();
  const qc = useQueryClient();
  const saved = state?.brand ?? null;
  const [company, setCompany] = useState(() => brandFields(saved).company);
  const [tones, setTones] = useState<ReadonlySet<string>>(() => new Set());
  const [tone, setTone] = useState("");
  const [site, setSite] = useState("");
  const [instagram, setInstagram] = useState("");
  const [audience, setAudience] = useState("");
  const [files, setFiles] = useState<BrandView["files"]>([]);
  const [links, setLinks] = useState<string[]>([]);
  const [link, setLink] = useState("");
  const [uploading, setUploading] = useState(false);
  const [linkOpen, setLinkOpen] = useState(false);
  // The person's own words: the field open, and a tone tapped before it stays picked only if both are used.
  const [writing, setWriting] = useState(false);
  const started = useRef(false);
  // What the server had: `GET …/brand` is read once, and the fields start from it (a step gone back to).
  useEffect(() => {
    if (started.current || !state) return;
    started.current = true;
    const had = brandFields(saved);
    setCompany(had.company);
    setTones(had.tones);
    setTone(had.tone);
    setWriting(had.tone !== "");
    setSite(had.site);
    setInstagram(had.instagram);
    setAudience(had.audience);
    setFiles(had.files);
    setLinks(had.links);
  }, [state, saved]);
  const tonePicked = [...tones];
  // A tapped tone asked for a written one of its own: what the person types is kept, an empty field is not.
  const custom = writing && tone.trim() !== "";
  const input: BrandInput = {
    company: company.trim(),
    tones: tonePicked,
    tone: custom ? tone.trim() : null,
    site: site.trim() || null,
    instagram: instagram.trim() || null,
    audience: audience.trim() || null,
    files: files.map((f) => f.id),
    links,
  };
  // Required: a name and a tone (tapped or written). Everything else may stay empty.
  const ready = brandMissing(input) === null;
  const save = useMutation({
    meta: { silent: true },
    mutationFn: () => api.orgs.saveBrand(orgId, input),
    onSuccess: (out) => {
      // The answer is the step's own data: a later visit reads it as said.
      qc.setQueryData(keys.brand(orgId, i18n.language), {
        pending: out.pending,
        brand: out.brand,
        skillId: out.skillId,
        tones: state?.tones ?? [],
      } satisfies BrandData);
      // The team's agents now read the skill: their pages and the team list say it.
      void qc.invalidateQueries({ queryKey: keys.agents(orgId) });
      void qc.invalidateQueries({ queryKey: keys.skills(orgId) });
      onSaved();
    },
  });
  const filesInput = useRef<HTMLInputElement>(null);
  const addFiles = async (picked: FileList | null) => {
    if (!picked || picked.length === 0) return;
    setUploading(true);
    try {
      for (const file of [...picked]) {
        const kept = await api.artifacts.upload(orgId, file, { title: file.name });
        setFiles((was) => [...was, { id: kept.id, title: kept.title }]);
      }
    } finally {
      setUploading(false);
      if (filesInput.current) filesInput.current.value = "";
    }
  };
  const addLink = () => {
    const text = link.trim();
    if (!text) return;
    setLinks((was) => [...was, text]);
    setLink("");
    setLinkOpen(false);
  };
  return (
    <>
      <Locked when={save.isPending || uploading}>
        <div className="onb__answer onb-brand">
          <div className="onb-brand__grid">
            <Field label={t("onboarding.flow.brand.company")}>
              <Input
                value={company}
                onChange={(e) => setCompany(e.target.value)}
                placeholder={t("onboarding.flow.brand.companyPlaceholder")}
                maxLength={120}
                required
                spellCheck={false}
                autoFocus
              />
            </Field>
            <Field label={t("onboarding.flow.brand.site")}>
              <Input
                value={site}
                onChange={(e) => setSite(e.target.value)}
                inputMode="url"
                maxLength={500}
                spellCheck={false}
              />
            </Field>
            <Field label={t("onboarding.flow.brand.instagram")}>
              <Input
                value={instagram}
                onChange={(e) => setInstagram(e.target.value)}
                placeholder={t("onboarding.flow.brand.instagramPlaceholder")}
                maxLength={200}
                spellCheck={false}
              />
            </Field>
            <Field label={t("onboarding.flow.brand.audience")}>
              <Input
                value={audience}
                onChange={(e) => setAudience(e.target.value)}
                placeholder={t("onboarding.flow.brand.audiencePlaceholder")}
                maxLength={2000}
              />
            </Field>
          </div>
          <Field label={t("onboarding.flow.brand.tone")} group>
            <div className="onb-brand__tones">
              {(state?.tones ?? []).map((tone) => (
                <ChipButton
                  key={tone.id}
                  aria-pressed={tones.has(tone.id)}
                  className="tp-chip"
                  onClick={() =>
                    setTones((was) => {
                      const next = new Set(was);
                      if (next.has(tone.id)) next.delete(tone.id);
                      else next.add(tone.id);
                      return next;
                    })
                  }
                >
                  {tone.label}
                </ChipButton>
              ))}
              <ChipButton aria-pressed={writing} className="tp-chip" icon="edit" onClick={() => setWriting((w) => !w)}>
                {t("onboarding.flow.brand.toneOwn")}
              </ChipButton>
            </div>
            {writing && (
              <Textarea
                className="onb-brand__own"
                aria-label={t("onboarding.flow.brand.tonePlaceholder")}
                value={tone}
                onChange={(e) => setTone(e.target.value)}
                placeholder={t("onboarding.flow.brand.tonePlaceholder")}
                rows={1}
                autoGrow
                maxLength={2000}
              />
            )}
          </Field>
          <BrandManual
            files={files}
            links={links}
            link={link}
            linkOpen={linkOpen}
            uploading={uploading}
            onPick={() => filesInput.current?.click()}
            onRemoveFile={(id) => setFiles((was) => was.filter((f) => f.id !== id))}
            onLinkOpen={() => setLinkOpen(true)}
            onLink={setLink}
            onAddLink={addLink}
            onRemoveLink={(l) => setLinks((was) => was.filter((x) => x !== l))}
          />
          <input
            ref={filesInput}
            type="file"
            multiple
            hidden
            accept=".pdf,.fig,.png,.jpg,.jpeg,.svg,.zip,.doc,.docx,.ppt,.pptx,.key"
            onChange={(e) => void addFiles(e.target.files)}
          />
          {save.isError && (
            <p className="onb__error" role="alert">
              {errorText(t, save.error)}
            </p>
          )}
        </div>
      </Locked>
      <div className="onb__actions">
        <Button
          variant="primary"
          block
          kbd={["↵"]}
          data-enter=""
          disabled={!ready}
          loading={save.isPending}
          onClick={() => save.mutate()}
        >
          {t("onboarding.actions.continue")}
        </Button>
        {/* "Conto depois": it doesn't save, and the server keeps the step waiting (its finish says why). */}
        <p className="onb__skip">
          <button type="button" className="ac-link" disabled={save.isPending} onClick={onSaved}>
            {t("onboarding.flow.brand.later")}
          </button>
        </p>
      </div>
    </>
  );
}

/** The brand manual: files in the Drive and links, each one removable, the way in always saying what it takes. */
function BrandManual({
  files,
  links,
  link,
  linkOpen,
  uploading,
  onPick,
  onRemoveFile,
  onLinkOpen,
  onLink,
  onAddLink,
  onRemoveLink,
}: {
  files: BrandView["files"];
  links: string[];
  link: string;
  linkOpen: boolean;
  uploading: boolean;
  onPick: () => void;
  onRemoveFile: (id: string) => void;
  onLinkOpen: () => void;
  onLink: (value: string) => void;
  onAddLink: () => void;
  onRemoveLink: (value: string) => void;
}) {
  const { t } = useTranslation();
  const any = files.length > 0 || links.length > 0;
  return (
    <div className="onb-brand__manual">
      <div className="onb-brand__drop">
        <span className="onb-brand__drop-mark" aria-hidden="true">
          <Icon name="upload" size={16} />
        </span>
        <div className="onb-brand__drop-text">
          <b>{t("onboarding.flow.brand.manual")}</b>
          <span>{t("onboarding.flow.brand.manualText")}</span>
        </div>
        <span className="onb-brand__drop-acts">
          <Button size="sm" loading={uploading} onClick={onPick}>
            {t("onboarding.flow.brand.manualPick")}
          </Button>
          <Button size="sm" onClick={onLinkOpen}>
            {t("onboarding.flow.brand.manualLink")}
          </Button>
        </span>
      </div>
      {any && (
        <ul className="onb-brand__files" aria-label={t("onboarding.flow.brand.manual")}>
          {files.map((f) => (
            <li key={f.id} className="onb-brand__file">
              <Icon name="document" size={14} />
              <span className="onb-brand__file-name">{f.title}</span>
              <span className="onb-brand__file-state">{t("onboarding.flow.brand.saved")}</span>
              <button
                type="button"
                className="onb-brand__file-x"
                aria-label={t("common.removeName", { name: f.title })}
                onClick={() => onRemoveFile(f.id)}
              >
                <Icon name="close" size={14} />
              </button>
            </li>
          ))}
          {links.map((l) => (
            <li key={l} className="onb-brand__file">
              <Icon name="link" size={14} />
              <span className="onb-brand__file-name">{l}</span>
              <button
                type="button"
                className="onb-brand__file-x"
                aria-label={t("common.removeName", { name: l })}
                onClick={() => onRemoveLink(l)}
              >
                <Icon name="close" size={14} />
              </button>
            </li>
          ))}
        </ul>
      )}
      {linkOpen && (
        <div className="onb-brand__linkrow">
          <Input
            value={link}
            onChange={(e) => onLink(e.target.value)}
            placeholder={t("onboarding.flow.brand.manualLinkPlaceholder")}
            inputMode="url"
            aria-label={t("onboarding.flow.brand.manualLink")}
            onKeyDown={(e) => {
              if (e.key !== "Enter") return;
              e.preventDefault();
              onAddLink();
            }}
          />
          <Button size="sm" onClick={onAddLink} disabled={!link.trim()}>
            {t("onboarding.flow.brand.manualAdd")}
          </Button>
        </div>
      )}
    </div>
  );
}
