import { useMemo, useState } from "react";
import { Image, StyleSheet, View } from "react-native";
import { appHeaders, lastCookie } from "@/lib/auth";
import { photoSource } from "@/lib/photo";
import { serverUrl } from "@/lib/server";
import { useTheme } from "@/ui/theme";
import { Tile } from "./parts";

/**
 * A group's face (this fork's channel photo, `channels.icon`: `/api/app/channel-icons/…`): a circle, as on the web, on
 * the stage's color with a thin ring; without a photo, or when it fails, the "#" tile.
 */
export function GroupPhoto({ icon, size }: { icon?: string | null | undefined; size: number }) {
  const { colors } = useTheme();
  const source = useMemo(() => photoSource(icon ?? null, serverUrl(), appHeaders(lastCookie())), [icon]);
  const [failed, setFailed] = useState(false);
  if (!source || failed) return <Tile icon="hash" size={size} />;
  return (
    <View
      style={[
        styles.ring,
        {
          width: size,
          height: size,
          borderRadius: size / 2,
          borderColor: colors.glassEdge,
          backgroundColor: "#0A0A0A",
        },
      ]}
    >
      <Image
        source={source}
        onError={() => setFailed(true)}
        resizeMode="cover"
        style={{ width: size, height: size, borderRadius: size / 2 }}
        accessibilityIgnoresInvertColors
      />
    </View>
  );
}

const styles = StyleSheet.create({ ring: { overflow: "hidden", borderWidth: StyleSheet.hairlineWidth } });
