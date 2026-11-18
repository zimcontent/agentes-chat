import { instanceQuery, useApi, useAuthConfig } from "@agenteschat/client";
import { mayAsk } from "@agenteschat/client/lib/audience";
import { rightHandOf } from "@agenteschat/client/lib/right-hand";
import { supportContactOf, supportDraft, whatsAppHref } from "@agenteschat/client/lib/support";
import { useQuery } from "@tanstack/react-query";
import { usePathname } from "expo-router";
import { useTranslation } from "react-i18next";
import { Linking, StyleSheet, View } from "react-native";
import { useOrg } from "@/providers/org";
import { GroupedFooter, GroupedHeader, GroupedList, GroupedRow } from "@/ui";
import { useOpenDm } from "../new/useOpenDm";
import { useDirectory } from "../shared/hooks";
import { Page } from "./parts";

/**
 * Suporte, pushed from Você: how to reach whoever runs this installation (`SUPPORT_EMAIL`, `SUPPORT_WHATSAPP`) and its
 * own code (`DOUG_CLIENT_CODE`), then "Peça ajuda ao Doug": a DM with the workspace's right hand, opened with the
 * context already in the box. Only where the operator set an address (`supportContactOf`); the row never shows
 * otherwise.
 */
export function SupportScreen() {
  const { t } = useTranslation();
  const config = useAuthConfig().data;
  const contact = supportContactOf(config);
  const instance = useQuery(instanceQuery(useApi())).data;
  const dir = useDirectory();
  const org = useOrg();
  const pathname = usePathname();
  const openDm = useOpenDm();
  const doug = rightHandOf(dir.agents);
  const askable = doug && mayAsk(org.org, doug);
  if (!contact) return <Page title={t("settings.section.support")} />;
  const { email, whatsapp, clientCode } = contact;
  const ask = () => {
    if (!askable || !doug) return;
    openDm(
      { agentId: doug.id },
      {
        compose: true,
        text: supportDraft({
          agentName: doug.name,
          version: instance?.version ?? null,
          clientCode: contact.clientCode,
          page: pathname,
        }),
      },
    );
  };
  return (
    <Page title={t("settings.section.support")}>
      <View style={styles.gap} />
      <GroupedHeader>{t("settings.support.title")}</GroupedHeader>
      <GroupedList>
        {email ? (
          <GroupedRow
            icon="mail"
            label={t("settings.support.email")}
            value={email}
            onPress={() => void Linking.openURL(`mailto:${email}`).catch(() => undefined)}
          />
        ) : null}
        {whatsapp ? (
          <GroupedRow
            icon="message"
            label={t("settings.support.whatsapp")}
            value={whatsapp}
            onPress={() => void Linking.openURL(whatsAppHref(whatsapp)).catch(() => undefined)}
          />
        ) : null}
        {clientCode ? <GroupedRow icon="hash" label={t("settings.support.client")} value={clientCode} /> : null}
      </GroupedList>
      <GroupedFooter>{t("settings.support.lead")}</GroupedFooter>
      {askable && doug ? (
        <>
          <View style={styles.gap} />
          <GroupedHeader>{t("settings.support.askTitle", { name: doug.name })}</GroupedHeader>
          <GroupedList>
            <GroupedRow
              icon="agent"
              label={t("settings.support.ask", { name: doug.name })}
              sub={t("settings.support.askStatus")}
              chevron
              onPress={ask}
            />
          </GroupedList>
          <GroupedFooter>{t("settings.support.askLead", { name: doug.name })}</GroupedFooter>
        </>
      ) : null}
    </Page>
  );
}

const styles = StyleSheet.create({ gap: { height: 12 } });
