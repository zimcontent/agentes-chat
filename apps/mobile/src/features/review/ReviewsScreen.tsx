import { useVideoReviews, type VideoReviewSummary } from "@agenteschat/client";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { RefreshControl, StyleSheet, View } from "react-native";
import { Button, Chip, EmptyState, GroupedList, GroupedRow, Segmented, SkeletonList, Text } from "@/ui";
import { router } from "@/ui/navigation";
import { AgentFace } from "../shared/Face";
import { useOrgId, usePullRefresh, useWhen } from "../shared/hooks";
import { PushedLargeTitle } from "../shared/PushedLargeTitle";
import { statusIcon, statusTone } from "./logic";
import { useReviewWords } from "./media";

/** Opens one video's Revisor. */
export const openReview = (id: string) => router.push(`/review/${id}`);

/**
 * Revisão on the phone (docs/adr/doug-0007-video-review.md): the videos agents sent for review, the ones waiting first
 * ("Para revisar"), or all of them. A row opens the video's Revisor.
 */
export function ReviewsScreen() {
  const w = useReviewWords();
  const { t } = useTranslation();
  const orgId = useOrgId();
  const reviews = useVideoReviews(orgId);
  const pull = usePullRefresh(reviews.refetch);
  const [filter, setFilter] = useState<"open" | "all">("open");
  const all = reviews.data ?? [];
  const open = all.filter((r) => r.status === "in_review").length;
  const list = all.filter((r) => filter === "all" || r.status === "in_review");
  return (
    <PushedLargeTitle
      title={w.title}
      grouped
      refreshControl={<RefreshControl refreshing={pull.refreshing} onRefresh={pull.onRefresh} />}
    >
      <View style={styles.in}>
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
    </PushedLargeTitle>
  );
}

function ReviewRow({ review: r }: { review: VideoReviewSummary }) {
  const w = useReviewWords();
  const when = useWhen();
  const facts = [
    r.client,
    w.version(r.version),
    r.agent ? w.by(r.agent.name) : "",
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
      leading={r.agent ? <AgentFace agentId={r.agent.id} size={36} live={false} /> : undefined}
      icon={r.agent ? undefined : "play"}
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

const styles = StyleSheet.create({
  in: { paddingHorizontal: 16, gap: 16 },
  center: { alignItems: "center", gap: 12, paddingVertical: 32 },
  centerText: { textAlign: "center" },
  chip: { marginTop: 6 },
});
