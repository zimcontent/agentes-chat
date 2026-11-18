import type { AuthConfig } from "../api/types";

/**
 * Support for the people who run each installation: the addresses the operator set (`SUPPORT_EMAIL`, `SUPPORT_WHATSAPP`)
 * and the client code (`DOUG_CLIENT_CODE`). The account menu and Settings show them as one entry, and it holds a
 * shortcut to the workspace's right hand with the context a person would otherwise type. Absent either address, there
 * is no Support entry.
 */
export interface SupportContact {
  email: string | null;
  whatsapp: string | null;
  /** This installation's own code ("064"), when the operator set one. */
  clientCode: string | null;
}

/**
 * What this server offers, or null when it offers no Support (neither address set, or a server older than it): the
 * account menu and Settings read it to show or skip the entry.
 */
export function supportContactOf(
  config: Pick<AuthConfig, "support" | "clientCode" | "supportEmail"> | undefined,
): SupportContact | null {
  if (!config) return null;
  // Older servers said only the address (`supportEmail`, for a hold's notice); it is still a way to reach them.
  const email = config.support?.email ?? config.supportEmail ?? null;
  const whatsapp = config.support?.whatsapp ?? null;
  if (!email && !whatsapp) return null;
  return { email, whatsapp, clientCode: config.clientCode ?? null };
}

/** A WhatsApp number as `wa.me` takes it: digits only, no `+`, spaces, dots, parentheses or hyphens. */
export const whatsAppHref = (number: string): string => `https://wa.me/${number.replace(/[^0-9]/g, "")}`;

/**
 * The message an agent gets from "Peça ajuda ao Doug": what a person would say, plus the facts whoever answers needs
 * (this server's version, the installation's code when it has one, the page they were on). `page`: the screen's path.
 */
export function supportDraft(input: {
  agentName: string;
  version: string | null | undefined;
  clientCode: string | null;
  page: string | null;
}): string {
  const facts = [
    input.version ? `versão do servidor ${input.version}` : null,
    input.clientCode ? `instalação ${input.clientCode}` : null,
    input.page ? `na página ${input.page}` : null,
  ].filter(Boolean);
  const context = facts.length > 0 ? ` (${facts.join(", ")})` : "";
  return `${input.agentName}, preciso de ajuda com o sistema${context}: `;
}
