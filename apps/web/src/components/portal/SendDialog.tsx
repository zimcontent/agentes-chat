import type { PortalCard, PortalCardFile, PortalJob, PortalType } from "@dougbot/client";
import { usePortalJob, useSendForApproval } from "@dougbot/client";
import { previewKindOfName } from "@dougbot/client/lib/files";
import {
  PORTAL_SEND_FILES,
  PORTAL_TYPES,
  portalClientName,
  portalErrorText,
  portalLink,
  portalSendProblem,
  portalSendType,
} from "@dougbot/client/lib/portal";
import {
  Button,
  Chip,
  Dialog,
  DialogBody,
  DialogFooter,
  Field,
  Icon,
  Input,
  Locked,
  PixelSpinner,
  Select,
  Textarea,
} from "@dougbot/ui";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { useOrg } from "@/components/org-context";
import { PortalCover, PortalFiles } from "./PortalFiles";

/**
 * "Send for approval" (ADR 9001): the client, the type and the Drive files, then whatever is already known (title,
 * caption, editor); never a date: a post goes to the client without one, and gets it when a person schedules it
 * (ADR 9001, addendum 2026-11-17). What a post still lacks comes back after the send and can be completed later.
 * A reel is one video, its cover a picture apart; a carousel goes in the order shown. Started from a card, its
 * fields and files fill the form and the card leaves the board once the send is done. After "Send" the dialog
 * follows the send to its end (the link at the portal and what is missing, or the portal's own words when it
 * refuses); it goes on by itself if the dialog is closed.
 */
export function SendDialog({
  open,
  client,
  clients,
  card,
  onClose,
}: {
  open: boolean;
  /** The client it starts on: the board's, or the card's. */
  client: string | null;
  /** Every client of the portal, to send from the overview. */
  clients: string[];
  card: PortalCard | null;
  onClose: () => void;
}) {
  const { t } = useTranslation();
  return (
    <Dialog
      open={open}
      onOpenChange={(o) => !o && onClose()}
      title={t("portal.send")}
      description={t("portal.sending.description")}
      closeLabel={t("common.close")}
      width={600}
    >
      {open && <SendBody key={card?.id ?? "none"} client={client} clients={clients} card={card} onClose={onClose} />}
    </Dialog>
  );
}

function SendBody({
  client: startClient,
  clients,
  card,
  onClose,
}: {
  client: string | null;
  clients: string[];
  card: PortalCard | null;
  onClose: () => void;
}) {
  const { t, i18n } = useTranslation();
  const { org } = useOrg();
  const send = useSendForApproval(org.id);
  const [jobId, setJobId] = useState<string | null>(null);
  const job = usePortalJob(org.id, jobId).data;
  const options = [...new Set([...(startClient ? [startClient] : []), ...clients])];
  const [client, setClient] = useState<string | undefined>(startClient ?? options[0]);
  const [type, setType] = useState<PortalType>(portalSendType(card));
  const [files, setFiles] = useState<PortalCardFile[]>(card?.files ?? []);
  const [cover, setCover] = useState<PortalCardFile | null>(null);
  const [title, setTitle] = useState(card?.title ?? "");
  const [caption, setCaption] = useState(card?.caption ?? "");
  const [editor, setEditor] = useState(card?.editor ?? "");
  const [error, setError] = useState<string | null>(null);
  // Said once files were picked: an empty form asks for nothing yet.
  const problem = portalSendProblem(type, files, type === "reel" ? cover : null);
  const shownProblem = problem && problem !== "noFiles" ? problem : null;
  const ready = Boolean(client) && problem === null;
  const submit = () => {
    if (!ready || !client) return;
    setError(null);
    send.mutate(
      {
        client,
        type,
        artifactIds: files.map((f) => f.id),
        ...(type === "reel" && cover ? { coverArtifactId: cover.id } : {}),
        ...(title.trim() ? { title: title.trim() } : {}),
        ...(caption.trim() ? { caption } : {}),
        ...(editor.trim() ? { editor: editor.trim() } : {}),
        ...(card ? { card: card.id } : {}),
        // A key of this press alone: the same press never sends twice, another try is another send.
        key: crypto.randomUUID(),
      },
      {
        onSuccess: (started) => setJobId(started.id),
        onError: (failure) => setError(portalErrorText(t, failure, i18n.language)),
      },
    );
  };

  if (jobId && job) {
    return (
      <SendProgress
        job={job}
        video={files.some((f) => previewKindOfName(f.name) === "video")}
        onRetry={() => setJobId(null)}
        onClose={onClose}
      />
    );
  }
  return (
    <form
      className="portal-form"
      onSubmit={(e) => {
        e.preventDefault();
        submit();
      }}
    >
      <Locked when={send.isPending}>
        <DialogBody>
          <div className="portal-form__pair">
            <Field label={t("portal.form.client")}>
              <Select
                value={client}
                onValueChange={setClient}
                options={options.map((value) => ({ value, label: portalClientName(value) }))}
              />
            </Field>
            <Field label={t("portal.form.type")}>
              <Select
                value={type}
                onValueChange={setType}
                options={PORTAL_TYPES.map((value) => ({ value, label: t(`portal.types.${value}`) }))}
              />
            </Field>
          </div>
          <PortalFiles
            label={t("portal.form.files")}
            files={files}
            onChange={setFiles}
            error={shownProblem ? t(`portal.sending.${shownProblem}`, { max: PORTAL_SEND_FILES }) : undefined}
          />
          {type === "reel" && <PortalCover label={t("portal.form.cover")} cover={cover} onChange={setCover} />}
          <Field label={t("portal.form.title")}>
            <Input value={title} maxLength={120} onChange={(e) => setTitle(e.target.value)} />
          </Field>
          <Field label={t("portal.form.caption")}>
            <Textarea value={caption} rows={3} maxLength={5000} onChange={(e) => setCaption(e.target.value)} />
          </Field>
          <Field label={t("portal.form.editor")}>
            <Input value={editor} maxLength={40} onChange={(e) => setEditor(e.target.value)} />
          </Field>
          {/* The portal's own refusal, as it said it. */}
          {error && (
            <p className="ac-field__error" role="alert">
              {error}
            </p>
          )}
        </DialogBody>
      </Locked>
      <DialogFooter>
        <Button onClick={onClose}>{t("common.cancel")}</Button>
        <Button type="submit" variant="primary" icon="send" disabled={!ready} loading={send.isPending}>
          {t("portal.sending.submit")}
        </Button>
      </DialogFooter>
    </form>
  );
}

/**
 * A send on its way, then how it ended: done with the post's link and what it still lacks, or failed with the
 * portal's own words (plain text) and another try. Close is always there: the send needs nobody watching.
 */
function SendProgress({
  job,
  video,
  onRetry,
  onClose,
}: {
  job: PortalJob;
  video: boolean;
  onRetry: () => void;
  onClose: () => void;
}) {
  const { t } = useTranslation();
  const link = portalLink(job.link);
  return (
    <>
      <DialogBody className="portal-send">
        {job.state === "sending" && (
          <>
            <p className="portal-send__status ac-iconline" role="status">
              <PixelSpinner size={16} />
              <span>{t("portal.sending.progress", { client: portalClientName(job.client) })}</span>
            </p>
            {video && <p className="small muted">{t("portal.sending.video")}</p>}
          </>
        )}
        {job.state === "done" && (
          <>
            <p className="portal-send__status ac-iconline" role="status" data-tone="done">
              <Icon name="check" size={16} />
              <span>{t("portal.sending.done")}</span>
            </p>
            {job.missing.length > 0 && (
              <div className="portal-send__missing">
                <span className="ac-field__label">{t("portal.sending.stillMissing")}</span>
                <span className="portal-card__chips">
                  {job.missing.map((what) => (
                    <Chip key={what} icon="alert">
                      {t(`portal.missing.${what}`)}
                    </Chip>
                  ))}
                </span>
              </div>
            )}
          </>
        )}
        {job.state === "failed" && (
          <>
            <p className="portal-send__status ac-iconline" role="alert" data-tone="warn">
              <Icon name="alert" size={16} />
              <span>{t("portal.sending.failed")}</span>
            </p>
            {job.error && <p className="portal-send__error">{job.error}</p>}
          </>
        )}
      </DialogBody>
      <DialogFooter>
        <Button onClick={onClose}>{t("common.close")}</Button>
        {job.state === "failed" && (
          <Button variant="primary" onClick={onRetry}>
            {t("common.retry")}
          </Button>
        )}
        {job.state === "done" && link && (
          <Button asChild variant="primary" icon="external">
            <a href={link} target="_blank" rel="noopener noreferrer">
              {t("portal.openAtPortal")}
            </a>
          </Button>
        )}
      </DialogFooter>
    </>
  );
}
