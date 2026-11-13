import { fillPluralGaps } from "@agenteschat/i18n/plurals";
import { ptBR } from "@agenteschat/i18n/pt-BR";
import { Slot } from "expo-router";
import i18n from "i18next";
import { initReactI18next } from "react-i18next";
import { View } from "react-native";
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

export default function PranchaLayout() {
  const ready = useAppFonts();
  if (!ready) return <View />;
  return (
    <GestureHandlerRootView style={{ flex: 1 }}>
      <SafeAreaProvider>
        <ThemeProvider>
          <Slot />
        </ThemeProvider>
      </SafeAreaProvider>
    </GestureHandlerRootView>
  );
}
