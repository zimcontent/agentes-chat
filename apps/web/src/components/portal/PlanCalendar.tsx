import type { PortalItem, PortalPlan } from "@agenteschat/client";
import { capitalize } from "@agenteschat/client/lib/format";
import {
  type PortalCalendarBy,
  type PortalCalendarEntry,
  portalCalendar,
  portalMonthName,
} from "@agenteschat/client/lib/portal";
import { Button, monthGrid, Segmented, ymd } from "@agenteschat/ui";
import { useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { stageName } from "./stage";

/** How many chips a day shows before "+N more" opens the rest. */
const DAY_ROOM = 3;

/**
 * The strategic schedule as a calendar (ADR 9001 §8): a month, its weeks as rows from Monday, each card a small chip
 * in its stage's colour on the day its post goes out, and each post at the portal no card stands for on the day it is
 * set for or went out. "Production date" shows the cards on the day the team makes them instead. A chip opens its
 * card, or the portal's post. Days are read as the portal wrote them, never moved to this time zone.
 */
export function PlanCalendar({
  plan,
  onOpen,
  onItem,
}: {
  plan: PortalPlan;
  onOpen: (cardId: string) => void;
  onItem: (item: PortalItem) => void;
}) {
  const { t, i18n } = useTranslation();
  const today = new Date();
  const [month, setMonth] = useState(() => new Date(today.getFullYear(), today.getMonth(), 1));
  const [by, setBy] = useState<PortalCalendarBy>("post");
  const [open, setOpen] = useState<string | null>(null);
  const days = useMemo(() => portalCalendar(plan, by), [plan, by]);
  const grid = monthGrid(month, 1);
  const weekdays = grid
    .slice(0, 7)
    .map((d) => capitalize(new Intl.DateTimeFormat(i18n.language, { weekday: "short" }).format(d), i18n.language));
  const name = capitalize(
    portalMonthName(i18n.language, `${month.getFullYear()}-${String(month.getMonth() + 1).padStart(2, "0")}`),
    i18n.language,
  );
  const step = (by: number) => setMonth(new Date(month.getFullYear(), month.getMonth() + by, 1));
  const chip = (entry: PortalCalendarEntry) => (
    <li key={`${entry.kind}:${entry.id}`}>
      <button
        type="button"
        className="plan-cal__chip"
        data-stage={entry.stage}
        title={`${entry.title} · ${stageName(t, entry.stage)}`}
        onClick={() => (entry.kind === "card" ? onOpen(entry.id) : onItem(entry.item))}
      >
        {entry.title}
      </button>
    </li>
  );
  return (
    <section className="plan-cal" aria-label={name}>
      <div className="plan-cal__bar">
        <h2 className="plan-cal__month" aria-live="polite">
          {name}
        </h2>
        <span className="plan-cal__nav">
          <Button
            size="sm"
            variant="ghost"
            iconOnly
            icon="chevronLeft"
            aria-label={t("common.previousMonth")}
            onClick={() => step(-1)}
          />
          <Button size="sm" onClick={() => setMonth(new Date(today.getFullYear(), today.getMonth(), 1))}>
            {t("portal.calendar.today")}
          </Button>
          <Button
            size="sm"
            variant="ghost"
            iconOnly
            icon="chevronRight"
            aria-label={t("common.nextMonth")}
            onClick={() => step(1)}
          />
        </span>
        <Segmented
          size="sm"
          label={t("portal.calendar.by")}
          value={by}
          onValueChange={setBy}
          options={[
            { value: "post", label: t("portal.calendar.byPost") },
            { value: "produce", label: t("portal.calendar.byProduce") },
          ]}
        />
      </div>
      <div className="plan-cal__grid">
        {weekdays.map((w) => (
          <span key={w} className="plan-cal__dow" aria-hidden="true">
            {w}
          </span>
        ))}
        {grid.map((d) => {
          const day = ymd(d);
          const entries = days.get(day) ?? [];
          const all = open === day || entries.length <= DAY_ROOM + 1;
          const shown = all ? entries : entries.slice(0, DAY_ROOM);
          return (
            <div
              key={day}
              className="plan-cal__day"
              data-day={day}
              data-out={d.getMonth() !== month.getMonth() || undefined}
              data-today={day === ymd(today) || undefined}
            >
              <time className="plan-cal__num" dateTime={day}>
                {d.getDate()}
              </time>
              {entries.length > 0 && (
                <ul className="plan-cal__chips">
                  {shown.map(chip)}
                  {!all && (
                    <li>
                      <button
                        type="button"
                        className="plan-cal__more"
                        aria-label={t("portal.calendar.more", { count: entries.length - DAY_ROOM })}
                        onClick={() => setOpen(day)}
                      >
                        {/* On a phone the day is too narrow for the words: "+N", the words stay its name. */}
                        <span className="plan-cal__more-long" aria-hidden="true">
                          {t("portal.calendar.more", { count: entries.length - DAY_ROOM })}
                        </span>
                        <span className="plan-cal__more-short" aria-hidden="true">
                          +{entries.length - DAY_ROOM}
                        </span>
                      </button>
                    </li>
                  )}
                </ul>
              )}
            </div>
          );
        })}
      </div>
    </section>
  );
}
