import { memo, useId } from "react";
import { StyleSheet, View } from "react-native";
import Svg, { Circle, Defs, Pattern, RadialGradient, Rect, Stop } from "react-native-svg";
import { useTheme } from "@/ui";
import { BACKDROP_DOT, BACKDROP_STEP, backdropTones } from "./backdrop";

/**
 * The conversation's texture behind its list: the dot grid and the glow from the top (`backdrop.ts`). One static
 * drawing, sized once with the screen: it sits under the list, never inside it, so scrolling never draws it again,
 * and nothing in it moves. Touches pass through.
 */
export const ChatBackdrop = memo(function ChatBackdrop({ accent }: { accent?: string | null }) {
  const { scheme } = useTheme();
  const tones = backdropTones(scheme === "dark", accent);
  // Ids of their own: two conversations mounted at once (a push over another) never share a pattern.
  const id = useId().replace(/[^a-zA-Z0-9]/g, "");
  const half = BACKDROP_STEP / 2;
  return (
    <View
      style={StyleSheet.absoluteFill}
      pointerEvents="none"
      accessibilityElementsHidden
      importantForAccessibility="no"
    >
      <Svg width="100%" height="100%">
        <Defs>
          <Pattern id={`dots${id}`} width={BACKDROP_STEP} height={BACKDROP_STEP} patternUnits="userSpaceOnUse">
            <Circle cx={half} cy={half} r={BACKDROP_DOT} fill={tones.dot} fillOpacity={tones.dotOpacity} />
          </Pattern>
          <RadialGradient id={`glow${id}`} cx="20%" cy="12%" rx="95%" ry="46%" fx="20%" fy="12%">
            <Stop offset="0" stopColor={tones.glow} stopOpacity={tones.glowOpacity} />
            <Stop offset="0.55" stopColor={tones.glow} stopOpacity={tones.glowOpacity * 0.35} />
            <Stop offset="1" stopColor={tones.glow} stopOpacity={0} />
          </RadialGradient>
        </Defs>
        {/* Its heart just under the bar (the bar's band covers the very top). */}
        <Rect x="0" y="0" width="100%" height="100%" fill={`url(#glow${id})`} />
        <Rect x="0" y="0" width="100%" height="100%" fill={`url(#dots${id})`} />
      </Svg>
    </View>
  );
});
