import type { Executor } from "@agenteschat/db";
import { queueEmail } from "./email";

/**
 * Support for the people who run each installation (SWAS clients): the summary an agent sends when someone asks it
 * for help with the installation itself (`contact_support`), by email to `SUPPORT_EMAIL`, in that person's name and
 * with their address on Reply-To, so an answer reaches them. The app's own Support card shows the same addresses and
 * starts a message to the workspace's right hand.
 */

/** As long as a careful summary, short enough for one email. */
export const SUPPORT_MAX = 4000;

/** How many summaries one person may send in an hour (`contact_support`), the same as `send_feedback`. */
export const SUPPORT_PER_HOUR = { limit: 10, windowMs: 60 * 60_000 } as const;

/**
 * The refusal under a call nobody is behind: a summary speaks for a person, and a routine's or an agent's own run has
 * none to speak for.
 */
export const SUPPORT_NOBODY =
  "A support request goes in a person's name, and nobody asked for this one: nothing was sent. Say it in your reply instead.";

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

/**
 * Queues the summary (outbox job `email.send`), in the caller's transaction: sent once per `key`. The email's own
 * picture comes from `publicUrl`, this server's address, and an answer to it goes to the person who asked.
 */
export async function queueSupportEmail(
  tx: Executor,
  input: { orgId: string | null; key: string; to: string; publicUrl: string; summary: SupportSummary },
) {
  await queueEmail(tx, {
    orgId: input.orgId,
    key: input.key,
    to: [input.to],
    // Their own address, readable and answered by Reply: the email speaks for them.
    replyTo: input.summary.email,
    template: {
      kind: "support_request",
      locale: "en",
      url: input.publicUrl,
      ...input.summary,
    },
  });
}
