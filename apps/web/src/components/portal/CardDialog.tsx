import type { PortalCard, PortalCardFile, PortalType } from "@dougbot/client";
import { useSavePortalCard } from "@dougbot/client";
import {
  PORTAL_TYPES,
  portalClientName,
  portalDayOf,
  portalErrorText,
  portalWithResponsible,
} from "@dougbot/client/lib/portal";
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
} from "@dougbot/ui";
import { type RefObject, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { actorFromKey, NO_ACTOR, useActors } from "@/components/actors";
import { useOrg } from "@/components/org-context";
import { useToast } from "@/lib/toast";
import { PortalFiles } from "./PortalFiles";

/**
 * A card of the board (ADR 9001), new or being changed: a post the team still has to make. Its title is all it
 * needs; who is responsible, the day it is made, the type, the day it goes out, a note, the caption and the Drive
 * files that go up with it can come later. What it holds fills "Send for approval" when the card is sent.
 *
 * The card is also a task of the workspace: the one responsible is its first member, a person or an agent (picked
 * from the list the tasks' own assignee field shows), and an agent put there starts on it at once. With no client
 * implied (`client` null: the overview's "New task"), the client is picked first among `clients`.
 */
export function CardDialog({
  open,
  client,
  clients = [],
  card,
  title,
  onClose,
}: {
  open: boolean;
  /** The client it is for; null: picked in the dialog, among `clients`. */
  client: string | null;
  clients?: string[];
  /** The card being changed; null: a new one. */
  card: PortalCard | null;
  /** In place of "New card" (the overview's "New task"). */
  title?: string;
  onClose: () => void;
}) {
  const { t } = useTranslation();
  const titleRef = useRef<HTMLInputElement>(null);
  return (
    <Dialog
      open={open}
      onOpenChange={(o) => !o && onClose()}
      title={title ?? t(card ? "portal.card.editTitle" : "portal.card.newTitle")}
      closeLabel={t("common.close")}
      width={600}
      initialFocus={titleRef}
    >
      {open && (
        <CardForm
          key={card?.id ?? "new"}
          titleRef={titleRef}
          client={client}
          clients={clients}
          card={card}
          onClose={onClose}
        />
      )}
    </Dialog>
  );
}

function CardForm({
  titleRef,
  client: startClient,
  clients,
  card,
  onClose,
}: {
  titleRef: RefObject<HTMLInputElement | null>;
  client: string | null;
  clients: string[];
  card: PortalCard | null;
  onClose: () => void;
}) {
  const { t, i18n } = useTranslation();
  const { org } = useOrg();
  const toast = useToast();
  const actors = useActors();
  const save = useSavePortalCard(org.id);
  const first = card?.members[0];
  const [client, setClient] = useState<string | undefined>(startClient ?? clients[0]);
  const [title, setTitle] = useState(card?.title ?? "");
  const [type, setType] = useState<PortalType>(card?.type ?? "reel");
  const [day, setDay] = useState<string | null>(portalDayOf(card?.date));
  const [produceOn, setProduceOn] = useState<string | null>(card?.produceOn ?? null);
  // The one responsible, as the tasks' assignee field names them: `person:<id>`, `agent:<id>` or nobody.
  const [who, setWho] = useState(
    first ? `${actors.dir.memberById.has(first) ? "person" : "agent"}:${first}` : NO_ACTOR,
  );
  const [note, setNote] = useState(card?.note ?? "");
  const [caption, setCaption] = useState(card?.caption ?? "");
  const [files, setFiles] = useState<PortalCardFile[]>(card?.files ?? []);
  const [error, setError] = useState<string | null>(null);
  const responsible = actorFromKey(who);
  const ready = title.trim().length > 0 && Boolean(client);
  const dateLabels = {
    previousMonth: t("common.previousMonth"),
    nextMonth: t("common.nextMonth"),
    choose: t("common.chooseDate"),
    clear: t("portal.empty.noDate"),
  };
  const submit = () => {
    if (!ready || !client) return;
    setError(null);
    const fields = {
      title: title.trim(),
      type,
      date: day,
      produceOn,
      note: note.trim(),
      caption,
      files,
      // The one responsible goes first; whoever else was on the card stays on it.
      ...(responsible && responsible.id !== first
        ? { members: portalWithResponsible(card?.members ?? [], responsible.id) }
        : {}),
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
          {startClient === null && (
            <Field label={t("portal.form.client")}>
              <Select
                value={client}
                onValueChange={setClient}
                options={clients.map((value) => ({ value, label: portalClientName(value) }))}
              />
            </Field>
          )}
          <div className="portal-form__pair">
            <Field
              label={t("portal.form.owner")}
              example={responsible?.type === "agent" ? t("portal.detail.agentStarts") : undefined}
            >
              <Select value={who} onValueChange={setWho} options={actors.options(true, who)} />
            </Field>
            <Field label={t("portal.detail.produceOn")}>
              <DatePicker
                value={produceOn}
                short
                onChange={setProduceOn}
                onClear={() => setProduceOn(null)}
                locale={i18n.language}
                placeholder={t("portal.empty.noDate")}
                labels={dateLabels}
              />
            </Field>
          </div>
          <div className="portal-form__pair">
            <Field label={t("portal.form.type")}>
              <Select
                value={type}
                onValueChange={setType}
                options={PORTAL_TYPES.map((value) => ({ value, label: t(`portal.types.${value}`) }))}
              />
            </Field>
            <Field label={t("portal.detail.postOn")}>
              <DatePicker
                value={day}
                short
                onChange={setDay}
                onClear={() => setDay(null)}
                locale={i18n.language}
                placeholder={t("portal.empty.noDate")}
                labels={dateLabels}
              />
            </Field>
          </div>
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
