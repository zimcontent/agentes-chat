import { type WhatsAppMessage, whatsappFileUrl } from "@dougbot/client";
import { memo, type ReactNode, useEffect, useMemo, useState, useSyncExternalStore } from "react";
import { useTranslation } from "react-i18next";
import { Pressable, Text as RNText, StyleSheet, View } from "react-native";
import { GestureDetector, useExclusiveGestures, usePanGesture, useTapGesture } from "react-native-gesture-handler";
import { scheduleOnRN } from "react-native-worklets";
import { useOrgId } from "../shared/hooks";
import { nextSpeed } from "../voice/logic";
import {
  playingId,
  seekPlayback,
  setPlaybackSpeed,
  startPlayback,
  stopPlayback,
  subscribePlayback,
} from "../voice/playback";
import { setVoiceSpeed, subscribeVoiceSpeed, voiceSpeed } from "../voice/speed";
import { clockOf, ownFile, waveBars } from "./logic";
import { useWa, WA_FONT, WaGlyph } from "./look";
import { useWhatsAppWords } from "./words";

/** A bar of the wave and the room after it, as WhatsApp draws them. */
const BAR_W = 3;
const BAR_GAP = 2;
const WAVE_H = 26;
const DOT = 13;
/** The list recycles rows: where each voice message stopped lives outside them. */
const positions = new Map<string, number>();
/** Voice messages played to the end here: their dot turns from green to blue, as WhatsApp's do. */
const heard = new Set<string>();

/**
 * A WhatsApp voice message as its own app draws it: the solid play button, the recording's own loudness as rounded
 * bars that fill blue as it plays, the round dot where it is (tap or drag the wave to go there), its length under it,
 * and the sender's photo with a mic, which gives way to the speed (1×, 1,5×, 2×) while it plays.
 */
export const VoiceNote = memo(function VoiceNote({
  message: m,
  accountId,
  face,
  stamp,
}: {
  message: WhatsAppMessage;
  accountId: string;
  face: ReactNode;
  stamp: ReactNode;
}) {
  const w = useWhatsAppWords();
  const wa = useWa();
  const { t, i18n } = useTranslation();
  const orgId = useOrgId();
  const playing = useSyncExternalStore(subscribePlayback, () => playingId() === m.id);
  const rate = useSyncExternalStore(subscribeVoiceSpeed, voiceSpeed);
  const [at, setAt] = useState(() => positions.get(m.id) ?? 0);
  const [width, setWidth] = useState(0);
  const [broken, setBroken] = useState(false);
  const [done, setDone] = useState(() => heard.has(m.id));
  const seconds = m.media?.seconds ?? 0;
  const count = width > 0 ? Math.max(12, Math.floor((width + BAR_GAP) / (BAR_W + BAR_GAP))) : 0;
  const bars = useMemo(() => (count > 0 ? waveBars(m.wave, m.id, count) : []), [m.wave, m.id, count]);
  const speedFormat = useMemo(
    () => new Intl.NumberFormat(i18n.language, { maximumFractionDigits: 1 }),
    [i18n.language],
  );

  // A recycled row takes on another message.
  useEffect(() => {
    setAt(positions.get(m.id) ?? 0);
    setBroken(false);
    setDone(heard.has(m.id));
  }, [m.id]);
  useEffect(() => {
    if (playing) setPlaybackSpeed(m.id, rate);
  }, [playing, rate, m.id]);

  const report = (next: number) => {
    positions.set(m.id, next);
    setAt(next);
  };
  const play = (from: number) => {
    setBroken(false);
    void startPlayback({
      id: m.id,
      source: ownFile((base) => whatsappFileUrl(orgId, accountId, m.id, base)),
      durationMs: seconds * 1000,
      from,
      speed: voiceSpeed(),
      onProgress: report,
      onEnd: () => {
        positions.delete(m.id);
        heard.add(m.id);
        setDone(true);
        setAt(0);
      },
      onError: () => setBroken(true),
    }).catch(() => setBroken(true));
  };
  const toggle = () => {
    if (playing) stopPlayback();
    else play(at >= 0.999 ? 0 : at);
  };
  // Going to a spot plays from there, as a tap on WhatsApp's wave does.
  const seek = (to: number) => {
    report(to);
    if (playing) seekPlayback(m.id, to);
    else play(to);
  };
  const fraction = (x: number) => {
    "worklet";
    return width > 0 ? Math.max(0, Math.min(0.999, x / width)) : 0;
  };
  const pan = usePanGesture({
    activeOffsetX: [-4, 4],
    failOffsetY: [-12, 12],
    onUpdate: (e) => {
      "worklet";
      scheduleOnRN(report, fraction(e.x));
    },
    onDeactivate: (e) => {
      "worklet";
      scheduleOnRN(seek, fraction(e.x));
    },
  });
  const tap = useTapGesture({
    onDeactivate: (e) => {
      "worklet";
      if (!e.canceled) scheduleOnRN(seek, fraction(e.x));
    },
  });
  const scrub = useExclusiveGestures(pan, tap);

  const played = Math.round(at * bars.length);
  const shown = playing || at > 0 ? seconds * at : seconds;
  const meta = m.fromMe ? wa.metaOut : wa.sub;
  const idle = m.fromMe ? wa.metaOut : wa.sub;
  // The dot: green on a message nobody here has played yet, blue once it was (WhatsApp's own cue).
  const dot = m.fromMe || done || at > 0 ? wa.played : wa.green;
  const label = `${playing ? w.pause : w.play}, ${clockOf(seconds)}`;
  return (
    <View>
      <View style={styles.voice}>
        <Pressable
          onPress={toggle}
          hitSlop={10}
          accessibilityRole="button"
          accessibilityLabel={label}
          style={({ pressed }) => [styles.play, pressed ? styles.pressed : null]}
        >
          <WaGlyph name={playing ? "pauseSolid" : "playSolid"} size={30} color={wa.soft} fill={wa.soft} weight={0.6} />
        </Pressable>
        <View style={styles.mid}>
          <GestureDetector gesture={scrub}>
            <View
              style={styles.wave}
              onLayout={(e) => setWidth(e.nativeEvent.layout.width)}
              accessible
              accessibilityRole="adjustable"
              accessibilityLabel={label}
              accessibilityValue={{ min: 0, max: 100, now: Math.round(at * 100) }}
              accessibilityActions={[{ name: "increment" }, { name: "decrement" }]}
              onAccessibilityAction={(e) =>
                seek(Math.max(0, Math.min(0.999, at + (e.nativeEvent.actionName === "increment" ? 0.1 : -0.1))))
              }
            >
              {bars.map((h, i) => (
                <View
                  // biome-ignore lint/suspicious/noArrayIndexKey: the bars are a fixed row, by position
                  key={i}
                  style={[
                    styles.bar,
                    { height: Math.max(BAR_W, Math.round(h * WAVE_H)), backgroundColor: i < played ? wa.played : idle },
                    i < played ? null : styles.barIdle,
                  ]}
                />
              ))}
              {width > 0 ? (
                <View
                  pointerEvents="none"
                  style={[styles.dot, { left: Math.min(width - DOT, at * width - DOT / 2), backgroundColor: dot }]}
                />
              ) : null}
            </View>
          </GestureDetector>
          <View style={styles.foot}>
            <RNText style={[styles.clock, { color: meta }]}>{clockOf(shown)}</RNText>
            {stamp}
          </View>
        </View>
        {playing || at > 0 ? (
          <Pressable
            onPress={() => setVoiceSpeed(nextSpeed(rate))}
            accessibilityRole="button"
            accessibilityLabel={w.chat.speed}
            hitSlop={10}
            style={({ pressed }) => [styles.speed, { backgroundColor: wa.dayFill }, pressed ? styles.pressed : null]}
          >
            <RNText style={[styles.speedText, { color: wa.ink }]}>{`${speedFormat.format(rate)}×`}</RNText>
          </Pressable>
        ) : face ? (
          <View style={styles.face}>
            {face}
            <View style={[styles.badge, { backgroundColor: m.fromMe ? wa.bubbleOut : wa.bubbleIn }]}>
              <WaGlyph name="mic" size={15} color={done ? wa.played : wa.green} weight={2.2} />
            </View>
          </View>
        ) : null}
      </View>
      {broken ? (
        <Pressable onPress={toggle} accessibilityRole="button" hitSlop={8} style={styles.broken}>
          <RNText style={[styles.brokenText, { color: wa.danger }]}>
            {t("voice.cantPlay")} <RNText style={styles.retry}>{t("common.retry")}</RNText>
          </RNText>
        </Pressable>
      ) : null}
    </View>
  );
});

const styles = StyleSheet.create({
  voice: { flexDirection: "row", alignItems: "center", gap: 8 },
  play: { width: 34, height: 40, alignItems: "center", justifyContent: "center" },
  pressed: { opacity: 0.6 },
  mid: { flex: 1, minWidth: 0, paddingTop: 10 },
  wave: { height: WAVE_H + 4, flexDirection: "row", alignItems: "center", gap: BAR_GAP },
  bar: { width: BAR_W, borderRadius: BAR_W / 2 },
  barIdle: { opacity: 0.75 },
  dot: { position: "absolute", top: (WAVE_H + 4 - DOT) / 2, width: DOT, height: DOT, borderRadius: DOT / 2 },
  foot: { flexDirection: "row", justifyContent: "space-between", alignItems: "center", marginTop: 1 },
  clock: { fontFamily: WA_FONT.r, fontSize: 11.5, fontVariant: ["tabular-nums"] },
  speed: {
    minWidth: 42,
    height: 26,
    paddingHorizontal: 8,
    borderRadius: 13,
    alignItems: "center",
    justifyContent: "center",
  },
  speedText: { fontFamily: WA_FONT.s, fontSize: 13, fontVariant: ["tabular-nums"] },
  face: { width: 46, height: 46, alignItems: "center", justifyContent: "center" },
  badge: {
    position: "absolute",
    left: -2,
    bottom: -1,
    width: 20,
    height: 20,
    borderRadius: 10,
    alignItems: "center",
    justifyContent: "center",
  },
  broken: { paddingTop: 4, paddingLeft: 42 },
  brokenText: { fontFamily: WA_FONT.r, fontSize: 12.5 },
  retry: { fontFamily: WA_FONT.s, textDecorationLine: "underline" },
});
