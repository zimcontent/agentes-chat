import type { PortalItem, PortalItemEdit } from "@agenteschat/client";
import { useEditPortalItem } from "@agenteschat/client";
import { portalDayOf, portalErrorText, portalSendDate, portalTimeOf } from "@agenteschat/client/lib/portal";
import {
  Button,
  DatePicker,
  Dialog,
  DialogBody,
  DialogFooter,
  Field,
  Input,
  Locked,
  Textarea,
  TimeSelect,
} from "@agenteschat/ui";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { useOrg } from "@/components/org-context";
import { useToast } from "@/lib/toast";

/** The hour a date starts with when the post had none. */
const DEFAULT_TIME = "09:00";

/**
 * A post at the portal, completed or changed from here (ADR 9001): its title, caption and date. Only what changed
 * is sent. The date is the portal's own clock: read and written as the portal has it, never moved to this
 * browser's time zone.
 */
export function ItemDialog({ item, onClose }: { item: PortalItem | null; onClose: () => void }) {
  const { t } = useTranslation();
  return (
    <Dialog
      open={item !== null}
      onOpenChange={(o) => !o && onClose()}
      title={t("portal.post.editTitle")}
      closeLabel={t("common.close")}
      width={600}
    >
      {item && <ItemForm key={item.id} item={item} onClose={onClose} />}
    </Dialog>
  );
}

function ItemForm({ item, onClose }: { item: PortalItem; onClose: () => void }) {
  const { t, i18n } = useTranslation();
  const { org } = useOrg();
  const toast = useToast();
  const edit = useEditPortalItem(org.id);
  const was = { day: portalDayOf(item.scheduledFor), time: portalTimeOf(item.scheduledFor) ?? DEFAULT_TIME };
  const [title, setTitle] = useState(item.title);
  const [caption, setCaption] = useState(item.caption);
  const [day, setDay] = useState<string | null>(was.day);
  const [time, setTime] = useState(was.time);
  const [error, setError] = useState<string | null>(null);
  const changes: PortalItemEdit = {
    ...(title.trim() !== item.title ? { title: title.trim() } : {}),
    ...(caption !== item.caption ? { caption } : {}),
    ...(day !== was.day || (day && time !== was.time) ? { scheduledFor: day ? portalSendDate(day, time) : null } : {}),
  };
  const ready = title.trim().length > 0 && Object.keys(changes).length > 0;
  const submit = () => {
    if (!ready) return;
    setError(null);
    edit.mutate(
      { client: item.client, itemId: item.id, edit: changes },
      {
        onSuccess: () => {
          toast.show(t("portal.post.saved"));
          onClose();
        },
        onError: (failure) => setError(portalErrorText(t, failure, i18n.language)),
      },
    );
  };
  return (
    <form
      className="portal-form"
      onSubmit={(e) => {
        e.preventDefault();
        submit();
      }}
    >
      <Locked when={edit.isPending}>
        <DialogBody>
          <Field label={t("portal.form.title")}>
            <Input value={title} maxLength={120} onChange={(e) => setTitle(e.target.value)} />
          </Field>
          <Field label={t("portal.form.caption")}>
            <Textarea value={caption} rows={4} maxLength={5000} onChange={(e) => setCaption(e.target.value)} />
          </Field>
          <div className="portal-form__pair">
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
            {day && (
              <Field label={t("portal.form.time")}>
                <TimeSelect value={time} onChange={setTime} />
              </Field>
            )}
          </div>
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
        <Button type="submit" variant="primary" disabled={!ready} loading={edit.isPending}>
          {t("common.save")}
        </Button>
      </DialogFooter>
    </form>
  );
}
