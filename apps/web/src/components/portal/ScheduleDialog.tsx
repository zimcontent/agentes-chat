import type { PortalItem } from "@dougbot/client";
import { useSchedulePortalItem } from "@dougbot/client";
import {
  portalAhead,
  portalDayOf,
  portalErrorText,
  portalSendDate,
  portalTimeOf,
  portalWhen,
} from "@dougbot/client/lib/portal";
import { Button, DatePicker, Dialog, DialogBody, DialogFooter, Field, Locked, TimeSelect, ymd } from "@dougbot/ui";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { useOrg } from "@/components/org-context";
import { useNow } from "@/hooks/useNow";
import { useToast } from "@/lib/toast";

/**
 * "Schedule post" (ADR 9001), on a post the client approved: a day and a time, and the portal takes it to the
 * publishing service by itself with the caption and files it has there. It starts on the post's own date when it
 * has one (a date proposed for it), else empty. A time that already passed can't be confirmed (by this device's clock; the portal, which
 * reads the time in its own zone, has the last word and its refusal shows here in its own words). The post moves to
 * Scheduled once the publishing service has it, within a few minutes: until then it stays in Approved with its date.
 */
export function ScheduleDialog({ item, onClose }: { item: PortalItem | null; onClose: () => void }) {
  const { t } = useTranslation();
  return (
    <Dialog
      open={item !== null}
      onOpenChange={(o) => !o && onClose()}
      title={t("portal.schedule.action")}
      description={t("portal.schedule.text")}
      closeLabel={t("common.close")}
      width={440}
    >
      {item && <ScheduleForm key={item.id} item={item} onClose={onClose} />}
    </Dialog>
  );
}

function ScheduleForm({ item, onClose }: { item: PortalItem; onClose: () => void }) {
  const { t, i18n } = useTranslation();
  const { org } = useOrg();
  const toast = useToast();
  const schedule = useSchedulePortalItem(org.id);
  const [day, setDay] = useState<string | null>(portalDayOf(item.scheduledFor));
  const [time, setTime] = useState(portalTimeOf(item.scheduledFor) ?? "");
  const [error, setError] = useState<string | null>(null);
  // The minute turns while the dialog is open: a time that was ahead may not be any more.
  const now = new Date(useNow(30_000));
  const filled = day !== null && time !== "";
  const ahead = portalAhead(day, time, now);
  const submit = () => {
    if (!day || !ahead) return;
    setError(null);
    const scheduledFor = portalSendDate(day, time);
    schedule.mutate(
      { client: item.client, itemId: item.id, scheduledFor },
      {
        onSuccess: () => {
          toast.show(t("portal.schedule.done", { when: portalWhen(i18n.language, scheduledFor) ?? scheduledFor }));
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
      <Locked when={schedule.isPending}>
        <DialogBody>
          <div className="portal-form__pair">
            <Field label={t("portal.form.date")}>
              <DatePicker
                value={day}
                short
                onChange={setDay}
                min={ymd(now)}
                locale={i18n.language}
                placeholder={t("common.chooseDate")}
                labels={{
                  previousMonth: t("common.previousMonth"),
                  nextMonth: t("common.nextMonth"),
                  choose: t("common.chooseDate"),
                }}
              />
            </Field>
            <Field label={t("portal.form.time")} error={filled && !ahead ? t("portal.schedule.past") : undefined}>
              <TimeSelect value={time} onChange={setTime} />
            </Field>
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
        <Button type="submit" variant="primary" disabled={!ahead} loading={schedule.isPending}>
          {t("portal.schedule.confirm")}
        </Button>
      </DialogFooter>
    </form>
  );
}
