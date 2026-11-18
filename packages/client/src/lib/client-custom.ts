import type { Agent, Instance, Me, OrgSummary } from "../api/types";
import { isRightHand } from "./right-hand";

/**
 * A server's client customizations (ADR doug-0020), read from `GET /me` (`client`), with `GET /api/instance` filling in
 * the name and color for a reader that only has it (the sign-in page, the server picker). A server deployed for one
 * client renames the product, paints its own highlight, turns some of the sidebar's tools off for every workspace and
 * leaves some of Team Doug's agents out. Every helper here is a no-op for a server with none.
 */
export interface ClientLook {
  /** What the apps call the product; null: the build's own name. */
  name: string | null;
  /** The color the apps highlight, `#rrggbb`; null: the build's own. */
  accent: string | null;
  /** The sidebar's tools this client turns off for every workspace, by the apps' ids. */
  hiddenTools: readonly string[];
  /** The agents this client leaves out of its apps' lists, by handle (`otto`). */
  hiddenAgents: readonly string[];
  /** What the onboarding says on top of its rail; null: nothing extra. */
  onboardingIntro: string | null;
}

export const NO_CLIENT: ClientLook = {
  name: null,
  accent: null,
  hiddenTools: [],
  hiddenAgents: [],
  onboardingIntro: null,
};

/**
 * The client's overrides as `me` (every field) and the instance (the name and color) say them; nothing from either:
 * NO_CLIENT. `me` wins where both speak.
 */
export function clientLookOf(me: Me | null | undefined, instance?: Instance | null): ClientLook {
  const fromMe = me?.client;
  const fromInstance = instance?.client;
  if (!fromMe && !fromInstance) return NO_CLIENT;
  return {
    name: fromMe?.name ?? fromInstance?.name ?? null,
    accent: fromMe?.accent ?? fromInstance?.accent ?? null,
    hiddenTools: fromMe?.hiddenTools ?? [],
    hiddenAgents: fromMe?.hiddenAgents ?? [],
    onboardingIntro: fromMe?.onboardingIntro ?? null,
  };
}

/** The product's name for this server: the client's, else the build's (`fallback`). */
export const productName = (client: ClientLook | null | undefined, fallback: string): string =>
  client?.name?.trim() || fallback;

/**
 * What a workspace's sidebar leaves out: the admin's own pick (`organization_settings.hidden_tools`) plus the client's,
 * once each.
 */
export function hiddenToolsWith(
  client: ClientLook | null | undefined,
  workspaceHidden: readonly string[] = [],
): string[] {
  return client?.hiddenTools.length ? [...new Set([...workspaceHidden, ...client.hiddenTools])] : [...workspaceHidden];
}

/** A workspace as the apps read it with the client: its `hiddenTools` with the client's added. */
export function withClientTools<T extends Pick<OrgSummary, "hiddenTools">>(org: T, client: ClientLook): T {
  return client.hiddenTools.length ? { ...org, hiddenTools: hiddenToolsWith(client, org.hiddenTools ?? []) } : org;
}

/**
 * The agents of `agents` this client's lists leave out, by handle. Never the right hand (ADR 0137: it is part of the
 * workspace, and every screen treats it apart from the team).
 */
export function clientHiddenAgentIds(
  client: ClientLook | null | undefined,
  agents: readonly Pick<Agent, "id" | "handle" | "builtin">[],
): Set<string> {
  if (!client?.hiddenAgents.length) return new Set();
  const bare = (handle: string) => handle.replace(/^@/, "").toLowerCase();
  const handles = new Set(client.hiddenAgents.map(bare));
  return new Set(agents.filter((a) => !isRightHand(a) && handles.has(bare(a.handle))).map((a) => a.id));
}
