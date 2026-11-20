import { VOICE_MAX_MS } from "@dougbot/client/lib/voice";
import {
  getRecordingPermissionsAsync,
  RecordingPresets,
  requestRecordingPermissionsAsync,
  setAudioModeAsync,
  useAudioRecorder,
} from "expo-audio";
import { useCallback, useEffect, useRef, useState } from "react";

/** WhatsApp takes a voice message of at least a second. */
export const TAKE_MIN_MS = 1_000;

/**
 * A voice message for WhatsApp: held on the green mic (or locked, hands free), then sent or deleted, as in WhatsApp.
 * `start` answers whether it is recording. `stop` answers the finished file and its length; null when there was nothing (or it was too short).
 * Past the app's longest voice message it stops by itself and `onFull` sends what it has.
 */
export function useWhatsAppTake({ onBlocked, onFull }: { onBlocked: () => void; onFull: () => void }) {
  const recorder = useAudioRecorder(RecordingPresets.HIGH_QUALITY);
  const [recording, setRecording] = useState(false);
  const [ms, setMs] = useState(0);
  const started = useRef(0);
  const timer = useRef<ReturnType<typeof setInterval> | null>(null);
  const full = useRef(onFull);
  full.current = onFull;

  const clear = useCallback(() => {
    if (timer.current) clearInterval(timer.current);
    timer.current = null;
  }, []);

  useEffect(
    () => () => {
      clear();
      if (recorder.isRecording) void recorder.stop().catch(() => undefined);
      void setAudioModeAsync({ allowsRecording: false, playsInSilentMode: true }).catch(() => undefined);
    },
    [recorder, clear],
  );

  const start = useCallback(async (): Promise<boolean> => {
    const known = await getRecordingPermissionsAsync();
    const asked = known.granted ? known : known.canAskAgain ? await requestRecordingPermissionsAsync() : known;
    if (!asked.granted) {
      onBlocked();
      return false;
    }
    try {
      await setAudioModeAsync({ allowsRecording: true, playsInSilentMode: true, interruptionMode: "doNotMix" });
      await recorder.prepareToRecordAsync();
      recorder.record();
    } catch {
      return false;
    }
    started.current = Date.now();
    setMs(0);
    setRecording(true);
    timer.current = setInterval(() => {
      const now = Date.now() - started.current;
      setMs(now);
      if (now >= VOICE_MAX_MS) full.current();
    }, 250);
    return true;
  }, [recorder, onBlocked]);

  const finish = useCallback(async () => {
    clear();
    setRecording(false);
    const length = Date.now() - started.current;
    try {
      await recorder.stop();
    } catch {}
    await setAudioModeAsync({ allowsRecording: false, playsInSilentMode: true }).catch(() => undefined);
    return { uri: recorder.uri ?? null, ms: length };
  }, [recorder, clear]);

  /** Stops and answers the take to send; null when it is too short to go. */
  const stop = useCallback(async () => {
    const take = await finish();
    return take.uri && take.ms >= TAKE_MIN_MS ? { uri: take.uri, ms: take.ms } : null;
  }, [finish]);

  /** Stops and drops it. */
  const cancel = useCallback(async () => {
    await finish();
  }, [finish]);

  return { recording, ms, start, stop, cancel };
}
