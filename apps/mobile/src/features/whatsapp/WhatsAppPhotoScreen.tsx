import { whatsappFileUrl } from "@dougbot/client";
import { StatusBar } from "expo-status-bar";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { Pressable, Text as RNText, StyleSheet, useWindowDimensions, View } from "react-native";
import Animated, { useAnimatedStyle, useSharedValue } from "react-native-reanimated";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { goBack } from "@/ui/navigation";
import { ZoomableImage } from "../files/ZoomableImage";
import { useOrgId } from "../shared/hooks";
import { ownFile } from "./logic";
import { WA_FONT, WaGlyph } from "./look";

const WHITE = "#FFFFFF";
const DIM = "rgba(255,255,255,0.7)";

/**
 * A WhatsApp photo full screen over its conversation, as WhatsApp opens one: black, who sent it and when on top,
 * pinch or double tap to zoom, drag down to close. A tap hides and shows the bar.
 */
export function WhatsAppPhotoScreen({
  accountId,
  messageId,
  title,
  sub,
}: {
  accountId: string;
  messageId: string;
  title: string;
  sub: string;
}) {
  const { t } = useTranslation();
  const orgId = useOrgId();
  const insets = useSafeAreaInsets();
  const { width, height } = useWindowDimensions();
  const drag = useSharedValue(0);
  const [chrome, setChrome] = useState(true);
  const close = () => goBack();
  const file = ownFile((base) => whatsappFileUrl(orgId, accountId, messageId, base));
  const backdrop = useAnimatedStyle(() => ({ opacity: 1 - Math.min(Math.abs(drag.value) / (height * 0.6), 0.85) }));
  const bar = useAnimatedStyle(() => ({ opacity: (chrome ? 1 : 0) * (1 - Math.min(Math.abs(drag.value) / 80, 1)) }));
  return (
    <View style={styles.screen}>
      <StatusBar style="light" hidden={!chrome} animated />
      <Animated.View style={[StyleSheet.absoluteFill, styles.black, backdrop]} />
      <ZoomableImage
        uri={file.uri}
        headers={file.headers}
        cacheKey={`whatsapp:${messageId}`}
        width={width}
        height={height}
        drag={drag}
        onZoomChange={() => {}}
        onTap={() => setChrome((v) => !v)}
        onDismiss={close}
      />
      <Animated.View
        pointerEvents={chrome ? "box-none" : "none"}
        style={[styles.top, { paddingTop: insets.top + 6 }, bar]}
      >
        <Pressable
          onPress={close}
          accessibilityRole="button"
          accessibilityLabel={t("mobile.common.close")}
          hitSlop={8}
          style={styles.close}
        >
          <WaGlyph name="close" size={22} color={WHITE} weight={2} />
        </Pressable>
        <View style={styles.titles}>
          <RNText numberOfLines={1} style={styles.title}>
            {title}
          </RNText>
          {sub ? (
            <RNText numberOfLines={1} style={styles.sub}>
              {sub}
            </RNText>
          ) : null}
        </View>
      </Animated.View>
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: "transparent" },
  black: { backgroundColor: "#000" },
  top: {
    position: "absolute",
    top: 0,
    left: 0,
    right: 0,
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    paddingHorizontal: 8,
    paddingBottom: 10,
    backgroundColor: "rgba(0,0,0,0.35)",
  },
  close: { width: 44, height: 44, alignItems: "center", justifyContent: "center" },
  titles: { flex: 1, minWidth: 0 },
  title: { fontFamily: WA_FONT.s, fontSize: 16, color: WHITE },
  sub: { fontFamily: WA_FONT.r, fontSize: 12.5, color: DIM },
});
