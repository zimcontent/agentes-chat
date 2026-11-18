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
 * account menu and Settings read it to show or skip the entry. The one rule both apps follow.
 *
 * The addresses come from `GET /auth-config`, which a signed-out page reads too; the installation's code only from
 * `GET /me` (`me`), which needs a session. A server from before the move said the code in `auth-config`: that one still
 * counts, so an app on it shows the code as it did.
 */
export function supportContactOf(
  config: Pick<AuthConfig, "support" | "clientCode" | "supportEmail"> | undefined,
  me?: { clientCode?: string | null } | null,
): SupportContact | null {
  if (!config) return null;
  // Older servers said only the address (`supportEmail`, for a hold's notice); it is still a way to reach them.
  const email = config.support?.email ?? config.supportEmail ?? null;
  const whatsapp = config.support?.whatsapp ?? null;
  if (!email && !whatsapp) return null;
  return { email, whatsapp, clientCode: me?.clientCode ?? config.clientCode ?? null };
}

/** A WhatsApp number as `wa.me` takes it: digits only, no `+`, spaces, dots, parentheses or hyphens. */
export const whatsAppHref = (number: string): string => `https://wa.me/${number.replace(/[^0-9]/g, "")}`;

/**
 * Where the person opened Support (the web's Sidebar or Settings, the phone's Você), kept while the app runs so the
 * draft names the page they came from and not the Support page itself. One entry, the last place opened.
 */
let cameFrom: string | null = null;

/** Remembers the page a person opened Support from (`page`: its path). */
export const setSupportCameFrom = (page: string | null) => {
  cameFrom = page;
};

/** The page they came from, for `supportDraft`; null: nobody opened Support yet. */
export const supportCameFrom = (): string | null => cameFrom;

/**
 * The words `supportDraft` puts the draft in, translated by the app (`t()`): the sentence that opens it, one line per
 * fact, and the ask. Each app passes its own language, so the draft reads as the person's app does.
 */
export interface SupportDraftWords {
  /** "{name}, I need help with the system ({facts}):", the facts' parentheses included; without facts, its own line. */
  lead: (input: { name: string; facts: string | null }) => string;
  /** One fact: the server's version, the installation's code, the page the person was on. */
  fact: (input: { kind: "version" | "client" | "page"; value: string }) => string;
  /** The ask, in words: the agent sends it with `contact_support`, so the person types no command. */
  ask: string;
}

/** The draft in English, for a caller with no language of its own: the apps pass their own `t()`'s words. */
export const SUPPORT_DRAFT_WORDS: SupportDraftWords = {
  lead: ({ name, facts }) =>
    facts === null ? `${name}, I need help with the system:` : `${name}, I need help with the system (${facts}):`,
  fact: ({ kind, value }) =>
    kind === "version"
      ? `server version ${value}`
      : kind === "client"
        ? `installation ${value}`
        : `on the page ${value}`,
  ask: "Send this to support with contact_support, in my name.",
};

/**
 * The message "Peça ajuda ao Doug" leaves in the right hand's DM: what a person would say, the facts whoever answers
 * needs (this server's version, the installation's code when it has one, the page they came from), then the ask that
 * makes the agent call `contact_support` and send it in their name.
 */
export function supportDraft(input: {
  agentName: string;
  version: string | null | undefined;
  clientCode: string | null;
  /** The page the person came from (`supportCameFrom`); null or absent: the draft names none. */
  page?: string | null;
  /** The sentence in their language; absent: `SUPPORT_DRAFT_WORDS` (English). */
  words?: SupportDraftWords;
}): string {
  const words = input.words ?? SUPPORT_DRAFT_WORDS;
  const facts = [
    input.version ? words.fact({ kind: "version", value: input.version }) : null,
    input.clientCode ? words.fact({ kind: "client", value: input.clientCode }) : null,
    input.page ? words.fact({ kind: "page", value: input.page }) : null,
  ].filter((f): f is string => Boolean(f));
  return `${words.lead({ name: input.agentName, facts: facts.length > 0 ? facts.join(", ") : null })} ${words.ask}\n\n`;
}
