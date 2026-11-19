import type { TeamAgendaTask } from "@agenteschat/client";
import { useMoveInQueue, useTeamAgenda } from "@agenteschat/client";
import { can } from "@agenteschat/client/lib/permissions";
import {
  type AgendaItem,
  type AgendaPerson,
  addDays,
  agendaByAssignee,
  agendaView,
  daysBetween,
  localDay,
  queueMoveFor,
  TEAM_AGENDA_DAYS,
  tasksByDay,
} from "@agenteschat/client/lib/team-agenda";
import { Button, Chip, GroupHeading, Segmented, Select } from "@agenteschat/ui";
import { Link } from "@tanstack/react-router";
import type { TFunction } from "i18next";
import { type KeyboardEvent, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { ActorAvatar } from "@/components/AgentAvatar";
import { useOrg } from "@/components/org-context";
import { useQueueDrag } from "@/components/queue-drag";
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
 * "Agenda da equipe" on Home, for owners and administrators: each person's (then each agent's) queue, the tasks they
 * have in the order they are to do them (ADR doug-0022). A task joins the end of its assignee's queue when it reaches
 * them; dragging it by its handle, or its handle's arrow keys, moves it up or down, and that order is the priority.
 * Each row keeps its date as a chip, late ones marked. A strip of days picks one ("Amanhã", "Ter 17"), still in queue
 * order, and the arrows go a week at a time. The portal's cards are tasks with their production day as the due date.
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
  const move = useMoveInQueue(org.id);
  const [said, setSaid] = useState("");
  // The drop reads what this render shows: set below, once the lanes are known.
  const dropTo = useRef<(lane: string, id: string, index: number) => void>(() => {});
  const drag = useQueueDrag({ enabled: admin, onDrop: (lane, id, index) => dropTo.current(lane, id, index) });
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
  /** `id` put at `index` among the other tasks `lane` shows: one move in that assignee's queue. */
  const moveTo = (lane: string, id: string, index: number) => {
    const shown = list.find((p) => keyOf(p) === lane);
    const whole = everyone.find((p) => keyOf(p) === lane);
    if (!shown || !whole) return;
    const queue = whole.tasks.map((i) => i.task.id);
    const at = queueMoveFor(
      queue,
      shown.tasks.map((i) => i.task.id),
      id,
      index,
    );
    if (!at) return;
    move.mutate({ assignee: shown.assignee, taskId: id, afterId: at.afterId });
    const others = shown.tasks.filter((i) => i.task.id !== id);
    const number = shown.tasks.find((i) => i.task.id === id)?.task.number ?? 0;
    setSaid(t("home.agenda.queue.moved", { number, place: Math.min(index, others.length) + 1, count: shown.count }));
  };
  dropTo.current = moveTo;

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
            <PersonAgenda
              key={keyOf(p)}
              lane={keyOf(p)}
              person={p}
              name={name(p.assignee)}
              today={today}
              drag={drag}
              onStep={(id, index) => moveTo(keyOf(p), id, index)}
            />
          ))}
        </div>
      ) : (
        <p className="list-card team-agenda__none">{shownDay ? t("home.agenda.noneDay") : t("home.agenda.noneWeek")}</p>
      )}
      <p className="ac-visually-hidden" aria-live="polite">
        {said}
      </p>
    </section>
  );
}

type QueueDrag = ReturnType<typeof useQueueDrag>;

function PersonAgenda({
  lane,
  person,
  name,
  today,
  drag,
  onStep,
}: {
  lane: string;
  person: AgendaPerson;
  name: string;
  today: string;
  drag: QueueDrag;
  /** The keyboard's move: `id` to `index` among the others. */
  onStep: (id: string, index: number) => void;
}) {
  const { t } = useTranslation();
  const todayCount = person.tasks.filter((i) => i.task.dueDate === today).length;
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
      <ol className="home-tasks__list team-queue" data-queue={lane} aria-label={t("home.agenda.queue.list", { name })}>
        {person.tasks.map((item, i) => (
          <QueueRow
            key={item.task.id}
            item={item}
            place={i + 1}
            today={today}
            drag={drag}
            onKey={(e) => {
              const step = e.key === "ArrowUp" ? -1 : e.key === "ArrowDown" ? 1 : 0;
              if (!step || e.altKey || e.ctrlKey || e.metaKey || e.shiftKey) return;
              e.preventDefault();
              const index = i + step;
              if (index < 0 || index >= person.tasks.length) return;
              onStep(item.task.id, index);
            }}
          />
        ))}
      </ol>
    </section>
  );
}

function QueueRow({
  item,
  place,
  today,
  drag,
  onKey,
}: {
  item: AgendaItem;
  place: number;
  today: string;
  drag: QueueDrag;
  onKey: (e: KeyboardEvent<HTMLButtonElement>) => void;
}) {
  const { t, i18n } = useTranslation();
  const { org } = useOrg();
  const { task, kind } = item;
  const drop = drag.drop?.id === task.id ? drag.drop.where : undefined;
  return (
    <li
      className="team-queue__row"
      data-queue-row={task.id}
      data-drop={drop}
      data-lifted={drag.lifted === task.id || undefined}
      data-kind={kind}
    >
      <Button
        size="sm"
        variant="ghost"
        icon="grip"
        iconOnly
        className="team-queue__grip"
        aria-label={t("home.agenda.queue.move", { number: task.number })}
        onKeyDown={onKey}
        {...drag.handle(task.id)}
      />
      <span className="team-queue__place tabular" aria-hidden="true">
        {place}
      </span>
      <Link
        className="home-tasks__row team-queue__task"
        to="/org/$orgId/issues/$number"
        params={{ orgId: org.id, number: String(task.number) }}
        draggable={false}
      >
        <span className="home-tasks__text">
          <span className="home-tasks__title">{task.title}</span>
          <span className="home-tasks__meta">
            <span className="tabular">#{task.number}</span>
            {task.project && <span>{task.project.name}</span>}
          </span>
        </span>
        <span className="home-tasks__chips">
          {kind === "late" && task.dueDate && (
            <Chip tone="waiting" icon="alert">
              {t("home.agenda.wasDue", { when: shortDay(i18n.language, task.dueDate) })}
            </Chip>
          )}
          {kind !== "late" && task.dueDate && (
            <Chip icon="calendar">
              {t("home.agenda.due", { when: dayLabel(t, i18n.language, task.dueDate, today, true) })}
            </Chip>
          )}
          {kind === "now" && <Chip tone="info">{t(`home.agenda.status.${task.status as "in_progress"}`)}</Chip>}
          {task.priority === "high" && <Chip tone="waiting">{t("home.agenda.high")}</Chip>}
          {task.blocked && <Chip tone="waiting">{t("home.agenda.blocked")}</Chip>}
        </span>
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
