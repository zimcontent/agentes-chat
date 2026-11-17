import { BlurView } from "expo-blur";
import { useEffect, useState } from "react";
import { AccessibilityInfo, Platform, StyleSheet, View } from "react-native";
import Animated, { type SharedValue, useAnimatedStyle } from "react-native-reanimated";
import { useTheme } from "@/ui";

/**
 * The island's frosted glass: dark in both themes, as the camera it grows out of, so the two read as one piece and
 * its white words stay readable over anything. At rest (the signature) it is thin, the screen showing through; with
 * a notice (`dim` 1) it darkens for the words. On iOS a real blur; on Android, which has no fast blur, a near-solid
 * dark; on the board (web) the browser's blur. With Reduce Transparency on, solid. Its lit edge is the island's own
 * border (`ISLAND_RIM`), so it follows the island's corners as they move.
 */
export function IslandGlass({ dim }: { dim: SharedValue<number> }) {
  const solid = useReducedTransparency();
  const { scheme } = useTheme();
  const deeper = useAnimatedStyle(() => ({ opacity: dim.value }));
  if (solid) return <View style={[StyleSheet.absoluteFill, styles.solid]} />;
  return (
    <>
      {Platform.OS === "ios" ? (
        <BlurView intensity={40} tint="systemUltraThinMaterialDark" style={StyleSheet.absoluteFill} />
      ) : Platform.OS === "web" ? (
        <View style={[StyleSheet.absoluteFill, styles.webBlur]} />
      ) : null}
      <View
        style={[
          StyleSheet.absoluteFill,
          Platform.OS === "android" ? styles.androidRest : scheme === "dark" ? styles.rest : styles.restLight,
        ]}
      />
      <Animated.View style={[StyleSheet.absoluteFill, styles.notice, deeper]} />
    </>
  );
}

/** The glass's thin lit edge, so it holds its shape over a dark screen. */
export const ISLAND_RIM = "rgba(255,255,255,0.14)";

function useReducedTransparency() {
  const [on, setOn] = useState(false);
  useEffect(() => {
    if (Platform.OS !== "ios") return;
    let alive = true;
    void AccessibilityInfo.isReduceTransparencyEnabled().then((v) => alive && setOn(v));
    const sub = AccessibilityInfo.addEventListener("reduceTransparencyChanged", setOn);
    return () => {
      alive = false;
      sub.remove();
    };
  }, []);
  return on;
}

const styles = StyleSheet.create({
  solid: { backgroundColor: "#000" },
  // `backdropFilter` is the browser's (react-native-web passes it through).
  webBlur: { backdropFilter: "blur(18px) saturate(160%)" } as object,
  // On the dark stage the screen shows through more; on light it takes 60%, so the signature's #EDEDED keeps 4.5:1
  // over a white screen.
  rest: { backgroundColor: "rgba(10,10,10,0.42)" },
  restLight: { backgroundColor: "rgba(10,10,10,0.6)" },
  androidRest: { backgroundColor: "rgba(10,10,10,0.86)" },
  // Over the rest's 42%: about 82% in all, the old solid island's legibility for a notice's words.
  notice: { backgroundColor: "rgba(0,0,0,0.68)" },
});
