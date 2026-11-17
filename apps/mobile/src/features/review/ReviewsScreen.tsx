import {
  filterReviews,
  firstTab,
  mixedIn,
  type ReviewWho,
  reviewTabsByWho,
  teamPeople,
  useApi,
  useVideoReviews,
  type VideoReviewSummary,
} from "@agenteschat/client";
import { Image } from "expo-image";
import { useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { RefreshControl, StyleSheet, View } from "react-native";
import {
  Button,
  Chip,
  EmptyState,
  Filters,
  GroupedList,
  GroupedRow,
  IconButton,
  LargeTitleScreen,
  PersonAvatar,
  PULL_TINT,
  PullOrbit,
  Segmented,
  SkeletonList,
  Text,
} from "@/ui";
import { router } from "@/ui/navigation";
import { AgentFace, Face } from "../shared/Face";
import { useColors, useDirectory, useMeId, useOrgId, usePullRefresh, useWhen } from "../shared/hooks";
import { PushedLargeTitle } from "../shared/PushedLargeTitle";
import { useTabHeader } from "../shared/tabHeader";
import { statusIcon, statusTone } from "./logic";
import { ownSource, useReviewWords } from "./media";
import { openSendWork } from "./SendWorkScreen";
import { filterRow, pickInRow, type RowState } from "./team-logic";

/** Opens one video's Revisor. */
export const openReview = (id: string) => router.push(`/review/${id}`);

/**
 * Revisão on the phone, by who made the work (docs/adr/doug-0015-team-work-review.md, the web's tabs): Meus ajustes
 * (once I sent work: the changes asked of me), Agentes and Equipe, each with what waits. Under them one sideways row:
 * Equipe's people, Vídeos or Peças where the tab holds both, and Para revisar or Todos. "Mandar para revisão" sends
 * one's own work. A row opens the work's Revisor.
 */
export function ReviewsScreen({ tab = false }: { tab?: boolean }) {
  const w = useReviewWords();
  const { t } = useTranslation();
  const orgId = useOrgId();
  const meId = useMeId() ?? "";
  const reviews = useVideoReviews(orgId);
  const pull = usePullRefresh(reviews.refetch);
  const everything = reviews.data ?? [];
  const tabs = reviewTabsByWho(everything, meId);
  const [who, setWho] = useState<ReviewWho>("agents");
  // It opens on the tab with work waiting once the list is in, and then stays where the person puts it.
  const picked = useRef(false);
  // biome-ignore lint/correctness/useExhaustiveDependencies: once, when the list (and who I am) first arrive
  useEffect(() => {
    if (picked.current || !reviews.isSuccess || !meId) return;
    picked.current = true;
    setWho(firstTab(tabs));
  }, [reviews.isSuccess, meId]);
  const shownWho = tabs.some((x) => x.key === who) ? who : "agents";
  const [row, setRow] = useState<RowState>({ person: null, medium: "all", status: "open" });
  const people = teamPeople(everything, meId);
  const person = shownWho === "team" && people.some((p) => p.id === row.person) ? row.person : null;
  const mixed = mixedIn(everything, shownWho, meId);
  const medium = mixed ? row.medium : "all";
  const list = filterReviews(everything, { who: shownWho, person, medium, status: row.status }, meId);
  const open = filterReviews(everything, { who: shownWho, person, medium, status: "open" }, meId).length;
  const filters = filterRow(
    { who: shownWho, people, mixed, open, person, medium, status: row.status },
    {
      everyone: w.team.everyone,
      video: w.team.medium.video,
      design: w.team.medium.design,
      open: shownWho === "mine" ? w.editor.toDo : w.filters.open,
      all: w.filters.all,
    },
  );
  const send = () => openSendWork();
  const tabHeader = useTabHeader();
  const header = {
    ...tabHeader,
    actions: [{ icon: "plus" as const, sf: "plus" as const, label: w.team.send, onPress: send }, ...tabHeader.actions],
  };
  const empty =
    shownWho === "mine"
      ? { title: w.team.emptyMine, text: w.team.emptyMineText }
      : shownWho === "team"
        ? { title: w.team.emptyTeam, text: w.team.emptyTeamText }
        : { title: w.team.emptyAgents, text: w.team.emptyAgentsText };
  const body = (
    <View style={styles.in}>
      <Segmented
        wide
        value={shownWho}
        onChange={(v) => setWho(v as ReviewWho)}
        items={tabs.map((x) => ({
          key: x.key,
          label: w.team.tabs[x.key],
          ...(x.waiting > 0 ? { count: x.waiting } : {}),
        }))}
      />
      <View style={styles.row}>
        <Filters items={filters.items} value={filters.value} onChange={(key) => setRow((r) => pickInRow(r, key))} />
      </View>
      {reviews.isLoading ? (
        <SkeletonList rows={4} />
      ) : reviews.isError && !reviews.data ? (
        <View style={styles.center}>
          <Text tone="muted" style={styles.centerText}>
            {w.failed}
          </Text>
          <Button
            variant="secondary"
            size="sm"
            label={t("mobile.common.retry")}
            onPress={() => void reviews.refetch()}
          />
        </View>
      ) : list.length === 0 ? (
        <EmptyState
          size="page"
          agent
          title={empty.title}
          subtitle={empty.text}
          action={
            shownWho === "team" ? (
              <Button variant="primary" icon="plus" label={w.team.send} onPress={send} />
            ) : undefined
          }
        />
      ) : (
        <GroupedList>
          {list.map((r) => (
            <ReviewRow key={r.id} review={r} mine={r.sender?.id === meId} />
          ))}
        </GroupedList>
      )}
    </View>
  );
  // The Revisão tab (the web sidebar's row): the tabs' bar with "Mandar para revisão"; pushed from a link, a back.
  if (tab)
    return (
      <LargeTitleScreen
        title={w.title}
        {...header}
        grouped
        refreshControl={
          <RefreshControl refreshing={pull.refreshing} onRefresh={pull.onRefresh} tintColor={PULL_TINT} />
        }
        pullMark={<PullOrbit refreshing={pull.refreshing} />}
      >
        {body}
      </LargeTitleScreen>
    );
  return (
    <PushedLargeTitle
      title={w.title}
      grouped
      right={<IconButton icon="plus" label={w.team.send} onPress={send} />}
      refreshControl={<RefreshControl refreshing={pull.refreshing} onRefresh={pull.onRefresh} />}
    >
      {body}
    </PushedLargeTitle>
  );
}

function ReviewRow({ review: r, mine }: { review: VideoReviewSummary; mine: boolean }) {
  const w = useReviewWords();
  const when = useWhen();
  const api = useApi();
  const orgId = useOrgId();
  const c = useColors();
  const dir = useDirectory();
  // A design piece stands for itself with its first slide (docs/adr/doug-0010-design-review.md).
  const cover =
    r.medium === "design" && r.cover ? (
      <Image
        source={ownSource(api.artifacts.fileUrl(orgId, r.cover))}
        style={[styles.cover, { backgroundColor: c.sunken }]}
        contentFit="cover"
      />
    ) : null;
  const facts = [
    r.client,
    w.version(r.version),
    r.agent ? w.by(r.agent.name) : r.sender ? w.editor.sentBy(r.sender.name) : "",
    r.openNotes > 0 ? w.notesOpen(r.openNotes) : "",
    when.short(r.updatedAt),
  ].filter(Boolean);
  return (
    <GroupedRow
      label={r.title}
      labelLines={2}
      sub={facts.join(" · ")}
      subLines={2}
      media
      leading={
        cover ??
        (r.agent ? (
          <AgentFace agentId={r.agent.id} size={36} live={false} />
        ) : r.sender ? (
          // An editor's own delivery: their face, as the web's list.
          dir.memberById.has(r.sender.id) ? (
            <Face who={{ type: "person", id: r.sender.id }} size={36} live={false} />
          ) : (
            // Someone the directory doesn't know (yet): their initials, never a question mark.
            <PersonAvatar name={r.sender.name} size={36} />
          )
        ) : undefined)
      }
      icon={cover || r.agent || r.sender ? undefined : r.medium === "design" ? "image" : "play"}
      below={
        <View style={styles.chip}>
          {mine && r.status === "changes" ? (
            // Changes asked of me: mine to make (the web's "Ajuste para fazer").
            <Chip tone="wait" icon="pen" label={w.editor.toDo} />
          ) : (
            <Chip tone={statusTone(r.status)} icon={statusIcon(r.status)} label={w.status[r.status]} />
          )}
        </View>
      }
      chevron
      onPress={() => openReview(r.id)}
    />
  );
}

const styles = StyleSheet.create({
  // The pills reach the screen's edges (they scroll sideways), past the list's side margin.
  row: { marginHorizontal: -16 },
  in: { paddingHorizontal: 16, gap: 16 },
  center: { alignItems: "center", gap: 12, paddingVertical: 32 },
  centerText: { textAlign: "center" },
  chip: { marginTop: 6 },
  cover: { width: 36, height: 45, borderRadius: 6 },
});
