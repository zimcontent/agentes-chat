import { useTranslation } from "react-i18next";
import { StyleSheet, View } from "react-native";
import { Card, Filters, IconButton, Text } from "@/ui";
import { useWhen } from "../shared/hooks";
import { type ClockTime, MINUTE_STEP, stepTime } from "./logic";

/** A day of `days` (by its index) and a time of day: what the picker holds. */
export interface DayTimePick {
  dayOffset: number;
  time: ClockTime;
}

/**
 * The app's own day and time picker (no native one): the days as a row of pills ("Hoje", "Amanhã", "sex 21"…),
 * scrolling sideways, and the hour and the minute as steppers ("‹ 14 › : ‹ 30 ›", the minute by `MINUTE_STEP`).
 * "Lembrar" and "Pronto para agendar" pick with it.
 */
export function DayTimePicker({
  days,
  value,
  onChange,
}: {
  /** Local midnights to choose from (`dayChoices`). */
  days: readonly Date[];
  value: DayTimePick;
  onChange: (next: DayTimePick) => void;
}) {
  const { t } = useTranslation();
  const { locale } = useWhen();
  const moveTime = (minutes: number) => onChange({ ...value, time: stepTime(value.time, minutes) });
  return (
    <>
      <Filters
        items={days.map((d, i) => ({
          key: String(i),
          label:
            i === 0
              ? t("mobile.time.today")
              : i === 1
                ? t("mobile.remind.tomorrow")
                : new Intl.DateTimeFormat(locale, { weekday: "short", day: "numeric" }).format(d).replace(".", ""),
        }))}
        value={String(value.dayOffset)}
        onChange={(key) => onChange({ ...value, dayOffset: Number(key) })}
      />
      <Card>
        <View style={styles.clock}>
          <Stepper
            value={String(value.time.hour).padStart(2, "0")}
            label={t("mobile.remind.hour")}
            lessLabel={t("mobile.remind.hourLess")}
            moreLabel={t("mobile.remind.hourMore")}
            onLess={() => moveTime(-60)}
            onMore={() => moveTime(60)}
          />
          <Text variant="display" tone="faint">
            :
          </Text>
          <Stepper
            value={String(value.time.minute).padStart(2, "0")}
            label={t("mobile.remind.minute")}
            lessLabel={t("mobile.remind.minuteLess", { n: MINUTE_STEP })}
            moreLabel={t("mobile.remind.minuteMore", { n: MINUTE_STEP })}
            onLess={() => moveTime(-MINUTE_STEP)}
            onMore={() => moveTime(MINUTE_STEP)}
          />
        </View>
      </Card>
    </>
  );
}

/** "‹ 14 ›": a number with a step down and up (our buttons, no native picker). */
function Stepper({
  value,
  label,
  lessLabel,
  moreLabel,
  onLess,
  onMore,
}: {
  value: string;
  label: string;
  lessLabel: string;
  moreLabel: string;
  onLess: () => void;
  onMore: () => void;
}) {
  return (
    <View style={styles.stepper}>
      <IconButton icon="back" label={lessLabel} onPress={onLess} />
      <Text
        variant="display"
        style={styles.digits}
        accessibilityLabel={`${label} ${value}`}
        accessibilityLiveRegion="polite"
      >
        {value}
      </Text>
      <IconButton icon="right" label={moreLabel} onPress={onMore} />
    </View>
  );
}

const styles = StyleSheet.create({
  clock: { flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 4, paddingVertical: 12 },
  stepper: { flexDirection: "row", alignItems: "center", gap: 2 },
  digits: { minWidth: 48, textAlign: "center", fontVariant: ["tabular-nums"] },
});
