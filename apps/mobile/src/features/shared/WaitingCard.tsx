import type { ReactNode } from "react";
import { Pressable, StyleSheet, View } from "react-native";
import { Button, Icon, type IconName, Sky, Text, weights } from "@/ui";
import { AskButtons, ExpiryLine } from "../chat/asks";
import { AgentFace } from "./Face";
import { useColors, useDirectory } from "./hooks";
import { agentLook } from "./logic";

/** The leading face: an agent's (on its sky), or what stands for whoever asks (a server's mark, people's faces). */
const FACE = 40;

export interface WaitingCardProps {
  /** The agent asking: its face leads the card and its sky tints the card's top (gray when none asks). */
  agentId?: string | null;
  /** Leads the card when no agent asks (a connector's mark, the faces of who asks to join), FACE points wide. */
  leading?: ReactNode;
  /** Who asks ("Ada", "TikTok"); the kind goes under it. */
  name?: string;
  kind: { icon: IconName; label: string };
  title?: string;
  /** Under the title: why it was asked in muted, then what it goes through (`WaitingSource`), what it costs. */
  children?: ReactNode;
  /** Its deadline: the amber fuse and the time left, on the foot's line at its right (`ExpiryLine`). */
  expires?: { createdAt?: string | null; expiresAt: string } | null;
  /** At the name's line's right: when it was asked ("19:58"). */
  where?: string;
  /** Where it was asked ("em #marketing"), after the kind's tag on its line. */
  place?: string;
  /**
   * The one action, wide under the request: the screen's one primary on the card that decides something, else
   * secondary (`variant`), so a page of cards has one primary.
   */
  action?: { label: string; onPress: () => void; variant?: "primary" | "secondary" } | null;
  /** The decision taken on the card itself (the chat's `AskButtons`), in place of `action`. */
  decision?: ReactNode;
  /** A quiet way out under the decision, at the foot line's left ("Mudar quando perguntar"); the deadline at its right. */
  footNote?: ReactNode;
  onPress?: () => void;
  accessibilityLabel?: string;
  /** Under the card's foot, after a hairline ("e mais 2 esperando você"). */
  footer?: ReactNode;
}

/**
 * One thing waiting on you, as Pendentes and an agent's profile show it: a card on a hairline rim (no shadow: a page
 * holds several), the asking agent's sky faint across its top (gray when no agent asks). Its head is the face, the name
 * (semibold) with when at its right, and under it the kind as an amber tag (amber is the one color of "waits on you")
 * with where it was asked; then the request in words (17 semibold, the card's one bold line), why in muted, what it
 * goes through on one quiet line; the decision (or its one action) wide under it, and a foot line with a quiet way out
 * at the left and the fuse to the deadline at the right.
 */
export function WaitingCard({
  agentId,
  leading,
  name,
  kind,
  title,
  children,
  expires,
  where,
  place,
  action,
  decision,
  footNote,
  onPress,
  accessibilityLabel,
  footer,
}: WaitingCardProps) {
  const c = useColors();
  const dir = useDirectory();
  const agent = agentId ? dir.agentById.get(agentId) : undefined;
  const foot =
    decision ??
    (action ? (
      <AskButtons
        primary={
          <Button
            variant={action.variant ?? "primary"}
            size="card"
            wide
            label={action.label}
            onPress={action.onPress}
          />
        }
      />
    ) : null);
  return (
    <View style={[styles.card, { backgroundColor: c.raised, borderColor: c.line }]}>
      <View style={styles.clip}>
        {/* The asking agent's sky; a gray one when no agent asks (a server, people), so every card reads the same. */}
        <Sky
          color={agent ? agentLook(agent).color : "graphite"}
          depth={0.55}
          fade={0.15}
          surface="raised"
          style={styles.sky}
        />
        <Pressable
          onPress={onPress}
          disabled={!onPress}
          accessibilityRole={onPress ? "button" : undefined}
          accessibilityLabel={accessibilityLabel}
          style={({ pressed }) => [styles.body, pressed && styles.pressed]}
        >
          <View style={styles.hd}>
            {agentId ? <AgentFace agentId={agentId} size={FACE} live={false} /> : leading}
            <View style={styles.who}>
              <View style={styles.nameLine}>
                {name ? (
                  <Text variant="callout" tone="ink" numberOfLines={1} style={[styles.name, styles.grow]}>
                    {name}
                  </Text>
                ) : (
                  <View style={styles.grow} />
                )}
                {where ? (
                  <Text variant="footnote" tone="faint" numberOfLines={1} style={[styles.when, styles.where]}>
                    {where}
                  </Text>
                ) : null}
              </View>
              <View style={styles.kindLine}>
                <View style={[styles.tag, { backgroundColor: c.attentionSoft }]}>
                  <Icon name={kind.icon} size={12} color={c.amberInk} />
                  <Text variant="caption" numberOfLines={1} style={[styles.tagText, { color: c.amberInk }]}>
                    {kind.label}
                  </Text>
                </View>
                {place ? (
                  <Text variant="footnote" tone="faint" numberOfLines={1} style={styles.place}>
                    {place}
                  </Text>
                ) : null}
              </View>
            </View>
          </View>
          {title ? (
            <Text variant="title" tone="ink" numberOfLines={4} style={styles.title}>
              {title}
            </Text>
          ) : null}
          {children}
        </Pressable>
        {foot ? <View style={styles.ft}>{foot}</View> : null}
        {footNote || expires ? (
          <View style={[styles.footLine, foot ? null : styles.footLineAlone]}>
            <View style={styles.footNote}>{footNote}</View>
            {expires ? (
              <View style={styles.expiry}>
                <ExpiryLine createdAt={expires.createdAt} expiresAt={expires.expiresAt} />
              </View>
            ) : null}
          </View>
        ) : null}
        {footer ? <View style={[styles.footer, { borderTopColor: c.line2 }]}>{footer}</View> : null}
      </View>
    </View>
  );
}

/** What a waiting card's request goes through, on one quiet line as the chat's card says it: its mark, its details. */
export function WaitingSource({ mark, text }: { mark?: ReactNode; text: string }) {
  const c = useColors();
  return (
    <View style={[styles.source, { backgroundColor: c.plateSoft }]}>
      {mark ? <View style={styles.sourceMark}>{mark}</View> : null}
      <Text variant="footnote" tone="muted" numberOfLines={1} style={styles.grow}>
        {text}
      </Text>
    </View>
  );
}

/** The cut corner: square-ish bottom left, the rest round (the chat's blocks, the web's cards). */
const RADIUS = 20;
const CUT = 6;

const styles = StyleSheet.create({
  card: { borderRadius: RADIUS, borderBottomLeftRadius: CUT, borderWidth: 1 },
  clip: { borderRadius: RADIUS - 1, borderBottomLeftRadius: CUT - 1, overflow: "hidden", paddingBottom: 16 },
  sky: { position: "absolute", top: 0, left: 0, right: 0, height: 72, opacity: 0.6 },
  body: { paddingHorizontal: 16, paddingTop: 16, gap: 8 },
  hd: { flexDirection: "row", alignItems: "center", gap: 12, marginBottom: 4 },
  who: { flex: 1, minWidth: 0, gap: 4 },
  nameLine: { flexDirection: "row", alignItems: "center", gap: 8 },
  name: { fontWeight: weights.semibold },
  // The kind as a label nobody presses: a small amber tag, then where it was asked.
  kindLine: { flexDirection: "row", alignItems: "center", gap: 8 },
  tag: {
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
    height: 22,
    paddingHorizontal: 8,
    borderRadius: 6,
    flexShrink: 0,
    maxWidth: "70%",
  },
  tagText: { fontWeight: weights.semibold, flexShrink: 1 },
  place: { flexShrink: 1, minWidth: 0 },
  title: { letterSpacing: -0.2 },
  // The source line in a quiet plate: its mark, its details on one line.
  source: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    alignSelf: "stretch",
    minHeight: 32,
    paddingHorizontal: 8,
    borderRadius: 8,
  },
  sourceMark: { flexShrink: 0 },
  // The decision 16 under the request.
  ft: { paddingHorizontal: 16, paddingTop: 16 },
  // The way out and the deadline share one line under the decision.
  // The way out keeps its words whole: when both don't fit on one line the deadline goes under it, at the right.
  footLine: {
    flexDirection: "row",
    flexWrap: "wrap",
    alignItems: "center",
    justifyContent: "space-between",
    columnGap: 12,
    rowGap: 4,
    paddingHorizontal: 16,
    paddingTop: 8,
    minHeight: 32,
  },
  footLineAlone: { paddingTop: 12 },
  expiry: { marginLeft: "auto" },
  footNote: { flexShrink: 0, maxWidth: "100%" },
  when: { fontVariant: ["tabular-nums"] },
  where: { flexShrink: 0, maxWidth: "45%" },
  footer: { marginTop: 12, marginHorizontal: 16, paddingTop: 10, borderTopWidth: StyleSheet.hairlineWidth },
  grow: { flex: 1, minWidth: 0 },
  pressed: { opacity: 0.85 },
});
