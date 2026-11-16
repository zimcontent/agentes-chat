import type { TeamAgendaTask } from "@agenteschat/client";
import { useTeamAgenda } from "@agenteschat/client";
import { can } from "@agenteschat/client/lib/permissions";
import {
  type AgendaDay,
  type AgendaPerson,
  agendaByAssignee,
  daysBetween,
  localDay,
  TEAM_AGENDA_DAYS,
} from "@agenteschat/client/lib/team-agenda";
import { Chip, GroupHeading, Select } from "@agenteschat/ui";
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

/**
 * "Agenda da equipe" on Home, for owners and administrators: what each person (then each agent) has to do today and
 * in the next days, from the tasks' due dates, late ones first. The portal's cards are tasks with their production
 * day as the due date, so a post to make shows on the day it is to be made. Only with something on it.
 */
export function TeamAgenda() {
  const { t } = useTranslation();
  const { org } = useOrg();
  const dir = useDirectory(org.id);
  const now = useNow(60_000);
  const admin = can(org, "administrator");
  const today = localDay(new Date(now));
  const agenda = useTeamAgenda(org.id, today, TEAM_AGENDA_DAYS, admin).data;
  const [picked, setPicked] = useState(ALL);
  if (!admin || !agenda || agenda.tasks.length === 0) return null;

  const name = (a: TeamAgendaTask["assignee"]) =>
    a.type === "agent"
      ? (dir.anyAgent(a.id)?.name ?? t("channel.unknownAgent"))
      : (dir.memberById.get(a.id)?.name ?? t("channel.unknownPerson"));
  const people = agendaByAssignee(agenda, name);
  const keyOf = (p: AgendaPerson) => `${p.assignee.type}:${p.assignee.id}`;
  const shown = picked === ALL ? people : people.filter((p) => keyOf(p) === picked);
  const list = shown.length > 0 ? shown : people;

  return (
    <section className="home-sec team-agenda" aria-label={t("home.agenda.title")}>
      <GroupHeading
        title={t("home.agenda.title")}
        count={agenda.tasks.length}
        aside={
          people.length > 1 ? (
            <Select
              size="sm"
              align="end"
              aria-label={t("home.agenda.who")}
              value={list === people ? ALL : picked}
              onValueChange={setPicked}
              options={[
                { value: ALL, label: t("home.agenda.everyone") },
                ...people.map((p) => ({
                  value: keyOf(p),
                  label: name(p.assignee),
                  leading: <ActorAvatar actor={p.assignee} name={name(p.assignee)} size="xs" />,
                })),
              ]}
            />
          ) : null
        }
      />
      <div className="team-agenda__people">
        {list.map((p) => (
          <PersonAgenda key={keyOf(p)} person={p} name={name(p.assignee)} today={today} />
        ))}
      </div>
    </section>
  );
}

function PersonAgenda({ person, name, today }: { person: AgendaPerson; name: string; today: string }) {
  const { t } = useTranslation();
  const todayCount = person.days.find((d) => d.key === today)?.tasks.length ?? 0;
  const summary = [
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
  const label = day.late ? t("home.agenda.late") : dayLabel(t, i18n.language, day.key, today);
  return (
    <section className="home-tasks__group" data-group={day.late ? "late" : undefined} aria-label={label}>
      <h3 className="home-tasks__name">
        {label}
        <span className="tabular">{day.tasks.length}</span>
      </h3>
      <ul className="home-tasks__list">
        {day.tasks.map((task) => (
          <AgendaRow key={task.id} task={task} late={day.late} />
        ))}
      </ul>
    </section>
  );
}

function AgendaRow({ task, late }: { task: TeamAgendaTask; late: boolean }) {
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
            {late && <span>{t("home.agenda.wasDue", { when: shortDay(i18n.language, task.dueDate) })}</span>}
          </span>
        </span>
        {(task.status !== "todo" || task.blocked || task.priority === "high") && (
          <span className="home-tasks__chips">
            {task.priority === "high" && <Chip tone="waiting">{t("home.agenda.high")}</Chip>}
            {task.blocked && <Chip tone="waiting">{t("home.agenda.blocked")}</Chip>}
            {task.status !== "todo" && <Chip tone="info">{t(`home.agenda.status.${task.status}`)}</Chip>}
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

/** "Hoje · segunda, 16", "Amanhã · terça, 17", "quarta, 18". */
function dayLabel(t: TFunction, locale: string, day: string, today: string) {
  const text = new Intl.DateTimeFormat(locale, { weekday: "long", day: "numeric" }).format(dateOf(day));
  const away = daysBetween(today, day);
  if (away === 0) return t("home.agenda.today", { day: text });
  if (away === 1) return t("home.agenda.tomorrow", { day: text });
  return text.charAt(0).toLocaleUpperCase(locale) + text.slice(1);
}
