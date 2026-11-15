import {
  getRecordingPermissionsAsync,
  RecordingPresets,
  requestRecordingPermissionsAsync,
  setAudioModeAsync,
  useAudioRecorder,
} from "expo-audio";
import { useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { Alert, Linking } from "react-native";
import { useReviewWords } from "./media";

/**
 * Tap to start, tap again to stop (docs/adr/doug-0007-video-review.md): a note said aloud, or the word that goes with
 * "Pedir ajustes". `toggle` answers the finished recording's file when it stops, null when it starts or can't.
 */
export function useTapRecorder() {
  const w = useReviewWords();
  const { t } = useTranslation();
  const recorder = useAudioRecorder(RecordingPresets.HIGH_QUALITY);
  const [recording, setRecording] = useState(false);
  const live = useRef(true);
  useEffect(
    () => () => {
      live.current = false;
      if (recorder.isRecording) void recorder.stop().catch(() => undefined);
      void setAudioModeAsync({ allowsRecording: false, playsInSilentMode: true });
    },
    [recorder],
  );

  const toggle = async (): Promise<string | null> => {
    if (recording) {
      setRecording(false);
      try {
        await recorder.stop();
      } catch {}
      await setAudioModeAsync({ allowsRecording: false, playsInSilentMode: true });
      return recorder.uri ?? null;
    }
    const known = await getRecordingPermissionsAsync();
    const asked = known.granted ? known : known.canAskAgain ? await requestRecordingPermissionsAsync() : known;
    if (!asked.granted) {
      Alert.alert(w.micBlockedPhone, undefined, [
        { text: w.cancel, style: "cancel" },
        { text: t("mobile.common.openSettings"), onPress: () => void Linking.openSettings() },
      ]);
      return null;
    }
    await setAudioModeAsync({ allowsRecording: true, playsInSilentMode: true, interruptionMode: "doNotMix" });
    await recorder.prepareToRecordAsync();
    recorder.record();
    if (live.current) setRecording(true);
    return null;
  };

  return { recording, toggle };
}
