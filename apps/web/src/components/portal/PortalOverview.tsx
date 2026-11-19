import type { PortalClientSummary, PortalColumn, PortalPipelineEntry } from "@dougbot/client";
import { useChannels, usePortalPipeline, usePortalTasks } from "@dougbot/client";
import { can } from "@dougbot/client/lib/permissions";
import {
  filterPipeline,
  PORTAL_FOCI,
  PORTAL_PIPELINE_STAGES,
  type PortalClientStatus,
  type PortalFocus,
  pipelineClients,
  pipelineNextPost,
  pipelinePeople,
  pipelineSteps,
  pipelineTiles,
  portalClientName,
  portalStatusWaits,
  portalTaskNumbers,
  portalWhen,
  sortPipelineByProduction,
} from "@dougbot/client/lib/portal";
import {
  AvatarStack,
  Button,
  Chip,
  EmptyState,
  FilterToggle,
  GroupHeading,
  Icon,
  type IconName,
  type LineFact,
  Select,
} from "@dougbot/ui";
import { Link, useNavigate } from "@tanstack/react-router";
import type { TFunction } from "i18next";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { PersonAvatar } from "@/components/AgentAvatar";
import { ErrorState, LoadingCards } from "@/components/Loading";
import { useOrg } from "@/components/org-context";
import { BoardColumn, BoardFrame, CardFace } from "./board-parts";
import { CardDialog } from "./CardDialog";
import { ClientDot, ClientMark, usePortalClientColors, usePortalClientLogos } from "./client-color";
import { HiddenClients } from "./client-edit";
import { MemberFaces, usePortalPeople, WhoFace } from "./members";
import { StageLegend } from "./PlanLegend";
import { type PortalSearch, usePortalSearch } from "./search";
import { StageChip, stageName } from "./stage";

/** Each column's icon: the stages of the team's work, then whose turn it is at the portal. */
export const COLUMN_ICON: Record<PortalColumn, IconName> = {
  todo: "stageTodo",
  doing: "stageProgress",
  approval: "eye",
  adjusting: "alert",
  approved: "check",
  scheduled: "calendar",
  posted: "stageDone",
};

const ALL = "all";
const ME = "me";
/** How many faces a client's row shows before "+n". */
const FACES = 4;

/** A client's one line, in words. */
const statusText = (t: TFunction, status: PortalClientStatus) =>
  status.kind === "adjusting"
    ? t("portal.adjustments", { count: status.count })
    : status.kind === "late" || status.kind === "send" || status.kind === "schedule" || status.kind === "client"
      ? t(`portal.home.status.${status.kind}`, { count: status.count })
      : status.kind === "making"
        ? t("portal.columns.doing")
        : t(`portal.home.status.${status.kind}`);

/**
 * The portal's first screen (ADR 9001 §10), read from top to bottom: what needs the team now (four numbers, each a
 * filter of the pipeline below), how each client is (a card with the one thing that matters most about it, its work
 * along the line stage by stage, who is on it and its next post), and the whole pipeline across clients, as the
 * boards' own columns and cards or as a list. Nothing here changes anything: a client's card opens the client, a
 * piece of work its schedule. What
 * is filtered and how it is shown lives in the URL (`of`, `who`, `stage`, `view=list`).
 *
 * Every card is also a task of the workspace (ADR 9001): the pipeline says each one's number, "New task" makes a
 * card for any client from here (whoever may give agents work), and "See all tasks" goes to the tasks' own page.
 */
export function PortalOverview({
  clients,
  hidden,
}: {
  clients: PortalClientSummary[];
  /** The clients the team hid, for who may show them again (empty for anyone else). */
  hidden: readonly { client: string }[];
}) {
  const { t } = useTranslation();
  const { org, me } = useOrg();
  const pipeline = usePortalPipeline(org.id);
  const numbers = portalTaskNumbers(usePortalTasks(org.id).data);
  const { search, go } = usePortalSearch();
  const [creating, setCreating] = useState(false);
  const names = clients.map((c) => c.client);
  if (pipeline.isLoading) return <LoadingCards count={3} />;
  if (!pipeline.data) return <ErrorState error={pipeline.error} onRetry={() => void pipeline.refetch()} />;
  const { entries, day } = pipeline.data;
  const set = (change: Partial<PortalSearch>) => {
    const next = { ...search, ...change };
    for (const key of Object.keys(next) as (keyof PortalSearch)[]) if (next[key] === undefined) delete next[key];
    go(next, true);
  };
  const focus = search.stage ?? null;
  const who = search.who === ME ? me.user.id : (search.who ?? null);
  const shown = filterPipeline(entries, { client: search.of, who, focus });
  const filtered = Boolean(search.of || search.who || search.stage);
  return (
    <div className="portal-home">
      <Tiles entries={entries} focus={focus} onFocus={(next) => set({ stage: next ?? undefined })} />
      <Clients names={names} entries={entries} day={day} />
      <section className="portal-home__part" aria-label={t("portal.home.pipeline")}>
        <GroupHeading
          title={t("portal.home.pipeline")}
          count={shown.length}
          aside={
            <span className="portal-home__acts">
              <Link className="ac-link small" to="/org/$orgId/issues" params={{ orgId: org.id }}>
                {t("portal.home.allTasks")}
              </Link>
              {can(org, "assign_work") && (
                <Button size="sm" icon="plus" onClick={() => setCreating(true)}>
                  {t("portal.home.newTask")}
                </Button>
              )}
              <fieldset className="portal-views" aria-label={t("portal.plan.view")}>
                <Button
                  size="sm"
                  variant="ghost"
                  iconOnly
                  icon="grid"
                  aria-label={t("portal.home.pipeline")}
                  title={t("portal.home.pipeline")}
                  aria-pressed={search.view !== "list"}
                  onClick={() => set({ view: undefined })}
                />
                <Button
                  size="sm"
                  variant="ghost"
                  iconOnly
                  icon="list"
                  aria-label={t("portal.home.viewList")}
                  title={t("portal.home.viewList")}
                  aria-pressed={search.view === "list"}
                  onClick={() => set({ view: "list" })}
                />
              </fieldset>
            </span>
          }
        />
        <Filters entries={entries} search={search} onChange={set} />
        {entries.length === 0 ? (
          <EmptyState size="panel" icon="stageDone" title={t("portal.home.nothingOpen")}>
            {t("portal.home.nothingOpenText")}
          </EmptyState>
        ) : shown.length === 0 && filtered ? (
          <EmptyState
            size="panel"
            icon="filter"
            title={t("portal.home.noMatch")}
            actions={
              <Button onClick={() => set({ of: undefined, who: undefined, stage: undefined })}>
                {t("portal.home.clear")}
              </Button>
            }
          />
        ) : search.view === "list" ? (
          <PipelineList entries={shown} numbers={numbers} />
        ) : (
          <PipelineBoard entries={shown} numbers={numbers} />
        )}
      </section>
      <HiddenClients hidden={hidden} />
      <CardDialog
        open={creating}
        client={null}
        clients={names}
        card={null}
        title={t("portal.home.newTask")}
        onClose={() => setCreating(false)}
      />
    </div>
  );
}

/**
 * "Now": four numbers, each with its name and one line of context. A press filters the pipeline to it (and again
 * shows everything). Only "Needs you" may take the attention tone, and only while it counts something.
 */
function Tiles({
  entries,
  focus,
  onFocus,
}: {
  entries: PortalPipelineEntry[];
  focus: PortalFocus | null;
  onFocus: (focus: PortalFocus | null) => void;
}) {
  const { t } = useTranslation();
  const n = pipelineTiles(entries);
  const hint: Record<PortalFocus, string> = {
    you: `${t("portal.columns.adjusting")} ${n.adjusting} · ${t("portal.home.lateWord")} ${n.late}`,
    making: `${t("portal.columns.todo")} ${n.todo} · ${t("portal.columns.doing")} ${n.doing}`,
    client: t("portal.home.clientHint"),
    schedule: t("portal.home.scheduled", { count: n.scheduled }),
  };
  return (
    <section className="portal-home__part" aria-label={t("portal.home.now")}>
      <GroupHeading title={t("portal.home.now")} />
      <div className="portal-tiles">
        {PORTAL_FOCI.map((key) => (
          <button
            key={key}
            type="button"
            className="portal-tile"
            data-focus={key}
            data-attention={(key === "you" && n.you > 0) || undefined}
            aria-pressed={focus === key}
            onClick={() => onFocus(focus === key ? null : key)}
          >
            <span className="portal-tile__num tabular">{n[key]}</span>
            <span className="portal-tile__name">{t(`portal.home.tiles.${key}`)}</span>
            <span className="portal-tile__hint">{hint[key]}</span>
          </button>
        ))}
      </div>
    </section>
  );
}

/**
 * "Clients": a card each, in the boards' own surface. Its head is the client's mark, its name and how many it has
 * open; its main line is the one thing that matters most about it (in the attention tone only when it waits on the
 * team); then its work along the line as a conveyor: a stop per stage, joined by a thin line, a stop with work
 * filled in the stage's colour with its count, an empty one a small hollow dot (the stage's name on hover and to a
 * screen reader, and in the legend under the grid); its foot is who is on it and its next post. The card opens the
 * client. Who waits on the team comes first, then the busiest; a client with nothing open last, quieter.
 */
function Clients({ names, entries, day }: { names: string[]; entries: PortalPipelineEntry[]; day: string }) {
  const { t, i18n } = useTranslation();
  const { org } = useOrg();
  const who = usePortalPeople();
  const channels = useChannels(org.id).data ?? [];
  const rows = pipelineClients(names, entries);
  const colors = usePortalClientColors();
  const logos = usePortalClientLogos();
  return (
    <section className="portal-home__part" aria-label={t("portal.home.clients")}>
      <GroupHeading title={t("portal.home.clients")} count={rows.length} />
      <ul className="portal-cards">
        {rows.map(({ client, entries: own, status }) => {
          const name = portalClientName(client);
          const people = who.known(pipelinePeople(own));
          const next = portalWhen(i18n.language, pipelineNextPost(own, day));
          const waits = portalStatusWaits(status);
          // A group named after the client lends it its photo.
          const photo = channels.find(
            (c) => c.icon && [client, name.toLowerCase()].includes(c.name.toLowerCase()),
          )?.icon;
          return (
            <li key={client}>
              <Link
                className="issue-card portal-card portal-clientcard"
                to="/org/$orgId/portal"
                params={{ orgId: org.id }}
                search={{ client }}
                data-idle={status.kind === "idle" || undefined}
              >
                <span className="portal-clientcard__head" data-client-color={colors.get(client)}>
                  <ClientMark client={client} logo={logos.get(client)} photo={photo} color={colors.get(client)} />
                  <span className="portal-clientcard__name" title={name}>
                    {name}
                  </span>
                  {own.length > 0 && (
                    <span className="portal-clientcard__open">{t("portal.open", { count: own.length })}</span>
                  )}
                </span>
                <span className="portal-clientcard__status" data-attention={waits || undefined}>
                  {waits ? (
                    <Icon name="alert" size={16} />
                  ) : status.kind === "clear" ? (
                    <Icon name="check" size={16} />
                  ) : null}
                  {statusText(t, status)}
                </span>
                <ol className="portal-stats" aria-label={t("portal.home.pipeline")}>
                  {pipelineSteps(own).map((step) => (
                    <li
                      key={step.stage}
                      className="portal-stat"
                      data-stage={step.stage}
                      data-empty={step.count === 0 || undefined}
                    >
                      <span className="portal-dot" data-stage={step.stage} aria-hidden="true" />
                      <span className="portal-stat__name">{stageName(t, step.stage)}</span>
                      <b className="portal-stat__num tabular">{step.count}</b>
                    </li>
                  ))}
                </ol>
                {(people.length > 0 || next) && (
                  <span className="portal-clientcard__foot">
                    <span className="portal-clientcard__people">
                      {people.length > 0 && (
                        <AvatarStack>
                          {people.slice(0, FACES).map((w) => (
                            <WhoFace key={w.id} who={w} size="xs" title={w.name} labelled />
                          ))}
                        </AvatarStack>
                      )}
                      {people.length > FACES && (
                        <span
                          className="portal-clientcard__more tabular"
                          title={people
                            .slice(FACES)
                            .map((m) => m.name)
                            .join(", ")}
                        >
                          <span aria-hidden="true">+{people.length - FACES}</span>
                          <span className="ac-visually-hidden">
                            {t("portal.home.morePeople", { count: people.length - FACES })}
                          </span>
                        </span>
                      )}
                    </span>
                    {next && (
                      <span className="portal-clientcard__next">
                        <span className="portal-clientcard__label">{t("portal.home.nextPost")}</span>
                        <span className="tabular">{next}</span>
                      </span>
                    )}
                  </span>
                )}
              </Link>
            </li>
          );
        })}
      </ul>
      <div className="portal-home__legend">
        <StageLegend stages={PORTAL_PIPELINE_STAGES} />
      </div>
    </section>
  );
}

/**
 * The pipeline's filters: one client's work, one person's ("Only me" among them) or one agent's (after the people),
 * and the four tiles'.
 */
function Filters({
  entries,
  search,
  onChange,
}: {
  entries: PortalPipelineEntry[];
  search: PortalSearch;
  onChange: (change: Partial<PortalSearch>) => void;
}) {
  const { t } = useTranslation();
  const { me } = useOrg();
  const clients = [...new Set(entries.map((e) => e.client))].sort();
  const people = usePortalPeople()
    .choices(search.who ? [search.who] : [])
    .filter((w) => w.id !== me.user.id);
  const n = pipelineTiles(entries);
  return (
    <div className="portal-filters">
      <Select
        size="sm"
        aria-label={t("portal.form.client")}
        value={search.of ?? ALL}
        onValueChange={(v) => onChange({ of: v === ALL ? undefined : v })}
        options={[
          { value: ALL, label: t("portal.allClients") },
          ...clients.map((c) => ({ value: c, label: portalClientName(c) })),
        ]}
      />
      <Select
        size="sm"
        aria-label={t("portal.home.person")}
        value={search.who === me.user.id ? ME : (search.who ?? ALL)}
        onValueChange={(v) => onChange({ who: v === ALL ? undefined : v })}
        options={[
          { value: ALL, label: t("portal.home.everyone") },
          {
            value: ME,
            label: t("portal.home.onlyMe"),
            leading: <PersonAvatar id={me.user.id} name={me.user.name} size="xs" />,
          },
          ...people.map((w) => ({ value: w.id, label: w.name, leading: <WhoFace who={w} size="xs" /> })),
        ]}
      />
      <span className="portal-filters__chips">
        {PORTAL_FOCI.map((key) => (
          <FilterToggle
            key={key}
            pressed={search.stage === key}
            onPressedChange={(on) => onChange({ stage: on ? key : undefined })}
            count={n[key]}
          >
            {t(`portal.home.tiles.${key}`)}
          </FilterToggle>
        ))}
      </span>
    </div>
  );
}

/** Where a piece of work opens: its card on the client's schedule, or the client's board for a post with no card. */
const entrySearch = (e: PortalPipelineEntry): PortalSearch =>
  e.kind === "card" ? { client: e.client, tab: "plan", card: e.id } : { client: e.client };

/** A card's task number as the pipeline says it ("#12"); a post with no card has none. */
const taskOf = (numbers: ReadonlyMap<string, number>, e: PortalPipelineEntry) =>
  e.kind === "card" ? numbers.get(e.id) : undefined;

/**
 * The pipeline as the boards' own columns and cards, read only: each card says its client first, then its type, and
 * that it is late when its production day passed; then its task's number, the day it is made and the day it goes
 * out, who is on it, and what the client asked when it waits on an adjustment (outside text: plain words). A press
 * opens it at its client. The board's empty space drags it sideways; no card moves here.
 */
function PipelineBoard({ entries, numbers }: { entries: PortalPipelineEntry[]; numbers: ReadonlyMap<string, number> }) {
  const { t, i18n } = useTranslation();
  const { org } = useOrg();
  const navigate = useNavigate();
  const colors = usePortalClientColors();
  return (
    <BoardFrame className="portal-pipeline">
      {PORTAL_PIPELINE_STAGES.map((stage) => {
        const cards = entries.filter((e) => e.stage === stage);
        return (
          <BoardColumn
            key={stage}
            name={t(`portal.columns.${stage}`)}
            icon={COLUMN_ICON[stage]}
            count={cards.length}
            data-attention={(stage === "adjusting" && cards.length > 0) || undefined}
          >
            <div className="issues-col__cards">
              {cards.length === 0 && <p className="issues-col__empty">{t("portal.empty.column")}</p>}
              {cards.map((e) => {
                const produce = portalWhen(i18n.language, e.produceOn);
                const post = portalWhen(i18n.language, e.postOn);
                const task = taskOf(numbers, e);
                const facts: LineFact[] = [
                  ...(task !== undefined
                    ? [{ key: "task", text: `#${task}`, title: t("portal.task", { number: task }) }]
                    : []),
                  ...(produce
                    ? [
                        {
                          key: "produce",
                          icon: "clock" as const,
                          text: produce,
                          title: t("portal.plan.produceOn", { when: produce }),
                          ...(e.late ? { tone: "warn" as const } : {}),
                        },
                      ]
                    : []),
                  ...(post
                    ? [
                        {
                          key: "post",
                          icon: "calendar" as const,
                          text: post,
                          title: t("portal.plan.postOn", { when: post }),
                        },
                      ]
                    : []),
                ];
                return (
                  <CardFace
                    key={`${e.client}/${e.kind}/${e.id}`}
                    id={e.id}
                    title={e.title}
                    label={`${portalClientName(e.client)}: ${e.title}`}
                    data-late={e.late || undefined}
                    data-client-color={colors.get(e.client)}
                    onOpen={() =>
                      void navigate({ to: "/org/$orgId/portal", params: { orgId: org.id }, search: entrySearch(e) })
                    }
                    chips={
                      <>
                        <Chip className="portal-clientchip" data-client-color={colors.get(e.client)}>
                          {portalClientName(e.client)}
                        </Chip>
                        <Chip>{t(`portal.types.${e.type}`)}</Chip>
                        {e.late && (
                          <Chip icon="alert" tone="waiting">
                            {t("portal.home.late")}
                          </Chip>
                        )}
                      </>
                    }
                    facts={facts}
                    people={<MemberFaces ids={e.members} max={FACES} className="portal-card__who" />}
                  >
                    {e.note && (
                      <p className="portal-card__note portal-card__note--asked">
                        <b>{t("portal.clientAsked")}</b>
                        {e.note}
                      </p>
                    )}
                  </CardFace>
                );
              })}
            </div>
          </BoardColumn>
        );
      })}
    </BoardFrame>
  );
}

/**
 * The pipeline as a table, for who reads lists: a group per stage, a row per piece of work with its client, title,
 * type, who is on it, the day it is made and the day it goes out. The production column's head turns its order
 * around (soonest first by default; work with no day last either way). A title opens the work at its client, with
 * its task's number quietly after it.
 */
function PipelineList({ entries, numbers }: { entries: PortalPipelineEntry[]; numbers: ReadonlyMap<string, number> }) {
  const { t, i18n } = useTranslation();
  const { org } = useOrg();
  const [desc, setDesc] = useState(false);
  const colors = usePortalClientColors();
  return (
    <div className="list-card portal-table__wrap">
      <table className="portal-table">
        <thead>
          <tr>
            <th scope="col">{t("portal.form.client")}</th>
            <th scope="col">{t("portal.form.title")}</th>
            <th scope="col">{t("portal.form.type")}</th>
            <th scope="col">{t("portal.home.people")}</th>
            <th scope="col" aria-sort={desc ? "descending" : "ascending"}>
              <button
                type="button"
                className="portal-table__sort"
                title={t("portal.home.sortProduce")}
                onClick={() => setDesc((v) => !v)}
              >
                {t("portal.home.produce")}
                <Icon name={desc ? "arrowDown" : "arrowUp"} size={14} />
              </button>
            </th>
            <th scope="col">{t("portal.home.post")}</th>
          </tr>
        </thead>
        {PORTAL_PIPELINE_STAGES.map((stage) => {
          const rows = sortPipelineByProduction(
            entries.filter((e) => e.stage === stage),
            desc,
          );
          if (rows.length === 0) return null;
          return (
            <tbody key={stage} data-group={stage}>
              <tr className="portal-table__group">
                <th colSpan={6} scope="colgroup">
                  <StageChip stage={stage} />
                  <span className="tabular">{rows.length}</span>
                </th>
              </tr>
              {rows.map((e) => {
                const task = taskOf(numbers, e);
                return (
                  <tr key={`${e.client}/${e.kind}/${e.id}`} data-late={e.late || undefined}>
                    <td className="portal-table__client">
                      <ClientDot color={colors.get(e.client)} />
                      {portalClientName(e.client)}
                    </td>
                    <td className="portal-table__title">
                      <Link to="/org/$orgId/portal" params={{ orgId: org.id }} search={entrySearch(e)} title={e.title}>
                        {e.title}
                      </Link>
                      {task !== undefined && (
                        <span className="portal-table__task tabular" title={t("portal.task", { number: task })}>
                          #{task}
                        </span>
                      )}
                    </td>
                    <td>{t(`portal.types.${e.type}`)}</td>
                    <td>
                      <MemberFaces ids={e.members} max={FACES} className="portal-card__who" />
                    </td>
                    <td className="tabular">
                      {portalWhen(i18n.language, e.produceOn)}
                      {e.late && <span className="portal-table__late"> · {t("portal.home.late")}</span>}
                    </td>
                    <td className="tabular">{portalWhen(i18n.language, e.postOn)}</td>
                  </tr>
                );
              })}
            </tbody>
          );
        })}
      </table>
    </div>
  );
}
