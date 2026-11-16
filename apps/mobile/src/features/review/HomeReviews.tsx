import { useVideoReviews } from "@agenteschat/client";
import { Pressable, StyleSheet, View } from "react-native";
import { Count, Icon, Text } from "@/ui";
import { router } from "@/ui/navigation";
import { useColors, useOrgId } from "../shared/hooks";
import { tapHaptic, useSurface } from "../shared/parts";
import { useReviewWords } from "./media";

/**
 * Revisão on the home (docs/adr/doug-0007-video-review.md), as the web's dock shows it: once an agent sent a video for
 * review, one row with how many wait, which pushes the list. One waiting opens that video straight away.
 */
export function HomeReviews() {
  const w = useReviewWords();
  const c = useColors();
  const surface = useSurface();
  const orgId = useOrgId();
  const reviews = useVideoReviews(orgId).data ?? [];
  if (reviews.length === 0) return null;
  const waiting = reviews.filter((r) => r.status === "in_review");
  const only = waiting.length === 1 ? waiting[0] : undefined;
  const sub = only ? only.title : waiting.length > 0 ? w.filters.open : w.meta;
  return (
    <View style={styles.wrap}>
      <Pressable
        onPress={() => {
          tapHaptic();
          router.push(only ? `/review/${only.id}` : "/reviews");
        }}
        accessibilityRole="button"
        accessibilityLabel={[w.title, waiting.length > 0 ? `${waiting.length} ${w.filters.open}` : ""]
          .filter(Boolean)
          .join(", ")}
        style={({ pressed }) => [styles.row, surface, pressed && styles.pressed]}
      >
        <View style={[styles.tile, { backgroundColor: c.plate }]}>
          <Icon name="play" size={18} color={c.ink} />
        </View>
        <View style={styles.grow}>
          <Text variant="subhead" style={styles.bold}>
            {w.title}
          </Text>
          <Text variant="footnote" tone="muted" numberOfLines={1}>
            {sub}
          </Text>
        </View>
        {waiting.length > 0 ? <Count value={waiting.length} inverted /> : null}
        <Icon name="right" size={16} color={c.faint} />
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { paddingHorizontal: 16, paddingTop: 4, paddingBottom: 8 },
  row: { flexDirection: "row", alignItems: "center", gap: 12, padding: 12, borderRadius: 20 },
  pressed: { opacity: 0.8 },
  tile: { width: 36, height: 36, borderRadius: 10, alignItems: "center", justifyContent: "center" },
  grow: { flex: 1, minWidth: 0 },
  bold: { fontWeight: "600" },
});
