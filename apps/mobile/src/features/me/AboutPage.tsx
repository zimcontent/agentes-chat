import { instanceQuery, useApi } from "@agenteschat/client";
import { LICENSE_URL } from "@agenteschat/client/lib/about";
import { shownAddress } from "@agenteschat/client/lib/sites";
import { useQuery } from "@tanstack/react-query";
import { Trans, useTranslation } from "react-i18next";
import { StyleSheet, View } from "react-native";
import { Assinatura, GroupedFooter, GroupedList, GroupedRow, Text } from "@/ui";
import { openPage } from "../ai/parts";
import { Page } from "./parts";

/**
 * DougBot's own source (the fork, AGPL-3.0 §13: whoever uses it over a network is offered the source); the server's
 * `sourceUrl` wins when it says one.
 */
export const DOUGBOT_SOURCE_URL = "https://github.com/zimcontent/dougbot";

const link = (href: string) => (
  <Text variant="footnote" accessibilityRole="link" style={styles.link} onPress={() => openPage(href)} />
);

/**
 * Sobre o DougBot, pushed from Você: DougBot's signature, "Baseado no agentes.chat da Codari Global, LLC · AGPL-3.0" and
 * the link to the fork's source, then AGPL-3.0's Appropriate Legal Notices and the attribution the license's
 * section 7(b) term in NOTICE requires. Shown on every self-hosted server, with no setting that hides it (`showsAbout`).
 */
export function AboutPage() {
  const { t } = useTranslation();
  const instance = useQuery(instanceQuery(useApi()));
  const source = instance.data?.sourceUrl ?? DOUGBOT_SOURCE_URL;
  return (
    <Page title={t("settings.section.about")}>
      <View style={styles.mark}>
        <Assinatura size={28} />
      </View>
      <GroupedList>
        {/* A deploy's version can be long (its `APP_VERSION`): under the label, whole. */}
        <GroupedRow label={t("settings.about.version")} sub={instance.data?.version ?? "…"} subLines={2} />
        {/* The address under its label: side by side both were cut with "…" (ui-polish 17). */}
        <GroupedRow
          label={t("mobile.brand.source")}
          sub={shownAddress(source)}
          subLines={2}
          chevron
          onPress={() => openPage(source)}
        />
      </GroupedList>
      <GroupedFooter>
        {t("mobile.brand.basedOn")}
        {"\n\n"}
        <Trans i18nKey="settings.about.license" components={{ license: link(LICENSE_URL) }} />
        {"\n\n"}
        {t("settings.about.copyright")}
      </GroupedFooter>
    </Page>
  );
}

const styles = StyleSheet.create({
  mark: { alignItems: "center", paddingVertical: 24 },
  link: { textDecorationLine: "underline" },
});
