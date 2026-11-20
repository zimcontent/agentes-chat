import { useEffect, useRef } from "react";
import { StyleSheet, View } from "react-native";
import { GestureDetector, usePanGesture } from "react-native-gesture-handler";
import Animated, {
  cancelAnimation,
  type SharedValue,
  useAnimatedStyle,
  useSharedValue,
  withRepeat,
  withSpring,
  withTiming,
} from "react-native-reanimated";
import { scheduleOnRN } from "react-native-worklets";
import { useReducedMotion } from "@/ui";
import { holdAt, SLIDE_CANCEL, SLIDE_LOCK } from "./logic";
import { type WaColors, WaGlyph } from "./look";

/** What the hold on the mic asks for, told once per hold. */
export interface MicHold {
  onStart: () => void;
  /** The finger let go where it held: send what was recorded. */
  onRelease: () => void;
  onCancel: () => void;
  onLock: () => void;
}

const SPRING = { damping: 18, stiffness: 260, mass: 1 };

/**
 * WhatsApp's green mic: hold it to record, let go to send, slide left to drop the take, slide up to lock it and keep
 * recording hands free. The finger's way (`dx`, `dy`, only leftward and upward) is shared with the strip that says
 * "slide to cancel" and the lock above it.
 */
export function MicButton({
  wa,
  label,
  holding,
  hold,
  dx,
  dy,
}: {
  wa: WaColors;
  label: string;
  holding: boolean;
  hold: MicHold;
  dx: SharedValue<number>;
  dy: SharedValue<number>;
}) {
  const reduced = useReducedMotion();
  // The latest handlers, read when the gesture calls back: the screen makes new ones each render.
  const now = useRef(hold);
  now.current = hold;
  const start = () => now.current.onStart();
  const release = () => now.current.onRelease();
  const cancel = () => now.current.onCancel();
  const lock = () => now.current.onLock();
  /** 0 holding, 1 dropped, 2 locked: what the slide decided, so it is told once. */
  const decided = useSharedValue(0);

  const pan = usePanGesture({
    minDistance: 0,
    maxPointers: 1,
    onActivate: () => {
      "worklet";
      decided.value = 0;
      dx.value = 0;
      dy.value = 0;
      scheduleOnRN(start);
    },
    onUpdate: (e) => {
      "worklet";
      if (decided.value !== 0) return;
      dx.value = Math.min(0, e.translationX);
      dy.value = Math.min(0, e.translationY);
      const where = holdAt(e.translationX, e.translationY);
      if (where === "cancel") {
        decided.value = 1;
        scheduleOnRN(cancel);
      } else if (where === "lock") {
        decided.value = 2;
        scheduleOnRN(lock);
      }
    },
    onDeactivate: () => {
      "worklet";
      const was = decided.value;
      decided.value = 0;
      dx.value = withSpring(0, SPRING);
      dy.value = withSpring(0, SPRING);
      if (was === 0) scheduleOnRN(release);
    },
  });

  const grow = useSharedValue(0);
  useEffect(() => {
    grow.value = reduced ? (holding ? 1 : 0) : withSpring(holding ? 1 : 0, SPRING);
  }, [holding, reduced, grow]);
  const style = useAnimatedStyle(() => ({
    transform: [
      { translateX: Math.max(dx.value, -SLIDE_CANCEL) },
      { translateY: Math.max(dy.value, -SLIDE_LOCK) },
      { scale: 1 + 0.45 * grow.value },
    ],
  }));

  return (
    <GestureDetector gesture={pan}>
      <Animated.View
        accessible
        accessibilityRole="button"
        accessibilityLabel={label}
        // A screen reader can't hold: its double tap starts a locked recording, with delete and send beside it.
        accessibilityActions={[{ name: "activate" }]}
        onAccessibilityAction={() => {
          start();
          lock();
        }}
        style={[styles.round, { backgroundColor: wa.green }, style]}
      >
        <WaGlyph name="mic" size={21} weight={2} color={wa.onGreen} />
      </Animated.View>
    </GestureDetector>
  );
}

/** The lock above the mic while it is held: it rises with the finger, as WhatsApp's does. */
export function LockPill({ wa, dy }: { wa: WaColors; dy: SharedValue<number> }) {
  const style = useAnimatedStyle(() => ({
    transform: [{ translateY: Math.max(dy.value * 0.5, -SLIDE_LOCK / 2) }],
    opacity: 1 - Math.min(1, -dy.value / SLIDE_LOCK) * 0.3,
  }));
  return (
    <Animated.View pointerEvents="none" style={[styles.lock, { backgroundColor: wa.bar, borderColor: wa.line }, style]}>
      <WaGlyph name="lock" size={18} color={wa.soft} />
      <WaGlyph name="up" size={16} color={wa.sub} />
    </Animated.View>
  );
}

/** "‹ Slide to cancel", following the finger and fading as it nears the end. */
export function SlideHint({ wa, dx, text }: { wa: WaColors; dx: SharedValue<number>; text: React.ReactNode }) {
  const style = useAnimatedStyle(() => ({
    transform: [{ translateX: dx.value * 0.6 }],
    opacity: 1 - Math.min(1, -dx.value / SLIDE_CANCEL) * 0.85,
  }));
  return (
    <Animated.View style={[styles.hint, style]}>
      <WaGlyph name="left" size={16} color={wa.sub} />
      {text}
    </Animated.View>
  );
}

/** The red dot of a recording, breathing as WhatsApp's does (still with reduced motion). */
export function RecordingDot({ color }: { color: string }) {
  const reduced = useReducedMotion();
  const fade = useSharedValue(1);
  useEffect(() => {
    if (reduced) return;
    fade.value = withRepeat(withTiming(0.25, { duration: 650 }), -1, true);
    return () => cancelAnimation(fade);
  }, [reduced, fade]);
  const style = useAnimatedStyle(() => ({ opacity: fade.value }));
  return (
    <View style={styles.dotBox}>
      <Animated.View style={[styles.dot, { backgroundColor: color }, style]} />
    </View>
  );
}

const styles = StyleSheet.create({
  round: { width: 44, height: 44, borderRadius: 22, alignItems: "center", justifyContent: "center", marginLeft: 2 },
  lock: {
    position: "absolute",
    right: 4,
    bottom: 60,
    width: 40,
    paddingVertical: 10,
    borderRadius: 20,
    borderWidth: StyleSheet.hairlineWidth,
    alignItems: "center",
    gap: 4,
  },
  hint: { flexDirection: "row", alignItems: "center", gap: 2, marginLeft: "auto", paddingRight: 8 },
  dotBox: { width: 14, alignItems: "center" },
  dot: { width: 10, height: 10, borderRadius: 5 },
});
