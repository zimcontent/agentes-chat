import { authConfigQuery, instanceQuery, type Me, meQuery } from "@agenteschat/client";
import type { LegalKind } from "@agenteschat/i18n/legal";
import { redirect } from "@tanstack/react-router";
import type { RouterContext } from "./router-context";

/** Route guard: the signed-in person, or a redirect to /login that comes back afterwards. */
export async function requireUser(context: RouterContext, href: string): Promise<Me> {
  const me = await context.queryClient.ensureQueryData(meQuery(context.api));
  if (!me) throw redirect({ to: "/login", search: { redirect: href } });
  return me;
}

/**
 * The signed-in person, sure to include `orgId` when they belong to it: the
 * cached list can predate a workspace just created or joined, so a miss asks
 * the server again before saying "you're not part of this organization".
 */
export async function requireUserIn(context: RouterContext, href: string, orgId: string): Promise<Me> {
  const me = await requireUser(context, href);
  if (me.organizations.some((o) => o.id === orgId)) return me;
  const fresh = await context.queryClient.fetchQuery({ ...meQuery(context.api), staleTime: 0 });
  if (!fresh) throw redirect({ to: "/login", search: { redirect: href } });
  return fresh;
}

/**
 * `/terms`, `/privacy`, `/termos` and `/privacidade`. On agentes.chat Cloud (`cloud`) they are the Cloud's documents.
 * Any other server sends each to its own page when `TERMS_URL` / `PRIVACY_URL` name one elsewhere; when the setting is
 * this server's own `/termos` or `/privacidade` (the default for a server that names its company, `LEGAL_COMPANY_NAME`)
 * they are DougBot's documents (`own`); and with no page set, there is none (`none`), as before.
 */
/**
 * `/empresas`, the company request form: self-hosting's alone (ADR doug-0033). On agentes.chat Cloud the server serves
 * no route (`registerCompanyRequests`) and no list, so the page is not offered either: it answers `false` there and the
 * route reads it as a page that does not exist, the same on every other server that shows it.
 */
export async function showsCompanyRequests(context: RouterContext): Promise<boolean> {
  const [instance, config] = await Promise.all([
    context.queryClient.ensureQueryData(instanceQuery(context.api)),
    context.queryClient.ensureQueryData(authConfigQuery(context.api)),
  ]);
  return !instance.cloud && !config.cloud;
}

export async function legalPage(context: RouterContext, kind: LegalKind): Promise<"cloud" | "own" | "none"> {
  const [instance, config] = await Promise.all([
    context.queryClient.ensureQueryData(instanceQuery(context.api)),
    context.queryClient.ensureQueryData(authConfigQuery(context.api)),
  ]);
  if (instance.cloud) return "cloud";
  const own = kind === "terms" ? config.termsUrl : config.privacyUrl;
  if (!own) return "none";
  const address = new URL(own, window.location.href);
  if (address.origin !== window.location.origin) throw redirect({ href: own });
  // This server's own address: DougBot's page where it is the default one (`/termos`, `/privacidade`). Any other path
  // here is this app's `/terms` or `/privacy` again, which would land back here, and is no page, as it always was.
  return address.pathname === (kind === "terms" ? "/termos" : "/privacidade") ? "own" : "none";
}
