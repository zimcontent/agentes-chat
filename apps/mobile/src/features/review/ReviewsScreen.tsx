import { useApi, useVideoReviews, type VideoReviewSummary } from "@agenteschat/client";
import { Image } from "expo-image";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { RefreshControl, StyleSheet, View } from "react-native";
import {
  Button,
  Chip,
  EmptyState,
  Filters,
  GroupedList,
  GroupedRow,
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
import { useColors, useDirectory, useOrgId, usePullRefresh, useWhen } from "../shared/hooks";
import { PushedLargeTitle } from "../shared/PushedLargeTitle";
import { useTabHeader } from "../shared/tabHeader";
import { type ReviewKind, reviewKindOf, reviewTabs, statusIcon, statusTone } from "./logic";
import { ownSource, useReviewWords } from "./media";

/** Opens one video's Revisor. */
export const openReview = (id: string) => router.push(`/review/${id}`);

/**
 * Revisão on the phone (docs/adr/doug-0007-video-review.md): the videos agents sent for review, the ones waiting first
 * ("Para revisar"), or all of them. A row opens the video's Revisor.
 */
export function ReviewsScreen({ tab = false }: { tab?: boolean }) {
  const w = useReviewWords();
  const { t, i18n } = useTranslation();
  const orgId = useOrgId();
  const reviews = useVideoReviews(orgId);
  const [kind, setKind] = useState<ReviewKind>("all");
  const pull = usePullRefresh(reviews.refetch);
  const [filter, setFilter] = useState<"open" | "all">("open");
  // What the team reviews comes in kinds, each a tab (as the web's): the agents' videos, each editor's, design pieces.
  const everything = reviews.data ?? [];
  const tabs = reviewTabs(everything);
  const shownKind = tabs.some((x) => x.key === kind) ? kind : "all";
  const all = everything.filter((r) => shownKind === "all" || reviewKindOf(r) === shownKind);
  const open = all.filter((r) => r.status === "in_review").length;
  const list = all.filter((r) => filter === "all" || r.status === "in_review");
  const tabWords = KIND_WORDS[i18n.language?.startsWith("pt") ? "pt" : "en"];
  const tabLabel = (x: (typeof tabs)[number]) => {
    const name =
      x.key === "all"
        ? tabWords.all
        : x.key === "ai"
          ? tabWords.ai
          : x.key === "design"
            ? tabWords.design
            : tabWords.editor(x.editor ?? "");
    return x.waiting > 0 ? `${name} · ${x.waiting}` : name;
  };
  const header = useTabHeader();
  const body = (
    <View style={styles.in}>
      {tabs.length > 2 ? (
        <View style={styles.kinds}>
          <Filters
            items={tabs.map((x) => ({ key: x.key, label: tabLabel(x) }))}
            value={shownKind}
            onChange={(key) => setKind(key as ReviewKind)}
          />
        </View>
      ) : null}
      <Segmented
        wide
        value={filter}
        onChange={(v) => setFilter(v as "open" | "all")}
        items={[
          { key: "open", label: w.filters.open, count: open },
          { key: "all", label: w.filters.all },
        ]}
      />
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
        <EmptyState size="page" agent title={w.empty} subtitle={w.emptyText} />
      ) : (
        <GroupedList>
          {list.map((r) => (
            <ReviewRow key={r.id} review={r} />
          ))}
        </GroupedList>
      )}
    </View>
  );
  // The Revisão tab (the web sidebar's row): the tabs' bar, with the workspace and "+"; pushed from a link, a back.
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
      refreshControl={<RefreshControl refreshing={pull.refreshing} onRefresh={pull.onRefresh} />}
    >
      {body}
    </PushedLargeTitle>
  );
}

function ReviewRow({ review: r }: { review: VideoReviewSummary }) {
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
          <Chip tone={statusTone(r.status)} icon={statusIcon(r.status)} label={w.status[r.status]} />
        </View>
      }
      chevron
      onPress={() => openReview(r.id)}
    />
  );
}

/** The tabs' names: this feature's words live beside it, in Portuguese and English. */
const KIND_WORDS = {
  pt: { all: "Tudo", ai: "Vídeo de IA", design: "Design", editor: (name: string) => `Vídeo do ${name}` },
  en: { all: "All", ai: "AI videos", design: "Design", editor: (name: string) => `${name}'s videos` },
} as const;

const styles = StyleSheet.create({
  // The pills reach the screen's edges (they scroll sideways), past the list's side margin.
  kinds: { marginHorizontal: -16 },
  in: { paddingHorizontal: 16, gap: 16 },
  center: { alignItems: "center", gap: 12, paddingVertical: 32 },
  centerText: { textAlign: "center" },
  chip: { marginTop: 6 },
  cover: { width: 36, height: 45, borderRadius: 6 },
});
