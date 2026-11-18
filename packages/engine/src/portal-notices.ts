import type { EmailSender } from "@agenteschat/adapters";
import type { Database } from "@agenteschat/db";
import { and, desc, eq, schema, sql } from "@agenteschat/db";
import { clientLinkUrl } from "./approval-portal-clients";
import { queueEmail } from "./email";
import type { WhatsAppAccountRow, WhatsAppDeps } from "./whatsapp/accounts";
import { deliverWhatsAppText, whatsappJidOf } from "./whatsapp/conversations";

const { portalPosts, portalClients, portalNotices, organizationSettings, whatsappAccounts } = schema;

/**
 * The notices a client gets when there is something new to approve, or a new version of a post (docs/adr/
 * doug-0020-embedded-approval-portal.md): by e-mail to every contact with an address (the `portal_ready` email), and on
 * WhatsApp from the number the workspace chose for the portal to every contact with a number, while it has one. The
 * words are the client's own share of the page, in pt-BR and English, with the client's own link.
 *
 * What went out is kept in `portal_notices` (`client`, `channel`, `contactId`, `postId`, `version`, `at`), and every
 * limit is read from it, so the ADR and this code say the same:
 *
 * - One notice per post and version. A post is *fresh* while its version waiting on the client is newer than the last
 *   version recorded for it, so a version the client was already told of never tells twice and a v2 after an
 *   adjustment (a post sent back and redone) does. The send's job key is `postId:version` (`portalNotifyPostKey`),
 *   which is the same statement at the queue.
 * - A client's notices inside an hour are one notice: what the job gathers is every fresh post of that client, named in
 *   `posts[]` (the email's list, the text's first line), instead of one message per post.
 * - Nothing goes while the client has no live link (`skipped: "link"`: its token no longer matches, so the page it
 *   would open answers nothing) or every post waiting on it was already told of (`none`).
 * - A number starts no more conversations than the app itself allows (`whatsapp.new_chats_limit`, the check
 *   `deliverWhatsAppText` goes through), and the notice goes only from the number the workspace picked in Settings ›
 *   Clientes do portal: with none, nothing goes by WhatsApp. A person's own number is never used for it.
 */

/** The job the portal's notice for a post runs as. */
export const PORTAL_NOTIFY_JOB = "portal.notify";

/** A notice for one client inside this of another is that same notice (`posts[]` joined), and never a second one. */
export const PORTAL_NOTICE_GROUP_MS = 60 * 60_000;

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
  /** What "now" is, for the limits: the clock, unless a test says otherwise. */
  now?: () => Date;
}

/** The statuses a client still has to decide: `sent`, `seen`, or its new version's `adjusted`. */
const WAITING_STATUSES = ["sent", "seen", "adjusted"] as const;
const waitingSql = sql`${portalPosts.status} in (${sql.join(
  WAITING_STATUSES.map((status) => sql`${status}`),
  sql`, `,
)})`;

/** A post still waiting on someone: what the notice's `posts[]` names. */
interface WaitingPost {
  id: string;
  title: string;
  version: number;
}

/** Every post of this client waiting on it now: one notice gathers them, the newest first. */
async function waitingPosts(db: Database, orgId: string, client: string): Promise<WaitingPost[]> {
  return db
    .select({ id: portalPosts.id, title: portalPosts.title, version: portalPosts.version })
    .from(portalPosts)
    .where(and(eq(portalPosts.orgId, orgId), eq(portalPosts.client, client), waitingSql))
    .orderBy(desc(portalPosts.updatedAt));
}

/** The client behind a post, with its contacts. */
async function clientOfPost(db: Database, orgId: string, client: string) {
  const [row] = await db
    .select()
    .from(portalClients)
    .where(and(eq(portalClients.orgId, orgId), eq(portalClients.client, client)));
  return row ?? null;
}

/**
 * The WhatsApp number the portal's notices go out as: the workspace's own choice (`organization_settings.
 * portal_notice_number`), while it is one of its connected numbers. Null: nothing goes by WhatsApp, whatever other
 * numbers the workspace has. A person's own number is never used on its own.
 */
async function chosenNumber(db: Database, orgId: string): Promise<WhatsAppAccountRow | null> {
  const [choice] = await db
    .select({ id: organizationSettings.portalNoticeNumber })
    .from(organizationSettings)
    .where(eq(organizationSettings.orgId, orgId));
  if (!choice?.id) return null;
  const [row] = await db
    .select()
    .from(whatsappAccounts)
    .where(and(eq(whatsappAccounts.orgId, orgId), eq(whatsappAccounts.id, choice.id)));
  // A choice whose number left or went disconnected tells nothing: a new one is picked in Settings.
  return row?.status === "connected" ? row : null;
}

/** The most a post's version reached when this client's contacts were told about it, by any way; 0 when never. */
async function toldVersionOf(db: Database, orgId: string, client: string, postId: string): Promise<number> {
  const [row] = await db
    .select({ version: portalNotices.version })
    .from(portalNotices)
    .where(
      and(eq(portalNotices.orgId, orgId), eq(portalNotices.client, client), eq(portalNotices.postId, postId)),
    )
    .orderBy(desc(portalNotices.version))
    .limit(1);
  return row?.version ?? 0;
}

/**
 * Keeps what went out, so every limit reads from what really happened: the client, the way, the contact, the post and
 * its version. Written after the email or the text is queued and sent, one row per (contact, post, way).
 */
async function recordPortalNotice(
  db: Database,
  orgId: string,
  input: {
    client: string;
    channel: "email" | "whatsapp";
    contactId: string | null;
    postId: string;
    version: number;
    at: Date;
  },
) {
  await db.insert(portalNotices).values({
    orgId,
    client: input.client,
    channel: input.channel,
    contactId: input.contactId,
    postId: input.postId,
    version: input.version,
    at: input.at,
  });
}

/**
 * Tells a client's contacts that a post is waiting on them (job `portal.notify`), in their language, with the client's
 * own link. A contact with an address gets the email; a number that already talks to the contact gets a text, and one
 * that doesn't only while the number may start a conversation today. Nothing goes when: the post was answered meanwhile
 * (`answered`), the client was removed (`client`), the client has no live link (`link`, its token no longer matching),
 * the client was told inside the hour (`recent`, that notice's `posts[]` already names this one), or a contact has no
 * way to be reached (`none`).
 */
export async function announcePortalPost(
  deps: PortalNoticeDeps,
  orgId: string,
  postId: string,
  version: number,
): Promise<{ sent: number; skipped: string | null }> {
  const now = deps.now?.() ?? new Date();
  const [post] = await deps.db
    .select()
    .from(portalPosts)
    .where(and(eq(portalPosts.orgId, orgId), eq(portalPosts.id, postId)));
  if (!post) return { sent: 0, skipped: "client" };
  if (!(WAITING_STATUSES as readonly string[]).includes(post.status)) return { sent: 0, skipped: "answered" };
  const client = await clientOfPost(deps.db, orgId, post.client);
  if (!client) return { sent: 0, skipped: "client" };
  const url = await clientLinkUrl(deps.db, deps.publicUrl, deps.secret, client.id);
  // No live link: the client's page wouldn't open, so a notice saying it is there helps no one (ADR doug-0020 §4).
  if (!url) return { sent: 0, skipped: "link" };
  const waiting = await waitingPosts(deps.db, orgId, post.client);
  // What this notice gathers: every post of the client whose waiting version is past the one it was told of, oldest
  // version first — the client's own, one message for the hour, and a v2 after an adjustment is past its v1.
  const fresh: { id: string; title: string; version: number }[] = [];
  for (const p of waiting) {
    const asked = p.id === post.id ? version : p.version;
    if (asked > (await toldVersionOf(deps.db, orgId, post.client, p.id))) {
      fresh.push({ id: p.id, title: p.title, version: asked });
    }
  }
  if (fresh.length === 0) return { sent: 0, skipped: "none" };
  const posts = fresh.map((p) => ({ title: p.title, version: p.version }));
  const group = portalNoticeWindow(now);
  const number = deps.whatsapp?.gateway ? await chosenNumber(deps.db, orgId) : null;
  let sent = 0;
  for (const contact of client.contacts) {
    const locale = /[ãõçáéíóúâêôà]/i.test(contact.name) ? "pt-BR" : "en";
    if (deps.email && contact.email) {
      try {
        await queueEmail(deps.db, {
          orgId,
          // The client, the hour's window, the contact, and which post versions it names: a repeat of the same notice
          // adds nothing, while a new version of a post inside the window (the client asked a change, the team redid
          // it) is a notice of its own — the rule the ADR states, `posts[]` and all.
          key: `portal-notice:${post.client}:${group.toISOString()}:${contact.id}:${fresh.map((p) => `${p.id}v${p.version}`).join("+")}`,
          to: [contact.email],
          template: { kind: "portal_ready", locale, clientName: client.name, posts, url },
        });
        for (const p of fresh) {
          await recordPortalNotice(deps.db, orgId, {
            client: post.client,
            channel: "email",
            contactId: contact.id,
            postId: p.id,
            version: p.version,
            at: now,
          });
        }
        sent++;
      } catch (error) {
        deps.log?.warn("approval portal: a client's email could not be queued", { postId, error: String(error) });
      }
    }
    if (deps.whatsapp?.gateway && number && contact.whatsapp) {
      try {
        const title = posts[0]?.title ?? post.title;
        const more = posts.length > 1 ? ` (+${posts.length - 1})` : "";
        const text =
          locale === "pt-BR"
            ? `Oi! Tem uma publicação do ${client.name} esperando o seu OK:\n${title}${more}\n${url}`
            : `Hi! A ${client.name} post is waiting for your OK:\n${title}${more}\n${url}`;
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
        for (const p of fresh) {
          await recordPortalNotice(deps.db, orgId, {
            client: post.client,
            channel: "whatsapp",
            contactId: contact.id,
            postId: p.id,
            version: p.version,
            at: now,
          });
        }
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

/**
 * The job a send enqueues: `postId:version`, the key the ADR names, so the same version never tells twice. A v2 names
 * another one, so a post sent back and redone tells again.
 */
export const portalNotifyPostKey = (postId: string, version: number) => `portal.notify:${postId}:v${version}`;

/** The window of an hour `at` belongs to: the notice one client's sends inside it become. */
export const portalNoticeWindow = (at: Date) => new Date(Math.floor(at.getTime() / PORTAL_NOTICE_GROUP_MS) * PORTAL_NOTICE_GROUP_MS);

/** Where a client's notice for a window begins: the `at` of the window, for a test that reads the rows back. */
export const portalNoticeWindowKey = (client: string, at: Date) =>
  `${client}:${portalNoticeWindow(at).toISOString()}`;
