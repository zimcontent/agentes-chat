import { timingSafeEqual } from "node:crypto";
import type { BlobStore, PortalClientColor, PortalStatus, PortalType } from "@agenteschat/adapters";
import { PORTAL_CLIENT_COLORS, StorageError } from "@agenteschat/adapters";
import type { Database } from "@agenteschat/db";
import { and, asc, desc, eq, inArray, isNull, schema, sql } from "@agenteschat/db";
import { isAppLocale, LOCALE_CODES } from "@agenteschat/i18n/locale";
import { recordAudit } from "./audit";
import { portalClientToken, sha256 } from "./crypto";
import { ConflictError, ForbiddenError, NotFoundError, ValidationError } from "./errors";

const { portalClientLinks, portalClients, portalPostFiles, portalPostNotes, portalPosts } = schema;
const { issues } = schema;

/**
 * The clients of the installation's approval portal (docs/adr/doug-0031-embedded-approval-portal.md): each one has a
 * name, its contacts (an e-mail, a WhatsApp number, or both) and a link of its own, `<PUBLIC_URL>/p/<token>`, with
 * no account: the token is the whole of the access, good for one client of one workspace, and the team may revoke it.
 * The page it opens is rendered as its own, never by the app's signed-in routes.
 */

/** The most contacts a client has. */
export const PORTAL_CLIENT_CONTACTS_MAX = 10;
/** The longest name the team may give a client (`setPortalClientName`, ADR 9001's rename), and the one it is made with. */
export const PORTAL_CLIENT_NAME_MAX = 60;
/** A client's own name as it is made here (`upsertPortalClient`): the page's title, not the team's rename. */
export const PORTAL_CLIENT_TITLE_MAX = 80;
export const PORTAL_CONTACT_NAME_MAX = 80;
export const PORTAL_CONTACT_EMAIL_MAX = 200;

/** The client's id as the board, the agents and the address call it by ("acme"). */
export const PORTAL_CLIENT_ID = /^[a-z0-9][a-z0-9-]{0,63}$/;

/** A phone number as the portal writes it: digits only, country code first. */
const PORTAL_PHONE = /^\d{8,15}$/;
const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;

/**
 * The workspace holding the installation's portal: the one with clients, else the one the portal's own tasks already
 * are in (`issues.source` of type `portal`), else the installation's first, as `portalOrgId` (approval-portal-embedded.ts)
 * and `portalHere`/`portalWorkspace` (approval-portal-tasks.ts) answer it. One installation has one portal (ADR 9001
 * §18), so a second workspace on the same server has none of it: no client, no link, no page. The three read the same
 * two sources in the same order, so a client made and a task the watch later makes never name different workspaces.
 */
export async function portalWorkspaceOf(db: Database): Promise<string | null> {
  const [held] = await db.select({ orgId: portalClients.orgId }).from(portalClients).limit(1);
  if (held) return held.orgId;
  const [tasks] = await db
    .select({ orgId: issues.orgId })
    .from(issues)
    .where(sql`${issues.source}->>'type' = 'portal'`)
    .limit(1);
  if (tasks) return tasks.orgId;
  const [first] = await db
    .select({ id: schema.organizations.id })
    .from(schema.organizations)
    .orderBy(asc(schema.organizations.createdAt))
    .limit(1);
  return first?.id ?? null;
}

/**
 * Whether this workspace is the installation's portal (ADR 9001 §18), read from `portalWorkspaceOf`: a client is
 * never made, changed, linked or removed in another. The route and the tool both ask it before their change; a
 * workspace with no portal answers as if the server had none (`portal.off`).
 */
export async function portalBelongsTo(db: Database, orgId: string): Promise<boolean> {
  return (await portalWorkspaceOf(db)) === orgId;
}

export interface PortalContactView {
  id: string;
  name: string;
  email: string | null;
  /** Digits only, country code first. */
  whatsapp: string | null;
}

export interface PortalClientView {
  id: string;
  /** The id the board and the agents call it by. */
  client: string;
  name: string;
  contacts: PortalContactView[];
  color: PortalClientColor | null;
  /** The client's page's own link; null while it has none (revoked), or while its token no longer matches. */
  link: string | null;
  /** When the last link was revoked: the address answers nothing until a new one is made. */
  revoked: boolean;
  /**
   * A live link whose token no longer matches the hash kept with it: `AGENTES_SECRET` changed since it was made. The
   * address opens nothing, so the team has to make a new one (`makeClientLink`); never shown as if it worked.
   */
  linkStale: boolean;
  /**
   * The language the client's notices are written in, one of `LOCALE_CODES`; null: the workspace owner's own
   * (`portalClientLocale`). The client has no account, so the team picks this in Settings.
   */
  locale: string | null;
  createdAt: string;
}

const clientView = async (
  deps: { db: Database; publicUrl: string; secret: string },
  row: typeof portalClients.$inferSelect,
): Promise<PortalClientView> => {
  const last = await lastLink(deps.db, row.id);
  const link = await clientLinkUrl(deps.db, deps.publicUrl, deps.secret, row.id);
  return {
    id: row.id,
    client: row.client,
    name: row.name,
    contacts: row.contacts,
    color: (row.color as PortalClientColor | null) ?? null,
    link,
    revoked: Boolean(last?.revokedAt),
    // An unrevoked link that answers null: its token no longer matches.
    linkStale: Boolean(last && !last.revokedAt && !link),
    locale: row.locale ?? null,
    createdAt: row.createdAt.toISOString(),
  };
};

/** The client's newest link, revoked or not: what `revoked` and `linkStale` are read from. */
const lastLink = async (db: Database, clientId: string) =>
  (
    await db
      .select({ revokedAt: portalClientLinks.revokedAt })
      .from(portalClientLinks)
      .where(eq(portalClientLinks.clientId, clientId))
      .orderBy(desc(portalClientLinks.createdAt))
      .limit(1)
  )[0] ?? null;

/**
 * The address a client's current, unrevoked link opens; null while it has none, or while the token made from the row
 * no longer matches the hash kept with it (`AGENTES_SECRET` changed since). An address that would open nothing is
 * never shown: the team is told to make a new one instead (`PortalClientView.linkStale`).
 */
export async function clientLinkUrl(
  db: Database,
  publicUrl: string,
  secret: string,
  clientId: string,
): Promise<string | null> {
  const [link] = await db
    .select({ id: portalClientLinks.id, tokenHash: portalClientLinks.tokenHash })
    .from(portalClientLinks)
    .where(and(eq(portalClientLinks.clientId, clientId), isNull(portalClientLinks.revokedAt)))
    .orderBy(desc(portalClientLinks.createdAt))
    .limit(1);
  if (!link) return null;
  const token = portalClientToken(secret, link.id);
  // The address is only worth showing while it would open the page: the same test `portalClientOfToken` makes.
  if (sha256(token) !== link.tokenHash) return null;
  return `${publicUrl.replace(/\/+$/, "")}/p/${token}`;
}

function contactOf(input: unknown): PortalContactView {
  const row = (input ?? {}) as Record<string, unknown>;
  const name = typeof row.name === "string" ? row.name.trim().slice(0, PORTAL_CONTACT_NAME_MAX) : "";
  const email = typeof row.email === "string" ? row.email.trim().toLowerCase().slice(0, PORTAL_CONTACT_EMAIL_MAX) : "";
  const whatsapp = typeof row.whatsapp === "string" ? row.whatsapp.replace(/\D/g, "") : "";
  if (!name) throw new ValidationError("Every contact needs a name");
  if (!email && !whatsapp) throw new ValidationError("A contact needs an e-mail address or a WhatsApp number");
  if (email && !EMAIL.test(email)) throw new ValidationError(`"${email}" isn't an e-mail address`);
  if (whatsapp && !PORTAL_PHONE.test(whatsapp)) {
    throw new ValidationError("Type the WhatsApp number with its country code, digits only");
  }
  return {
    // Made here, never taken from the input: two clients can't share a contact's id, and a client's own numbers are
    // what say who a contact is — its name, its address, its number.
    id: Bun.randomUUIDv7(),
    name: name.slice(0, PORTAL_CONTACT_NAME_MAX),
    email: email || null,
    whatsapp: whatsapp || null,
  };
}

/** A colour the apps draw, or null. */
function colorOf(value: unknown): PortalClientColor | null {
  if (value === null || value === undefined || value === "") return null;
  if (typeof value === "string" && (PORTAL_CLIENT_COLORS as readonly string[]).includes(value)) {
    return value as PortalClientColor;
  }
  throw new ValidationError("Pick one of the client's colours");
}

/** A language the client's notices are written in, or null (the workspace owner's own). */
function localeOf(value: unknown): string | null {
  if (value === null || value === undefined || value === "") return null;
  if (typeof value === "string" && isAppLocale(value)) return value;
  throw new ValidationError(`The client's language is one of ${LOCALE_CODES.join(", ")}`);
}

export interface PortalClientInput {
  client?: string;
  name: string;
  contacts?: unknown[];
  color?: unknown;
  locale?: unknown;
}

/** A client's name as an id ("Padaria Aurora" → "padaria-aurora"). */
export function slugOf(name: string): string {
  return name
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 64);
}

/**
 * Makes a client (or changes the one `client` names): a name, the contacts told when a post waits on them, a colour.
 * Who may: the route checks `assign_work` before it calls here, and the workspace must be the portal's own
 * (`portalBelongsTo`), so a second business on the same server never gets clients or their links. A new client starts
 * with a link, so the team has one to send the moment the client is there. `contacts` is written only when the input
 * carries it, so a change to the name or the colour alone keeps them as they are.
 */
export async function upsertPortalClient(
  deps: { db: Database; publicUrl: string; secret: string },
  orgId: string,
  input: PortalClientInput,
  by: string | null,
): Promise<PortalClientView> {
  const db = deps.db;
  if (!(await portalBelongsTo(db, orgId))) {
    throw new ForbiddenError("This workspace doesn't have the approval portal", "portal.off");
  }
  const client = (input.client?.trim() || slugOf(input.name ?? "")).trim();
  if (!PORTAL_CLIENT_ID.test(client)) {
    throw new ValidationError("The client's id is lowercase letters, digits and hyphens (up to 64)");
  }
  const name = (input.name ?? "").trim().slice(0, PORTAL_CLIENT_TITLE_MAX);
  if (!name) throw new ValidationError("Give the client a name");
  const contacts = (input.contacts ?? []).slice(0, PORTAL_CLIENT_CONTACTS_MAX).map(contactOf);
  const color = colorOf(input.color);
  const locale = localeOf(input.locale);
  const [existing] = await db
    .select()
    .from(portalClients)
    .where(and(eq(portalClients.orgId, orgId), eq(portalClients.client, client)));
  if (existing) {
    const [row] = await db
      .update(portalClients)
      .set({
        name,
        ...(input.contacts !== undefined ? { contacts } : {}),
        ...(input.color !== undefined ? { color } : {}),
        ...(input.locale !== undefined ? { locale } : {}),
        updatedAt: new Date(),
      })
      .where(eq(portalClients.id, existing.id))
      .returning();
    if (!row) throw new NotFoundError("Client not found");
    return clientView(deps, row);
  }
  if (!by) throw new ForbiddenError("A person makes the team's clients");
  const [row] = await db
    .insert(portalClients)
    .values({ orgId, client, name, contacts, color, locale, createdBy: by })
    .returning();
  if (!row) throw new ValidationError("The client could not be made");
  await makeClientLink(deps, orgId, row.id, by);
  return clientView(deps, row);
}

/**
 * Makes a new link for a client, revoking the one before: the address it derived from answers nothing from then on.
 * Only the token's hash is kept (`tokenHash`), so the address can be shown again from the row's id and no copy of the
 * token sits in the database. A new `AGENTES_SECRET` gives every link a token that no longer matches.
 */
export async function makeClientLink(
  deps: { db: Database; publicUrl: string; secret: string },
  orgId: string,
  clientId: string,
  by: string | null,
): Promise<string> {
  const db = deps.db;
  if (!(await portalBelongsTo(db, orgId))) {
    throw new ForbiddenError("This workspace doesn't have the approval portal", "portal.off");
  }
  await db
    .update(portalClientLinks)
    .set({ revokedAt: new Date() })
    .where(
      and(
        eq(portalClientLinks.orgId, orgId),
        eq(portalClientLinks.clientId, clientId),
        isNull(portalClientLinks.revokedAt),
      ),
    );
  const id = Bun.randomUUIDv7();
  const token = portalClientToken(deps.secret, id);
  await db.insert(portalClientLinks).values({ id, orgId, clientId, tokenHash: sha256(token), createdBy: by });
  // A client with no link was told nothing (a notice answers `skipped: "link"`, and nothing else would name it again):
  // the posts waiting on it now, that nobody was told of, get their `portal.notify` queued as the new link is made.
  // Loaded here: `portal-notices` imports this module's `clientLinkUrl`.
  const { queuePortalNoticesFor } = await import("./portal-notices");
  await queuePortalNoticesFor(db, orgId).catch(() => {});
  return `${deps.publicUrl.replace(/\/+$/, "")}/p/${token}`;
}

/** Revokes a client's link (by the client's id, "acme"): the address answers nothing until a new one is made. */
export async function revokeClientLink(deps: { db: Database }, orgId: string, client: string) {
  if (!(await portalBelongsTo(deps.db, orgId))) {
    throw new ForbiddenError("This workspace doesn't have the approval portal", "portal.off");
  }
  const found = await getPortalClient(deps.db, orgId, client);
  if (!found) return;
  await deps.db
    .update(portalClientLinks)
    .set({ revokedAt: new Date() })
    .where(
      and(
        eq(portalClientLinks.orgId, orgId),
        eq(portalClientLinks.clientId, found.id),
        isNull(portalClientLinks.revokedAt),
      ),
    );
}

/**
 * Every client of the workspace, with the address of each one's link (members read it). Another workspace on the same
 * server has none: the portal is one operation's (ADR 9001 §18).
 */
export async function listPortalClients(
  deps: { db: Database; publicUrl: string; secret: string },
  orgId: string,
): Promise<PortalClientView[]> {
  if (!(await portalBelongsTo(deps.db, orgId))) return [];
  const rows = await deps.db
    .select()
    .from(portalClients)
    .where(eq(portalClients.orgId, orgId))
    .orderBy(asc(portalClients.createdAt));
  return Promise.all(rows.map((row) => clientView(deps, row)));
}

/**
 * How often a link's `last_used_at` is written: a page's opening, a decision and each of its files all go by the same
 * token, so a phone playing a video would otherwise write a row per second. Five minutes is enough to see a link in
 * use, and never more than one write per link in that window.
 */
export const PORTAL_LINK_TOUCH_MS = 5 * 60_000;

/**
 * The client behind a link's token, or null while the token names none (or the link was revoked). Opening it marks
 * the link as used (`last_used_at`), at most once each `PORTAL_LINK_TOUCH_MS`: best effort, a failure says nothing about
 * the page's own answer.
 *
 * The token is checked twice: its hash names the row, and the token the row's own id derives from this server's secret
 * (`portalClientToken(secret, linkId)`) has to be the one presented. The hash alone would keep a link good whatever the
 * secret became, and changing `AGENTES_SECRET` has to invalidate every link made under the old one — the same answer
 * `clientLinkUrl` gives the team's list, never a page a secret meant to close still opens.
 */
export async function portalClientOfToken(db: Database, token: string, secret: string) {
  const [row] = await db
    .select({
      linkId: portalClientLinks.id,
      tokenHash: portalClientLinks.tokenHash,
      lastUsedAt: portalClientLinks.lastUsedAt,
      orgId: portalClients.orgId,
      id: portalClients.id,
      client: portalClients.client,
      name: portalClients.name,
      logo: portalClients.logo,
      contacts: portalClients.contacts,
    })
    .from(portalClientLinks)
    .innerJoin(portalClients, eq(portalClients.id, portalClientLinks.clientId))
    .where(and(eq(portalClientLinks.tokenHash, sha256(token)), isNull(portalClientLinks.revokedAt)));
  if (!row) return null;
  // The row's hash named it; the secret has to make the same token, or the link is from another secret's time.
  const derived = portalClientToken(secret, row.linkId);
  const same = derived.length === token.length && timingSafeEqual(Buffer.from(derived), Buffer.from(token));
  if (!same) return null;
  const now = new Date();
  if (!row.lastUsedAt || now.getTime() - row.lastUsedAt.getTime() >= PORTAL_LINK_TOUCH_MS) {
    await db.update(portalClientLinks).set({ lastUsedAt: now }).where(eq(portalClientLinks.id, row.linkId));
  }
  return row;
}

/** Removes a client with its links: its posts stay, for the team, but no page shows it. */
export async function removePortalClient(db: Database, orgId: string, client: string) {
  if (!(await portalBelongsTo(db, orgId))) {
    throw new ForbiddenError("This workspace doesn't have the approval portal", "portal.off");
  }
  await db.delete(portalClients).where(and(eq(portalClients.orgId, orgId), eq(portalClients.client, client)));
}

/** A client named by its id (`client`), when this workspace has it. */
export async function getPortalClient(db: Database, orgId: string, client: string) {
  const [row] = await db
    .select()
    .from(portalClients)
    .where(and(eq(portalClients.orgId, orgId), eq(portalClients.client, client)));
  return row ?? null;
}

// ---------- the client's own page ----------

/** A post as its client reads it: nothing of the team's own, only what they approve. */
export interface ClientPortalPost {
  id: string;
  title: string;
  type: PortalType;
  status: PortalStatus;
  caption: string;
  version: number;
  /** A video plays; pictures are a carousel or a single image. */
  video: boolean;
  /** Each file's id and kind, in order: `/p/api/<token>/files/<id>`. */
  media: { id: string; kind: "video" | "image" | "file"; name: string }[];
  /** A reel's cover, for the picture shown before it plays. */
  cover: string | null;
  /** What the client wrote on it, oldest first. */
  notes: {
    id: string;
    atSeconds: number | null;
    page: number | null;
    x: number | null;
    y: number | null;
    text: string;
    by: string | null;
    at: string;
    kind: "approve" | "adjust" | null;
  }[];
  scheduledFor: string | null;
  publishedAt: string | null;
  postUrl: string | null;
  updatedAt: string;
}

export interface ClientPortalPage {
  client: { client: string; name: string; logo: string | null };
  /** What waits on the client: sent, seen, or its new version sent. */
  waiting: ClientPortalPost[];
  /** What the client already decided, and what went out. */
  history: ClientPortalPost[];
}

/** The statuses that are the client's to decide (`sent`, `seen`, or its new version's `adjusted`). */
const WAITING: readonly PortalStatus[] = ["sent", "seen", "adjusted"];

export const portalWaitingOnClient = (status: string) => WAITING.includes(status as PortalStatus);

/**
 * The client's page, read from its link's token: the posts waiting on it and the history. Nothing of the workspace is
 * named but its client's logo, and every file is read through the same token (`clientPortalFile`). Opening the page
 * marks the posts waiting on it `seen`, once.
 */
export async function clientPortalPage(
  db: Database,
  clientRow: { orgId: string; client: string; name: string; logo: string | null },
  markSeen: boolean,
): Promise<ClientPortalPage> {
  const posts = await db
    .select()
    .from(portalPosts)
    .where(and(eq(portalPosts.orgId, clientRow.orgId), eq(portalPosts.client, clientRow.client)))
    .orderBy(desc(portalPosts.updatedAt));
  const ids = posts.map((p) => p.id);
  const files = ids.length
    ? await db
        .select()
        .from(portalPostFiles)
        .where(and(eq(portalPostFiles.orgId, clientRow.orgId), inArray(portalPostFiles.postId, ids)))
        .orderBy(asc(portalPostFiles.version), asc(portalPostFiles.role), asc(portalPostFiles.position))
    : [];
  const notes = ids.length
    ? await db
        .select()
        .from(portalPostNotes)
        .where(and(eq(portalPostNotes.orgId, clientRow.orgId), inArray(portalPostNotes.postId, ids)))
        .orderBy(asc(portalPostNotes.at))
    : [];
  const seen: string[] = [];
  const postOf = (post: typeof portalPosts.$inferSelect): ClientPortalPost => {
    const mine = files.filter((f) => f.postId === post.id && f.version === post.version);
    // Opening the page marks a post waiting on the client as seen, once: the page reads it that way from then on.
    const status = markSeen && post.status === "sent" ? "seen" : post.status;
    if (status === "seen" && post.status === "sent") seen.push(post.id);
    return {
      id: post.id,
      title: post.title,
      type: post.type,
      status,
      caption: post.caption,
      version: post.version,
      video: post.video,
      media: mine
        .filter((f) => f.role === "media")
        .map((f) => ({
          id: f.id,
          kind: f.contentType.startsWith("video/") ? "video" : f.contentType.startsWith("image/") ? "image" : "file",
          name: f.name,
        })),
      cover: mine.find((f) => f.role === "cover")?.id ?? null,
      notes: notes
        .filter((n) => n.postId === post.id)
        .map((n) => ({
          id: n.id,
          atSeconds: n.atSeconds,
          page: n.page,
          x: n.x,
          y: n.y,
          text: n.text,
          by: n.by,
          at: n.at.toISOString(),
          kind: n.kind,
        })),
      scheduledFor: post.scheduledFor?.toISOString() ?? null,
      publishedAt: post.publishedAt?.toISOString() ?? null,
      postUrl: post.postUrl,
      updatedAt: post.updatedAt.toISOString(),
    };
  };
  const shown = posts.map(postOf);
  if (markSeen && seen.length > 0) {
    await db
      .update(portalPosts)
      .set({ status: "seen", seenAt: new Date(), updatedAt: new Date() })
      .where(
        and(eq(portalPosts.orgId, clientRow.orgId), inArray(portalPosts.id, seen), eq(portalPosts.status, "sent")),
      );
  }
  return {
    client: { client: clientRow.client, name: clientRow.name, logo: clientRow.logo },
    waiting: shown.filter((p) => WAITING.includes(p.status)),
    history: shown.filter((p) => !WAITING.includes(p.status)),
  };
}

export interface ClientDecision {
  postId: string;
  decision: "approve" | "adjust";
  /**
   * The version of the post the client had on screen. A decision is about what the client saw: when the post moved
   * on meanwhile (a new version went up while the page was open), the decision is refused with
   * `portal.version_changed` (409) and the page asks the client to reload, instead of approving work they never saw.
   */
  version?: number;
  /** What they wrote: an approval's note, or the change asked. */
  text?: string;
  /** Where in a video, in seconds; null: not a point in time. */
  atSeconds?: number | null;
  /** A carousel's slide, from 1; null: none. */
  page?: number | null;
  x?: number | null;
  y?: number | null;
  /** The contact's name, as the team reads it. */
  by?: string | null;
}

/** The most a client's note holds. */
export const CLIENT_NOTE_MAX = 4000;

/**
 * The client's decision through the link's token (docs/adr/doug-0031-embedded-approval-portal.md): an approval, or a
 * change asked (a note, maybe with a second of a video or a spot of a slide). Only a post waiting on this client takes
 * one, and only once: it turns `approved` or `adjust_requested`, and the workspace's own watch reads the change (and
 * the note) and carries them to the team's card and task, to whoever has the work, and to an agent that starts on it.
 *
 * The status moves by one statement that only touches a post still waiting on the client (`UPDATE … WHERE status IN
 * (…) RETURNING`), so two decisions at once — a double tap, a retried request — never both go through: the first turns
 * the post, the note is inserted only then, and the other finds no row and gets the same `portal.already_answered` a
 * second decision gets. The two happen in one transaction, so a note is never kept for a decision the row refused.
 */
export async function clientDecision(
  deps: { db: Database; wake?: () => void },
  clientRow: { orgId: string; client: string },
  input: ClientDecision,
): Promise<{ status: PortalStatus; version: number }> {
  const db = deps.db;
  const [post] = await db
    .select({ id: portalPosts.id, version: portalPosts.version })
    .from(portalPosts)
    .where(
      and(
        eq(portalPosts.orgId, clientRow.orgId),
        eq(portalPosts.client, clientRow.client),
        eq(portalPosts.id, input.postId),
      ),
    );
  if (!post) throw new NotFoundError("Post not found");
  // The client decides on what they saw: a version that moved on since (a new one went up while the page was open) is
  // refused, and the page asks them to look again, rather than approving a version nobody read.
  if (typeof input.version === "number" && input.version !== post.version) {
    throw new ConflictError("This post has a new version: reload the page", "portal.version_changed");
  }
  const text = (input.text ?? "").trim().slice(0, CLIENT_NOTE_MAX);
  if (input.decision === "adjust" && !text) throw new ValidationError("Tell us what to change");
  const fraction = (v: number | null | undefined) =>
    typeof v === "number" && Number.isFinite(v) ? Math.min(1, Math.max(0, v)) : null;
  const atSeconds =
    typeof input.atSeconds === "number" && Number.isFinite(input.atSeconds) ? Math.max(0, input.atSeconds) : null;
  const page = typeof input.page === "number" && Number.isInteger(input.page) ? Math.min(1000, input.page) : null;
  const status: PortalStatus = input.decision === "approve" ? "approved" : "adjust_requested";
  const version = post.version;
  await db.transaction(async (tx) => {
    const [turned] = await tx
      .update(portalPosts)
      .set({ status, updatedAt: new Date() })
      // The version is part of the statement, not only of the read above: a new version that went up between the read
      // and this write leaves the row unturned, so a decision on V1 never lands on the V2 a client hasn't seen.
      .where(
        and(eq(portalPosts.id, post.id), eq(portalPosts.version, post.version), inArray(portalPosts.status, WAITING)),
      )
      .returning({ version: portalPosts.version });
    // The post left the client's hands meanwhile (another decision, a new version, or the team's answer): the same
    // refusal a second decision gets, and nothing is written on it.
    if (!turned) throw new ConflictError("This post was already answered", "portal.already_answered");
    await tx.insert(portalPostNotes).values({
      orgId: clientRow.orgId,
      postId: post.id,
      version: turned.version,
      atSeconds,
      page,
      x: fraction(input.x),
      y: fraction(input.y),
      text,
      by: (input.by ?? null)?.slice(0, 120) || null,
      kind: input.decision,
    });
  });
  // The workspace's watch (`portalTasksTick`) sees the change and carries it on: the card's task follows, whoever has
  // it is told, and an agent starts on the change at once.
  deps.wake?.();
  return { status, version };
}

/** A post's file by its id, for the workspace's own routes (the token's client reads it through `clientPortalFile`). */
export async function portalFile(
  deps: { db: Database; blobs: BlobStore },
  orgId: string,
  fileId: string,
): Promise<{ body: Uint8Array; contentType: string; name: string } | null> {
  const [row] = await deps.db
    .select()
    .from(portalPostFiles)
    .where(and(eq(portalPostFiles.orgId, orgId), eq(portalPostFiles.id, fileId)));
  if (!row) return null;
  const object = await deps.blobs.get(row.blobKey);
  if (!object) return null;
  return { body: object.body, contentType: row.contentType, name: row.name };
}

/** A post's file for the client's own page: the token's client owns the post it belongs to, and nothing else. */
export async function clientPortalFile(
  deps: { db: Database; blobs: BlobStore },
  clientRow: { orgId: string; client: string },
  fileId: string,
) {
  const [row] = await deps.db
    .select({ file: portalPostFiles })
    .from(portalPostFiles)
    .innerJoin(portalPosts, eq(portalPosts.id, portalPostFiles.postId))
    .where(
      and(
        eq(portalPostFiles.orgId, clientRow.orgId),
        eq(portalPostFiles.id, fileId),
        eq(portalPosts.client, clientRow.client),
      ),
    );
  if (!row) return null;
  const object = await deps.blobs.get(row.file.blobKey);
  if (!object) return null;
  return { body: object.body, contentType: row.file.contentType, name: row.file.name };
}

/** What a client's file route answers with: the bytes, the file's own words, its size, and the part when a `Range` asked. */
export interface ClientPortalFileRead {
  body: Uint8Array;
  contentType: string;
  name: string;
  /** The file's whole length, for the `Content-Range` the answer carries. */
  size: number;
  /** The part read, when a `Range` asked for one; null: the whole file. */
  part: { start: number; end: number } | null;
}

/**
 * The most one `bytes=` read answers with (`8 MiB`): a player's jump reads a chunk, never an hour of video at once.
 * An open range (`bytes=0-`) is that chunk, so a store that reads parts is never asked for a whole long file.
 */
export const PORTAL_FILE_RANGE_BYTES = 8 * 1024 * 1024;

/**
 * A post's file through the token's client, read whole or just the part a `Range` asks for: a store that can read a
 * part without the whole of it in memory (`getRange`: S3, the disk) is asked for only those bytes, and one that only
 * reads whole ones answers the slice, as `rangedResponse` made before. A range off the end of the file is `"bad"`
 * (`416`, with `bytes *` and the file's size in `Content-Range`), not a read; a multi-range header is ignored (the
 * whole file, `200`), as the RFC lets a server do. An open range (`bytes=0-`) ends after `PORTAL_FILE_RANGE_BYTES`.
 * The file must belong to the token's client's post, as `clientPortalFile` asks.
 */
export async function clientPortalFileRange(
  deps: { db: Database; blobs: BlobStore },
  clientRow: { orgId: string; client: string },
  fileId: string,
  range: string | undefined,
): Promise<ClientPortalFileRead | "bad" | null> {
  const [row] = await deps.db
    .select({ file: portalPostFiles })
    .from(portalPostFiles)
    .innerJoin(portalPosts, eq(portalPosts.id, portalPostFiles.postId))
    .where(
      and(
        eq(portalPostFiles.orgId, clientRow.orgId),
        eq(portalPostFiles.id, fileId),
        eq(portalPosts.client, clientRow.client),
      ),
    );
  if (!row) return null;
  const part = rangePart(range, row.file.size);
  if (part === "bad") return "bad";
  const base = { contentType: row.file.contentType, name: row.file.name };
  if (!part) {
    const whole = await deps.blobs.get(row.file.blobKey);
    return whole ? { ...base, body: whole.body, size: whole.body.length, part: null } : null;
  }
  if (deps.blobs.getRange) {
    // A bucket that refuses the part (its own `416`) read the file as still being what it was when the row was
    // written: the client is answered the `416` that part is, never a store's failure as an unexpected error.
    const read = await deps.blobs.getRange(row.file.blobKey, part.start, part.end).catch((error: unknown) => {
      if (error instanceof StorageError && error.code === "range_not_satisfiable") return "bad" as const;
      throw error;
    });
    if (read === "bad") return "bad";
    return read ? { ...base, body: read.body, size: read.total, part } : null;
  }
  const whole = await deps.blobs.get(row.file.blobKey);
  if (!whole) return null;
  return { ...base, body: whole.body.subarray(part.start, part.end + 1), size: whole.body.length, part };
}

/** A file's size, for the `Content-Range` a `416` carries: the row's own count, out of any read. */
export async function clientPortalFileSize(
  db: Database,
  clientRow: { orgId: string; client: string },
  fileId: string,
): Promise<number | null> {
  const [row] = await db
    .select({ size: portalPostFiles.size })
    .from(portalPostFiles)
    .innerJoin(portalPosts, eq(portalPosts.id, portalPostFiles.postId))
    .where(
      and(
        eq(portalPostFiles.orgId, clientRow.orgId),
        eq(portalPostFiles.id, fileId),
        eq(portalPosts.client, clientRow.client),
      ),
    );
  return row?.size ?? null;
}

/**
 * A `Range` header against a file's size: the part, null (the whole file), or `"bad"` for a part off the end of it
 * (a `416`, whose `Content-Range` reads `bytes *` and then the size).
 *
 * Anything the server doesn't understand is ignored and the whole file answered (`200`), as RFC 9110 lets it: a unit
 * that isn't `bytes` (`items=0-5`), a header with no numbers in it (`bytes=`, `bytes=-`), a multi-range one
 * (`bytes=0-1,4-5`: one part would answer something else than was asked), and a range that ends before it starts
 * (`bytes=5-2`: no bytes can be taken from it). A part past the file's end is the `bad` a `416` answers. An open range
 * (`bytes=0-`) and a suffix one (`bytes=-N`) end at most `PORTAL_FILE_RANGE_BYTES` past the start the range names.
 */
export function rangePart(header: string | undefined, size: number): { start: number; end: number } | "bad" | null {
  if (!header) return null;
  // A multi-range header is ignored: the RFC 9110 lets a server answer the whole representation, and one part would
  // silently answer something the caller didn't ask for.
  if (header.includes(",")) return null;
  const match = /^bytes=(\d*)-(\d*)$/.exec(header.trim());
  // Another unit, or nothing a range can be made of: no range at all, and the whole file.
  if (!match) return null;
  if (!match[1] && !match[2]) return null;
  const last = size - 1;
  // `bytes=-N`: the last N bytes, as many as the file has (a suffix range asks for its own length and is never
  // shortened by the cap the way an open one is).
  if (!match[1]) {
    const wanted = Number(match[2]);
    if (!Number.isInteger(wanted) || wanted <= 0) return null;
    if (size === 0) return "bad";
    return { start: Math.max(0, size - wanted), end: last };
  }
  const start = Number(match[1]);
  if (!Number.isInteger(start)) return null;
  // A closed range that ends before it starts takes nothing from the file: ignored as one the server doesn't make
  // sense of, never the `416` a part past the end gets.
  if (match[2] !== "" && Number(match[2]) < start) return null;
  if (start >= size) return "bad";
  // An open range (`bytes=0-`) is one read's cap; a closed one keeps what it asks, up to its own cap as well.
  const asked = match[2] === "" ? Number.POSITIVE_INFINITY : Number(match[2]);
  const end = Math.min(asked, start + PORTAL_FILE_RANGE_BYTES - 1, last);
  return { start, end };
}

// ---------- how the team knows a client ----------

const { portalClientSettings } = schema;

/*
 * How the team knows each of the approval portal's clients on this side (ADR 9001, addendum 2026-11-18). The portal
 * names a client by its slug and has no call to rename, create or delete one, so the name the team shows and whether
 * the team still wants the client in its lists are kept here, per workspace and client, on the row that already says
 * what an approval means for it (`portal_client_settings`). A hidden client leaves every list and count of the apps;
 * nothing at the portal changes, and showing it again brings everything back as it was.
 */

export interface PortalClientNaming {
  /** The team's name for each client that has one. */
  names: Map<string, string>;
  /** The clients the team hid. */
  hidden: Set<string>;
}

export async function portalClientNaming(db: Database, orgId: string): Promise<PortalClientNaming> {
  const rows = await db
    .select({
      client: portalClientSettings.client,
      name: portalClientSettings.displayName,
      hiddenAt: portalClientSettings.hiddenAt,
    })
    .from(portalClientSettings)
    .where(eq(portalClientSettings.orgId, orgId));
  const names = new Map<string, string>();
  const hidden = new Set<string>();
  for (const row of rows) {
    if (row.name) names.set(row.client, row.name);
    if (row.hiddenAt) hidden.add(row.client);
  }
  return { names, hidden };
}

/** The name a person typed, tidied: one line, spaces collapsed; empty is no name (back to the slug's). */
export function portalClientNameOf(input: string | null): string | null {
  const name = (input ?? "").replace(/\s+/g, " ").trim();
  if (!name) return null;
  if (name.length > PORTAL_CLIENT_NAME_MAX) {
    throw new ValidationError(`A client's name has at most ${PORTAL_CLIENT_NAME_MAX} characters`);
  }
  return name;
}

async function settingFor(db: Database, orgId: string, client: string) {
  const [row] = await db
    .select({ name: portalClientSettings.displayName, hiddenAt: portalClientSettings.hiddenAt })
    .from(portalClientSettings)
    .where(and(eq(portalClientSettings.orgId, orgId), eq(portalClientSettings.client, client)));
  return row ?? null;
}

/** Gives a client the name the team shows (`null`: back to its slug's), audited. Answers the name kept. */
export async function setPortalClientName(
  db: Database,
  orgId: string,
  client: string,
  input: string | null,
  userId: string,
): Promise<string | null> {
  const name = portalClientNameOf(input);
  const before = (await settingFor(db, orgId, client))?.name ?? null;
  if (before === name) return name;
  await db
    .insert(portalClientSettings)
    .values({ orgId, client, displayName: name, updatedBy: userId })
    .onConflictDoUpdate({
      target: [portalClientSettings.orgId, portalClientSettings.client],
      set: { displayName: name, updatedBy: userId, updatedAt: new Date() },
    });
  await recordAudit(db, {
    orgId,
    actor: { type: "person", id: userId },
    action: "portal.client_renamed",
    target: { type: "portal_client", id: client },
    details: { client, from: before, to: name },
  });
  return name;
}

/** Hides a client from every list of the apps, or shows it again, audited. Nothing changes at the portal. */
export async function setPortalClientHidden(
  db: Database,
  orgId: string,
  client: string,
  hidden: boolean,
  userId: string,
): Promise<void> {
  const was = Boolean((await settingFor(db, orgId, client))?.hiddenAt);
  if (was === hidden) return;
  const hiddenAt = hidden ? new Date() : null;
  await db
    .insert(portalClientSettings)
    .values({ orgId, client, hiddenAt, updatedBy: userId })
    .onConflictDoUpdate({
      target: [portalClientSettings.orgId, portalClientSettings.client],
      set: { hiddenAt, updatedBy: userId, updatedAt: new Date() },
    });
  await recordAudit(db, {
    orgId,
    actor: { type: "person", id: userId },
    action: hidden ? "portal.client_hidden" : "portal.client_shown",
    target: { type: "portal_client", id: client },
    details: { client },
  });
}
