import { bodyTones } from "@agenteschat/ui/agent/engine";
import { useId } from "react";
import { StyleSheet, View } from "react-native";
import Svg, { Circle, Defs, LinearGradient, Stop } from "react-native-svg";
import { Icon } from "./Icon";
import { roleMarkFit, roleMarkIcon } from "./role-mark";

/**
 * A workspace role's mark (ADR 0085), as the web's: the role's color in a full circle of glass (DougBot: no pixel dither; a soft light from the top) (never a
 * person's tile or an agent's cut corner), its icon in white on top with the web's one-point shadow. Decorative: the
 * role's name is always beside it. Without `icon` (Todos' and the owners' marks pass theirs) the circle alone.
 */
export function RoleMark({ color, icon, size = 26 }: { color: string; icon?: string | null; size?: number }) {
  const clip = `role-${useId().replace(/[^\w-]/g, "")}`;
  const { cells, icon: px } = roleMarkFit(size);
  const name = icon ? roleMarkIcon(icon) : null;
  const tones = bodyTones(color);
  return (
    <View
      style={{ width: size, height: size }}
      accessibilityElementsHidden
      importantForAccessibility="no-hide-descendants"
    >
      <Svg width={size} height={size} viewBox={`0 0 ${cells} ${cells}`}>
        <Defs>
          <LinearGradient id={clip} x1="0" y1="0" x2="0" y2="1">
            <Stop offset="0" stopColor={tones[3] ?? color} />
            <Stop offset="1" stopColor={tones[1] ?? color} />
          </LinearGradient>
        </Defs>
        <Circle cx={cells / 2} cy={cells / 2} r={cells / 2} fill={`url(#${clip})`} />
        <Circle
          cx={cells / 2}
          cy={cells / 2}
          r={cells / 2 - 0.4}
          fill="none"
          stroke="rgba(255,255,255,0.28)"
          strokeWidth={0.8}
        />
      </Svg>
      {name ? (
        <>
          <View style={[StyleSheet.absoluteFill, styles.center, styles.shadow]}>
            <Icon name={name} size={px} color="rgba(0,0,0,0.22)" />
          </View>
          <View style={[StyleSheet.absoluteFill, styles.center]}>
            <Icon name={name} size={px} color="#ffffff" />
          </View>
        </>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  center: { alignItems: "center", justifyContent: "center" },
  shadow: { top: 1, bottom: -1 },
});
