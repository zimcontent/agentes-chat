import { useEffect } from "react";
import { View } from "react-native";
import Animated, { useAnimatedStyle, useSharedValue, withSequence, withTiming } from "react-native-reanimated";
import Svg, { Circle, Path } from "react-native-svg";
import { useReducedMotion, useTheme } from "@/ui/theme";
import { useLoop } from "./loop";
import { BREATH_MS, stopBreath } from "./orbit";
import { Spinner } from "./PixelOrbit";

/**
 * The step marks next to the agent's work, drawn as clean vectors (DougBot: no pixels): the neutral turning ring
 * ("enviando", "lê na próxima pausa"), a finished step's check, a failed step's exclamation, a stopped step's dim
 * square and the composer's rounded stop square. Nothing moves with reduced motion.
 */

const hidden = { accessibilityElementsHidden: true, importantForAccessibility: "no-hide-descendants" as const };

/** The thin turning ring in ink (no agent color): something on its way that isn't an agent's work. */
export function InkOrbit({ size = 12, color }: { size?: number; color?: string }) {
  const { colors } = useTheme();
  return <Spinner size={size} color={color ?? colors.muted} />;
}

/** A finished step: a check in a 2-point stroke, popping in (~160 ms). */
export function PixelDone({ size = 14 }: { size?: number }) {
  const { colors } = useTheme();
  const reduced = useReducedMotion();
  const k = useSharedValue(reduced ? 1 : 0);
  const pop = useSharedValue(reduced ? 1 : 0.6);
  useEffect(() => {
    if (reduced) return;
    k.value = withTiming(1, { duration: 160 });
    pop.value = withSequence(withTiming(1.15, { duration: 100 }), withTiming(1, { duration: 60 }));
  }, [reduced, k, pop]);
  const style = useAnimatedStyle(() => ({ opacity: k.value, transform: [{ scale: pop.value }] }));
  const s = size / 14;
  return (
    <View style={{ width: size, height: size }} {...hidden}>
      <Animated.View style={[{ width: size, height: size }, style]}>
        <Svg width={size} height={size}>
          <Path
            d={`M${2.8 * s} ${7.4 * s}L${5.8 * s} ${10.2 * s}L${11.2 * s} ${3.9 * s}`}
            stroke={colors.ok}
            strokeWidth={2}
            strokeLinecap="round"
            strokeLinejoin="round"
            fill="none"
          />
        </Svg>
      </Animated.View>
    </View>
  );
}

/** A failed step: an exclamation (a 2-point stroke and its dot) in the danger color. */
export function PixelFail({ size = 14 }: { size?: number }) {
  const { colors } = useTheme();
  const x = size / 2;
  return (
    <View style={{ width: size, height: size }} {...hidden}>
      <Svg width={size} height={size}>
        <Path
          d={`M${x} ${size * 0.16}V${size * 0.6}`}
          stroke={colors.danger}
          strokeWidth={2}
          strokeLinecap="round"
          fill="none"
        />
        <Circle cx={x} cy={size * 0.83} r={1.25} fill={colors.danger} />
      </Svg>
    </View>
  );
}

/** A step cut short by a stop: a small square with rounded corners, dim. */
export function PixelStopped({ size = 14 }: { size?: number }) {
  const { colors } = useTheme();
  const side = Math.round(size * 0.64);
  return (
    <View style={{ width: size, height: size, alignItems: "center", justifyContent: "center" }} {...hidden}>
      <View style={{ width: side, height: side, borderRadius: 2, backgroundColor: colors.muted, opacity: 0.55 }} />
    </View>
  );
}

/** "Parar": one rounded square (reads as stop, ~3/4 of the box); it breathes lightly while the agent works (`moving`). */
export function PixelStop({ size = 13, color, moving = true }: { size?: number; color: string; moving?: boolean }) {
  const reduced = useReducedMotion();
  const still = reduced || !moving;
  const phase = useLoop(BREATH_MS, !still);
  const breath = useAnimatedStyle(() => ({ opacity: stopBreath(phase.value * BREATH_MS, still) }));
  const side = Math.round(size * 0.76);
  return (
    <View style={{ width: size, height: size, alignItems: "center", justifyContent: "center" }} {...hidden}>
      <Animated.View
        style={[
          {
            width: side,
            height: side,
            borderRadius: Math.max(2, Math.round(side * 0.24)),
            backgroundColor: color,
          },
          breath,
        ]}
      />
    </View>
  );
}
