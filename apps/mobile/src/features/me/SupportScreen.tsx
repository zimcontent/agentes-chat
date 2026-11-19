import { instanceQuery, useApi, useAuthConfig, useMe } from "@dougbot/client";
import { mayAsk } from "@dougbot/client/lib/audience";
import { rightHandOf } from "@dougbot/client/lib/right-hand";
import {
  type SupportDraftWords,
  supportCameFrom,
  supportContactOf,
  supportDraft,
  whatsAppHref,
} from "@dougbot/client/lib/support";
import { useQuery } from "@tanstack/react-query";
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
  const contact = supportContactOf(config, useMe().data);
  const instance = useQuery(instanceQuery(useApi())).data;
  const dir = useDirectory();
  const org = useOrg();
  const openDm = useOpenDm();
  const doug = rightHandOf(dir.agents);
  const askable = doug && mayAsk(org.org, doug);
  // The draft speaks the app's language: the words come from `t()`, not from the guide's own English.
  const words: SupportDraftWords = {
    lead: ({ name, facts }) =>
      facts === null ? t("settings.support.draft", { name }) : t("settings.support.draftWith", { name, facts }),
    fact: ({ kind, value }) =>
      kind === "version"
        ? t("settings.support.draftVersion", { version: value })
        : kind === "client"
          ? t("settings.support.draftClient", { code: value })
          : t("settings.support.draftPage", { page: value }),
    ask: t("settings.support.draftAsk"),
  };
  if (!contact) return <Page title={t("settings.section.support")} />;
  const { email, whatsapp, clientCode } = contact;
  // Without a support address the agent has no `contact_support`: the card says what it does do, not an email.
  const askLead = email
    ? t("settings.support.askLead", { name: doug?.name ?? "" })
    : t("settings.support.askNoEmail", { name: doug?.name ?? "" });
  const ask = () => {
    if (!askable || !doug) return;
    openDm(
      { agentId: doug.id },
      {
        compose: true,
        // After whatever they were already writing there: the hand-off never erases their draft.
        join: true,
        text: supportDraft({
          agentName: doug.name,
          version: instance?.version ?? null,
          clientCode: contact.clientCode,
          page: supportCameFrom(),
          words,
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
              sub={askLead}
              chevron
              onPress={ask}
            />
          </GroupedList>
        </>
      ) : null}
    </Page>
  );
}

const styles = StyleSheet.create({ gap: { height: 12 } });
