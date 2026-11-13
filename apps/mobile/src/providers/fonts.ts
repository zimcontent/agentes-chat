import { Inter_400Regular } from "@expo-google-fonts/inter/400Regular";
import { Inter_500Medium } from "@expo-google-fonts/inter/500Medium";
import { Inter_600SemiBold } from "@expo-google-fonts/inter/600SemiBold";
import { Inter_700Bold } from "@expo-google-fonts/inter/700Bold";
import { JetBrainsMono_400Regular } from "@expo-google-fonts/jetbrains-mono/400Regular";
import { JetBrainsMono_500Medium } from "@expo-google-fonts/jetbrains-mono/500Medium";
import { Manrope_500Medium } from "@expo-google-fonts/manrope/500Medium";
import { Manrope_700Bold } from "@expo-google-fonts/manrope/700Bold";
import { Manrope_800ExtraBold } from "@expo-google-fonts/manrope/800ExtraBold";
import { useFonts } from "expo-font";
import { DB_FONTES } from "@/brand/tokens";

/**
 * DougBot's three families (IDENTIDADE.md §5), embedded from @expo-google-fonts (static files, one per weight: React
 * Native has no variable axes and picks no weight inside a family): Manrope 800/700/500 for titles, the name DougBot
 * and the bots' names; Inter 400/500/600 (700 for the odd bold) for the interface and the conversation; JetBrains Mono
 * for values and code. The family names are `DB_FONTES`. SIL Open Font License.
 */
export function useAppFonts(): boolean {
  const [loaded, error] = useFonts({
    [DB_FONTES.titulo800]: Manrope_800ExtraBold,
    [DB_FONTES.titulo700]: Manrope_700Bold,
    [DB_FONTES.titulo500]: Manrope_500Medium,
    [DB_FONTES.texto400]: Inter_400Regular,
    [DB_FONTES.texto500]: Inter_500Medium,
    [DB_FONTES.texto600]: Inter_600SemiBold,
    [DB_FONTES.texto700]: Inter_700Bold,
    [DB_FONTES.codigo400]: JetBrainsMono_400Regular,
    [DB_FONTES.codigo500]: JetBrainsMono_500Medium,
  });
  // A font that fails to load falls back to the system font: never block the app on it.
  return loaded || Boolean(error);
}
