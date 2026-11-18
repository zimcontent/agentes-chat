import * as Clipboard from "expo-clipboard";
import { File, Paths } from "expo-file-system";
import { Alert } from "react-native";

type Handler = (error: unknown, isFatal?: boolean) => void;
type ErrorUtilsLike = { getGlobalHandler(): Handler; setGlobalHandler(handler: Handler): void };

/** In the app's own documents: never sent anywhere, gone with the app. */
const NAME = "last-crash.txt";

/**
 * Keeps the last error that closed the app (its time, message and stack) in a file of the app's own folder before
 * the system's handler ends it, so a crash of a test build can be read off the phone afterwards (`xcrun devicectl
 * device copy from --domain-type appDataContainer`) when nothing was attached to watch it. Errors drawing a screen
 * don't get here: its error boundary shows them (`ScreenError`).
 */
/** Writes an error to the same file: one that closed the app, or one caught on its way to closing it (`caught`). */
export function keepError(error: unknown, where = "") {
  try {
    const e = error instanceof Error ? error : new Error(String(error));
    new File(Paths.document, NAME).write(
      `${new Date().toISOString()}${where ? ` ${where}` : ""}\n${e.message}\n${e.stack ?? ""}\n`,
    );
  } catch {
    // Nothing to keep it in.
  }
}

/** The error's words for a person to copy and send: when, the message and the first lines of its stack. */
function errorText(error: unknown) {
  const e = error instanceof Error ? error : new Error(String(error));
  return `${new Date().toISOString()}\n${e.name}: ${e.message}\n${(e.stack ?? "").split("\n").slice(0, 25).join("\n")}`;
}

let showing = false;
/** One alert at a time, with the error's words and a way to copy them. */
function showError(title: string, text: string) {
  if (showing) return;
  showing = true;
  Alert.alert(title, text, [
    {
      text: "Copiar texto",
      onPress: () => {
        showing = false;
        void Clipboard.setStringAsync(text).catch(() => undefined);
      },
    },
    { text: "Fechar", style: "cancel", onPress: () => (showing = false) },
  ]);
}

/**
 * Diagnostic build: a fatal JavaScript error is kept, shown on screen with its words to copy, and the app goes on
 * instead of closing, so the error that froze the app on builds 20 to 25 can be read off the phone and sent.
 */
export function keepLastCrash() {
  const errorUtils = (globalThis as { ErrorUtils?: ErrorUtilsLike }).ErrorUtils;
  if (!errorUtils) return;
  errorUtils.setGlobalHandler((error, isFatal) => {
    keepError(error, isFatal ? "fatal" : "");
    showError(isFatal ? "Erro que fecharia o app" : "Erro no app", errorText(error));
  });
  // What the last run kept before it ended (a crash the handler saw), shown once at the next start.
  try {
    const file = new File(Paths.document, NAME);
    if (file.exists) {
      const text = file.textSync();
      file.delete();
      if (text.trim()) setTimeout(() => showError("Erro da última vez", text), 4000);
    }
  } catch {
    // Nothing kept.
  }
}
