import type { ReactNode } from "react";
import { useTranslation } from "react-i18next";
import { StyleSheet, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { IconButton } from "@/ui";
import { goBack } from "@/ui/navigation";

/**
 * The top of a screen that draws its own bar (Arquivos, Senhas): the round back button on the left, what the screen
 * names itself in the middle, and its own button on the right, all 40 high under the status bar. The route hides the
 * system's bar for it; the swipe back still works.
 */
export function ScreenTopBar({
  middle,
  right,
  onBack = () => goBack(),
}: {
  middle: ReactNode;
  right?: ReactNode;
  onBack?: () => void;
}) {
  const { t } = useTranslation();
  const insets = useSafeAreaInsets();
  return (
    <View style={[styles.bar, { paddingTop: Math.max(insets.top, 20) + 6 }]}>
      <IconButton icon="back" plate label={t("mobile.common.back")} onPress={onBack} />
      <View style={styles.middle}>{middle}</View>
      {/* The middle stays centered: an empty side as wide as the button. */}
      {right ?? <View style={styles.side} />}
    </View>
  );
}

const styles = StyleSheet.create({
  bar: { flexDirection: "row", alignItems: "center", gap: 8, paddingHorizontal: 16 },
  middle: { flex: 1, minWidth: 0, alignItems: "center" },
  side: { width: 40 },
});
