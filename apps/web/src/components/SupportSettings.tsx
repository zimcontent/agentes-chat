import { instanceQuery, useAuthConfig } from "@agenteschat/client";
import { mayAsk } from "@agenteschat/client/lib/audience";
import { setDraftFor } from "@agenteschat/client/lib/drafts";
import { agentGrammar } from "@agenteschat/client/lib/grammar";
import { rightHandOf } from "@agenteschat/client/lib/right-hand";
import { supportContactOf, supportDraft, whatsAppHref } from "@agenteschat/client/lib/support";
import { Button, Card, CardHeader, Icon } from "@agenteschat/ui";
import { useQuery } from "@tanstack/react-query";
import { useNavigate, useRouterState } from "@tanstack/react-router";
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
 * the context already in the box (this server's version, the code, the page the person was on). Only where the
 * operator set an address: `supportContactOf` returns null otherwise, and the entry never shows.
 */
export function SupportSection() {
  const { t } = useTranslation();
  const { org } = useOrg();
  const navigate = useNavigate();
  const dir = useDirectory(org.id);
  const config = useAuthConfig().data;
  const contact = supportContactOf(config);
  const instance = useQuery(instanceQuery(useApi())).data;
  const path = useRouterState({ select: (s) => s.location.pathname });
  const doug = rightHandOf(dir.agents);
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
        page: path,
      }),
    );
    void navigate({ to: "/org/$orgId/dm/agent/$agentId", params: { orgId: org.id, agentId: doug.id } });
  };
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
          <CardHeader
            id="support-ask"
            icon="agent"
            title={t("settings.support.askTitle")}
            subtitle={t("settings.support.askLead")}
          />
          <div className="settings-rows">
            <PrefRow
              id="support-ask-row"
              icon="message"
              label={t("common.askAgent", agentGrammar(doug.name))}
              status={t("settings.support.askStatus")}
              actions={
                <Button variant="primary" icon="message" onClick={ask}>
                  {t("settings.support.ask")}
                </Button>
              }
            />
          </div>
        </Card>
      ) : null}
    </div>
  );
}
