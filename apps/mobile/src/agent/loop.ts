import { useEffect } from "react";
import {
  cancelAnimation,
  Easing,
  type SharedValue,
  useSharedValue,
  withRepeat,
  withTiming,
} from "react-native-reanimated";
import { useLivePaused } from "./live";

/**
 * Where a looping mark is in its round, 0 → 1 every `periodMs`, on the UI thread; 0 while not `moving` or off
 * screen (`LivePause`). A mark that loops while an agent works (the stop square, the typing dots, the breathing tool
 * call) draws from this instead of the shared frame clock: a React render 25 times a second is a Fabric commit each
 * time, and every commit has iOS walk every view in every mounted list on the main thread. On a long conversation
 * and a warm phone that kept the main thread busy past the system's 10 s allowance and the app was killed.
 */
export function useLoop(periodMs: number, moving: boolean): SharedValue<number> {
  const paused = useLivePaused();
  const on = moving && !paused;
  const phase = useSharedValue(0);
  useEffect(() => {
    if (!on) {
      cancelAnimation(phase);
      phase.value = 0;
      return;
    }
    phase.value = 0;
    phase.value = withRepeat(withTiming(1, { duration: periodMs, easing: Easing.linear }), -1, false);
    return () => cancelAnimation(phase);
  }, [on, periodMs, phase]);
  return phase;
}
