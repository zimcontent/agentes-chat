import type { PlanCard, PortalCard, PortalItem, PortalPlan } from "@agenteschat/client";
import { isPortalOff, usePortalBoard, usePortalOverview, usePortalPlan, usePortalTasks } from "@agenteschat/client";
import {
  portalClientName,
  portalMonthName,
  portalPostedAt,
  portalPostedByMonth,
  portalScheduling,
  portalTaskNumbers,
  portalWhen,
} from "@agenteschat/client/lib/portal";
import { type ReactNode, useState } from "react";
import { useTranslation } from "react-i18next";
import { RefreshControl, StyleSheet, View } from "react-native";
import { Chip, EmptyState, GroupedHeader, GroupedList, GroupedRow, Segmented, SkeletonList, Text } from "@/ui";
import { useOrgId, usePullRefresh } from "../shared/hooks";
import { PushedLargeTitle } from "../shared/PushedLargeTitle";
import { RetryLine } from "../shared/TeamSkyEmpty";
import { usePortalWords } from "./hooks";
import { boardColumns, cardOfItem, columnCount, planGroups } from "./model";
import { CardCover, HeaderCount, openCard, openPost, PortalNotice, StageChip, StatusChip } from "./parts";
import type { PortalWords } from "./words";

type Tab = "board" | "plan" | "posted" | "materials";

/**
 * One client of the portal (ADR 9001), pushed from the Portal tab: its board as the web's columns, from To do to
 * Scheduled (a column with nothing in it isn't drawn), its strategic schedule by list, what was posted by month, and
 * its materials (logins, links, references). A team card or a post the team made from a card opens that card; a post
 * no card stands for opens the post itself.
 */
export function ClientScreen({ client }: { client: string }) {
  const w = usePortalWords();
  const orgId = useOrgId();
  const board = usePortalBoard(orgId, client);
  const plan = usePortalPlan(orgId, client);
  const summary = usePortalOverview(orgId).data?.clients.find((c) => c.client === client);
  const numbers = portalTaskNumbers(usePortalTasks(orgId).data);
  const [tab, setTab] = useState<Tab>("board");
  const pull = usePullRefresh(() => Promise.all([board.refetch(), plan.refetch()]));
  const off = isPortalOff(board.error);
  const posted = board.data?.items.posted.length;
  const shown = tab === "board" || tab === "posted" ? board : plan;
  return (
    <PushedLargeTitle
      title={portalClientName(client)}
      grouped
      refreshControl={<RefreshControl refreshing={pull.refreshing} onRefresh={pull.onRefresh} />}
    >
      <View style={styles.in}>
        {summary && summary.open > 0 ? (
          <Text variant="subhead" tone="muted">
            {w.open(summary.open)}
          </Text>
        ) : null}
        <Segmented
          wide
          value={tab}
          onChange={(v) => setTab(v as Tab)}
          items={[
            { key: "board", label: w.tabs.board },
            { key: "plan", label: w.tabs.plan },
            { key: "posted", label: w.tabs.posted, ...(posted ? { count: posted } : {}) },
            { key: "materials", label: w.tabs.materials },
          ]}
        />
        {off ? (
          <EmptyState size="page" icon="check" title={w.off} subtitle={w.offText} />
        ) : shown.isLoading ? (
          <SkeletonList rows={5} />
        ) : !shown.data ? (
          <RetryLine onRetry={() => void shown.refetch()} />
        ) : tab === "board" && board.data ? (
          <>
            <PortalNotice state={board.data.state} />
            <Board w={w} client={client} board={board.data} plan={plan.data} numbers={numbers} />
          </>
        ) : tab === "posted" && board.data ? (
          <Posted w={w} client={client} items={board.data.items.posted} plan={plan.data} />
        ) : plan.data ? (
          <Lists w={w} client={client} plan={plan.data} numbers={numbers} materials={tab === "materials"} />
        ) : null}
      </View>
    </PushedLargeTitle>
  );
}

/** The board's columns that hold something, each a group; nothing anywhere: one empty state. */
function Board({
  w,
  client,
  board,
  plan,
  numbers,
}: {
  w: PortalWords;
  client: string;
  board: NonNullable<ReturnType<typeof usePortalBoard>["data"]>;
  plan: PortalPlan | undefined;
  numbers: Map<string, number>;
}) {
  const when = useDayWords();
  const columns = boardColumns(board).filter((c) => columnCount(c) > 0);
  if (columns.length === 0) return <EmptyState size="page" icon="list" title={w.emptyColumn} />;
  return (
    <>
      {columns.map((col) => (
        <View key={col.column}>
          <GroupedHeader aside={<HeaderCount count={columnCount(col)} />}>{w.columns[col.column]}</GroupedHeader>
          <GroupedList>
            {col.cards.map((card) => teamRow(w, when, card, numbers.get(card.id)))}
            {col.items.map((item) => postRow(w, when, client, item, cardOfItem(plan, item.id), numbers))}
          </GroupedList>
        </View>
      ))}
    </>
  );
}

/** A client's schedule by list (the cards in no list last), or its materials' lists with what they are for. */
function Lists({
  w,
  client,
  plan,
  numbers,
  materials,
}: {
  w: PortalWords;
  client: string;
  plan: PortalPlan;
  numbers: Map<string, number>;
  materials: boolean;
}) {
  const when = useDayWords();
  const groups = planGroups(plan, materials ? "materials" : "plan").filter((g) => g.cards.length > 0);
  if (groups.length === 0) {
    return materials ? (
      <EmptyState size="page" icon="archive" title={w.noMaterials} subtitle={w.materialsIntro} />
    ) : (
      <EmptyState size="page" icon="calendar" title={w.noLists} subtitle={w.noListsText} />
    );
  }
  return (
    <>
      <PortalNotice state={plan.state} />
      {materials ? (
        <Text variant="footnote" tone="muted" style={styles.intro}>
          {w.materialsIntro}
        </Text>
      ) : null}
      {groups.map((g) => (
        <View key={g.id ?? "none"}>
          <GroupedHeader aside={<HeaderCount count={g.cards.length} />}>{g.name ?? w.noList}</GroupedHeader>
          <GroupedList>
            {g.cards.map((card) => planRow(w, when, client, card, numbers.get(card.id), materials))}
          </GroupedList>
        </View>
      ))}
    </>
  );
}

/** What went out, newest first under the month it went out. */
function Posted({
  w,
  client,
  items,
  plan,
}: {
  w: PortalWords;
  client: string;
  items: PortalItem[];
  plan: PortalPlan | undefined;
}) {
  const { i18n } = useTranslation();
  if (items.length === 0) return <EmptyState size="page" icon="check" title={w.noPosted} />;
  return (
    <>
      {portalPostedByMonth(items).map((group) => (
        <View key={group.month ?? "none"}>
          <GroupedHeader aside={<HeaderCount count={group.items.length} />}>
            {group.month ? portalMonthName(i18n.language, group.month) : w.noDate}
          </GroupedHeader>
          <GroupedList>
            {group.items.map((item) => {
              const card = cardOfItem(plan, item.id);
              const day = portalWhen(i18n.language, portalPostedAt(item));
              return (
                <GroupedRow
                  key={item.id}
                  label={item.title}
                  labelLines={2}
                  sub={[w.types[item.type], day ?? w.noDate].join(" · ")}
                  media
                  leading={<CardCover files={card?.files ?? []} />}
                  chevron
                  onPress={() => (card ? openCard(client, card.id) : openPost(client, item.id))}
                />
              );
            })}
          </GroupedList>
        </View>
      ))}
    </>
  );
}

type DayWords = (date: string | null | undefined) => string | null;

/** A portal date as the lists say it ("20 de nov., 14:00"), in the portal's own clock. */
function useDayWords(): DayWords {
  const { i18n } = useTranslation();
  return (date) => portalWhen(i18n.language, date);
}

/** A card the team still makes: its picture, title, type, post date and files; its task's number at the end. */
function teamRow(w: PortalWords, when: DayWords, card: PortalCard, task: number | undefined) {
  const day = when(card.date);
  const facts = [w.types[card.type], day, card.files.length > 0 ? w.fileCount(card.files.length) : null].filter(
    (f): f is string => Boolean(f),
  );
  return (
    <GroupedRow
      key={card.id}
      label={card.title}
      labelLines={2}
      sub={facts.join(" · ")}
      media
      leading={<CardCover files={card.files} />}
      {...(task !== undefined ? { value: `#${task}` } : {})}
      chevron
      onPress={() => openCard(card.client, card.id)}
    />
  );
}

/**
 * A post at the portal: where it stands, what it still lacks, and for one the client sent back, what they asked
 * (outside text, plain words). It opens the card it came from when there is one.
 */
function postRow(
  w: PortalWords,
  when: DayWords,
  client: string,
  item: PortalItem,
  card: PlanCard | null,
  numbers: Map<string, number>,
) {
  const day = when(item.scheduledFor);
  const facts = [w.types[item.type], day, item.editor].filter((f): f is string => Boolean(f));
  const asked =
    item.lastNote && (item.status === "adjust_requested" || item.status === "adjusting") ? item.lastNote : null;
  const task = card ? numbers.get(card.id) : undefined;
  return (
    <GroupedRow
      key={item.id}
      label={item.title}
      labelLines={2}
      sub={facts.join(" · ")}
      media
      leading={<CardCover files={card?.files ?? []} />}
      {...(task !== undefined ? { value: `#${task}` } : {})}
      below={
        <Chips>
          <StatusChip status={item.status} />
          {portalScheduling(item) ? <Chip icon="clock" label={w.scheduling} /> : null}
          {item.missing.map((m) => (
            <Chip key={m} icon="flag" label={w.missing[m]} />
          ))}
          {asked ? (
            <Text variant="footnote" tone="ink2" numberOfLines={3} style={styles.asked}>
              {`${asked.by || w.clientAsked}: ${asked.text}`}
            </Text>
          ) : null}
        </Chips>
      }
      chevron
      onPress={() => (card ? openCard(client, card.id) : openPost(client, item.id))}
    />
  );
}

/** A card of the schedule or the materials: its stage (none for a material: nothing there is work). */
function planRow(
  w: PortalWords,
  when: DayWords,
  client: string,
  card: PlanCard,
  task: number | undefined,
  material: boolean,
) {
  const day = when(card.postOn);
  const facts = material
    ? [card.files.length > 0 ? w.fileCount(card.files.length) : null]
    : [w.types[card.type], day ? `${w.postOn}: ${day}` : null];
  return (
    <GroupedRow
      key={card.id}
      label={card.title}
      labelLines={2}
      sub={facts.filter((f): f is string => Boolean(f)).join(" · ")}
      media
      leading={<CardCover files={card.files} />}
      {...(task !== undefined ? { value: `#${task}` } : {})}
      {...(material
        ? {}
        : {
            below: (
              <Chips>
                <StageChip stage={card.stage} />
                {card.done ? <Chip icon="check" label={w.done} /> : null}
              </Chips>
            ),
          })}
      faint={card.done}
      chevron
      onPress={() => openCard(client, card.id)}
    />
  );
}

function Chips({ children }: { children: ReactNode }) {
  return <View style={styles.chips}>{children}</View>;
}

const styles = StyleSheet.create({
  in: { paddingHorizontal: 16, gap: 16 },
  chips: { flexDirection: "row", flexWrap: "wrap", gap: 6, marginTop: 6 },
  asked: { flexBasis: "100%" },
  intro: { paddingHorizontal: 16 },
});
