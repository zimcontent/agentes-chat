import { LinearGradient } from "expo-linear-gradient";
import type { ReactNode } from "react";
import { useTranslation } from "react-i18next";
import { Pressable, StyleSheet, useWindowDimensions, View } from "react-native";
import { Button, Text, useTheme } from "@/ui";
import { chosenBorder, chosenWash, PANEL_RADIUS } from "@/ui/surfaces";

/** This fork's own words, in Portuguese and English (any other language reads English). */
const WORDS = {
  pt: {
    coordinating: (n: number) => (n === 1 ? "Coordenando 1 agente" : `Coordenando ${n} agentes`),
    ready: "Pronto quando você precisar",
    nothingWaiting: "Nada esperando você",
    waiting: (n: number) => (n === 1 ? "1 decisão esperando você" : `${n} decisões esperando você`),
    seeDecisions: "Ver as decisões",
    decisions: "Decisões",
    talk: "Conversar",
    call: "Ligar",
    more: (n: number) => `+${n}`,
    moreLabel: (n: number) => (n === 1 ? "e mais 1 agente" : `e mais ${n} agentes`),
  },
  en: {
    coordinating: (n: number) => (n === 1 ? "Coordinating 1 agent" : `Coordinating ${n} agents`),
    ready: "Ready when you need",
    nothingWaiting: "Nothing waiting on you",
    waiting: (n: number) => (n === 1 ? "1 decision waiting on you" : `${n} decisions waiting on you`),
    seeDecisions: "See the decisions",
    decisions: "Decisions",
    talk: "Talk",
    call: "Call",
    more: (n: number) => `+${n}`,
    moreLabel: (n: number) => (n === 1 ? "and 1 more agent" : `and ${n} more agents`),
  },
} as const;

export type DougWords = (typeof WORDS)["pt"] | (typeof WORDS)["en"];

/** Início's words for the pinned Doug, in the app's language. */
export function useDougWords(): DougWords {
  const { i18n } = useTranslation();
  return WORDS[i18n.language?.startsWith("pt") ? "pt" : "en"];
}

/** A small face beside Doug's: one agent he coordinates now. */
export interface CrewFace {
  id: string;
  face: ReactNode;
}

/** Doug's face, the agents he coordinates now small on both sides. */
export const DOUG_FACE = 48;
export const CREW_FACE = 24;

/**
 * The card itself, with its data in props: the app's Início and the board draw the same one. Compact: his face in the
 * middle with the agents he coordinates now small around it, one line of what waits on you (the greeting before it
 * while both fit), and three buttons in a row, Conversar in the middle as the green one.
 */
export function DougPinnedCard({
  face,
  left,
  right,
  more,
  name,
  status,
  greeting,
  working,
  words,
  onTalk,
  onCall,
  onDecisions,
  onStatus,
}: {
  face: ReactNode;
  left: readonly CrewFace[];
  right: readonly CrewFace[];
  more: number;
  name: string;
  /** "Nada esperando você" or "N decisões esperando você". */
  status: string;
  /** "Boa noite, Gabriel." when it fits on the status's line, else empty. */
  greeting: string;
  /** How many agents work now, for the screen reader ("Coordenando 3 agentes"). */
  working: number;
  words: DougWords;
  onTalk: () => void;
  onCall: () => void;
  /** What he decided and did without asking. */
  onDecisions: () => void;
  /** The line itself, when something waits: Pendentes. */
  onStatus?: (() => void) | undefined;
}) {
  const { colors, scheme } = useTheme();
  // Under 390 points (13 mini, SE, 12 and 13 at 375) or with larger text, "Ver as decisões" is "Decisões": the three
  // buttons keep one row instead of the last one dropping under the others.
  const { width, fontScale } = useWindowDimensions();
  const short = width < 390 || fontScale > 1.1;
  const crew = (list: readonly CrewFace[]) => list.map((c) => <View key={c.id}>{c.face}</View>);
  const doing = working > 0 ? words.coordinating(working) : words.ready;
  return (
    <View style={[styles.card, chosenBorder(scheme, PANEL_RADIUS)]}>
      <LinearGradient
        colors={chosenWash(scheme)}
        start={{ x: 0.5, y: 0 }}
        end={{ x: 0.5, y: 1 }}
        style={[StyleSheet.absoluteFill, { borderRadius: PANEL_RADIUS - 1 }]}
        pointerEvents="none"
      />
      <Pressable
        onPress={onTalk}
        accessibilityRole="button"
        accessibilityLabel={`${name}, ${doing}${more > 0 ? `, ${words.moreLabel(more)}` : ""}`}
        style={styles.faces}
      >
        {crew(left)}
        <View style={styles.doug}>{face}</View>
        {crew(right)}
        {more > 0 ? (
          <View style={[styles.more, { borderColor: colors.glassEdge, backgroundColor: colors.raised }]}>
            <Text variant="caption" tone="muted" style={styles.moreText}>
              {words.more(more)}
            </Text>
          </View>
        ) : null}
      </Pressable>
      {/* His name under his face, with what he is up to: the card says who it is. */}
      <Pressable onPress={onTalk} accessibilityElementsHidden importantForAccessibility="no" style={styles.who}>
        <Text variant="callout" style={styles.name} numberOfLines={1}>
          {name}
          <Text variant="footnote" tone="muted">{`  ·  ${doing}`}</Text>
        </Text>
      </Pressable>
      <Pressable
        onPress={onStatus}
        disabled={!onStatus}
        accessibilityRole={onStatus ? "button" : "text"}
        style={styles.line}
      >
        <Text variant="subhead" style={styles.lineText}>
          {greeting ? (
            <Text variant="subhead" tone="muted">
              {`${greeting} `}
            </Text>
          ) : null}
          <Text variant="subhead" style={styles.status}>
            {status}
          </Text>
        </Text>
      </Pressable>
      <View style={styles.actions}>
        <Button variant="secondary" size="sm" label={words.call} onPress={onCall} />
        <View style={styles.main}>
          <Button variant="primary" size="sm" label={words.talk} onPress={onTalk} wide />
        </View>
        <Button
          variant="secondary"
          size="sm"
          label={short ? words.decisions : words.seeDecisions}
          hint={words.seeDecisions}
          onPress={onDecisions}
        />
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  card: { marginHorizontal: 16, marginTop: 12, paddingTop: 14, paddingBottom: 8, paddingHorizontal: 8, gap: 8 },
  faces: { flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 8 },
  doug: { marginHorizontal: 4 },
  more: {
    height: CREW_FACE,
    minWidth: CREW_FACE,
    paddingHorizontal: 6,
    borderRadius: CREW_FACE / 2,
    borderWidth: StyleSheet.hairlineWidth * 2,
    alignItems: "center",
    justifyContent: "center",
  },
  moreText: { fontWeight: "600" },
  who: { alignSelf: "center", paddingHorizontal: 4, marginTop: -2 },
  name: { fontWeight: "700", textAlign: "center" },
  line: { alignSelf: "center", paddingHorizontal: 4 },
  lineText: { textAlign: "center" },
  status: { fontWeight: "600" },
  // Three buttons 8 apart: Ligar and Ver as decisões as wide as their words, Conversar takes the rest. On a narrow or
  // enlarged screen the last one goes under, centered, never cut.
  actions: {
    flexDirection: "row",
    flexWrap: "wrap",
    justifyContent: "center",
    alignItems: "center",
    columnGap: 8,
    rowGap: 8,
    marginTop: 4,
  },
  main: { flexGrow: 1 },
});
