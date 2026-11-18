import type { BlobStore, PortalClientColor, PortalStatus, PortalType } from "@agenteschat/adapters";
import { PORTAL_CLIENT_COLORS } from "@agenteschat/adapters";
import type { Database } from "@agenteschat/db";
import { and, asc, desc, eq, inArray, isNull, schema } from "@agenteschat/db";
import { portalClientToken, sha256 } from "./crypto";
import { ConflictError, ForbiddenError, NotFoundError, ValidationError } from "./errors";

const { portalClientLinks, portalClients, portalPostFiles, portalPostNotes, portalPosts } = schema;

/**
 * The clients of the installation's approval portal (docs/adr/doug-0020-embedded-approval-portal.md): each one has a
 * name, its contacts (an e-mail, a WhatsApp number, or both) and a link of its own, `<PUBLIC_URL>/portal/<token>`, with
 * no account: the token is the whole of the access, good for one client of one workspace, and the team may revoke it.
 * The page it opens is rendered as its own, never by the app's signed-in routes.
 */

/** The most contacts a client has. */
export const PORTAL_CLIENT_CONTACTS_MAX = 10;
export const PORTAL_CLIENT_NAME_MAX = 80;
export const PORTAL_CONTACT_NAME_MAX = 80;
export const PORTAL_CONTACT_EMAIL_MAX = 200;

/** The client's id as the board, the agents and the address call it by ("acme"). */
export const PORTAL_CLIENT_ID = /^[a-z0-9][a-z0-9-]{0,63}$/;

/** A phone number as the portal writes it: digits only, country code first. */
const PORTAL_PHONE = /^\d{8,15}$/;
const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;

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
  /** The client's page's own link; null while it has none (revoked). */
  link: string | null;
  /** When the last link was revoked: the address answers nothing until a new one is made. */
  revoked: boolean;
  createdAt: string;
}

const clientView = async (
  deps: { db: Database; publicUrl: string; secret: string },
  row: typeof portalClients.$inferSelect,
): Promise<PortalClientView> => ({
  id: row.id,
  client: row.client,
  name: row.name,
  contacts: row.contacts,
  color: (row.color as PortalClientColor | null) ?? null,
  link: await clientLinkUrl(deps.db, deps.publicUrl, deps.secret, row.id),
  revoked: Boolean((await lastLink(deps.db, row.id))?.revokedAt),
  createdAt: row.createdAt.toISOString(),
});

const lastLink = async (db: Database, clientId: string) =>
  (
    await db
      .select({ revokedAt: portalClientLinks.revokedAt })
      .from(portalClientLinks)
      .where(eq(portalClientLinks.clientId, clientId))
      .orderBy(desc(portalClientLinks.createdAt))
      .limit(1)
  )[0] ?? null;

/** The address a client's current, unrevoked link opens; null while it has none. */
export async function clientLinkUrl(
  db: Database,
  publicUrl: string,
  secret: string,
  clientId: string,
): Promise<string | null> {
  const [link] = await db
    .select({ id: portalClientLinks.id })
    .from(portalClientLinks)
    .where(and(eq(portalClientLinks.clientId, clientId), isNull(portalClientLinks.revokedAt)))
    .orderBy(desc(portalClientLinks.createdAt))
    .limit(1);
  return link ? `${publicUrl.replace(/\/+$/, "")}/portal/${portalClientToken(secret, link.id)}` : null;
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
    id: typeof row.id === "string" && row.id ? row.id : Bun.randomUUIDv7(),
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

export interface PortalClientInput {
  client?: string;
  name: string;
  contacts?: unknown[];
  color?: unknown;
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
 * Who may: the route checks `assign_work` before it calls here. A new client starts with a link, so the team has one
 * to send the moment the client is there.
 */
export async function upsertPortalClient(
  deps: { db: Database; publicUrl: string; secret: string },
  orgId: string,
  input: PortalClientInput,
  by: string | null,
): Promise<PortalClientView> {
  const db = deps.db;
  const client = (input.client?.trim() || slugOf(input.name ?? "")).trim();
  if (!PORTAL_CLIENT_ID.test(client)) {
    throw new ValidationError("The client's id is lowercase letters, digits and hyphens (up to 64)");
  }
  const name = (input.name ?? "").trim().slice(0, PORTAL_CLIENT_NAME_MAX);
  if (!name) throw new ValidationError("Give the client a name");
  const contacts = (input.contacts ?? []).slice(0, PORTAL_CLIENT_CONTACTS_MAX).map(contactOf);
  const color = colorOf(input.color);
  const [existing] = await db
    .select()
    .from(portalClients)
    .where(and(eq(portalClients.orgId, orgId), eq(portalClients.client, client)));
  if (existing) {
    const [row] = await db
      .update(portalClients)
      .set({ name, contacts, ...(input.color !== undefined ? { color } : {}), updatedAt: new Date() })
      .where(eq(portalClients.id, existing.id))
      .returning();
    if (!row) throw new NotFoundError("Client not found");
    return clientView(deps, row);
  }
  if (!by) throw new ForbiddenError("A person makes the team's clients");
  const [row] = await db
    .insert(portalClients)
    .values({ orgId, client, name, contacts, color, createdBy: by })
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
  return `${deps.publicUrl.replace(/\/+$/, "")}/portal/${token}`;
}

/** Revokes a client's link (by the client's id, "acme"): the address answers nothing until a new one is made. */
export async function revokeClientLink(deps: { db: Database }, orgId: string, client: string) {
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

/** Every client of the workspace, with the address of each one's link (members read it). */
export async function listPortalClients(
  deps: { db: Database; publicUrl: string; secret: string },
  orgId: string,
): Promise<PortalClientView[]> {
  const rows = await deps.db
    .select()
    .from(portalClients)
    .where(eq(portalClients.orgId, orgId))
    .orderBy(asc(portalClients.createdAt));
  return Promise.all(rows.map((row) => clientView(deps, row)));
}

/** The client behind a link's token, or null while the token names none (or the link was revoked). */
export async function portalClientOfToken(db: Database, token: string) {
  const [row] = await db
    .select({
      linkId: portalClientLinks.id,
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
  // Best effort: said of the link each time the client opens its page.
  await db.update(portalClientLinks).set({ lastUsedAt: new Date() }).where(eq(portalClientLinks.id, row.linkId));
  return row;
}

/** Removes a client with its links: its posts stay, for the team, but no page shows it. */
export async function removePortalClient(db: Database, orgId: string, client: string) {
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
  /** Each file's id and kind, in order: `/portal/api/<token>/files/<id>`. */
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
 * The client's decision through the link's token (docs/adr/doug-0020-embedded-approval-portal.md): an approval, or a
 * change asked (a note, maybe with a second of a video or a spot of a slide). Only a post waiting on this client takes
 * one, and only once: it turns `approved` or `adjust_requested`, and the workspace's own watch reads the change (and
 * the note) and carries them to the team's card and task, to whoever has the work, and to an agent that starts on it.
 */
export async function clientDecision(
  deps: { db: Database; wake?: () => void },
  clientRow: { orgId: string; client: string },
  input: ClientDecision,
): Promise<{ status: PortalStatus; version: number }> {
  const db = deps.db;
  const [post] = await db
    .select()
    .from(portalPosts)
    .where(
      and(
        eq(portalPosts.orgId, clientRow.orgId),
        eq(portalPosts.client, clientRow.client),
        eq(portalPosts.id, input.postId),
      ),
    );
  if (!post) throw new NotFoundError("Post not found");
  if (!WAITING.includes(post.status)) {
    throw new ConflictError("This post was already answered", "portal.already_answered");
  }
  const text = (input.text ?? "").trim().slice(0, CLIENT_NOTE_MAX);
  if (input.decision === "adjust" && !text) throw new ValidationError("Tell us what to change");
  const fraction = (v: number | null | undefined) =>
    typeof v === "number" && Number.isFinite(v) ? Math.min(1, Math.max(0, v)) : null;
  const atSeconds =
    typeof input.atSeconds === "number" && Number.isFinite(input.atSeconds) ? Math.max(0, input.atSeconds) : null;
  const page = typeof input.page === "number" && Number.isInteger(input.page) ? Math.min(1000, input.page) : null;
  await db.insert(portalPostNotes).values({
    orgId: clientRow.orgId,
    postId: post.id,
    version: post.version,
    atSeconds,
    page,
    x: fraction(input.x),
    y: fraction(input.y),
    text,
    by: (input.by ?? null)?.slice(0, 120) || null,
    kind: input.decision,
  });
  const status: PortalStatus = input.decision === "approve" ? "approved" : "adjust_requested";
  await db.update(portalPosts).set({ status, updatedAt: new Date() }).where(eq(portalPosts.id, post.id));
  // The workspace's watch (`portalTasksTick`) sees the change and carries it on: the card's task follows, whoever has
  // it is told, and an agent starts on the change at once.
  deps.wake?.();
  return { status, version: post.version };
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
