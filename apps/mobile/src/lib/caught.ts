import * as Clipboard from "expo-clipboard";
import i18n from "i18next";
import { Alert } from "react-native";
import { reportError } from "./error-reports";
import { keepError } from "./last-crash";

/**
 * An error thrown by a tap (send, the microphone) stops here instead of closing the app: thrown out of a press, it
 * reached React Native's scheduler as a fatal error, and on Expo SDK 58 before expo-modules-jsi 58.0.21 that froze the
 * app until iOS killed it (a deadlock in `RuntimeScheduler_Modern::clearQueues`, expo/expo#51880). It is reported and
 * kept as the last crash is, and the person sees what failed, with its words to copy for whoever fixes it.
 */
export function showCaught(where: string, error: unknown) {
  reportError(error, { where });
  keepError(error, where);
  const e = error instanceof Error ? error : new Error(String(error));
  const text = `${where}: ${e.message}\n${(e.stack ?? "").split("\n").slice(0, 8).join("\n")}`;
  Alert.alert(i18n.t("mobile.app.failed"), text, [
    { text: i18n.t("mobile.chat.copy"), onPress: () => void Clipboard.setStringAsync(text).catch(() => undefined) },
    { text: i18n.t("common.close"), style: "cancel" },
  ]);
}

/** Runs `fn` and stops whatever it throws (`showCaught`). */
export function caught<A extends unknown[]>(where: string, fn: (...args: A) => void): (...args: A) => void {
  return (...args: A) => {
    try {
      fn(...args);
    } catch (error) {
      showCaught(where, error);
    }
  };
}
