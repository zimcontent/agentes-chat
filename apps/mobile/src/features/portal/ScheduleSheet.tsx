import { type PortalItem, useSchedulePortalItem } from "@agenteschat/client";
import { portalClientName, portalErrorText, portalWhen } from "@agenteschat/client/lib/portal";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { StyleSheet, View } from "react-native";
import { Button, Locked, Text, useToast } from "@/ui";
import { DayTimePicker } from "../reminders/DayTimePicker";
import { useNow, useOrgId } from "../shared/hooks";
import { SheetTitle } from "../shared/PromptForm";
import { successHaptic, Tile } from "../shared/parts";
import { useSheet } from "../shared/SheetHost";
import { usePortalWords } from "./hooks";
import { type SchedulePick, scheduleReady, scheduleSendOf, scheduleStart } from "./schedule";

/**
 * "Agendar publicação" from Pendentes (ADR 9001): a day and a time on the app's own picker, then Agendar. The rules
 * are the web's `ScheduleDialog`: it starts on the post's proposed date while that is ahead, a time that passed can't
 * be confirmed (by this device's clock), and the portal, which reads the time in its own zone, has the last word: its
 * refusal shows here in its own words. Once scheduled the post leaves the list on the portal's next read.
 */
export function ScheduleSheet({ item }: { item: PortalItem }) {
  const { t, i18n } = useTranslation();
  const orgId = useOrgId();
  const sheet = useSheet();
  const toast = useToast();
  const w = usePortalWords();
  const schedule = useSchedulePortalItem(orgId);
  // The days offered are fixed while the sheet is open; the minute turns, so "ahead" is read again.
  const [start] = useState(() => scheduleStart(item));
  const [pick, setPick] = useState<SchedulePick>(start.pick);
  const [error, setError] = useState<string | null>(null);
  const now = new Date(useNow(30_000));
  const send = scheduleSendOf(start.days, pick);
  const ready = scheduleReady(start.days, pick, now);
  const when = send ? (portalWhen(i18n.language, send, now) ?? send) : "";
  const submit = () => {
    if (!send || !ready || schedule.isPending) return;
    setError(null);
    schedule.mutate(
      { client: item.client, itemId: item.id, scheduledFor: send },
      {
        onSuccess: () => {
          sheet.close();
          successHaptic();
          toast({ title: w.scheduled(when), icon: "check" });
        },
        onError: (failure) => setError(portalErrorText(t, failure, i18n.language)),
      },
    );
  };
  return (
    <>
      <SheetTitle
        leading={<Tile icon="calendar" />}
        title={t("mobile.toSchedule.sheetTitle")}
        subtitle={[portalClientName(item.client), item.title].filter(Boolean).join(" · ")}
      />
      <Locked when={schedule.isPending} style={styles.picker}>
        <DayTimePicker
          days={start.days}
          value={pick}
          onChange={(next) => {
            setError(null);
            setPick(next);
          }}
        />
      </Locked>
      <View accessibilityLiveRegion="polite">
        <Text variant="small" tone={ready ? "muted" : "danger"} style={styles.center}>
          {ready ? t("mobile.toSchedule.when", { when }) : t("mobile.toSchedule.past")}
        </Text>
        {/* The portal's own refusal, as it said it. */}
        {error ? (
          <Text variant="small" tone="danger" style={[styles.center, styles.error]} accessibilityRole="alert">
            {error}
          </Text>
        ) : null}
      </View>
      <Button
        variant="primary"
        wide
        icon="calendar"
        label={t("mobile.toSchedule.confirm")}
        loading={schedule.isPending}
        disabled={!ready || !send}
        onPress={submit}
      />
      <Button variant="ghost" wide label={w.cancel} disabled={schedule.isPending} onPress={() => sheet.close()} />
    </>
  );
}

const styles = StyleSheet.create({
  picker: { gap: 12 },
  center: { textAlign: "center" },
  error: { marginTop: 4 },
});
