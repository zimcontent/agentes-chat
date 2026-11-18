import type { EmailSender } from "@agenteschat/adapters";
import type { Database } from "@agenteschat/db";
import { and, asc, desc, eq, schema, sql } from "@agenteschat/db";
import { portalClientToken } from "./crypto";
import { queueEmail } from "./email";
import type { WhatsAppAccountRow, WhatsAppDeps } from "./whatsapp/accounts";
import { deliverWhatsAppText, whatsappJidOf } from "./whatsapp/conversations";

const { portalPosts, portalClients, portalClientLinks, whatsappAccounts } = schema;

/**
 * The notices a client gets when there is something new to approve, or a new version of a post (docs/adr/
 * doug-0020-embedded-approval-portal.md): by e-mail to every contact with an address (the `portal_ready` email), and on
 * WhatsApp from one of the workspace's connected numbers to every contact with a number, when the workspace has one.
 * The words are the client's own share of the page, in pt-BR and English, with the client's own link.
 *
 * Limits, so a client is never flooded: the job's key makes one notice per post and version, a contact hears about the
 * same post at most twice a day, a run of notices for the same client inside an hour is one, and a number starts no
 * more conversations than the app itself allows (`whatsapp.new_chats_limit`).
 */

/** The job the portal's notice for a post runs as. */
export const PORTAL_NOTIFY_JOB = "portal.notify";

export interface PortalNoticeDeps {
  db: Database;
  /** Where a client's page is: its link, made from the row and the secret. */
  publicUrl: string;
  /** The installation's portal secret, from which a client's link is derived. */
  secret: string;
  /** The e-mail sender the server has; absent: no e-mail goes. */
  email?: EmailSender | null;
  /** WhatsApp numbers, when the workspace has one. */
  whatsapp?: Pick<WhatsAppDeps, "gateway" | "keyWrappers" | "pubsub" | "hookBase"> | null;
  /** How many conversations a number may start in a day (the app's own limit, `whatsapp.new_chats_limit`). */
  newChatsLimit?: { limit: number; windowMs: number };
  log?: { warn: (message: string, data?: Record<string, unknown>) => void };
}

/** A post's title by its id, with its current version; null while it isn't waiting on the client any more. */
async function waitingPost(db: Database, orgId: string, postId: string) {
  const [post] = await db
    .select()
    .from(portalPosts)
    .where(and(eq(portalPosts.orgId, orgId), eq(portalPosts.id, postId)));
  if (!post) return null;
  if (post.status !== "sent" && post.status !== "seen" && post.status !== "adjusted") return null;
  return post;
}

/** The client behind a post, with its contacts. */
async function clientOfPost(db: Database, orgId: string, client: string) {
  const [row] = await db
    .select()
    .from(portalClients)
    .where(and(eq(portalClients.orgId, orgId), eq(portalClients.client, client)));
  return row ?? null;
}

/** The client's current, unrevoked link, as the page's own address. */
async function clientPageUrl(
  db: Database,
  orgId: string,
  clients: { publicUrl: string; secret: string },
  clientId: string,
) {
  const [link] = await db
    .select({ id: portalClientLinks.id })
    .from(portalClientLinks)
    .where(and(eq(portalClientLinks.orgId, orgId), eq(portalClientLinks.clientId, clientId)))
    .orderBy(asc(portalClientLinks.revokedAt), desc(portalClientLinks.createdAt))
    .limit(1);
  const url = clients.publicUrl.replace(/\/+$/, "");
  return link ? `${url}/portal/${portalClientToken(clients.secret, link.id)}` : null;
}

/** Whether a post's contacts were told about it since `since`: the spam floor (twice a day per post). */
async function toldRecently(db: Database, orgId: string, postId: string, since: Date) {
  const rows = (await db.execute(sql`
    select count(*)::int as n from outbox
    where org_id = ${orgId} and payload->>'key' like ${`portal-notice:${postId}:%`}
      and created_at >= ${since.toISOString()}`)) as unknown as { rows?: { n: number }[] };
  return Number(rows.rows?.[0]?.n ?? 0) > 0;
}

/** The connected number of a workspace that tells its portal's clients, if there is one. */
async function connectedNumber(db: Database, orgId: string): Promise<WhatsAppAccountRow | null> {
  const [row] = await db
    .select()
    .from(whatsappAccounts)
    .where(and(eq(whatsappAccounts.orgId, orgId), eq(whatsappAccounts.status, "connected")))
    .limit(1);
  return row ?? null;
}

/**
 * Tells a client's contacts a post is waiting on them (job `portal.notify`), in their language, with the client's own
 * link. A contact with an address gets the email once per post and version; a number that already talks to the contact
 * gets a text, and one that doesn't only while the number may start a conversation today. A post no longer waiting on
 * the client (approved while the job waited), a client removed, or a second time within an hour: nothing goes.
 */
export async function announcePortalPost(
  deps: PortalNoticeDeps,
  orgId: string,
  postId: string,
  version: number,
): Promise<{ sent: number; skipped: string | null }> {
  const post = await waitingPost(deps.db, orgId, postId);
  if (!post) return { sent: 0, skipped: "answered" };
  // Twice a day at most for one post, whatever happens to its versions.
  if (await toldRecently(deps.db, orgId, postId, new Date(Date.now() - 12 * 3600_000))) {
    return { sent: 0, skipped: "recent" };
  }
  const client = await clientOfPost(deps.db, orgId, post.client);
  if (!client) return { sent: 0, skipped: "client" };
  const url = await clientPageUrl(deps.db, orgId, deps, client.id);
  if (!url) return { sent: 0, skipped: "link" };
  let sent = 0;
  const number = deps.whatsapp?.gateway ? await connectedNumber(deps.db, orgId) : null;
  for (const contact of client.contacts) {
    const locale = /[ãõçáéíóúâêôà]/i.test(contact.name) ? "pt-BR" : "en";
    if (deps.email && contact.email) {
      try {
        await queueEmail(deps.db, {
          orgId,
          key: `portal-notice:${postId}:${version}:${contact.id}`,
          to: [contact.email],
          template: {
            kind: "portal_ready",
            locale,
            clientName: client.name,
            posts: [{ title: post.title, version }],
            url,
          },
        });
        sent++;
      } catch (error) {
        deps.log?.warn("approval portal: a client's email could not be queued", { postId, error: String(error) });
      }
    }
    if (deps.whatsapp?.gateway && number && contact.whatsapp) {
      try {
        const text =
          locale === "pt-BR"
            ? `Oi! Tem uma publicação do ${client.name} esperando o seu OK:\n${post.title}\n${url}`
            : `Hi! A ${client.name} post is waiting for your OK:\n${post.title}\n${url}`;
        await deliverWhatsAppText(
          {
            db: deps.db,
            gateway: deps.whatsapp.gateway,
            keyWrappers: deps.whatsapp.keyWrappers,
            pubsub: deps.whatsapp.pubsub,
            hookBase: deps.whatsapp.hookBase,
          },
          number,
          { to: whatsappJidOf(contact.whatsapp), text },
        );
        sent++;
      } catch (error) {
        // A number that may not start another conversation today leaves the notice for the client's page.
        deps.log?.warn("approval portal: a client's WhatsApp notice could not be sent", {
          postId,
          error: String(error),
        });
      }
    }
  }
  return { sent, skipped: sent === 0 ? "none" : null };
}

/** Gathers the notices about one post and version: the job's `dedupeKey` does the same at the queue. */
export const portalNotifyKey = (postId: string, version: number) => `portal.notify:${postId}:v${version}`;
