import type { PortalItem } from "@agenteschat/client";
import { useSchedulePortalItem } from "@agenteschat/client";
import { portalAhead, portalErrorText, portalSendDate, portalWhen } from "@agenteschat/client/lib/portal";
import { useEffect, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { StyleSheet, View } from "react-native";
import { Button, Card, Filters, GroupedList, GroupedRow, Icon, Locked, Sheet, Text, useToast } from "@/ui";
import { Stepper } from "../reminders/DayTimePicker";
import { useColors, useOrgId } from "../shared/hooks";
import { SheetTitle } from "../shared/PromptForm";
import { successHaptic, Tile } from "../shared/parts";
import { usePortalWords } from "./hooks";
import { SCHEDULE_STEP, scheduleDays, scheduleStart, stepClock } from "./model";

/** The days the sheet offers: today and the next four weeks. */
const DAYS = 28;

/**
 * "Para agendar" (ADR 9001, addendum 2026-11-17) on the phone: the client's approved posts nobody released yet, each
 * saying "Publicação aprovada, toque para agendar"; a press picks its day and time and confirms, as the web's
 * `ScheduleDialog`. The day and time are the reminders' own picker (day chips, an hour and a minute stepper: no native
 * picker). A time that already passed can't be confirmed (by this device's clock; the portal, in its own zone, has the
 * last word, and its refusal shows here in its own words). Opened on one post (`start`), it goes straight to its form.
 */
export function ScheduleSheet({
  open,
  items,
  start,
  onClose,
}: {
  open: boolean;
  items: readonly PortalItem[];
  /** The post to schedule at once (a card's "toque para agendar"); null: the list first. */
  start: PortalItem | null;
  onClose: () => void;
}) {
  const [picked, setPicked] = useState<PortalItem | null>(start);
  // Each opening starts where it was asked to: on its post, or on the list.
  useEffect(() => {
    if (open) setPicked(start);
  }, [open, start]);
  return (
    <Sheet open={open} onClose={onClose} solid>
      <View style={styles.in}>
        {picked ? (
          <ScheduleForm
            key={picked.id}
            item={picked}
            onBack={items.length > 1 && !start ? () => setPicked(null) : null}
            onDone={onClose}
          />
        ) : (
          <ScheduleList items={items} onPick={setPicked} />
        )}
      </View>
    </Sheet>
  );
}

function ScheduleList({ items, onPick }: { items: readonly PortalItem[]; onPick: (item: PortalItem) => void }) {
  const w = usePortalWords();
  const { i18n } = useTranslation();
  const c = useColors();
  return (
    <>
      <SheetTitle
        leading={<Tile icon="calendar" />}
        title={w.toSchedule}
        subtitle={items.length > 0 ? w.toScheduleCount(items.length) : w.noneToSchedule}
      />
      {items.length > 0 ? (
        <GroupedList>
          {items.map((item) => {
            const proposed = portalWhen(i18n.language, item.scheduledFor);
            return (
              <GroupedRow
                key={item.id}
                label={item.title}
                labelLines={2}
                sub={proposed ? `${w.tapToSchedule} · ${proposed}` : w.tapToSchedule}
                // The date comes last: a third line keeps it whole on a 320 phone.
                subLines={3}
                leading={<Icon name="calendar" size={20} color={c.amber} />}
                chevron
                onPress={() => onPick(item)}
              />
            );
          })}
        </GroupedList>
      ) : null}
    </>
  );
}

function ScheduleForm({ item, onBack, onDone }: { item: PortalItem; onBack: (() => void) | null; onDone: () => void }) {
  const w = usePortalWords();
  const { t, i18n } = useTranslation();
  const orgId = useOrgId();
  const toast = useToast();
  const schedule = useSchedulePortalItem(orgId);
  // The days are fixed while the sheet is open; "now" moves, so a time that was ahead may not be any more.
  const first = useMemo(() => scheduleStart(item), [item]);
  const days = useMemo(() => scheduleDays(new Date(), DAYS, first.day), [first.day]);
  const [day, setDay] = useState(first.day);
  const [time, setTime] = useState(first.time);
  const [error, setError] = useState<string | null>(null);
  const ahead = portalAhead(day, time, new Date());
  const at = portalSendDate(day, time);
  const when = portalWhen(i18n.language, at) ?? at;
  const [hh, mm] = time.split(":");
  const dayLabel = (d: string, i: number) => {
    if (i === 0) return w.today;
    if (i === 1) return w.tomorrow;
    const date = new Date(Number(d.slice(0, 4)), Number(d.slice(5, 7)) - 1, Number(d.slice(8, 10)));
    return new Intl.DateTimeFormat(i18n.language, { weekday: "short", day: "numeric", month: "short" })
      .format(date)
      .replace(/\./g, "");
  };
  const submit = () => {
    if (!ahead || schedule.isPending) return;
    setError(null);
    schedule.mutate(
      { client: item.client, itemId: item.id, scheduledFor: at },
      {
        onSuccess: () => {
          successHaptic();
          toast({ title: w.scheduled(when), icon: "check" });
          onDone();
        },
        onError: (failure) => setError(portalErrorText(t, failure, i18n.language)),
      },
    );
  };
  return (
    <>
      <SheetTitle leading={<Tile icon="calendar" />} title={w.scheduleAction} subtitle={item.title} />
      <Locked when={schedule.isPending} style={styles.form}>
        <Filters
          items={days.map((d, i) => ({ key: d, label: dayLabel(d, i) }))}
          value={day}
          onChange={(d) => {
            setError(null);
            setDay(d);
          }}
        />
        <Card>
          <View style={styles.clock}>
            <Stepper
              value={hh ?? "00"}
              label={w.hour}
              lessLabel={w.hourLess}
              moreLabel={w.hourMore}
              onLess={() => setTime((x) => stepClock(x, -60))}
              onMore={() => setTime((x) => stepClock(x, 60))}
            />
            <Text variant="display" tone="faint">
              :
            </Text>
            <Stepper
              value={mm ?? "00"}
              label={w.minute}
              lessLabel={w.minuteLess(SCHEDULE_STEP)}
              moreLabel={w.minuteMore(SCHEDULE_STEP)}
              onLess={() => setTime((x) => stepClock(x, -SCHEDULE_STEP))}
              onMore={() => setTime((x) => stepClock(x, SCHEDULE_STEP))}
            />
          </View>
        </Card>
      </Locked>
      <Text
        variant="small"
        tone={ahead && !error ? "muted" : "danger"}
        style={styles.center}
        accessibilityLiveRegion="polite"
      >
        {error ?? (ahead ? when : w.schedulePast)}
      </Text>
      <Text variant="footnote" tone="muted" style={styles.center}>
        {w.scheduleText}
      </Text>
      <Button
        variant="primary"
        wide
        icon="calendar"
        label={w.scheduleConfirm}
        loading={schedule.isPending}
        disabled={!ahead}
        onPress={submit}
      />
      {onBack ? <Button variant="ghost" wide label={w.back} disabled={schedule.isPending} onPress={onBack} /> : null}
    </>
  );
}

const styles = StyleSheet.create({
  in: { gap: 12 },
  form: { gap: 12 },
  clock: { flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 4, paddingVertical: 8 },
  center: { textAlign: "center" },
});
