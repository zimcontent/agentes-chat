import {
  type BrandInput,
  type BrandToneWord,
  type BrandView,
  brandFields,
  brandMissing,
  keys,
} from "@agenteschat/client";
import { errorText } from "@agenteschat/client/lib/errors";
import { joinNames } from "@agenteschat/client/lib/format";
import { Button, ChipButton, Field, Icon, Input, Locked, Skeleton, Textarea } from "@agenteschat/ui";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useId, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { useApi } from "@/api/context";
import { ErrorState } from "@/components/Loading";
import "./brand-step.css";

/** What `GET …/brand` answers, as the step holds it (and what it keeps after a save). */
export interface BrandData {
  pending: boolean;
  brand: BrandView | null;
  skillId: string | null;
  /** The tones to tap, in the person's language. */
  tones: BrandToneWord[];
}

/**
 * "Ensine a sua marca ao time" (docs/adr/doug-0020-time-doug.md), required once the Doug team was made: the company's
 * name and tone of voice are required, the site, the profile, the audience and the brand manual (a file, in the Drive,
 * or a link) optional. It saves the workspace skill "Marca <empresa>" (`orgs.saveBrand`), which ROSA, SONY, the Social
 * Media and CHESS read; the server refuses to finish the onboarding while it waits (`onboarding.brand_pending`).
 *
 * It mounts only once `GET …/brand` arrived, so its fields start from what was said and never overwrite a person's
 * typing; a read that failed offers to try again.
 */
export function BrandStep({
  orgId,
  state,
  error,
  onRetry,
  computerNote,
  onConnectComputer,
  onSaved,
}: {
  orgId: string;
  /** The step's data: the brand already said, the tones to tap, and whether it still waits. Absent while loading. */
  state: BrandData | undefined;
  /** The read failed: the step says so and offers to try it again. */
  error: unknown;
  onRetry: () => void;
  /** Agents of the team just made that only work on a computer, named here, the first step after the team: none yet. */
  computerNote: { names: string[]; onConnect: () => void } | null;
  onConnectComputer: () => void;
  /** Saved (or the workspace's brand already was): the step is answered. */
  onSaved: () => void;
}) {
  // The read may be on its way, or have failed: its own states say it, never a blank form. A read that failed later,
  // the brand already here, keeps the form: what it has is what the person typed over, and a step can't be lost to a
  // refetch.
  if (error && state === undefined)
    return (
      <div className="onb__answer">
        <ErrorState error={error} onRetry={onRetry} />
      </div>
    );
  if (state === undefined)
    return (
      <div className="onb__answer onb-brand" aria-hidden="true">
        <div className="onb-brand__grid">
          {[0, 1, 2, 3].map((i) => (
            <Skeleton key={i} shape="block" height={64} />
          ))}
        </div>
        <Skeleton shape="block" height={48} />
        <Skeleton shape="block" height={112} />
      </div>
    );
  return (
    <BrandForm
      orgId={orgId}
      state={state}
      computerNote={computerNote}
      onConnectComputer={onConnectComputer}
      onSaved={onSaved}
    />
  );
}

/** The step's form, once its data is here: the fields start from what the server had, never over what was typed. */
function BrandForm({
  orgId,
  state,
  computerNote,
  onConnectComputer,
  onSaved,
}: {
  orgId: string;
  state: BrandData;
  computerNote: { names: string[]; onConnect: () => void } | null;
  onConnectComputer: () => void;
  onSaved: () => void;
}) {
  const { t, i18n } = useTranslation();
  const api = useApi();
  const qc = useQueryClient();
  // The tone group's required mark, read out as its description (a fieldset takes no `aria-required`).
  const requiredId = useId();
  const saved = state.brand;
  const had = brandFields(saved);
  const [company, setCompany] = useState(had.company);
  const [tones, setTones] = useState<ReadonlySet<string>>(had.tones);
  const [tone, setTone] = useState(had.tone);
  const [site, setSite] = useState(had.site);
  const [instagram, setInstagram] = useState(had.instagram);
  const [audience, setAudience] = useState(had.audience);
  const [files, setFiles] = useState<BrandView["files"]>(had.files);
  const [links, setLinks] = useState<string[]>(had.links);
  const [link, setLink] = useState("");
  const [uploading, setUploading] = useState(false);
  const [uploadError, setUploadError] = useState<string | null>(null);
  const [linkOpen, setLinkOpen] = useState(false);
  // The person's own words: the field open, and a tone tapped before it stays picked only if both are used.
  const [writing, setWriting] = useState(had.tone !== "");
  const tonePicked = [...tones];
  // A tapped tone asked for a written one of its own: what the person types is kept, an empty field is not.
  const custom = writing && tone.trim() !== "";
  // A link typed or pasted and left in its field, without "Adicionar": it counts as given, so the step never saves
  // without what the person can see. The same for a tone written and then unclicked off its chip.
  const typedLink = link.trim();
  const input: BrandInput = {
    company: company.trim(),
    tones: tonePicked,
    tone: custom ? tone.trim() : null,
    site: site.trim() || null,
    instagram: instagram.trim() || null,
    audience: audience.trim() || null,
    files: files.map((f) => f.id),
    links: typedLink && !links.includes(typedLink) ? [...links, typedLink] : links,
  };
  // Required: a name and a tone (tapped or written). Everything else may stay empty; what's missing is said under the
  // button, never only by a button that won't press.
  const missing = brandMissing(input);
  const ready = missing === null;
  // A brand already saved: taking a file or a link off changes the skill too, so it asks first.
  const savedSkill = saved !== null;
  const save = useMutation({
    meta: { silent: true },
    mutationFn: () => api.orgs.saveBrand(orgId, input),
    onSuccess: (out) => {
      // The answer is the step's own data: a later visit reads it as said.
      qc.setQueryData(keys.brand(orgId, i18n.language), {
        pending: out.pending,
        brand: out.brand,
        skillId: out.skillId,
        tones: state.tones,
      } satisfies BrandData);
      // The team's agents now read the skill: their pages and the team list say it.
      void qc.invalidateQueries({ queryKey: keys.agents(orgId) });
      void qc.invalidateQueries({ queryKey: keys.skills(orgId) });
      // Only after the save, never before: the server still waits while the brand isn't saved.
      onSaved();
    },
  });
  const filesInput = useRef<HTMLInputElement>(null);
  const addFiles = async (picked: FileList | null) => {
    if (!picked || picked.length === 0) return;
    setUploading(true);
    setUploadError(null);
    // Each file on its own: one that fails says why under the list, and the others still go.
    for (const file of [...picked]) {
      try {
        const kept = await api.artifacts.upload(orgId, file, { title: file.name });
        setFiles((was) => [...was, { id: kept.id, title: kept.title }]);
      } catch (e) {
        setUploadError(t("onboarding.flow.brand.failed", { reason: errorText(t, e, i18n.language) }));
      }
    }
    setUploading(false);
    if (filesInput.current) filesInput.current.value = "";
  };
  const addLink = () => {
    const text = link.trim();
    if (!text) return;
    setLinks((was) => [...was, text]);
    setLink("");
    setLinkOpen(false);
  };
  const removeFile = (id: string) => setFiles((was) => was.filter((f) => f.id !== id));
  const removeLink = (value: string) => setLinks((was) => was.filter((x) => x !== value));
  return (
    <>
      <Locked when={save.isPending || uploading}>
        <div className="onb__answer onb-brand">
          {/* What still waits after the team was made (an agent that only works on a computer, with none connected). */}
          {computerNote && (
            <p className="onb__status ac-iconline" role="status">
              <Icon name="computer" size={14} />
              <span>{t("onboarding.flow.who.computerPending", { names: joinNames(computerNote.names, t) })}</span>
              <button type="button" className="ac-link onb__link" onClick={onConnectComputer}>
                {t("onboarding.flow.who.connectComputer")}
              </button>
            </p>
          )}
          <div className="onb-brand__grid">
            <Field
              label={t("onboarding.flow.brand.company")}
              labelAside={<span className="onb-brand__req">{t("onboarding.flow.brand.required")}</span>}
            >
              <Input
                value={company}
                onChange={(e) => setCompany(e.target.value)}
                placeholder={t("onboarding.flow.brand.companyPlaceholder")}
                maxLength={120}
                required
                aria-required="true"
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
          <Field
            label={t("onboarding.flow.brand.tone")}
            group
            labelAside={<span className="onb-brand__req">{t("onboarding.flow.brand.required")}</span>}
          >
            {/* A group of toggles (a fieldset, so its label names it), the required mark read out too: a fieldset takes
                no `aria-required` of its own, so it describes itself by the word, and the field for one's own tone
                keeps the attribute itself. */}
            <fieldset
              className="onb-brand__tones"
              aria-label={t("onboarding.flow.brand.tone")}
              aria-describedby={requiredId}
            >
              <span id={requiredId} className="ac-visually-hidden">
                {t("onboarding.flow.brand.required")}
              </span>
              {state.tones.map((word) => (
                <ChipButton
                  key={word.id}
                  aria-pressed={tones.has(word.id)}
                  className="tp-chip"
                  onClick={() =>
                    setTones((was) => {
                      const next = new Set(was);
                      if (next.has(word.id)) next.delete(word.id);
                      else next.add(word.id);
                      return next;
                    })
                  }
                >
                  {word.label}
                </ChipButton>
              ))}
              <ChipButton aria-pressed={writing} className="tp-chip" icon="edit" onClick={() => setWriting((w) => !w)}>
                {t("onboarding.flow.brand.toneOwn")}
              </ChipButton>
            </fieldset>
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
            company={company.trim()}
            files={files}
            links={links}
            link={link}
            linkOpen={linkOpen}
            uploading={uploading}
            // The brand already saved: what's taken off the list leaves the skill too, so it says before it goes.
            savedSkill={savedSkill}
            onPick={() => filesInput.current?.click()}
            onRemoveFile={removeFile}
            onLinkOpen={() => setLinkOpen(true)}
            onLink={setLink}
            onAddLink={addLink}
            onRemoveLink={removeLink}
          />
          <input
            ref={filesInput}
            type="file"
            multiple
            hidden
            accept=".pdf,.fig,.png,.jpg,.jpeg,.svg,.zip,.doc,.docx,.ppt,.pptx,.key"
            onChange={(e) => void addFiles(e.target.files)}
          />
          {uploadError && (
            <p className="onb__error" role="alert">
              {uploadError}
            </p>
          )}
          {save.isError && (
            <p className="onb__error" role="alert">
              {errorText(t, save.error)}
            </p>
          )}
        </div>
      </Locked>
      <div className="onb__actions">
        {/* What the step still waits for, said, so a button that can't press isn't a puzzle. */}
        {!ready && (
          <p className="onb__help">{t(`onboarding.flow.brand.missing${missing === "company" ? "Company" : "Tone"}`)}</p>
        )}
        <Button
          variant="primary"
          block
          kbd={["↵"]}
          data-enter=""
          disabled={!ready || uploading}
          loading={save.isPending}
          onClick={() => save.mutate()}
        >
          {t("onboarding.actions.continue")}
        </Button>
      </div>
    </>
  );
}

/** The brand manual: files in the Drive and links, each one removable, the way in always saying what it takes. */
function BrandManual({
  company,
  files,
  links,
  link,
  linkOpen,
  uploading,
  savedSkill,
  onPick,
  onRemoveFile,
  onLinkOpen,
  onLink,
  onAddLink,
  onRemoveLink,
}: {
  /** The name typed: what the skill it becomes is called ("Marca <empresa>"). */
  company: string;
  files: BrandView["files"];
  links: string[];
  link: string;
  linkOpen: boolean;
  uploading: boolean;
  /** The brand is saved: a file or a link taken off leaves the skill, so the × asks first. */
  savedSkill: boolean;
  onPick: () => void;
  onRemoveFile: (id: string) => void;
  onLinkOpen: () => void;
  onLink: (value: string) => void;
  onAddLink: () => void;
  onRemoveLink: (value: string) => void;
}) {
  const { t } = useTranslation();
  const any = files.length > 0 || links.length > 0;
  // The × that asked "Take it off?", while the brand is saved: the row turns into the question.
  const [asking, setAsking] = useState<string | null>(null);
  const remove = (id: string, run: () => void) => {
    if (savedSkill && asking !== id) return setAsking(id);
    setAsking(null);
    run();
  };
  return (
    <div className="onb-brand__manual">
      <div className="onb-brand__drop">
        <span className="onb-brand__drop-mark" aria-hidden="true">
          <Icon name="upload" size={16} />
        </span>
        <div className="onb-brand__drop-text">
          <b>{t("onboarding.flow.brand.manual")}</b>
          <span>
            {t("onboarding.flow.brand.manualText", { company: company || t("onboarding.flow.brand.company") })}
          </span>
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
              {asking === f.id ? (
                <span className="onb-brand__file-ask ac-actline">
                  <span>{t("onboarding.flow.brand.removeSaved")}</span>
                  <button type="button" className="ac-link" onClick={() => remove(f.id, () => onRemoveFile(f.id))}>
                    {t("common.remove")}
                  </button>
                  <button type="button" className="ac-link" onClick={() => setAsking(null)}>
                    {t("common.cancel")}
                  </button>
                </span>
              ) : (
                <>
                  <span className="onb-brand__file-state">{t("onboarding.flow.brand.saved")}</span>
                  <button
                    type="button"
                    className="onb-brand__file-x"
                    aria-label={t("common.removeName", { name: f.title })}
                    onClick={() => remove(f.id, () => onRemoveFile(f.id))}
                  >
                    <Icon name="close" size={14} />
                  </button>
                </>
              )}
            </li>
          ))}
          {links.map((l) => (
            <li key={l} className="onb-brand__file">
              <Icon name="link" size={14} />
              <span className="onb-brand__file-name">{l}</span>
              {asking === l ? (
                <span className="onb-brand__file-ask ac-actline">
                  <span>{t("onboarding.flow.brand.removeSaved")}</span>
                  <button type="button" className="ac-link" onClick={() => remove(l, () => onRemoveLink(l))}>
                    {t("common.remove")}
                  </button>
                  <button type="button" className="ac-link" onClick={() => setAsking(null)}>
                    {t("common.cancel")}
                  </button>
                </span>
              ) : (
                <button
                  type="button"
                  className="onb-brand__file-x"
                  aria-label={t("common.removeName", { name: l })}
                  onClick={() => remove(l, () => onRemoveLink(l))}
                >
                  <Icon name="close" size={14} />
                </button>
              )}
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
