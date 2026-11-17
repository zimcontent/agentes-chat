import type { ReactNode } from "react";
import { useTranslation } from "react-i18next";
import { Pressable, StyleSheet, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { haptics, Icon, type IconName, Text, useTheme } from "@/ui";
import { pillSurface, surfaceStyle } from "@/ui/surfaces";

/** This fork's own words for a call with an agent, in Portuguese and English (any other language reads English). */
const WORDS = {
  pt: {
    calling: "chamando…",
    speaking: "falando",
    listening: "ouvindo você",
    captions: "Legenda",
    you: "Você",
    earpiece: "Pelo fone do celular. Para ouvir alto, toque em Alto-falante.",
    cancel: "Cancelar",
    write: "Escrever",
  },
  en: {
    calling: "calling…",
    speaking: "speaking",
    listening: "listening to you",
    captions: "Captions",
    you: "You",
    earpiece: "On the phone's earpiece. To hear it out loud, tap Speaker.",
    cancel: "Cancel",
    write: "Write",
  },
} as const;

/** One round button of the call's bar, with its word under it (the phone's own call screen). */
export function CallAction({
  icon,
  label,
  word,
  on,
  danger,
  onPress,
}: {
  icon: IconName;
  label: string;
  word: string;
  on?: boolean;
  danger?: boolean;
  onPress: () => void;
}) {
  const { colors: c, scheme } = useTheme();
  const look = danger
    ? { backgroundColor: c.danger, boxShadow: "0px 10px 30px -8px rgba(229, 72, 77, 0.6)" }
    : on
      ? { backgroundColor: c.ink }
      : surfaceStyle(pillSurface(scheme), ACTION / 2);
  const ink = danger ? "#fff" : on ? c.bg : c.ink;
  return (
    <View style={styles.action}>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={label}
        accessibilityState={on === undefined ? undefined : { selected: on }}
        onPress={() => {
          haptics.light();
          onPress();
        }}
        style={({ pressed }) => [styles.actionButton, look, { opacity: pressed ? 0.8 : 1 }]}
      >
        {/* Hanging up is the handset turned down, as every phone draws it. */}
        <View style={danger && icon === "handset" ? styles.down : undefined}>
          <Icon name={icon} size={26} color={ink} />
        </View>
      </Pressable>
      <Text variant="caption" tone="muted" numberOfLines={1}>
        {word}
      </Text>
    </View>
  );
}

/** Rings around the face that light with the voice: the site's lime glow, wider the louder it is. */
function Rings({ level, size, children }: { level: number; size: number; children: ReactNode }) {
  const lit = level > 0.08;
  const ring = (grow: number, alpha: number) => ({
    width: size + grow,
    height: size + grow,
    borderRadius: (size + grow) / 2,
    borderColor: `rgba(156, 250, 5, ${lit ? alpha : alpha * 0.5})`,
  });
  return (
    <View style={[styles.rings, { width: size + 124, height: size + 124 }]}>
      <View style={[styles.ring, ring(124, 0.22)]} />
      <View style={[styles.ring, ring(84, 0.35)]} />
      <View
        style={[
          styles.ring,
          ring(44, 0.55),
          { boxShadow: `0px 0px ${20 + Math.round(level * 40)}px rgba(156, 250, 5, ${lit ? 0.35 : 0.18})` },
        ]}
      />
      {children}
    </View>
  );
}

/** Five small bars beside "falando": who has the voice now. */
function Bars() {
  return (
    <View style={styles.bars} accessibilityElementsHidden>
      {[6, 12, 9, 14, 7].map((h, i) => (
        // biome-ignore lint/suspicious/noArrayIndexKey: a fixed drawing
        <View key={i} style={[styles.bar, { height: h }]} />
      ))}
    </View>
  );
}

/**
 * A call with an agent, drawn from its state (docs/adr/doug-0006-live-voice.md; the look in
 * docs/adr/doug-0016-doug-pinned.md): its face in rings of the lime that light with its voice, its name large, who is
 * talking, the latest words as captions, and the phone's own buttons. While it rings: the earpiece is said aloud and
 * only Speaker and Cancel show. The app's call and the board draw this same view.
 */
export function AgentCallView({
  name,
  face,
  since,
  connecting,
  failed,
  level,
  caption,
  micOn,
  speaker,
  onMinimize,
  onMic,
  onSpeaker,
  onWrite,
  onHangUp,
  hangUpWord,
  micWords,
  speakerWords,
  minimizeLabel,
}: {
  name: string;
  face: (size: number) => ReactNode;
  /** "0:48" since it started; empty while it rings. */
  since: string;
  connecting: boolean;
  /** The reason it failed, said under the name. */
  failed: string | null;
  level: number;
  caption: { who: "agent" | "me"; text: string } | null;
  micOn: boolean;
  speaker: boolean;
  onMinimize: () => void;
  onMic: () => void;
  onSpeaker: () => void;
  onWrite: () => void;
  onHangUp: () => void;
  hangUpWord: string;
  micWords: { on: string; off: string; turnOff: string; turnOn: string };
  speakerWords: { speaker: string; earpiece: string; toSpeaker: string; toEarpiece: string };
  minimizeLabel: string;
}) {
  const { i18n } = useTranslation();
  const w = WORDS[i18n.language?.startsWith("pt") ? "pt" : "en"];
  const { colors: c, scheme } = useTheme();
  const insets = useSafeAreaInsets();
  const speaking = caption?.who === "agent" && level > 0.08;
  const status = failed ?? (connecting ? w.calling : speaking ? w.speaking : w.listening);
  return (
    <View
      style={[styles.screen, { backgroundColor: c.bg, paddingTop: insets.top + 8, paddingBottom: insets.bottom + 16 }]}
    >
      <View style={styles.glow} pointerEvents="none" />
      <View style={styles.top}>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={minimizeLabel}
          onPress={onMinimize}
          style={[styles.round, surfaceStyle(pillSurface(scheme), 22)]}
        >
          <Icon name="down" size={20} color={c.ink} />
        </Pressable>
      </View>
      <View style={styles.middle}>
        <Rings level={connecting ? 0.2 : level} size={104}>
          {face(104)}
        </Rings>
        <Text variant="display2" style={styles.name} numberOfLines={1}>
          {name}
        </Text>
        <View style={styles.statusRow}>
          {speaking ? <Bars /> : null}
          <Text variant="subhead" tone="muted" style={styles.center}>
            {since && !connecting && !failed ? `${status} · ${since}` : status}
          </Text>
        </View>
        {connecting ? (
          <Text variant="subhead" tone="muted" style={[styles.center, styles.note]}>
            {w.earpiece}
          </Text>
        ) : caption ? (
          <View style={styles.caption}>
            <Text variant="caption" tone="muted" style={styles.center}>
              {caption.who === "me" ? w.you : w.captions}
            </Text>
            <Text variant="title2" numberOfLines={4} style={[styles.center, styles.captionText]}>
              {caption.text}
            </Text>
          </View>
        ) : null}
      </View>
      <View style={[styles.actions, connecting && styles.actionsRinging]}>
        {connecting ? null : (
          <CallAction
            icon={micOn ? "mic" : "micOff"}
            on={!micOn}
            word={micOn ? micWords.on : micWords.off}
            label={micOn ? micWords.turnOff : micWords.turnOn}
            onPress={onMic}
          />
        )}
        <CallAction
          icon="sound"
          on={speaker}
          word={speakerWords.speaker}
          label={speaker ? speakerWords.toEarpiece : speakerWords.toSpeaker}
          onPress={onSpeaker}
        />
        {connecting ? null : <CallAction icon="compose" word={w.write} label={w.write} onPress={onWrite} />}
        <CallAction
          icon="handset"
          danger
          word={connecting ? w.cancel : hangUpWord}
          label={connecting ? w.cancel : hangUpWord}
          onPress={onHangUp}
        />
      </View>
    </View>
  );
}

const ACTION = 66;

const styles = StyleSheet.create({
  screen: { flex: 1, paddingHorizontal: 16 },
  glow: {
    position: "absolute",
    alignSelf: "center",
    top: 120,
    width: 320,
    height: 320,
    borderRadius: 160,
    backgroundColor: "rgba(156, 250, 5, 0.08)",
    boxShadow: "0px 0px 120px 60px rgba(156, 250, 5, 0.08)",
  },
  top: { flexDirection: "row" },
  round: { width: 44, height: 44, alignItems: "center", justifyContent: "center" },
  middle: { flex: 1, alignItems: "center", paddingTop: 12 },
  rings: { alignItems: "center", justifyContent: "center" },
  ring: { position: "absolute", borderWidth: 1.5 },
  name: { marginTop: 8, fontWeight: "800", textAlign: "center" },
  statusRow: { flexDirection: "row", alignItems: "center", gap: 8, marginTop: 4 },
  center: { textAlign: "center" },
  note: { marginTop: 16, paddingHorizontal: 24 },
  caption: { marginTop: 28, gap: 8, paddingHorizontal: 12 },
  captionText: { fontWeight: "500" },
  bars: { flexDirection: "row", alignItems: "center", gap: 2, height: 14 },
  bar: { width: 3, borderRadius: 2, backgroundColor: "#9CFA05" },
  actions: { flexDirection: "row", justifyContent: "space-between", paddingHorizontal: 4 },
  actionsRinging: { justifyContent: "space-around" },
  down: { transform: [{ rotate: "135deg" }] },
  action: { alignItems: "center", gap: 8, width: 76 },
  actionButton: {
    width: ACTION,
    height: ACTION,
    borderRadius: ACTION / 2,
    alignItems: "center",
    justifyContent: "center",
  },
});
