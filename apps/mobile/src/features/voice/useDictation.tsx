import { keys, useApi } from "@agenteschat/client";
import { VOICE_MAX_MS, VOICE_MIN_MS, voiceClock } from "@agenteschat/client/lib/voice";
import { gradientOf, mixHex } from "@agenteschat/ui/agent/engine";
import { Skia } from "@shopify/react-native-skia";
import { useQuery } from "@tanstack/react-query";
import {
  getRecordingPermissionsAsync,
  type RecordingOptions,
  RecordingPresets,
  requestRecordingPermissionsAsync,
  setAudioModeAsync,
  useAudioRecorder,
} from "expo-audio";
import { File } from "expo-file-system";
import { useCallback, useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { ActivityIndicator, Alert, AppState, Linking, StyleSheet, View } from "react-native";
import { useSharedValue } from "react-native-reanimated";
import { authedFetch } from "@/lib/auth";
import { placeKey } from "@/lib/server";
import { serverOf } from "@/lib/server-choice";
import { haptics, Icon, PressScale, Text, useTheme, useToast } from "@/ui";
import { useDirectory } from "../shared/hooks";
import { agentLook } from "../shared/logic";
import { levelOf } from "./logic";
import { emptyWave, PixelWave, wavePaths } from "./VoiceBars";

/** Speech, small: one channel, levels on for the wave. */
const RECORDING: RecordingOptions = {
  ...RecordingPresets.HIGH_QUALITY,
  sampleRate: 22_050,
  numberOfChannels: 1,
  bitRate: 48_000,
  isMeteringEnabled: true,
};
const TICK_MS = 50;
/** The wave's height in the field. */
const WAVE = 24;
/** The field's buttons and their inset (`Composer`'s numbers). */
const BUTTON = 32;
const INSET = 16;
const GAP = 12;

export type DictationPhase = "idle" | "recording" | "transcribing";

/** Whether this person may record now, known before the tap so it never waits on the network. */
function useVoiceAllowed(orgId: string, enabled: boolean) {
  const api = useApi();
  const { data } = useQuery({
    queryKey: [...keys.org(orgId), "voice", "allowed"],
    enabled,
    staleTime: 60_000,
    queryFn: async () => (await api.voice.allowed(orgId)).allowed,
  });
  return data ?? null;
}

const removeFile = (uri: string | null) => {
  if (!uri) return;
  try {
    const f = new File(uri);
    if (f.exists) f.delete();
  } catch {}
};

/**
 * Dictation in the conversation's field (ADR 0100 addendum 2026-11-17), as the system's own: one tap on the microphone
 * records, the wave and the clock take the field's place, the × throws it away and the same button stops it. The
 * recording goes to the server's speech engine (`POST …/voice/dictate`) and its words come into the field at the
 * caret (`onWords`), to read, fix and send as text. Nothing is kept on the phone or the server. Null where voice is off.
 */
export function useDictation(input: {
  orgId: string;
  channelId: string;
  enabled: boolean;
  /** The agent this conversation is with, if one: its tones color the wave. */
  agentId?: string | null;
  onWords: (words: string) => void;
}): { mic: React.ReactNode; overlay: React.ReactNode | null; active: boolean } | null {
  const { orgId, channelId, enabled, agentId = null, onWords } = input;
  const { t, i18n } = useTranslation();
  const { colors: c, scheme } = useTheme();
  const toast = useToast();
  const dir = useDirectory();
  const allowed = useVoiceAllowed(orgId, enabled);
  const recorder = useAudioRecorder(RECORDING);
  const [phase, setPhaseState] = useState<DictationPhase>("idle");
  const [seconds, setSeconds] = useState(0);
  const phaseRef = useRef<DictationPhase>("idle");
  const levels = useRef<number[]>([]);
  const ms = useRef(0);
  const width = useRef(0);
  const timer = useRef<ReturnType<typeof setInterval> | null>(null);
  /** The recorder is starting; a tap meanwhile (`ending`) ends it as soon as it records. */
  const starting = useRef(false);
  const ending = useRef<"stop" | "cancel" | null>(null);
  const inner = useSharedValue(Skia.Path.Make());
  const edge = useSharedValue(Skia.Path.Make());
  const progress = useSharedValue(1);
  const say = (key: string) => toast({ title: t(key), icon: "mic" });
  const latest = useRef({ onWords, allowed, say, t, language: i18n.language });
  latest.current = { onWords, allowed, say, t, language: i18n.language };

  const setPhase = useCallback((next: DictationPhase) => {
    phaseRef.current = next;
    setPhaseState(next);
  }, []);
  const stopTimer = useCallback(() => {
    if (timer.current) clearInterval(timer.current);
    timer.current = null;
  }, []);
  const reset = useCallback(() => {
    stopTimer();
    levels.current = [];
    ms.current = 0;
    ending.current = null;
    inner.value = emptyWave().inner;
    edge.value = emptyWave().edge;
    setSeconds(0);
    setPhase("idle");
    void setAudioModeAsync({ allowsRecording: false, playsInSilentMode: true }).catch(() => undefined);
  }, [edge, inner, setPhase, stopTimer]);

  /** The recorder stopped; its file, if anything was recorded. */
  const stopRecorder = useCallback(async () => {
    stopTimer();
    try {
      await recorder.stop();
    } catch {}
    return recorder.uri ?? null;
  }, [recorder, stopTimer]);

  const cancel = useCallback(async () => {
    if (starting.current) {
      ending.current = "cancel";
      return;
    }
    if (phaseRef.current !== "recording") return;
    haptics.light();
    removeFile(await stopRecorder());
    reset();
  }, [reset, stopRecorder]);

  const stop = useCallback(async () => {
    if (starting.current) {
      ending.current = "stop";
      return;
    }
    if (phaseRef.current !== "recording") return;
    const length = ms.current;
    setPhase("transcribing");
    const uri = await stopRecorder();
    const { say, language, onWords: put } = latest.current;
    if (!uri || length < VOICE_MIN_MS) {
      removeFile(uri);
      reset();
      return;
    }
    haptics.light();
    try {
      const form = new FormData();
      // Expo's FormData takes a part with `bytes()` (see `outbox.ts`), never React Native's `{ uri }`.
      const file = new File(uri);
      form.append("file", { name: "dictation.m4a", type: "audio/mp4", bytes: () => file.bytes() } as unknown as Blob);
      form.append("durationMs", String(Math.round(length)));
      form.append("language", language.slice(0, 2));
      const place = placeKey();
      const res = await authedFetch(
        `${serverOf(place)}/api/app/organizations/${orgId}/channels/${channelId}/voice/dictate`,
        { method: "POST", body: form },
        place,
      );
      const body = (await res.json().catch(() => null)) as { text?: string; error?: { code?: string } } | null;
      if (res.ok && typeof body?.text === "string") {
        if (body.text.trim()) put(body.text.trim());
        else say("mobile.voice.noWords");
      } else if (body?.error?.code === "voice_limit") {
        haptics.warning();
        say("voice.limit");
      } else {
        haptics.warning();
        say("mobile.voice.dictationFailed");
      }
    } catch {
      haptics.warning();
      say("mobile.voice.dictationFailed");
    } finally {
      removeFile(uri);
      reset();
    }
  }, [channelId, orgId, reset, setPhase, stopRecorder]);

  const tick = useCallback(() => {
    const status = recorder.getStatus();
    // A call or Siri took the microphone: what was said is transcribed.
    if (!status.isRecording && status.durationMillis > 0) {
      void stop();
      return;
    }
    ms.current = status.durationMillis;
    levels.current.push(levelOf(status.metering));
    if (width.current > 0) {
      const wave = wavePaths(levels.current, width.current, WAVE, true);
      inner.value = wave.inner;
      edge.value = wave.edge;
    }
    const whole = Math.floor(ms.current / 1000);
    setSeconds((s) => (s === whole ? s : whole));
    if (ms.current >= VOICE_MAX_MS) void stop();
  }, [edge, inner, recorder, stop]);

  const start = useCallback(async () => {
    if (phaseRef.current !== "idle" || starting.current) return;
    const { say } = latest.current;
    if (latest.current.allowed === false) {
      haptics.warning();
      say("voice.limit");
      return;
    }
    ending.current = null;
    starting.current = true;
    try {
      const known = await getRecordingPermissionsAsync();
      if (!known.granted) {
        const asked = known.canAskAgain ? await requestRecordingPermissionsAsync() : known;
        if (!asked.granted && !asked.canAskAgain) {
          const { t: tr } = latest.current;
          Alert.alert(tr("voice.micBlocked"), tr("voice.micBlockedHint"), [
            { text: tr("voice.notNow"), style: "cancel" },
            { text: tr("voice.openSettings"), onPress: () => void Linking.openSettings() },
          ]);
        }
        // Asked now: the next tap records.
        starting.current = false;
        return;
      }
      haptics.medium();
      setPhase("recording");
      await setAudioModeAsync({ allowsRecording: true, playsInSilentMode: true, interruptionMode: "doNotMix" });
      await recorder.prepareToRecordAsync();
      recorder.record();
      timer.current = setInterval(tick, TICK_MS);
    } catch {
      starting.current = false;
      haptics.warning();
      say("mobile.voice.dictationFailed");
      await stopRecorder();
      reset();
      return;
    }
    starting.current = false;
    // Tapped again while the recorder was starting.
    if (ending.current === "cancel") await cancel();
    else if (ending.current === "stop") await stop();
  }, [cancel, recorder, reset, setPhase, stop, stopRecorder, tick]);

  // Sent to the background: what was said is transcribed, as when the person taps stop.
  useEffect(() => {
    const sub = AppState.addEventListener("change", (state) => {
      if (state === "background" && phaseRef.current === "recording") void stop();
    });
    return () => sub.remove();
  }, [stop]);
  // Leaving the conversation: a recording nobody finished is kept nowhere.
  useEffect(
    () => () => {
      stopTimer();
      if (phaseRef.current === "recording") {
        void recorder
          .stop()
          .then(() => removeFile(recorder.uri ?? null))
          .catch(() => undefined);
      }
    },
    [recorder, stopTimer],
  );

  if (!enabled) return null;

  const agent = agentId ? dir.agentById.get(agentId) : undefined;
  // The agent's sky, deep inside and light at the ends; in the dark the light tone and a paler one. Ink without one.
  const tones: readonly [string, string] = (() => {
    if (!agent) return [c.ink, c.ink];
    const [light, deep] = gradientOf(agentLook(agent).color);
    return scheme === "dark" ? [light, mixHex(light, "#ffffff", 0.4)] : [deep, light];
  })();

  const recording = phase === "recording";
  const transcribing = phase === "transcribing";

  const mic = transcribing ? (
    <View style={[styles.button, styles.center]} accessibilityLabel={t("mobile.voice.transcribing")}>
      <ActivityIndicator size="small" color={c.muted} />
    </View>
  ) : (
    <PressScale
      to={0.9}
      haptic={false}
      onPress={() => void (recording ? stop() : start())}
      accessibilityRole="button"
      accessibilityLabel={recording ? t("mobile.voice.stopDictating") : t("mobile.voice.dictate")}
      hitSlop={6}
      style={[styles.button, recording && { backgroundColor: c.ink }]}
    >
      <View style={styles.center}>
        {recording ? <Icon name="stop" size={18} color={c.bg} /> : <Icon name="mic" size={20} color={c.muted} />}
      </View>
    </PressScale>
  );

  const overlay = recording ? (
    <View style={[styles.overlay, { backgroundColor: c.raised2 }]} accessibilityLiveRegion="polite">
      <PressScale
        to={0.9}
        onPress={() => void cancel()}
        accessibilityRole="button"
        accessibilityLabel={t("mobile.voice.cancelDictating")}
        hitSlop={6}
        style={[styles.button, { backgroundColor: c.plate }]}
      >
        <View style={styles.center}>
          <Icon name="x" size={18} color={c.ink2} />
        </View>
      </PressScale>
      <View
        style={styles.wave}
        onLayout={(e) => {
          width.current = e.nativeEvent.layout.width;
        }}
      >
        <PixelWave
          inner={inner}
          edge={edge}
          progress={progress}
          tones={tones}
          off={c.faint}
          height={WAVE}
          fade={c.raised2}
        />
      </View>
      <Text variant="subhead" tone="muted" numberOfLines={1} style={styles.time}>
        {voiceClock(seconds * 1000)}
      </Text>
    </View>
  ) : transcribing ? (
    <View style={[styles.overlay, { backgroundColor: c.raised2 }]} accessibilityLiveRegion="polite">
      <Text variant="subhead" tone="muted" numberOfLines={1} style={styles.transcribing}>
        {t("mobile.voice.transcribing")}
      </Text>
    </View>
  ) : null;

  return { mic, overlay, active: phase !== "idle" };
}

const styles = StyleSheet.create({
  center: { flex: 1, alignItems: "center", justifyContent: "center" },
  button: { width: BUTTON, height: BUTTON, borderRadius: BUTTON / 2 },
  // Over the field's words and its other buttons, leaving the microphone's place (the field's end) free.
  overlay: {
    ...StyleSheet.absoluteFill,
    borderRadius: 22,
    flexDirection: "row",
    alignItems: "flex-end",
    gap: GAP,
    paddingVertical: INSET,
    paddingLeft: INSET,
    paddingRight: INSET + BUTTON + GAP,
  },
  wave: { flex: 1, minWidth: 0, height: BUTTON, flexDirection: "row", alignItems: "center" },
  time: { flexShrink: 0, lineHeight: BUTTON, fontVariant: ["tabular-nums"] },
  transcribing: { flex: 1, minWidth: 0, lineHeight: BUTTON, paddingLeft: 4 },
});
