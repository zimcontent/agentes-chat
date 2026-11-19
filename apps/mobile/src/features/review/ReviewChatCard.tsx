import { reviewLinksIn, useApi, useVideoReviews } from "@dougbot/client";
import { Image } from "expo-image";
import { Pressable, StyleSheet, View } from "react-native";
import { Button, Chip, Icon, Text } from "@/ui";
import { useCardTop } from "../chat/look";
import { useColors, useOrgId } from "../shared/hooks";
import { useSurface } from "../shared/parts";
import { reviewIdsOf, statusIcon, statusTone } from "./logic";
import { ownSource, useReviewWords } from "./media";
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
  const api = useApi();
  // From the list every card shares (read every 30 s), not a poll per card.
  const r = useVideoReviews(orgId).data?.find((x) => x.id === id);
  // A review this person may not see (another conversation's), or one gone: no card, the link stays as it is.
  if (!r) return null;
  const facts = [r.client, w.version(r.version), r.agent ? w.by(r.agent.name) : ""].filter(Boolean).join(" · ");
  // A design piece shows its first slide: the art is ready, the card is the way in (docs/adr/doug-0010-design-review.md).
  const design = r.medium === "design";
  const words = (
    <>
      <View style={styles.row}>
        <Icon name={design ? "image" : "play"} size={15} color={c.muted} />
        <Text variant="caption" tone="muted" style={styles.bold}>
          {design ? w.design.card : w.card}
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
    </>
  );
  const foot = (
    <View style={styles.foot}>
      <Chip tone={statusTone(r.status)} icon={statusIcon(r.status)} label={w.status[r.status]} />
      <Button
        variant={r.status === "in_review" ? "primary" : "secondary"}
        size="sm"
        label={w.open}
        hint={design ? w.design.open : w.openVideo}
        onPress={() => openReview(r.id)}
      />
    </View>
  );
  return (
    <View style={[styles.card, surface, top]}>
      {design && r.cover ? (
        // The whole first slide, standing, beside its words: a tap on it opens the piece like the button.
        <View style={styles.piece}>
          <Pressable
            onPress={() => openReview(r.id)}
            accessibilityRole="button"
            accessibilityLabel={`${w.design.open}: ${r.title}`}
          >
            <Image
              source={ownSource(api.artifacts.fileUrl(orgId, r.cover))}
              style={[styles.cover, { backgroundColor: c.sunken }]}
              contentFit="contain"
              transition={120}
              accessibilityIgnoresInvertColors
            />
          </Pressable>
          <View style={styles.words}>{words}</View>
        </View>
      ) : (
        words
      )}
      {foot}
    </View>
  );
}

const styles = StyleSheet.create({
  card: { padding: 12, borderRadius: 20, gap: 4 },
  piece: { flexDirection: "row", gap: 12, alignItems: "flex-start" },
  cover: { width: 96, aspectRatio: 4 / 5, borderRadius: 10 },
  words: { flex: 1, minWidth: 0, gap: 4 },
  row: { flexDirection: "row", alignItems: "center", gap: 6 },
  bold: { fontWeight: "600" },
  foot: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: 8, marginTop: 6 },
});
