import type { PortalCard, PortalCardFile, PortalType } from "@agenteschat/client";
import { useSavePortalCard } from "@agenteschat/client";
import { PORTAL_TYPES, portalDayOf, portalErrorText } from "@agenteschat/client/lib/portal";
import {
  Button,
  DatePicker,
  Dialog,
  DialogBody,
  DialogFooter,
  Field,
  Input,
  Locked,
  Select,
  Textarea,
} from "@agenteschat/ui";
import { type RefObject, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { useOrg } from "@/components/org-context";
import { useToast } from "@/lib/toast";
import { PortalFiles } from "./PortalFiles";

/**
 * A card of the board (ADR 9001), new or being changed: a post the team still has to make. Its title is all it
 * needs; the type, date, owner, note, caption and the Drive files that go up with it can come later. What it holds
 * fills "Send for approval" when the card is sent.
 */
export function CardDialog({
  open,
  client,
  card,
  onClose,
}: {
  open: boolean;
  client: string;
  /** The card being changed; null: a new one. */
  card: PortalCard | null;
  onClose: () => void;
}) {
  const { t } = useTranslation();
  const titleRef = useRef<HTMLInputElement>(null);
  return (
    <Dialog
      open={open}
      onOpenChange={(o) => !o && onClose()}
      title={t(card ? "portal.card.editTitle" : "portal.card.newTitle")}
      closeLabel={t("common.close")}
      width={600}
      initialFocus={titleRef}
    >
      {open && <CardForm key={card?.id ?? "new"} titleRef={titleRef} client={client} card={card} onClose={onClose} />}
    </Dialog>
  );
}

function CardForm({
  titleRef,
  client,
  card,
  onClose,
}: {
  titleRef: RefObject<HTMLInputElement | null>;
  client: string;
  card: PortalCard | null;
  onClose: () => void;
}) {
  const { t, i18n } = useTranslation();
  const { org } = useOrg();
  const toast = useToast();
  const save = useSavePortalCard(org.id);
  const [title, setTitle] = useState(card?.title ?? "");
  const [type, setType] = useState<PortalType>(card?.type ?? "reel");
  const [day, setDay] = useState<string | null>(portalDayOf(card?.date));
  const [owner, setOwner] = useState(card?.owner ?? "");
  const [note, setNote] = useState(card?.note ?? "");
  const [caption, setCaption] = useState(card?.caption ?? "");
  const [files, setFiles] = useState<PortalCardFile[]>(card?.files ?? []);
  const [error, setError] = useState<string | null>(null);
  const ready = title.trim().length > 0;
  const submit = () => {
    if (!ready) return;
    setError(null);
    const fields = {
      title: title.trim(),
      type,
      date: day,
      owner: owner.trim() || null,
      note: note.trim(),
      caption,
      files,
    };
    save.mutate(card ? { cardId: card.id, ...fields } : { client, ...fields }, {
      onSuccess: () => {
        toast.show(t(card ? "portal.card.saved" : "portal.card.created"));
        onClose();
      },
      onError: (failure) => setError(portalErrorText(t, failure, i18n.language)),
    });
  };
  return (
    <form
      className="portal-form"
      onSubmit={(e) => {
        e.preventDefault();
        submit();
      }}
    >
      <Locked when={save.isPending}>
        <DialogBody>
          <Field label={t("portal.form.title")}>
            <Input ref={titleRef} value={title} maxLength={120} onChange={(e) => setTitle(e.target.value)} />
          </Field>
          <div className="portal-form__pair">
            <Field label={t("portal.form.type")}>
              <Select
                value={type}
                onValueChange={setType}
                options={PORTAL_TYPES.map((value) => ({ value, label: t(`portal.types.${value}`) }))}
              />
            </Field>
            <Field label={t("portal.form.date")}>
              <DatePicker
                value={day}
                short
                onChange={setDay}
                onClear={() => setDay(null)}
                locale={i18n.language}
                placeholder={t("portal.empty.noDate")}
                labels={{
                  previousMonth: t("common.previousMonth"),
                  nextMonth: t("common.nextMonth"),
                  choose: t("common.chooseDate"),
                  clear: t("portal.empty.noDate"),
                }}
              />
            </Field>
          </div>
          <Field label={t("portal.form.owner")}>
            <Input value={owner} maxLength={120} onChange={(e) => setOwner(e.target.value)} />
          </Field>
          <Field label={t("portal.form.note")}>
            <Textarea value={note} rows={2} maxLength={2000} onChange={(e) => setNote(e.target.value)} />
          </Field>
          <Field label={t("portal.form.caption")}>
            <Textarea value={caption} rows={3} maxLength={5000} onChange={(e) => setCaption(e.target.value)} />
          </Field>
          <PortalFiles label={t("portal.form.files")} files={files} onChange={setFiles} />
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
        <Button type="submit" variant="primary" disabled={!ready} loading={save.isPending}>
          {t("common.save")}
        </Button>
      </DialogFooter>
    </form>
  );
}
