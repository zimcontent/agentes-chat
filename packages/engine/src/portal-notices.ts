import type { EmailSender } from "@agenteschat/adapters";
import type { Database, Executor } from "@agenteschat/db";
import { and, asc, desc, eq, inArray, schema, sql } from "@agenteschat/db";
import { type AppLocale, appLocale, isAppLocale } from "@agenteschat/i18n/locale";
import { clientLinkUrl } from "./approval-portal-clients";
import { queueEmail } from "./email";
import { can, getMembership } from "./organizations";
import { enqueue } from "./outbox";
import { STANDING_COLUMNS, workRefusal } from "./standing";
import type { WhatsAppAccountRow, WhatsAppDeps } from "./whatsapp/accounts";
import { deliverWhatsAppText, whatsappJidOf } from "./whatsapp/conversations";

const { portalPosts, portalClients, portalNotices, organizationSettings, whatsappAccounts, organizations } = schema;
const { organizationMembers, users } = schema;

/**
 * The notices a client gets when there is something new to approve, or a new version of a post (docs/adr/
 * doug-0031-embedded-approval-portal.md): by e-mail to every contact with an address (the `portal_ready` email), and on
 * WhatsApp from the number the workspace chose for the portal to every contact with a number, while it has one. The
 * words are the client's own share of the page, in the client's own language (`portal_clients.locale`, picked in
 * Settings; the workspace owner's when that is empty), with the client's own link.
 *
 * What went out is kept in `portal_notices` (`client`, `channel`, `contactId`, `postId`, `version`, `at`), and every
 * limit is read from it, so the ADR and this code say the same:
 *
 * - One notice per post and version. A post is *fresh* while its version waiting on the client is newer than the last
 *   version recorded for it, so a version the client was already told of never tells twice and a v2 after an
 *   adjustment (a post sent back and redone) does. The send's job key is `postId:version` (`portalNotifyPostKey`),
 *   which is the same statement at the queue.
 * - A client's notices inside an hour are one notice: what the job gathers is every fresh post of that client, named in
 *   `posts[]` (the email's list, the text's first line), instead of one message per post. The job names its client, so
 *   a retry that comes back at the end of the hour gathers what landed meanwhile even when its own post was answered.
 * - Nothing goes while the client has no live link (`skipped: "link"`: its token no longer matches, so the page it
 *   would open answers nothing) or every post waiting on it was already told of (`none`).
 * - A number starts no more conversations than the app itself allows (`whatsapp.new_chats_limit`, the check
 *   `deliverWhatsAppText` goes through), and the notice goes only from the number the workspace picked in Settings ›
 *   Clientes do portal: with none, nothing goes by WhatsApp. A person's own number is never used for it.
 * - One notice at a time for a client, across every process: the hour is read and what went out is written under an
 *   advisory lock named by the workspace and the client (`pg_advisory_xact_lock`), so two jobs that arrive together
 *   never both read "no notice in the last hour" and both tell the client.
 */

/** The job the portal's notice for a post runs as. */
export const PORTAL_NOTIFY_JOB = "portal.notify";

/**
 * What `announcePortalPost` did: how many contacts were told, and why nothing went when none was. `retryAt` comes with
 * `skipped: "recent"`: the moment the client's hour is over, when the job runs again and gathers everything that landed
 * meanwhile into one notice.
 */
export interface PortalNoticeResult {
  sent: number;
  skipped: string | null;
  /** The moment the client's hour is over: the job runs again then, and gathers everything that landed meanwhile. */
  retryAt?: Date;
  /** The client whose hour held the notice, when `skipped` is `recent`: the retry's key names it. */
  client?: string;
  /**
   * The contacts whose text didn't go while the rest of the notice did: the job queues a retry for them alone, so a
   * gateway that refused one number doesn't keep the others from hearing of the post.
   */
  pending?: string[];
}

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
async function waitingPosts(db: Executor, orgId: string, client: string): Promise<WaitingPost[]> {
  return db
    .select({ id: portalPosts.id, title: portalPosts.title, version: portalPosts.version })
    .from(portalPosts)
    .where(and(eq(portalPosts.orgId, orgId), eq(portalPosts.client, client), waitingSql))
    .orderBy(desc(portalPosts.updatedAt));
}

/** The client behind the job's payload, with its contacts (and the language its notices are written in). */
async function clientOfPost(db: Executor, orgId: string, client: string) {
  const [row] = await db
    .select()
    .from(portalClients)
    .where(and(eq(portalClients.orgId, orgId), eq(portalClients.client, client)));
  return row ?? null;
}

/**
 * The language a client's notices are written in (ADR doug-0031 §8): the client's own (`portal_clients.locale`, picked
 * in Settings), else the workspace owner's own language (`personLocale`), else English. Never guessed from the
 * contacts' names: a name says nothing certain about the language a person reads.
 */
export async function portalClientLocale(
  db: Executor,
  orgId: string,
  row: { locale: string | null } | null,
): Promise<AppLocale> {
  if (row?.locale && isAppLocale(row.locale)) return row.locale;
  const [owner] = await db
    .select({ userId: organizationMembers.userId, locale: users.locale })
    .from(organizationMembers)
    .innerJoin(users, eq(users.id, organizationMembers.userId))
    .where(and(eq(organizationMembers.orgId, orgId), eq(organizationMembers.role, "owner")))
    .orderBy(asc(organizationMembers.createdAt))
    .limit(1);
  return (appLocale([owner?.locale], true) as AppLocale | null) ?? "en";
}

/**
 * The WhatsApp number the portal's notices go out as: the workspace's own choice (`organization_settings.
 * portal_notice_number`), while it is one of its connected numbers the person who chose it may still use. Null: nothing
 * goes by WhatsApp, whatever other numbers the workspace has. A person's own number is never used on its own.
 *
 * A choice whose author no longer uses that number (taken off its `people` list, with no `manage_connectors` to see
 * every number) is ignored, as a number that left the workspace or went disconnected is: a number the chooser lost
 * access to is not the workspace's to tell clients from.
 */
async function chosenNumber(db: Database, orgId: string): Promise<WhatsAppAccountRow | null> {
  const [choice] = await db
    .select({ id: organizationSettings.portalNoticeNumber, by: organizationSettings.portalNoticeNumberBy })
    .from(organizationSettings)
    .where(eq(organizationSettings.orgId, orgId));
  if (!choice?.id) return null;
  const [row] = await db
    .select()
    .from(whatsappAccounts)
    .where(and(eq(whatsappAccounts.orgId, orgId), eq(whatsappAccounts.id, choice.id)));
  if (row?.status !== "connected") return null;
  // A number whose author is no person any more (or none was kept, as a choice made before this existed is) goes out
  // as it did: the author's access is what is read, never a reason to silence a choice that never said who made it.
  if (!choice.by) return row;
  const by = await getMembership(db, choice.by, orgId);
  if (!by) return null;
  if (!can(by, "manage_connectors") && !row.people.includes(choice.by)) return null;
  return row;
}

/**
 * When this client's last notice went out, by any way and about any post; null when none ever did. Read from
 * `portal_notices`, so the hour is measured by what really happened and not by an in-memory mark.
 */
async function lastNoticeAt(db: Executor, orgId: string, client: string): Promise<Date | null> {
  const [row] = await db
    .select({ at: portalNotices.at })
    .from(portalNotices)
    .where(and(eq(portalNotices.orgId, orgId), eq(portalNotices.client, client)))
    .orderBy(desc(portalNotices.at))
    .limit(1);
  return row?.at ?? null;
}

/** The most a post's version reached when this client's contacts were told about it, by any way; 0 when never. */
async function toldVersionOf(db: Executor, orgId: string, client: string, postId: string): Promise<number> {
  const [row] = await db
    .select({ version: portalNotices.version })
    .from(portalNotices)
    .where(and(eq(portalNotices.orgId, orgId), eq(portalNotices.client, client), eq(portalNotices.postId, postId)))
    .orderBy(desc(portalNotices.version))
    .limit(1);
  return row?.version ?? 0;
}

/**
 * Keeps what went out, so every limit reads from what really happened: the client, the way, the contact, the post and
 * its version. Written after the email or the text is queued and sent, one row per (contact, post, way).
 */
async function recordPortalNotice(
  db: Executor,
  orgId: string,
  input: {
    client: string;
    channel: "email" | "whatsapp";
    contactId: string | null;
    postId: string;
    version: number;
    at: Date;
  },
): Promise<string[]> {
  const rows = await db
    .insert(portalNotices)
    .values({
      orgId,
      client: input.client,
      channel: input.channel,
      contactId: input.contactId,
      postId: input.postId,
      version: input.version,
      at: input.at,
    })
    .returning({ id: portalNotices.id });
  return rows.map((row) => row.id);
}

/**
 * Tells a client's contacts that a post is waiting on them (job `portal.notify`), in the client's language, with the
 * client's own link. A contact with an address gets the email; a number that already talks to the contact gets a text,
 * and one that doesn't only while the number may start a conversation today. Nothing goes when: the client was removed
 * (`client`), the client has no live link (`link`, its token no longer matching), a notice for this client went out
 * inside the hour (`recent`, with `retryAt`: the job runs again then, and the posts that landed meanwhile go in one
 * notice, `posts[]`), or nothing is waiting that the client wasn't told of (`none`).
 *
 * The post named by the job is not required to be still waiting on the client: a retry that comes back at the end of
 * the hour names the post that first held it, which may have been answered since, while another post landed meanwhile
 * is what the client has to be told of. What is gathered is every post of the client that is waiting now — at its own
 * `version` (`p.version`) — and was not told of yet, whether it is the job's post or not. A post that is not waiting
 * (answered, adjusting, published) never goes in `posts[]`, and its own version is never named.
 */
export async function announcePortalPost(
  deps: PortalNoticeDeps,
  orgId: string,
  postId: string,
  /**
   * The version the job was queued with (`portalNotifyPostKey`). Kept for the job's own record; what is fresh is read
   * from each post's row, never from this, so a retry about a post that was answered never names its old version.
   */
  version: number,
  /** The client the job names, when it does (`portal.notify`'s retry): what is told of is that client, whatever its
   * post became. Without it, the client is the one the post belongs to, as a send names it. */
  named?: string | null,
  /**
   * The contacts whose text is still owed (`PortalNoticeResult.pending`, a job's own retry): only they are told, by
   * WhatsApp alone, and the client's hour is not read — this is the same notice finishing, not a second one.
   */
  onlyContacts?: readonly string[] | null,
): Promise<PortalNoticeResult> {
  void version;
  const now = deps.now?.() ?? new Date();
  // The client the payload names is the one to tell (a retry reads "tell client X", and by then its own post may be
  // answered while another landed). Without one, the post names it: a post the portal no longer has, and no client in
  // the payload either, tells nothing — the same `client` a removed one answers.
  const [jobPost] = named
    ? [{ client: named, status: null }]
    : await deps.db
        .select({ client: portalPosts.client, status: portalPosts.status })
        .from(portalPosts)
        .where(and(eq(portalPosts.orgId, orgId), eq(portalPosts.id, postId)));
  const clientId = jobPost?.client;
  if (!clientId) return { sent: 0, skipped: "client" };
  // The job's own post is past deciding (answered, scheduled, published) and it names no client of its own: what it
  // was queued for is over. A retry that names its client is never this one: what it gathers is what waits now.
  if (!named && !(WAITING_STATUSES as readonly string[]).includes(jobPost?.status ?? "")) {
    return { sent: 0, skipped: "answered" };
  }
  // A workspace closed to work (suspended, being deleted, on a hold) tells its clients nothing (standing.ts): its page
  // doesn't open either, so a notice saying a post is there would ask for something the workspace refuses.
  const [standing] = await deps.db.select(STANDING_COLUMNS).from(organizations).where(eq(organizations.id, orgId));
  if (workRefusal(standing ?? undefined)) return { sent: 0, skipped: "closed" };
  const client = await clientOfPost(deps.db, orgId, clientId);
  if (!client) return { sent: 0, skipped: "client" };
  const url = await clientLinkUrl(deps.db, deps.publicUrl, deps.secret, client.id);
  // No live link: the client's page wouldn't open, so a notice saying it is there helps no one (ADR doug-0031 §4).
  if (!url) return { sent: 0, skipped: "link" };
  const waiting = await waitingPosts(deps.db, orgId, clientId);
  // What this notice gathers: every post of the client waiting now whose own version is past the one it was told of —
  // the job's own post and whatever landed meanwhile, one message for the hour, and a v2 after an adjustment is past
  // its v1. Each post's wait is read from its own row, never from the version a job carried when it was queued.
  const fresh: { id: string; title: string; version: number }[] = [];
  for (const p of waiting) {
    if (p.version > (await toldVersionOf(deps.db, orgId, clientId, p.id))) {
      fresh.push({ id: p.id, title: p.title, version: p.version });
    }
  }
  if (fresh.length === 0) return { sent: 0, skipped: "none" };
  const posts = fresh.map((p) => ({ title: p.title, version: p.version }));
  const group = portalNoticeWindow(now);
  // The number and the language are read before the lock: they don't change what "this client's notice for this hour"
  // is, and every way this one goes is decided inside it.
  const number = deps.whatsapp?.gateway ? await chosenNumber(deps.db, orgId) : null;
  // The client's own language (or its workspace owner's), never one guessed from a name.
  const locale = await portalClientLocale(deps.db, orgId, client);
  const payload = (contact: { id: string; email: string | null; whatsapp: string | null }) => {
    const out: { email?: { to: string; key: string }; whatsapp?: { to: string; text: string } } = {};
    if (deps.email && contact.email) {
      // The client, the hour's window, the contact, and which post versions it names: a repeat of the same notice adds
      // nothing, while a new version of a post inside the window (the client asked a change, the team redid it) is a
      // notice of its own — the rule the ADR states, `posts[]` and all.
      out.email = {
        to: contact.email,
        key: `portal-notice:${clientId}:${group.toISOString()}:${contact.id}:${fresh.map((p) => `${p.id}v${p.version}`).join("+")}`,
      };
    }
    if (deps.whatsapp?.gateway && number && contact.whatsapp) {
      const title = posts[0]?.title ?? "";
      const more = posts.length > 1 ? ` (+${posts.length - 1})` : "";
      out.whatsapp = {
        to: whatsappJidOf(contact.whatsapp),
        text:
          locale === "pt-BR"
            ? `Oi! Tem uma publicação do ${client.name} esperando o seu OK:\n${title}${more}\n${url}`
            : `Hi! A ${client.name} post is waiting for your OK:\n${title}${more}\n${url}`,
      };
    }
    return out;
  };
  // One notice an hour for a client, and one at a time across every process: a transaction-scoped advisory lock named
  // by the workspace and the client, taken before the hour is read and kept until what went out is written. Two
  // `portal.notify` jobs that arrive together (a send and a new version, or a retry and a send) line up instead of both
  // reading "no notice in the last hour" and both telling the client. Everything a database holds is written inside
  // the lock; the texts go after it commits, so no lock is held over the network.
  const owed = onlyContacts?.length ? new Set(onlyContacts) : null;
  const settled = await deps.db.transaction(async (tx) => {
    await tx.execute(sql`select pg_advisory_xact_lock(hashtext(${`portal-notice:${orgId}:${clientId}`}))`);
    // How recent the client's last notice is, read under the lock: the job that comes second sees the first's rows and
    // holds, where one that read before it would have told the client a second time. A retry for the contacts whose
    // text didn't go is this same notice finishing: the hour is its own and is not read again.
    const last = owed ? null : await lastNoticeAt(tx, orgId, clientId);
    if (last && now.getTime() - last.getTime() < PORTAL_NOTICE_GROUP_MS) {
      const retryAt = new Date(last.getTime() + PORTAL_NOTICE_GROUP_MS);
      return { result: { sent: 0, skipped: "recent", retryAt, client: clientId } as PortalNoticeResult, texts: [] };
    }
    const texts: { contactId: string; to: string; text: string; noticeIds: string[] }[] = [];
    let sent = 0;
    for (const contact of client.contacts) {
      // A retry for the contacts whose text is owed tells them alone: the e-mail of everyone else's notice already
      // went, and the rows it wrote are what the hour reads.
      if (owed && !owed.has(contact.id)) continue;
      const ways = payload(contact);
      if (ways.email) {
        try {
          await queueEmail(tx, {
            orgId,
            key: ways.email.key,
            to: [ways.email.to],
            template: { kind: "portal_ready", locale, clientName: client.name, posts, url },
          });
          for (const p of fresh) {
            await recordPortalNotice(tx, orgId, {
              client: clientId,
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
      if (ways.whatsapp && number) {
        // The rows go in now, under the lock, so the hour counts a text the moment it is decided; a text that can't be
        // sent takes them back out (`after`, below), and the client still has the page and the e-mail.
        const noticeIds: string[] = [];
        for (const p of fresh) {
          noticeIds.push(
            ...(await recordPortalNotice(tx, orgId, {
              client: clientId,
              channel: "whatsapp",
              contactId: contact.id,
              postId: p.id,
              version: p.version,
              at: now,
            })),
          );
        }
        texts.push({ contactId: contact.id, to: ways.whatsapp.to, text: ways.whatsapp.text, noticeIds });
        sent++;
      }
    }
    return { result: { sent, skipped: sent === 0 ? "none" : null } as PortalNoticeResult, texts };
  });
  // The texts, once the hour is theirs: a number that may not start another conversation today leaves the notice for
  // the client's page, and the rows it would have written are taken back out, so it never reads as told by WhatsApp.
  let sent = settled.result.sent;
  const pending: string[] = [];
  for (const text of settled.texts) {
    try {
      await deliverWhatsAppText(
        {
          db: deps.db,
          gateway: deps.whatsapp?.gateway ?? null,
          keyWrappers: deps.whatsapp?.keyWrappers ?? [],
          pubsub: deps.whatsapp?.pubsub,
          hookBase: deps.whatsapp?.hookBase ?? "",
        },
        number as WhatsAppAccountRow,
        { to: text.to, text: text.text },
      );
    } catch (error) {
      sent--;
      // Exactly the rows this text's decision wrote: a text that never left reads as never written, and the hour it
      // would have taken is another notice's.
      if (text.noticeIds.length)
        await deps.db
          .delete(portalNotices)
          .where(and(eq(portalNotices.orgId, orgId), inArray(portalNotices.id, text.noticeIds)))
          .catch(() => undefined);
      pending.push(text.contactId);
      deps.log?.warn("approval portal: a client's WhatsApp notice could not be sent", { postId, error: String(error) });
    }
  }
  // Nothing reached anyone while the notice had ways to go: the gateway is down, or refuses this number, and no
  // contact had an address either. Every row this notice wrote was taken back out above, so the outbox's retry finds
  // the client exactly as it was before: the same posts, no notice recorded, and the whole notice goes again with
  // backoff. A notice where something did go is `done`, and whatever text is owed goes by the retry `jobs.ts` queues.
  if (pending.length > 0 && sent === 0 && settled.texts.length > 0) {
    throw new PortalTextsUnsent(pending.length);
  }
  return {
    ...settled.result,
    sent,
    ...(pending.length > 0 ? { pending } : {}),
    skipped: sent === 0 && settled.result.skipped === null ? "none" : settled.result.skipped,
  };
}

/**
 * Every text of a notice failed, while there were texts to send: a transient gateway (or a number that went away
 * between the lock and the send), never one contact's own. Thrown out of `announcePortalPost` so the job fails and
 * retries with backoff; the e-mail it queued is kept by its outbox key, so the retry tells the client once.
 */
export class PortalTextsUnsent extends Error {
  constructor(readonly failed: number) {
    super(`none of the ${failed} WhatsApp notices could be sent`);
    this.name = "PortalTextsUnsent";
  }
}

/**
 * The job a send enqueues: `postId:version`, the key the ADR names, so the same version never tells twice. A v2 names
 * another one, so a post sent back and redone tells again.
 */
export const portalNotifyPostKey = (postId: string, version: number) => `portal.notify:${postId}:v${version}`;

/**
 * The key a notice swept back into the queue carries (`queuePortalNoticesFor`): the post, its version, and the moment
 * the sweep ran, so a sweep never collides with the notice a send already left (`portalNotifyPostKey`, which that row
 * of the outbox still holds as `done`/`failed`) nor with an earlier sweep. Nothing else reads it: a retry for the
 * hour is still keyed by the client (`portal.notify:retry:<client>:<at>`, `jobs.ts`).
 */
export const portalNotifyResumeKey = (postId: string, version: number, at: Date) =>
  `portal.notify:resume:${postId}:v${version}:${at.toISOString()}`;

/**
 * When a workspace that was closed to work can work again, when a client gets a link again, or when the sweep runs for
 * any other reason: every post of its clients that waits there and that they were never told of gets a `portal.notify`
 * queued, so a hold that ended (or a link that was missing) doesn't leave a client's posts silent — a notice that fell
 * on a hold answered `skipped: "closed"`, one that fell on a stale link `skipped: "link"`, and nothing else would ever
 * name either again.
 *
 * Read from `portal_notices`, which is what fresh means: a post whose waiting version is past the last one recorded
 * is one nobody was told of. The key names the moment of the sweep (`portalNotifyResumeKey`), never the send's own
 * `postId:version`: that row is still in the outbox as `done`, and its dedupe key would swallow the sweep's job; a
 * sweep is safe to repeat because `announcePortalPost` is idempotent per post version (`portal_notices`). Answers how
 * many jobs were queued.
 */
export async function queuePortalNoticesFor(db: Database, orgId: string, now: Date = new Date()): Promise<number> {
  const waiting = await db
    .select({
      id: portalPosts.id,
      client: portalPosts.client,
      version: portalPosts.version,
      notified: sql<number>`(
        select max(${portalNotices.version}) from ${portalNotices}
        where ${portalNotices.orgId} = ${orgId}
          and ${portalNotices.client} = ${portalPosts.client}
          and ${portalNotices.postId} = ${portalPosts.id}
      )`,
    })
    .from(portalPosts)
    .where(and(eq(portalPosts.orgId, orgId), waitingSql));
  let queued = 0;
  for (const post of waiting) {
    if (post.version <= (post.notified ?? 0)) continue;
    // Counted only when the row is really written: the same sweep run twice for the same moment takes the first
    // row and writes no second (`enqueue` answers false), and a sweep again at another moment is a notice by
    // `announcePortalPost`'s own per-version check.
    const written = await enqueue(db, {
      orgId,
      kind: PORTAL_NOTIFY_JOB,
      payload: { postId: post.id, version: post.version, client: post.client, resumed: true },
      dedupeKey: portalNotifyResumeKey(post.id, post.version, now),
    });
    if (written) queued++;
  }
  return queued;
}

/** The window of an hour `at` belongs to: the notice one client's sends inside it become. */
export const portalNoticeWindow = (at: Date) =>
  new Date(Math.floor(at.getTime() / PORTAL_NOTICE_GROUP_MS) * PORTAL_NOTICE_GROUP_MS);

/** Where a client's notice for a window begins: the `at` of the window, for a test that reads the rows back. */
export const portalNoticeWindowKey = (client: string, at: Date) => `${client}:${portalNoticeWindow(at).toISOString()}`;
