import { lowerFirst } from "@agenteschat/client/lib/format";
import { rightHandOf } from "@agenteschat/client/lib/right-hand";
import { useCallback } from "react";
import { useTranslation } from "react-i18next";
import { serverUrl } from "@/lib/server";
import { router } from "@/ui/navigation";
import { openOwnPage } from "../ai/parts";
import { useOpenDm } from "../new/useOpenDm";
import { useDirectory, useOrgId } from "../shared/hooks";
import { genderOf } from "../shared/logic";

/*
 * Where agents are set up now that the phone keeps only their profile: the agent's page on this server's website
 * (instructions, budget, brakes, removing it, creating one) and the right hand's conversation, asked in words.
 */

/** An agent's page on the website, at its Configurações tab. */
export const agentSitePath = (orgId: string, agentId: string) =>
  `/org/${encodeURIComponent(orgId)}/agents/${encodeURIComponent(agentId)}?tab=settings`;

/** The website's "Criar agente" (`proposal`: an agent's proposal, opened on its draft; `channel`: starts there). */
export const newAgentSitePath = (orgId: string, q: { proposal?: string; channel?: string } = {}) => {
  // By hand: React Native's URLSearchParams is partial.
  const rest = Object.entries(q)
    .filter((e): e is [string, string] => Boolean(e[1]))
    .map(([k, v]) => `${k}=${encodeURIComponent(v)}`)
    .join("&");
  return `/org/${encodeURIComponent(orgId)}/agents/new${rest ? `?${rest}` : ""}`;
};

/**
 * Opens a page of this server's website in the in-app browser, never through the app's own links (the website's
 * agent page would come back here as the profile).
 */
export const openSitePath = (path: string) => openOwnPage(`${serverUrl()}${path}`);

/** "Mais ajustes no site": the agent's page on the website. */
export function useOpenAgentSite() {
  const orgId = useOrgId();
  return useCallback((agentId: string) => openSitePath(agentSitePath(orgId, agentId)), [orgId]);
}

/**
 * "Pedir ao Doug": the right hand's conversation, its field ready with `text` when given. A workspace without one
 * (made before it existed) opens the website instead: `site` there, the agents' page by default.
 */
export function useAskDoug() {
  const orgId = useOrgId();
  const dir = useDirectory();
  const openDm = useOpenDm();
  const doug = rightHandOf(dir.agents);
  return useCallback(
    (text?: string, site?: string) => {
      if (doug) void openDm({ agentId: doug.id }, { compose: true, ...(text ? { text } : {}) });
      else openSitePath(site ?? newAgentSitePath(orgId));
    },
    [doug, openDm, orgId],
  );
}

/** The agent's light settings ("Ajustes" on its profile). */
export const openAgentSettings = (agentId: string) => router.push(`/agent-settings/${agentId}` as never);

/**
 * "Aumentar orçamento" where an agent stopped at its budget: the right hand's conversation with the ask already
 * written ("Aumenta o orçamento da ROSA"), else the agent's page on the website.
 */
export function useRaiseBudget() {
  const { t } = useTranslation();
  const orgId = useOrgId();
  const dir = useDirectory();
  const ask = useAskDoug();
  return useCallback(
    (agentId: string) => {
      const name = dir.agentById.get(agentId)?.name ?? "";
      ask(t(`mobile.agentLite.raiseBudget${genderOf(name)}`, { name }), agentSitePath(orgId, agentId));
    },
    [ask, dir.agentById, orgId, t],
  );
}

/**
 * "Criar agente" on the phone: the right hand's conversation with the ask written ("Quero um agente novo para…",
 * `what` filled in when given), where it proposes one to approve; the website's "Criar agente" without a right hand.
 */
export function useCreateAgent() {
  const { t, i18n } = useTranslation();
  const orgId = useOrgId();
  const ask = useAskDoug();
  return useCallback(
    (what?: string, site: { channel?: string } = {}) =>
      ask(
        what?.trim()
          ? t("mobile.agentLite.createWhat", { what: lowerFirst(what.trim(), i18n.language) })
          : t("mobile.agentLite.create"),
        newAgentSitePath(orgId, site),
      ),
    [ask, orgId, t, i18n.language],
  );
}
