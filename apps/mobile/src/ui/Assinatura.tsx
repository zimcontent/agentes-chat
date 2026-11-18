import { useClientLook } from "@agenteschat/client";
import { productName } from "@agenteschat/client/lib/client-custom";
import { Text as RNText, View } from "react-native";
import { DB_FONTES } from "@/brand/tokens";
import { LogoMark } from "./LogoMark";
import { useTheme } from "./theme";

/** This build's own name, what a server with no client signs (ADR doug-0020). */
const BUILD_NAME = "DougBot";

/**
 * A name in the signature's two weights: the first word 800, the rest 500 ("Doug" + "Bot"), the way the identity draws
 * it. A client's name keeps that split at its first space ("Padaria" + " Aurora").
 */
function SignatureName({ name, size, color }: { name: string; size: number; color?: string }) {
  const face = { fontSize: size, lineHeight: Math.round(size * 1.2), letterSpacing: -0.035 * size, color };
  const at = name.indexOf(" ");
  if (at < 0) return <RNText style={[face, { fontFamily: DB_FONTES.titulo800, fontWeight: "800" }]}>{name}</RNText>;
  return (
    <>
      <RNText style={[face, { fontFamily: DB_FONTES.titulo800, fontWeight: "800" }]}>{name.slice(0, at)}</RNText>
      <RNText style={[face, { fontFamily: DB_FONTES.titulo500, fontWeight: "500" }]}>{name.slice(at)}</RNText>
    </>
  );
}

/**
 * DougBot's signature (IDENTIDADE.md §3): the Doug close up and the name, side by side, no box, no badge, no shadow.
 * The name is live text: "Doug" in Manrope 800 and "Bot" in Manrope 500, the same color, tracking −0.035em. The Doug
 * is 1.42× the name's size, 0.36× the size apart. On the dark stage both in #EDEDED, on light in ink (#0A0A0A).
 * Minimum 20 tall. `color` sets the ink on a ground of its own (the island's dark glass, in either theme).
 *
 * A server deployed for one client signs its name instead (ADR doug-0020): `label` names it outright, else the
 * client's name from `GET /me`, else this build's.
 */
export function Assinatura({ size = 22, label, color }: { size?: number; label?: string; color?: string }) {
  const { colors } = useTheme();
  // This server's client names the product (ADR doug-0020); `label` names it outright where a caller says so.
  const client = useClientLook();
  const name = label ?? productName(client, BUILD_NAME);
  const t = Math.max(size, 20 / 1.42);
  const mark = Math.round(t * 1.42);
  return (
    <View
      accessible
      accessibilityRole="header"
      accessibilityLabel={name}
      style={{ flexDirection: "row", alignItems: "center", gap: Math.round(t * 0.36) }}
    >
      <LogoMark size={mark} />
      <RNText allowFontScaling={false}>
        <SignatureName name={name} size={t} color={color ?? colors.ink} />
      </RNText>
    </View>
  );
}
