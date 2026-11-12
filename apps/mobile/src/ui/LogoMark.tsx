import { useId, useMemo } from "react";
import { View } from "react-native";
import { SvgXml } from "react-native-svg";
import { svgDoBot } from "@/brand/bots";

/**
 * DougBot's mark: the Doug, close up, drawn by the identity's code (`dougbot-avatar.js`), never an image file. A
 * workspace without a logo of its own wears it. No light on the floor: a mark sits on any ground.
 */
export function LogoMark({ size }: { size: number }) {
  const id = `m${useId().replace(/[^a-zA-Z0-9]/g, "")}`;
  const xml = useMemo(() => svgDoBot({ bot: "doug", tamanho: size, perto: true, brilho: false, id }), [size, id]);
  return (
    <View style={{ width: size, height: size }} accessibilityElementsHidden importantForAccessibility="no">
      <SvgXml xml={xml} width={size} height={size} />
    </View>
  );
}
