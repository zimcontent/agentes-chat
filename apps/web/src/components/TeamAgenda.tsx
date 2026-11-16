import type { TeamAgendaTask } from "@agenteschat/client";
import { useTeamAgenda } from "@agenteschat/client";
import { can } from "@agenteschat/client/lib/permissions";
import {
  type AgendaDay,
  type AgendaPerson,
  addDays,
  agendaByAssignee,
  agendaView,
  daysBetween,
  localDay,
  TEAM_AGENDA_DAYS,
  tasksByDay,
} from "@agenteschat/client/lib/team-agenda";
import { Button, Chip, GroupHeading, Segmented, Select } from "@agenteschat/ui";
import { Link } from "@tanstack/react-router";
import type { TFunction } from "i18next";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { ActorAvatar } from "@/components/AgentAvatar";
import { useOrg } from "@/components/org-context";
import { useDirectory } from "@/hooks/useDirectory";
import { useNow } from "@/hooks/useNow";
import "@/pages/portal.css";

/** Everyone, or one person's or agent's agenda (`person:<id>`, `agent:<id>`). */
const ALL = "all";

/** "Semana": every day of the week shown, none picked. */
const WEEK = "week";
/** How many weeks ahead the arrows reach. */
const WEEKS_AHEAD = 8;

/**
 * "Agenda da equipe" on Home, for owners and administrators: what each person (then each agent) is doing now and has
 * to do in the week, from the tasks' due dates, late ones first. A strip of days picks one ("Amanhã", "Ter 17") and the
 * arrows go a week at a time. The portal's cards are tasks with their production day as the due date, so a post to
 * make shows on the day it is to be made.
 */
export function TeamAgenda() {
  const { t, i18n } = useTranslation();
  const { org } = useOrg();
  const dir = useDirectory(org.id);
  const now = useNow(60_000);
  const admin = can(org, "administrator");
  const today = localDay(new Date(now));
  const [weeks, setWeeks] = useState(0);
  const [day, setDay] = useState<string>(WEEK);
  const from = addDays(today, weeks * TEAM_AGENDA_DAYS);
  const agenda = useTeamAgenda(org.id, from, TEAM_AGENDA_DAYS, admin).data;
  const [picked, setPicked] = useState(ALL);
  // Nothing at all to do, this week or late: Home shows nothing here. Another week keeps the strip to come back.
  if (!admin || !agenda || (weeks === 0 && agenda.tasks.length === 0)) return null;

  const name = (a: TeamAgendaTask["assignee"]) =>
    a.type === "agent"
      ? (dir.anyAgent(a.id)?.name ?? t("channel.unknownAgent"))
      : (dir.memberById.get(a.id)?.name ?? t("channel.unknownPerson"));
  const everyone = agendaByAssignee(agenda, name);
  const keyOf = (p: AgendaPerson) => `${p.assignee.type}:${p.assignee.id}`;
  const chosen = picked === ALL ? [] : everyone.filter((p) => keyOf(p) === picked);
  const whose = chosen.length > 0 ? chosen : everyone;
  const week = agendaView(whose, { today, from, day: null });
  const counts = tasksByDay(week);
  const days = Array.from({ length: TEAM_AGENDA_DAYS }, (_, i) => addDays(from, i));
  const shownDay = days.includes(day) ? day : null;
  const list = agendaView(whose, { today, from, day: shownDay });
  const total = list.reduce((n, p) => n + p.count, 0);
  const goWeek = (n: number) => {
    setWeeks(n);
    setDay(WEEK);
  };

  return (
    <section className="home-sec team-agenda" aria-label={t("home.agenda.title")}>
      <GroupHeading
        title={t("home.agenda.title")}
        count={total}
        aside={
          everyone.length > 1 ? (
            <Select
              size="sm"
              align="end"
              aria-label={t("home.agenda.who")}
              value={chosen.length > 0 ? picked : ALL}
              onValueChange={setPicked}
              options={[
                { value: ALL, label: t("home.agenda.everyone") },
                ...everyone.map((p) => ({
                  value: keyOf(p),
                  label: name(p.assignee),
                  leading: <ActorAvatar actor={p.assignee} name={name(p.assignee)} size="xs" />,
                })),
              ]}
            />
          ) : null
        }
      />
      <div className="team-agenda__days">
        <Button
          size="sm"
          variant="ghost"
          icon="chevronLeft"
          iconOnly
          aria-label={t("home.agenda.prevWeek")}
          disabled={weeks === 0}
          onClick={() => goWeek(weeks - 1)}
        />
        <Segmented
          size="sm"
          className="team-agenda__strip"
          label={t("home.agenda.pickDay")}
          value={shownDay ?? WEEK}
          onValueChange={setDay}
          options={[
            { value: WEEK, label: t(weeks === 0 ? "home.agenda.thisWeek" : "home.agenda.wholeWeek") },
            ...days.map((d) => ({
              value: d,
              label: chipDay(t, i18n.language, d, today),
              hint: counts.get(d) || undefined,
            })),
          ]}
        />
        <Button
          size="sm"
          variant="ghost"
          icon="chevronRight"
          iconOnly
          aria-label={t("home.agenda.nextWeek")}
          disabled={weeks >= WEEKS_AHEAD}
          onClick={() => goWeek(weeks + 1)}
        />
      </div>
      {list.length > 0 ? (
        <div className="team-agenda__people">
          {list.map((p) => (
            <PersonAgenda key={keyOf(p)} person={p} name={name(p.assignee)} today={today} />
          ))}
        </div>
      ) : (
        <p className="list-card team-agenda__none">{shownDay ? t("home.agenda.noneDay") : t("home.agenda.noneWeek")}</p>
      )}
    </section>
  );
}

function PersonAgenda({ person, name, today }: { person: AgendaPerson; name: string; today: string }) {
  const { t } = useTranslation();
  const todayCount = person.days.find((d) => d.key === today)?.tasks.length ?? 0;
  const summary = [
    person.now > 0 ? t("home.agenda.nowCount", { count: person.now }) : "",
    person.late > 0 ? t("home.agenda.lateCount", { count: person.late }) : "",
    todayCount > 0 ? t("home.agenda.todayCount", { count: todayCount }) : "",
    t("home.agenda.total", { count: person.count }),
  ]
    .filter(Boolean)
    .join(" · ");
  return (
    <section className="list-card team-agenda__person" aria-label={name}>
      <header className="team-agenda__who">
        <ActorAvatar actor={person.assignee} name={name} size="sm" />
        <span className="team-agenda__name">{name}</span>
        <span className="team-agenda__sum">{summary}</span>
      </header>
      {person.days.map((day) => (
        <DayGroup key={day.key} day={day} today={today} />
      ))}
    </section>
  );
}

function DayGroup({ day, today }: { day: AgendaDay; today: string }) {
  const { t, i18n } = useTranslation();
  const label =
    day.kind === "now"
      ? t("home.agenda.now")
      : day.kind === "late"
        ? t("home.agenda.late")
        : dayLabel(t, i18n.language, day.key, today);
  return (
    <section className="home-tasks__group" data-group={day.kind === "day" ? undefined : day.kind} aria-label={label}>
      <h3 className="home-tasks__name">
        {label}
        <span className="tabular">{day.tasks.length}</span>
      </h3>
      <ul className="home-tasks__list">
        {day.tasks.map((task) => (
          <AgendaRow key={task.id} task={task} kind={day.kind} today={today} />
        ))}
      </ul>
    </section>
  );
}

function AgendaRow({ task, kind, today }: { task: TeamAgendaTask; kind: AgendaDay["kind"]; today: string }) {
  const { t, i18n } = useTranslation();
  const { org } = useOrg();
  return (
    <li>
      <Link
        className="home-tasks__row"
        to="/org/$orgId/issues/$number"
        params={{ orgId: org.id, number: String(task.number) }}
      >
        <span className="home-tasks__text">
          <span className="home-tasks__title">{task.title}</span>
          <span className="home-tasks__meta">
            <span className="tabular">#{task.number}</span>
            {task.project && <span>{task.project.name}</span>}
            {task.dueDate && kind !== "day" && (
              <span>
                {task.dueDate < today
                  ? t("home.agenda.wasDue", { when: shortDay(i18n.language, task.dueDate) })
                  : t("home.agenda.due", { when: dayLabel(t, i18n.language, task.dueDate, today, true) })}
              </span>
            )}
          </span>
        </span>
        {(task.status === "in_review" || task.blocked || task.priority === "high") && (
          <span className="home-tasks__chips">
            {task.priority === "high" && <Chip tone="waiting">{t("home.agenda.high")}</Chip>}
            {task.blocked && <Chip tone="waiting">{t("home.agenda.blocked")}</Chip>}
            {task.status === "in_review" && <Chip tone="info">{t(`home.agenda.status.${task.status}`)}</Chip>}
          </span>
        )}
      </Link>
    </li>
  );
}

const dateOf = (day: string) => {
  const [y = 0, m = 1, d = 1] = day.split("-").map(Number);
  return new Date(y, m - 1, d);
};

/** "16 nov". */
function shortDay(locale: string, day: string) {
  return new Intl.DateTimeFormat(locale, { day: "numeric", month: "short" }).format(dateOf(day));
}

/** "Hoje · segunda, 16", "Amanhã · terça, 17", "quarta, 18"; `short`: "hoje", "amanhã", "quarta, 18". */
function dayLabel(t: TFunction, locale: string, day: string, today: string, short = false) {
  const text = new Intl.DateTimeFormat(locale, { weekday: "long", day: "numeric" }).format(dateOf(day));
  const away = daysBetween(today, day);
  if (short && away === 0) return t("home.agenda.todayShort");
  if (short && away === 1) return t("home.agenda.tomorrowShort");
  if (short) return text;
  if (away === 0) return t("home.agenda.today", { day: text });
  if (away === 1) return t("home.agenda.tomorrow", { day: text });
  return text.charAt(0).toLocaleUpperCase(locale) + text.slice(1);
}

/** A day in the strip: "Hoje", "Amanhã", then "ter. 17". */
function chipDay(t: TFunction, locale: string, day: string, today: string) {
  const away = daysBetween(today, day);
  if (away === 0) return t("home.agenda.todayChip");
  if (away === 1) return t("home.agenda.tomorrowChip");
  const text = new Intl.DateTimeFormat(locale, { weekday: "short", day: "numeric" }).format(dateOf(day));
  return text.charAt(0).toLocaleUpperCase(locale) + text.slice(1);
}
