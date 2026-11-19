import type { AgentColorName } from "@dougbot/ui/agent/engine";
import { useEffect } from "react";
import { View } from "react-native";
import Animated, {
  cancelAnimation,
  Easing,
  useAnimatedStyle,
  useSharedValue,
  withRepeat,
  withTiming,
} from "react-native-reanimated";
import Svg, { Circle } from "react-native-svg";
import { useReducedMotion, useTheme } from "@/ui/theme";
import { useLivePaused } from "./live";

export interface PixelOrbitProps {
  /** The agent (kept for the callers: its color isn't the identity's bot color, so the ring stays neutral). */
  color: AgentColorName;
  /** Side in points (default 12). */
  size?: number;
  /** Held still (a pull not yet let go): it turns once the work starts. */
  still?: boolean;
}

/** One turn of the ring. */
const TURN_MS = 900;

/**
 * A thin ring turning (working, loading): a faint full circle and a short arc of `color` going round it, on the UI
 * thread. Still under reduced motion, off screen, or when `still`. Shared by `PixelOrbit` and `InkOrbit`.
 */
export function Spinner({ size, color, still = false }: { size: number; color: string; still?: boolean }) {
  const reduced = useReducedMotion();
  const paused = useLivePaused();
  const moving = !still && !reduced && !paused;
  const turn = useSharedValue(0);
  useEffect(() => {
    if (!moving) {
      cancelAnimation(turn);
      return;
    }
    turn.value = 0;
    turn.value = withRepeat(withTiming(360, { duration: TURN_MS, easing: Easing.linear }), -1, false);
    return () => cancelAnimation(turn);
  }, [moving, turn]);
  const spin = useAnimatedStyle(() => ({ transform: [{ rotate: `${turn.value}deg` }] }));
  const stroke = Math.max(1.5, Math.min(2.5, size / 8));
  const r = (size - stroke) / 2;
  const around = 2 * Math.PI * r;
  return (
    <View
      style={{ width: size, height: size }}
      accessibilityElementsHidden
      importantForAccessibility="no-hide-descendants"
    >
      <Animated.View style={[{ width: size, height: size }, spin]}>
        <Svg width={size} height={size}>
          <Circle
            cx={size / 2}
            cy={size / 2}
            r={r}
            stroke={color}
            strokeOpacity={0.22}
            strokeWidth={stroke}
            fill="none"
          />
          <Circle
            cx={size / 2}
            cy={size / 2}
            r={r}
            stroke={color}
            strokeWidth={stroke}
            strokeLinecap="round"
            strokeDasharray={`${around * 0.28} ${around}`}
            fill="none"
          />
        </Svg>
      </Animated.View>
    </View>
  );
}

/** Working, loading: the thin turning ring, in the neutral `colors.muted`. */
export function PixelOrbit({ size = 12, still = false }: PixelOrbitProps) {
  const { colors } = useTheme();
  return <Spinner size={size} color={colors.muted} still={still} />;
}
