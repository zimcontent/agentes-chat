import { LinearGradient } from "expo-linear-gradient";
import type { ReactNode } from "react";
import { useTranslation } from "react-i18next";
import { Pressable, StyleSheet, View } from "react-native";
import { Button, Icon, Text, useTheme } from "@/ui";
import { chosenSurface, chosenWash, PANEL_RADIUS, pillSurface, surfaceStyle } from "@/ui/surfaces";

/** This fork's own words, in Portuguese and English (any other language reads English). */
const WORDS = {
  pt: {
    pinned: "Fixado",
    coordinating: (n: number) => (n === 1 ? "Coordenando 1 agente" : `Coordenando ${n} agentes`),
    ready: "Pronto quando você precisar",
    decisions: (n: number) => (n === 1 ? "Tenho 1 decisão para você." : `Tenho ${n} decisões para você.`),
    calm: "Tudo em dia. Me chame quando precisar.",
    seeDecisions: "Ver as decisões",
    talk: "Conversar",
    call: "Ligar",
    needsKey: (name: string) => `Para ligar para ${name}`,
  },
  en: {
    pinned: "Pinned",
    coordinating: (n: number) => (n === 1 ? "Coordinating 1 agent" : `Coordinating ${n} agents`),
    ready: "Ready when you need",
    decisions: (n: number) => (n === 1 ? "I have 1 decision for you." : `I have ${n} decisions for you.`),
    calm: "All caught up. Call me when you need.",
    seeDecisions: "See the decisions",
    talk: "Talk",
    call: "Call",
    needsKey: (name: string) => `To call ${name}`,
  },
} as const;

export type DougWords = (typeof WORDS)["pt"] | (typeof WORDS)["en"];

/** Início's words for the pinned Doug, in the app's language. */
export function useDougWords(): DougWords {
  const { i18n } = useTranslation();
  return WORDS[i18n.language?.startsWith("pt") ? "pt" : "en"];
}

/** The card itself, with its data in props: the app's Início and the board draw the same one. */
export function DougPinnedCard({
  face,
  name,
  status,
  message,
  primary,
  words,
  live,
  onOpen,
  onTalk,
  onCall,
}: {
  face: ReactNode;
  name: string;
  status: string;
  message: string;
  primary: string;
  words: DougWords;
  live: boolean;
  /** The main button. */
  onOpen: () => void;
  /** His face and name: his conversation (default: the main button's). */
  onTalk?: () => void;
  onCall: () => void;
}) {
  const { colors, scheme } = useTheme();
  const pill = pillSurface(scheme);
  return (
    <View style={[styles.card, surfaceStyle(chosenSurface(scheme), PANEL_RADIUS)]}>
      <LinearGradient
        colors={chosenWash(scheme)}
        start={{ x: 0, y: 0 }}
        end={{ x: 0.75, y: 0.75 }}
        style={[StyleSheet.absoluteFill, { borderRadius: PANEL_RADIUS }]}
        pointerEvents="none"
      />
      <Pressable
        onPress={onTalk ?? onOpen}
        accessibilityRole="button"
        accessibilityLabel={`${name}, ${status}`}
        style={styles.top}
      >
        {face}
        <View style={styles.who}>
          <Text variant="title" style={styles.name} numberOfLines={1}>
            {name}
          </Text>
          <View style={styles.statusLine}>
            {live ? <View style={[styles.dot, { backgroundColor: colors.green }]} /> : null}
            <Text variant="footnote" tone="muted" numberOfLines={1} style={styles.status}>
              {status}
            </Text>
          </View>
        </View>
        <View style={styles.pin}>
          <Icon name="pin" size={12} color={colors.muted} />
          <Text variant="caption" tone="muted">
            {words.pinned}
          </Text>
        </View>
      </Pressable>
      <Text variant="body" style={styles.message}>
        {message}
      </Text>
      <View style={styles.actions}>
        <View style={styles.grow}>
          <Button variant="primary" label={primary} onPress={onOpen} wide />
        </View>
        <Pressable
          onPress={onCall}
          accessibilityRole="button"
          accessibilityLabel={words.call}
          hitSlop={4}
          style={({ pressed }) => [styles.call, surfaceStyle(pill, 22), pressed && styles.pressed]}
        >
          <Icon name="handset" size={17} color={colors.ink} />
          <Text variant="subhead" style={styles.callLabel}>
            {words.call}
          </Text>
        </Pressable>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  card: { marginHorizontal: 16, marginTop: 12, padding: 14, gap: 12, overflow: "hidden" },
  top: { flexDirection: "row", alignItems: "center", gap: 12 },
  who: { flex: 1, minWidth: 0, gap: 2 },
  name: { fontWeight: "800" },
  statusLine: { flexDirection: "row", alignItems: "center", gap: 6 },
  dot: { width: 7, height: 7, borderRadius: 4 },
  status: { flexShrink: 1, fontWeight: "500" },
  pin: { flexDirection: "row", alignItems: "center", gap: 4, alignSelf: "flex-start" },
  message: { lineHeight: 22 },
  actions: { flexDirection: "row", alignItems: "center", gap: 8 },
  grow: { flex: 1 },
  call: { height: 44, flexDirection: "row", alignItems: "center", gap: 7, paddingHorizontal: 18 },
  callLabel: { fontWeight: "600" },
  pressed: { opacity: 0.7 },
});
