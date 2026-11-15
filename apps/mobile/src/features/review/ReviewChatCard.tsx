import { reviewLinksIn, useVideoReviews } from "@agenteschat/client";
import { StyleSheet, View } from "react-native";
import { Button, Chip, Icon, Text } from "@/ui";
import { useCardTop } from "../chat/look";
import { useColors, useOrgId } from "../shared/hooks";
import { useSurface } from "../shared/parts";
import { reviewIdsOf, statusIcon, statusTone } from "./logic";
import { useReviewWords } from "./media";
import { openReview } from "./ReviewsScreen";

/**
 * Under a message that points at a video in review (docs/adr/doug-0007-video-review.md): the link the agent posted
 * with `send_for_review`, or the decision a person sent. One card per video, with its version and where it stands,
 * and "Revisar", which opens the Revisor here in the app.
 */
export function ReviewChatCards({ body, meta }: { body: string; meta: unknown }) {
  const orgId = useOrgId();
  const ids = reviewIdsOf(reviewLinksIn(body), orgId, meta);
  if (ids.length === 0) return null;
  return (
    <>
      {ids.map((id) => (
        <ReviewChatCard key={id} id={id} />
      ))}
    </>
  );
}

function ReviewChatCard({ id }: { id: string }) {
  const w = useReviewWords();
  const c = useColors();
  const surface = useSurface();
  const top = useCardTop(8);
  const orgId = useOrgId();
  // From the list every card shares (read every 30 s), not a poll per card.
  const r = useVideoReviews(orgId).data?.find((x) => x.id === id);
  // A review this person may not see (another conversation's), or one gone: no card, the link stays as it is.
  if (!r) return null;
  const facts = [r.client, w.version(r.version), r.agent ? w.by(r.agent.name) : ""].filter(Boolean).join(" · ");
  return (
    <View style={[styles.card, surface, top]}>
      <View style={styles.row}>
        <Icon name="play" size={15} color={c.muted} />
        <Text variant="caption" tone="muted" style={styles.bold}>
          {w.card}
        </Text>
      </View>
      <Text variant="body" style={styles.bold} numberOfLines={2}>
        {r.title}
      </Text>
      {facts ? (
        <Text variant="footnote" tone="muted" numberOfLines={1}>
          {facts}
        </Text>
      ) : null}
      <View style={styles.foot}>
        <Chip tone={statusTone(r.status)} icon={statusIcon(r.status)} label={w.status[r.status]} />
        <Button
          variant={r.status === "in_review" ? "primary" : "secondary"}
          size="sm"
          label={w.open}
          hint={w.openVideo}
          onPress={() => openReview(r.id)}
        />
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  card: { padding: 12, borderRadius: 20, gap: 4 },
  row: { flexDirection: "row", alignItems: "center", gap: 6 },
  bold: { fontWeight: "600" },
  foot: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: 8, marginTop: 6 },
});
