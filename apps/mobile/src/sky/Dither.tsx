import { Skia, type SkRuntimeEffect } from "@shopify/react-native-skia";
import { useEffect } from "react";
import { type StyleProp, View, type ViewStyle } from "react-native";
import Animated, {
  cancelAnimation,
  Easing,
  type SharedValue,
  useAnimatedStyle,
  useSharedValue,
  withRepeat,
  withTiming,
} from "react-native-reanimated";
import { useLivePaused } from "@/agent/live";
import { useReducedMotion, useTheme } from "@/ui/theme";
import { type DitherKind, shaderSource } from "./shaders";

const effects = new Map<DitherKind, SkRuntimeEffect | null>();

/**
 * The compiled shader for a drawing (compiled once; null if the device refuses it). Kept for the launch splash,
 * which still reads it; nothing in the DougBot identity draws in dither any more.
 */
export function effectOf(kind: DitherKind): SkRuntimeEffect | null {
  if (!effects.has(kind)) {
    let effect: SkRuntimeEffect | null = null;
    try {
      effect = Skia.RuntimeEffect.Make(shaderSource(kind));
    } catch {
      effect = null;
    }
    if (!effect) console.warn(`dither shader "${kind}" did not compile`);
    effects.set(kind, effect);
  }
  return effects.get(kind) ?? null;
}

export interface DitherProps {
  kind: DitherKind;
  /** Tones, deep to light. Ignored: kept so the callers don't change. */
  tones: readonly string[];
  /** Points per dither cell. Ignored. */
  pixel: number;
  /** Drawing-specific values: `remaining` (fuse) and `value` (bar) still draw a plain bar. */
  extra?: Record<string, number | number[]>;
  animated?: boolean;
  fade?: number;
  fadeTop?: number;
  clear?: boolean;
  liveWidth?: SharedValue<number>;
  liveWork?: SharedValue<number>;
  style?: StyleProp<ViewStyle>;
}

const hidden = { accessibilityElementsHidden: true, importantForAccessibility: "no-hide-descendants" as const };

/**
 * What used to be a dither drawing. The DougBot identity has no pixel art and no decorative skies: the skies
 * (`sky`, `workspace`, `computer`, `horizon`, `sweep`, `pill`) are an empty box with the same style, so no layout
 * moves; the two drawings that meant something (`fuse`: time left, `bar`: a share used) are a plain `LineBar`.
 */
export function Dither({ kind, extra, style }: DitherProps) {
  if (kind === "fuse" || kind === "bar") {
    const v = Number(kind === "fuse" ? extra?.remaining : extra?.value);
    return <LineBar value={Number.isFinite(v) ? v : 0} style={style} />;
  }
  return <View style={style} pointerEvents="none" {...hidden} />;
}

/** A plain bar's default thickness: thin, a stroke rather than a block. */
export const BAR_HEIGHT = 4;

/**
 * A plain bar (DougBot): a `colors.line` rail and a `value` share (0..1) filled in `fill` (default the neutral
 * `colors.ink2`; the warning and error tones only where the bar means an alert). The rail is `thickness` points
 * high, centered in the box the caller gives (whose height stays the caller's), with round ends (half its height:
 * the natural end of a stroke, not a pill).
 */
export function LineBar({
  value,
  fill,
  thickness = BAR_HEIGHT,
  style,
}: {
  value: number;
  fill?: string;
  thickness?: number;
  style?: StyleProp<ViewStyle>;
}) {
  const { colors } = useTheme();
  const share = Math.max(0, Math.min(1, value));
  const radius = thickness / 2;
  return (
    <View style={[{ justifyContent: "center" }, style]} pointerEvents="none" {...hidden}>
      <View style={{ height: thickness, borderRadius: radius, backgroundColor: colors.line, overflow: "hidden" }}>
        {share > 0 ? (
          <View
            style={{
              width: `${share * 100}%`,
              height: thickness,
              borderRadius: radius,
              backgroundColor: fill ?? colors.ink2,
            }}
          />
        ) : null}
      </View>
    </View>
  );
}

/**
 * A slow, light opacity pulse (1 → 0.45 → 1) for what is in progress; still under reduced motion, off screen, or
 * when `active` is false. Returns the animated style for an `Animated.View`.
 */
export function usePulse(active: boolean) {
  const reduced = useReducedMotion();
  const paused = useLivePaused();
  const moving = active && !reduced && !paused;
  const k = useSharedValue(1);
  useEffect(() => {
    if (!moving) {
      cancelAnimation(k);
      k.value = 1;
      return;
    }
    k.value = withRepeat(withTiming(0.45, { duration: 800, easing: Easing.inOut(Easing.quad) }), -1, true);
    return () => cancelAnimation(k);
  }, [moving, k]);
  return useAnimatedStyle(() => ({ opacity: k.value }));
}

export { Animated };
