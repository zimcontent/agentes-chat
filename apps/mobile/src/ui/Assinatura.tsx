import { Text as RNText, View } from "react-native";
import { DB_FONTES } from "@/brand/tokens";
import { LogoMark } from "./LogoMark";
import { useTheme } from "./theme";

/**
 * DougBot's signature (IDENTIDADE.md §3): the Doug close up and the name, side by side, no box, no badge, no shadow.
 * The name is live text: "Doug" in Manrope 800 and "Bot" in Manrope 500, the same color, tracking −0.035em. The Doug
 * is 1.42× the name's size, 0.36× the size apart. On the dark stage both in #EDEDED, on light in ink (#0A0A0A).
 * Minimum 20 tall. `color` sets the ink on a ground of its own (the island's dark glass, in either theme).
 */
export function Assinatura({ size = 22, label = "DougBot", color }: { size?: number; label?: string; color?: string }) {
  const { colors } = useTheme();
  const t = Math.max(size, 20 / 1.42);
  const mark = Math.round(t * 1.42);
  const text = { fontSize: t, lineHeight: Math.round(t * 1.2), letterSpacing: -0.035 * t, color: color ?? colors.ink };
  return (
    <View
      accessible
      accessibilityRole="header"
      accessibilityLabel={label}
      style={{ flexDirection: "row", alignItems: "center", gap: Math.round(t * 0.36) }}
    >
      <LogoMark size={mark} />
      <RNText allowFontScaling={false} style={[text, { fontFamily: DB_FONTES.titulo500, fontWeight: "500" }]}>
        <RNText style={{ fontFamily: DB_FONTES.titulo800, fontWeight: "800" }}>Doug</RNText>
        Bot
      </RNText>
    </View>
  );
}
