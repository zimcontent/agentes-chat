import { ApiProvider } from "@dougbot/client";
import { fillPluralGaps } from "@dougbot/i18n/plurals";
import { ptBR } from "@dougbot/i18n/pt-BR";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { Slot } from "expo-router";
import i18n from "i18next";
import { initReactI18next } from "react-i18next";
import { Platform, View } from "react-native";
import { GestureHandlerRootView } from "react-native-gesture-handler";
import { SafeAreaProvider } from "react-native-safe-area-context";
import { FEATURES } from "@/features/i18n/locales";
import { withMobileKeys } from "@/i18n/merge";
import { useAppFonts } from "@/providers/fonts";
import { ThemeProvider } from "@/ui/theme";

/**
 * The visual board (`DOUGBOT_PRANCHA=1 expo start --web`, or `expo export --platform web`): the app's own components
 * with sample data, in a browser, for the Q&A of the identity (both themes follow the browser's `prefers-color-scheme`).
 * It is not the app: no server, no session, no navigation. See the README's "Prancha".
 */
if (!i18n.isInitialized) {
  const strings = withMobileKeys(
    { "pt-BR": { translation: fillPluralGaps("pt-BR", ptBR) } },
    { "pt-BR": FEATURES["pt-BR"] },
  )["pt-BR"];
  void i18n.use(initReactI18next).init({
    lng: "pt-BR",
    fallbackLng: "pt-BR",
    resources: { "pt-BR": strings ?? {} },
    interpolation: { escapeValue: false },
  });
}

/**
 * `?w=320` lays every screen out in a phone that wide: a headless browser's window doesn't go under about 500, so a
 * narrow window alone only crops the 390 phone.
 */
const narrow = (() => {
  if (Platform.OS !== "web" || typeof location === "undefined") return null;
  const w = Number(new URLSearchParams(location.search).get("w"));
  return w >= 240 && w <= 1200 ? w : null;
})();

/**
 * No server here: a part that reads the server (the signature asks whether it serves a client, ADR doug-0032) gets a
 * client whose every call waits forever, so it draws as a server with no client would.
 */
const pending = (): unknown => new Promise(() => {});
const offline = new Proxy({}, { get: () => new Proxy(pending, { get: () => pending, apply: pending }) });
const boardQueries = new QueryClient({ defaultOptions: { queries: { retry: false } } });

export default function PranchaLayout() {
  const ready = useAppFonts();
  if (!ready) return <View />;
  return (
    <QueryClientProvider client={boardQueries}>
      <ApiProvider client={offline as Parameters<typeof ApiProvider>[0]["client"]}>
        <GestureHandlerRootView style={{ flex: 1 }}>
          <SafeAreaProvider>
            <ThemeProvider>
              {narrow ? (
                <View style={{ flex: 1, width: narrow, overflow: "hidden" }}>
                  <Slot />
                </View>
              ) : (
                <Slot />
              )}
            </ThemeProvider>
          </SafeAreaProvider>
        </GestureHandlerRootView>
      </ApiProvider>
    </QueryClientProvider>
  );
}
