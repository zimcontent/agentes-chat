import { useEffect } from "react";
import Animated, { Easing, useAnimatedStyle, useSharedValue, withTiming } from "react-native-reanimated";
import { Icon } from "./Icon";
import { useReducedMotion } from "./theme";

/** The pop's length: short, once. */
const POP_MS = 220;
const EASE_OUT = Easing.bezier(0.23, 1, 0.32, 1);

/**
 * The check of a request you just approved: it settles in once (a short scale and fade, the decision's weight),
 * then stays the plain check. DougBot has no pixel burst and no decorative shine. `tone` is kept for the callers.
 * Under reduced motion it is only the check.
 */
export function SparkCheck({ size, color }: { size: number; color: string; tone?: string | null }) {
  const reduced = useReducedMotion();
  const t = useSharedValue(reduced ? 1 : 0);
  useEffect(() => {
    if (reduced) return;
    t.set(withTiming(1, { duration: POP_MS, easing: EASE_OUT }));
  }, [reduced, t]);
  const style = useAnimatedStyle(() => {
    const p = t.get();
    return { opacity: p, transform: [{ scale: 0.7 + 0.3 * p }] };
  });
  return (
    <Animated.View style={[{ width: size, height: size }, style]}>
      <Icon name="check" size={size} color={color} />
    </Animated.View>
  );
}
