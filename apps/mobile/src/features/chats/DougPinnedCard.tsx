import { type ReactNode, useId } from "react";
import { useTranslation } from "react-i18next";
import { Pressable, StyleSheet, useWindowDimensions, View } from "react-native";
import Svg, { Circle, Defs, Mask, Pattern, RadialGradient, Rect, Stop, SvgXml } from "react-native-svg";
import { iconSvg } from "@/brand/doug-icons.js";
import { Button, Text, useTheme } from "@/ui";

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
  },
} as const;

export type DougWords = (typeof WORDS)["pt"] | (typeof WORDS)["en"];

/** Início's words for the pinned Doug, in the app's language. */
export function useDougWords(): DougWords {
  const { i18n } = useTranslation();
  return WORDS[i18n.language?.startsWith("pt") ? "pt" : "en"];
}

/** Doug's icon beside his words. */
export const DOUG_FACE = 48;

/**
 * The card itself, with its data in props: the app's Início and the board draw the same one. Compact: his face in the
 * middle with the agents he coordinates now small around it, one line of what waits on you (the greeting before it
 * while both fit), and three buttons in a row, Conversar in the middle as the green one.
 */
export function DougPinnedCard({
  face,
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
  const { scheme } = useTheme();
  // Under 390 points (13 mini, SE, 12 and 13 at 375) or with larger text, "Ver as decisões" is "Decisões": the three
  // buttons keep one row instead of the last one dropping under the others.
  const { width, fontScale } = useWindowDimensions();
  const short = width < 390 || fontScale > 1.1;
  const doing = working > 0 ? words.coordinating(working) : words.ready;
  return (
    <View style={styles.section}>
      {/* No box: the brand's texture behind him, a lime glow and the site's dot grid fading out at the edges. */}
      <DougTexture dark={scheme === "dark"} />
      <Pressable
        onPress={onTalk}
        accessibilityRole="button"
        accessibilityLabel={`${name}, ${doing}`}
        style={styles.head}
      >
        {face}
        <View style={styles.words}>
          <Text variant="callout" style={styles.name} numberOfLines={1}>
            {name}
            <Text variant="footnote" tone="muted">{`  ·  ${doing}`}</Text>
          </Text>
          <Pressable
            onPress={onStatus}
            disabled={!onStatus}
            accessibilityRole={onStatus ? "button" : "text"}
            hitSlop={6}
          >
            <Text variant="subhead" numberOfLines={2}>
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
        </View>
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

/** Doug's own app icon (the lime ground, him peeking from the corner), drawn once: no animation, nothing per frame. */
const DOUG_ICON_XML = iconSvg({ ground: "day", color: "green", face: "normal", pose: "peek" });

export function DougIcon({ size = DOUG_FACE }: { size?: number }) {
  return (
    <View style={[styles.icon, { width: size, height: size, borderRadius: Math.round(size * 0.24) }]}>
      <SvgXml xml={DOUG_ICON_XML} width={size} height={size} />
    </View>
  );
}

/**
 * The section's backdrop: a soft lime glow behind Doug and the site's dot grid, both fading to nothing before the
 * edges (both ellipses reach zero exactly at the section's sides), so there is no box. One static drawing the size of the section (which never changes while it shows).
 */
function DougTexture({ dark }: { dark: boolean }) {
  const id = useId().replace(/[^a-zA-Z0-9]/g, "");
  const lime = dark ? "#9CFA05" : "#5A9A00";
  return (
    <View
      style={StyleSheet.absoluteFill}
      pointerEvents="none"
      accessibilityElementsHidden
      importantForAccessibility="no"
    >
      <Svg width="100%" height="100%">
        <Defs>
          <RadialGradient id={`g${id}`} cx="50%" cy="50%" rx="50%" ry="50%" fx="22%" fy="40%">
            <Stop offset="0" stopColor={lime} stopOpacity={dark ? 0.16 : 0.14} />
            <Stop offset="1" stopColor={lime} stopOpacity={0} />
          </RadialGradient>
          <RadialGradient id={`f${id}`} cx="50%" cy="50%" rx="50%" ry="50%">
            <Stop offset="0" stopColor="#FFFFFF" stopOpacity={1} />
            <Stop offset="1" stopColor="#FFFFFF" stopOpacity={0} />
          </RadialGradient>
          <Pattern id={`d${id}`} width={14} height={14} patternUnits="userSpaceOnUse">
            <Circle cx={7} cy={7} r={1} fill={dark ? "#FFFFFF" : "#0A0A0A"} fillOpacity={dark ? 0.1 : 0.08} />
          </Pattern>
          <Mask id={`m${id}`}>
            <Rect x="0" y="0" width="100%" height="100%" fill={`url(#f${id})`} />
          </Mask>
        </Defs>
        <Rect x="0" y="0" width="100%" height="100%" fill={`url(#g${id})`} />
        <Rect x="0" y="0" width="100%" height="100%" fill={`url(#d${id})`} mask={`url(#m${id})`} />
      </Svg>
    </View>
  );
}

const styles = StyleSheet.create({
  // No card: the section sits on the screen, its texture behind it.
  section: { marginHorizontal: 16, marginTop: 8, paddingTop: 8, paddingBottom: 8, paddingHorizontal: 4, gap: 12 },
  head: { flexDirection: "row", alignItems: "center", gap: 12 },
  words: { flex: 1, minWidth: 0, gap: 2 },
  icon: { overflow: "hidden" },
  name: { fontWeight: "700" },
  status: { fontWeight: "600" },
  // Three buttons 8 apart: Ligar and Ver as decisões as wide as their words, Conversar takes the rest. On a narrow or
  // enlarged screen the last one goes under, centered, never cut.
  actions: {
    flexDirection: "row",
    flexWrap: "wrap",
    justifyContent: "flex-start",
    alignItems: "center",
    columnGap: 8,
    rowGap: 8,
    marginTop: 4,
  },
  main: { flexGrow: 1 },
});
