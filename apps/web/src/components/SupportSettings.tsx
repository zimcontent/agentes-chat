import { instanceQuery, useAuthConfig, useMe } from "@agenteschat/client";
import { mayAsk } from "@agenteschat/client/lib/audience";
import { setDraftFor } from "@agenteschat/client/lib/drafts";
import { agentGrammar } from "@agenteschat/client/lib/grammar";
import { rightHandOf } from "@agenteschat/client/lib/right-hand";
import {
  type SupportDraftWords,
  supportCameFrom,
  supportContactOf,
  supportDraft,
  whatsAppHref,
} from "@agenteschat/client/lib/support";
import { Button, Card, CardHeader, Icon } from "@agenteschat/ui";
import { useQuery } from "@tanstack/react-query";
import { useNavigate } from "@tanstack/react-router";
import type { ReactNode } from "react";
import { useTranslation } from "react-i18next";
import { useApi } from "@/api/context";
import { PrefRow } from "@/components/NoticePrefs";
import { useOrg } from "@/components/org-context";
import { useDirectory } from "@/hooks/useDirectory";

/** One address, as a row's value: a link of the house style, opening in a new tab. */
function ReachLink({ href, children }: { href: string; children: ReactNode }) {
  return (
    <a className="ac-link ac-iconline" href={href} target="_blank" rel="noopener noreferrer">
      {children}
      <Icon name="external" size={14} />
    </a>
  );
}

/**
 * Configurações › Suporte: how to reach whoever runs this installation (`SUPPORT_EMAIL`, `SUPPORT_WHATSAPP`) and the
 * installation's own code (`DOUG_CLIENT_CODE`), then "Peça ajuda ao Doug": the workspace's right hand in its DM with
 * the context already in the box (this server's version, the code, the page the person came from). Only where the
 * operator set an address: `supportContactOf` returns null otherwise, and the entry never shows.
 */
export function SupportSection() {
  const { t } = useTranslation();
  const { org } = useOrg();
  const navigate = useNavigate();
  const dir = useDirectory(org.id);
  const config = useAuthConfig().data;
  const contact = supportContactOf(config, useMe().data);
  const instance = useQuery(instanceQuery(useApi())).data;
  const doug = rightHandOf(dir.agents);
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
  if (!contact) return null;
  const askable = doug && mayAsk(org, doug);
  const ask = () => {
    if (!askable || !doug) return;
    setDraftFor(
      `agent:${doug.id}`,
      supportDraft({
        agentName: doug.name,
        version: instance?.version ?? null,
        clientCode: contact.clientCode,
        page: supportCameFrom(),
        words,
      }),
      // After whatever the person was already writing there: the hand-off never erases their draft.
      { join: true },
    );
    void navigate({ to: "/org/$orgId/dm/agent/$agentId", params: { orgId: org.id, agentId: doug.id } });
  };
  // Each card says its purpose once: the title, then the lead or the row under it, never the same words three times.
  return (
    <div className="ac-groups">
      <Card aria-labelledby="support-reach">
        <CardHeader
          id="support-reach"
          icon="question"
          title={t("settings.support.title")}
          subtitle={t("settings.support.lead")}
        />
        <div className="settings-rows">
          {contact.email ? (
            <PrefRow
              id="support-email"
              icon="mail"
              label={t("settings.support.email")}
              control={<ReachLink href={`mailto:${contact.email}`}>{contact.email}</ReachLink>}
            />
          ) : null}
          {contact.whatsapp ? (
            <PrefRow
              id="support-whatsapp"
              icon="message"
              label={t("settings.support.whatsapp")}
              control={<ReachLink href={whatsAppHref(contact.whatsapp)}>{contact.whatsapp}</ReachLink>}
            />
          ) : null}
          {contact.clientCode ? (
            <PrefRow
              id="support-client"
              icon="grid"
              label={t("settings.support.client")}
              control={<span className="ac-num">{contact.clientCode}</span>}
            />
          ) : null}
        </div>
      </Card>
      {askable && doug ? (
        <Card aria-labelledby="support-ask">
          <CardHeader id="support-ask" icon="agent" title={t("settings.support.askTitle", { name: doug.name })} />
          <div className="settings-rows">
            {/* The row is the lead's line and the action: the title already named the agent. */}
            <PrefRow
              id="support-ask-row"
              icon="message"
              label={
                contact.email
                  ? t("settings.support.askLead", { name: doug.name })
                  : t("settings.support.askNoEmail", { name: doug.name })
              }
              status={contact.email ? t("settings.support.askStatus") : undefined}
              actions={
                <Button variant="primary" icon="message" onClick={ask}>
                  {t("common.askAgent", agentGrammar(doug.name))}
                </Button>
              }
            />
          </div>
        </Card>
      ) : null}
    </div>
  );
}
