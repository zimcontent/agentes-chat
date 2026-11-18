import type { Executor } from "@agenteschat/db";
import { queueEmail } from "./email";

/**
 * Support for the people who run each installation (SWAS clients): the summary an agent sends when someone asks it
 * for help with the installation itself (`contact_support`), by email to `SUPPORT_EMAIL`, in that person's name. The
 * app's own Support card shows the same addresses and starts a message to the workspace's right hand.
 */

/** As long as a careful summary, short enough for one email. */
export const SUPPORT_MAX = 4000;

/** What a summary carries beyond the person's words: who they are, where they work, who wrote it and which install. */
export interface SupportSummary {
  name: string;
  email: string;
  orgName: string;
  text: string;
  /** The agent that wrote it, for the email's "Written by". Null: an agent whose name is gone. */
  agent: { name: string; handle: string } | null;
  /** This installation's client code (`DOUG_CLIENT_CODE`), when it has one. */
  clientCode: string | null;
  /** This server's version. */
  version: string;
}

/** The card's label for who decides a support request: in that person's name, so only they approve it. */
export const supportRequestedBy = () => "Support";

/**
 * Queues the summary (outbox job `email.send`), in the caller's transaction: sent once per `key`. The email's own
 * picture comes from `publicUrl`, this server's address.
 */
export async function queueSupportEmail(
  tx: Executor,
  input: { orgId: string | null; key: string; to: string; publicUrl: string; summary: SupportSummary },
) {
  await queueEmail(tx, {
    orgId: input.orgId,
    key: input.key,
    to: [input.to],
    template: {
      kind: "support_request",
      locale: "en",
      url: input.publicUrl,
      ...input.summary,
    },
  });
}
