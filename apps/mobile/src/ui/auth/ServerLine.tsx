import { instanceQuery, useApi } from "@dougbot/client";
import { CLOUD_SERVER, serverHost } from "@dougbot/client/lib/server";
import { useQuery } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import { Pressable, StyleSheet, View } from "react-native";
import { accountLabel, setServer, useServer, useServerToReturn } from "@/lib/server";
import { router } from "@/ui/navigation";
import { useTheme } from "@/ui/theme";
import { Icon } from "../Icon";
import { Text } from "../Text";
import { AuthLink } from "./AuthLink";

/** Whether the phone's server now is the Cloud: what the server says, its host until it answered. */
export function useOnCloud(): boolean {
  const server = useServer();
  const cloud = useQuery(instanceQuery(useApi())).data?.cloud;
  return cloud ?? serverHost(server) === serverHost(CLOUD_SERVER);
}

/**
 * The quiet line under the sign-in: where it goes, "Entrando no agentes.chat Cloud · Trocar" (the server says whether
 * it is the Cloud) or "Entrando em <host> · Trocar", as on the web. On the Cloud, Trocar opens "Onde fica o seu
 * workspace?", in front of the address and QR screens; on a team's server it opens those screens directly (DougBot:
 * the sheet recommends the Cloud). The language follows the phone's (and its per-app setting in iOS Settings); signed in,
 * it changes in Você (ADR 0122). Signed in on another server (this one added from Workspaces): "Voltar para …" goes
 * back to it, still signed in there.
 */
export function AuthFootLine() {
  const { t } = useTranslation();
  const { colors } = useTheme();
  const server = useServer();
  const back = useServerToReturn();
  const onCloud = useOnCloud();
  const where = onCloud
    ? t("mobile.auth.server.footCloud")
    : t("mobile.auth.server.footOn", { host: serverHost(server) });
  return (
    <View style={styles.foot}>
      <Pressable
        // DougBot: on a team's server Trocar goes straight to the address and QR screen, as before the sheet.
        // "Onde fica o seu workspace?" recommends agentes.chat Cloud, so it opens only when the phone is on it.
        onPress={() => router.push(onCloud ? "/where" : "/scan")}
        accessibilityRole="button"
        accessibilityLabel={`${where}. ${t("mobile.auth.server.footSwitch")}`}
        // An 18-point line: 12 of slop above and below reaches the 44-point target.
        hitSlop={12}
        style={({ pressed }) => [styles.line, pressed && styles.pressed]}
      >
        <Icon name={onCloud ? "cloud" : "globe"} size={14} color={colors.faint} />
        {/* A team's host is cut in the middle (its end says which team); the action never. */}
        <Text variant="footnote" tone="faint" numberOfLines={1} ellipsizeMode="middle" style={styles.host}>
          {` ${where} · `}
        </Text>
        <Text variant="footnote" tone="ink2" numberOfLines={1} style={styles.bold}>
          {t("mobile.auth.server.footSwitch")}
        </Text>
      </Pressable>
      {back ? (
        <AuthLink
          label={t("mobile.auth.server.backTo", { host: accountLabel(back) ?? serverHost(back) })}
          onPress={() => void setServer(back)}
        />
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  foot: { alignItems: "center", gap: 12, alignSelf: "stretch" },
  line: { flexDirection: "row", alignItems: "center", maxWidth: "100%" },
  host: { flexShrink: 1 },
  bold: { fontWeight: "600" },
  pressed: { opacity: 0.6 },
});

/** The old name, for anything still importing it: the same line. */
export const ServerLine = AuthFootLine;
