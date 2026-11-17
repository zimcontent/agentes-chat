import { usePortalOverview, useVideoReviews, type VideoReviewSummary } from "@agenteschat/client";
import { portalClientName } from "@agenteschat/client/lib/portal";
import { useTranslation } from "react-i18next";
import { Pressable, StyleSheet, View } from "react-native";
import { Icon, type IconName, Text, useTheme } from "@/ui";
import { router } from "@/ui/navigation";
import { CARD_RADIUS, panelSurface, surfaceStyle } from "@/ui/surfaces";
import { usePortalOn } from "../portal/hooks";
import { useColors, useMeId, useOrgId } from "../shared/hooks";
import { useConversations } from "../shared/queries";
import { type EditorNow, editorNow, portalAdjusting } from "./glance";

/** This fork's own words, beside it in Portuguese and English (any other language reads English). */
const WORDS = {
  pt: {
    threads: "Threads",
    threadsNew: (n: number) => (n === 1 ? "1 nova" : `${n} novas`),
    threadsNone: "Nada novo",
    editor: (name: string) => name,
    doing: { changes: "Ajustando", in_review: "Enviou para revisão", approved: "Aprovado" } as Record<
      EditorNow["status"],
      string
    >,
    client: "Alterações",
    clientNone: "Nenhum pedido",
  },
  en: {
    threads: "Threads",
    threadsNew: (n: number) => `${n} new`,
    threadsNone: "Nothing new",
    editor: (name: string) => name,
    doing: { changes: "Making changes", in_review: "Sent for review", approved: "Approved" } as Record<
      EditorNow["status"],
      string
    >,
    client: "Changes",
    clientNone: "No requests",
  },
} as const;

/**
 * Início's glance, under the tools: small cards side by side with what the team asks about all day: the threads with
 * something new, what the editor is on now (from the videos they send to Revisão: making changes, sent for review,
 * approved; docs/adr/doug-0012-editor-delivery.md), and the posts a client sent back for changes at the portal
 * (ADR 9001). A card with nothing to stand on (no editor yet, no portal) stays out; a tap opens where it comes from.
 */
export function HomeGlance() {
  const { i18n } = useTranslation();
  const w = WORDS[i18n.language?.startsWith("pt") ? "pt" : "en"];
  const orgId = useOrgId();
  const meId = useMeId();
  const rows = useConversations().rows;
  const threads = rows.flatMap((r) => (r.kind === "thread" || r.kind === "mission" ? [r] : []));
  const newThreads = threads.filter((r) => r.unread > 0);
  const latest = newThreads[0] ?? threads[0];
  const reviews: VideoReviewSummary[] = useVideoReviews(orgId).data ?? [];
  const editor = editorNow(reviews, meId);
  const portalOn = usePortalOn();
  const adjusting = portalAdjusting(usePortalOverview(orgId, portalOn).data?.clients ?? []);
  const cards: GlanceCardData[] = [
    {
      key: "threads",
      icon: "reply",
      title: w.threads,
      big: newThreads.length > 0 ? w.threadsNew(newThreads.length) : w.threadsNone,
      line: latest?.title ?? "",
      hot: newThreads.length > 0,
      onPress: () => router.push("/threads"),
    },
    ...(editor
      ? [
          {
            key: "editor",
            icon: "play" as const,
            title: w.editor(editor.name),
            big: w.doing[editor.status],
            line: editor.title,
            hot: editor.status === "in_review",
            onPress: () => router.push(`/review/${editor.reviewId}`),
          },
        ]
      : []),
    ...(portalOn
      ? [
          {
            key: "client",
            icon: "flag" as const,
            title: w.client,
            big: adjusting.total > 0 ? String(adjusting.total) : w.clientNone,
            line: adjusting.clients.map(portalClientName).join(", "),
            hot: adjusting.total > 0,
            onPress: () => router.navigate("/portal"),
          },
        ]
      : []),
  ];
  return (
    <View style={styles.row}>
      {cards.map((card) => (
        <GlanceCard key={card.key} card={card} />
      ))}
    </View>
  );
}

export interface GlanceCardData {
  key: string;
  icon: IconName;
  title: string;
  /** The card's one figure or state, large. */
  big: string;
  /** What it is about, one line under it ("" for none). */
  line: string;
  /** Something waits here: the figure in the waiting colour. */
  hot: boolean;
  onPress: () => void;
}

export function GlanceCard({ card }: { card: GlanceCardData }) {
  const c = useColors();
  const { scheme } = useTheme();
  return (
    <Pressable
      onPress={card.onPress}
      accessibilityRole="button"
      accessibilityLabel={[card.title, card.big, card.line].filter(Boolean).join(", ")}
      style={({ pressed }) => [styles.card, surfaceStyle(panelSurface(scheme), CARD_RADIUS), pressed && styles.pressed]}
    >
      <View style={styles.head}>
        <Icon name={card.icon} size={14} color={c.muted} />
        <Text variant="footnote" tone="muted" style={styles.title} numberOfLines={1}>
          {card.title}
        </Text>
      </View>
      <Text variant="subhead" style={[styles.big, card.hot ? { color: c.amberInk } : null]} numberOfLines={1}>
        {card.big}
      </Text>
      {card.line ? (
        <Text variant="footnote" tone="muted" numberOfLines={2}>
          {card.line}
        </Text>
      ) : null}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: "row", gap: 8, paddingHorizontal: 16, paddingTop: 12, paddingBottom: 4 },
  card: { flex: 1, minHeight: 92, paddingVertical: 11, paddingHorizontal: 12, gap: 3 },
  pressed: { opacity: 0.7 },
  head: { flexDirection: "row", alignItems: "center", gap: 4 },
  title: { flexShrink: 1, fontWeight: "500" },
  big: { fontWeight: "700" },
});
