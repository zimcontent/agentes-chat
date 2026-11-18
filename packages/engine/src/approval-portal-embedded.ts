import type { ApprovalPortal, BlobStore, PortalCard, PortalItem, PortalJob, PortalState } from "@agenteschat/adapters";
import { ApprovalPortalError, PORTAL_FILE_BYTES } from "@agenteschat/adapters";
import type { Database, Executor } from "@agenteschat/db";
import { and, asc, desc, eq, inArray, schema, sql } from "@agenteschat/db";
import { portalWorkspaceOf } from "./approval-portal-clients";
import { ConflictError } from "./errors";
import { assertStorageRoom } from "./limits";
import { enqueue } from "./outbox";
import { portalNotifyPostKey } from "./portal-notices";

const { portalCards, portalClients, portalJobs, portalLabels, portalLists, portalPostFiles, portalPostNotes } = schema;
const { portalPosts, portalUploads } = schema;

/**
 * The approval portal kept in this server (docs/adr/doug-0031-embedded-approval-portal.md): the same contract as the
 * bridge (`ApprovalPortal`, ADR 9001), with every client, card, post and note in this database instead of another
 * service. An installation with no bridge of its own gets this one, so the Portal page, the agents' tools and the
 * clients' own links work out of the box.
 *
 * It speaks for the installation's portal workspace, as the bridge does (ADR 9001 §18): every row carries that
 * workspace's `org_id`, and a workspace that isn't the portal's has none of it.
 */

/** Where a post's files are kept in the platform's storage, beside the workspace's own keys. */
export const PORTAL_BLOB_PREFIX = (orgId: string) => `orgs/${orgId}/portal`;

/**
 * A send whose key another request took meanwhile: the transaction rolls everything it wrote back, and the row that
 * already exists answers (marked so it is never mistaken for anything else thrown inside the transaction).
 */
const SEND_TAKEN = Symbol("portal.send.taken");

/** The type of a file by its name: what a browser needs to play or draw it. */
export function portalContentType(name: string): string {
  const ext = name.toLowerCase().split(".").at(-1) ?? "";
  return (
    {
      mp4: "video/mp4",
      mov: "video/quicktime",
      webm: "video/webm",
      m4v: "video/mp4",
      jpg: "image/jpeg",
      jpeg: "image/jpeg",
      png: "image/png",
      webp: "image/webp",
      gif: "image/gif",
      pdf: "application/pdf",
    }[ext] ?? "application/octet-stream"
  );
}

export const isVideoFile = (name: string, contentType?: string | null) =>
  (contentType ?? portalContentType(name)).startsWith("video/");

/** What a sent post still lacks. Never shown to the client (ADR 9001). */
function missingOf(
  post: { type: string; caption: string; editor: string | null; scheduledFor: Date | null },
  cover: boolean,
) {
  const missing: ("cover" | "caption" | "editor" | "date")[] = [];
  if (post.type === "reel" && !cover) missing.push("cover");
  if (!post.caption.trim()) missing.push("caption");
  if (!post.editor) missing.push("editor");
  if (!post.scheduledFor) missing.push("date");
  return missing;
}

const iso = (at: Date | null | undefined) => at?.toISOString() ?? null;
const seconds = (at: Date) => Math.round(at.getTime());

export interface EmbeddedPortalDeps {
  db: Database;
  /** The installation's platform storage: a post's files and the clients' logos live there. */
  blobs: BlobStore;
  /** Where a client's page is (`<PUBLIC_URL>/p/<token>`) and what its links are derived from. */
  publicUrl: string;
  secret: string;
}

/**
 * The portal's workspace: the one holding its rows, else the installation's first. One installation has one portal
 * (ADR 9001 §18), so its clients are one workspace's. It is `portalWorkspaceOf` (approval-portal-clients.ts), which
 * reads the portal's own rows and the tasks its watch made for them in the same order, so this function and
 * `portalHere` never name different workspaces.
 */
export async function portalOrgId(db: Database): Promise<string | null> {
  return portalWorkspaceOf(db);
}

/**
 * A portal in this server's own database. Idempotent by key like the bridge: the same send key answers the same job.
 * `notify` is enqueued as the `portal.notify` job, so every way a post reaches a client tells them once.
 */
export function createEmbeddedApprovalPortal(deps: EmbeddedPortalDeps): ApprovalPortal {
  const { db, blobs, publicUrl } = deps;

  const org = async () => {
    const orgId = await portalOrgId(db);
    if (!orgId) throw new ApprovalPortalError(409, "This installation has no workspace yet");
    return orgId;
  };

  const postsOf = async (orgId: string, client?: string) =>
    client
      ? db
          .select()
          .from(portalPosts)
          .where(and(eq(portalPosts.orgId, orgId), eq(portalPosts.client, client)))
          .orderBy(desc(portalPosts.updatedAt))
      : db.select().from(portalPosts).where(eq(portalPosts.orgId, orgId)).orderBy(desc(portalPosts.updatedAt));

  const filesOf = async (orgId: string, postIds: string[]) =>
    postIds.length
      ? db
          .select()
          .from(portalPostFiles)
          .where(and(eq(portalPostFiles.orgId, orgId), inArray(portalPostFiles.postId, postIds)))
          .orderBy(asc(portalPostFiles.version), asc(portalPostFiles.position))
      : [];

  const notesOf = async (orgId: string, postIds: string[]) =>
    postIds.length
      ? db
          .select()
          .from(portalPostNotes)
          .where(and(eq(portalPostNotes.orgId, orgId), inArray(portalPostNotes.postId, postIds)))
          .orderBy(asc(portalPostNotes.at))
      : [];

  /** One post as the contract reads it, with its files and the client's notes. */
  const itemOf = (
    post: typeof portalPosts.$inferSelect,
    files: (typeof portalPostFiles.$inferSelect)[],
    notes: (typeof portalPostNotes.$inferSelect)[],
  ): PortalItem => {
    const mine = files.filter((f) => f.version === post.version);
    const media = mine.filter((f) => f.role === "media");
    const last = notes.at(-1);
    return {
      client: post.client,
      id: post.id,
      title: post.title,
      type: post.type,
      status: post.status,
      scheduledFor: iso(post.scheduledFor),
      publishedAt: iso(post.publishedAt),
      createdAt: iso(post.createdAt),
      updatedAt: iso(post.updatedAt),
      editor: post.editor,
      caption: post.caption,
      files: media.length,
      video: post.video,
      version: post.version,
      missing: missingOf(
        post,
        mine.some((f) => f.role === "cover"),
      ),
      released: post.released,
      lastNote: last ? { at: iso(last.at), by: last.by, text: last.text } : null,
      clientNotes: notes.map((n) => ({
        id: n.id,
        version: n.version,
        atSeconds: n.atSeconds,
        page: n.page,
        x: n.x,
        y: n.y,
        text: n.text,
        files: n.files,
        by: n.by,
        at: iso(n.at),
      })),
      postUrl: post.postUrl,
      // The team reads a post on the workspace's own board, never through a client's link (that one is the client's).
      link: `${publicUrl.replace(/\/+$/, "")}/org/${post.orgId}/portal?client=${encodeURIComponent(post.client)}`,
    };
  };

  const cardOf = (card: typeof portalCards.$inferSelect, shelf: boolean): PortalCard => ({
    id: card.id,
    client: card.client,
    title: card.title,
    type: card.type,
    state: card.state,
    caption: card.caption,
    date: card.date,
    editor: card.editor,
    owner: card.owner,
    note: card.note,
    files: card.files,
    produceOn: card.produceOn,
    list: card.list,
    order: card.order,
    description: card.description,
    labels: card.labels,
    members: card.members,
    checklist: card.checklist,
    comments: card.comments,
    item: card.item,
    task: card.task,
    done: card.done,
    material: shelf,
    createdAt: seconds(card.createdAt),
    updatedAt: seconds(card.updatedAt),
  });

  const shelvesOf = async (orgId: string) =>
    new Set(
      (
        await db
          .select({ id: portalLists.id })
          .from(portalLists)
          .where(and(eq(portalLists.orgId, orgId), eq(portalLists.kind, "materials")))
      ).map((l) => l.id),
    );

  const jobOf = (job: typeof portalJobs.$inferSelect): PortalJob => ({
    id: job.id,
    state: job.state,
    client: job.client,
    item: job.item,
    title: job.title,
    missing: job.missing as PortalJob["missing"],
    link: job.item
      ? `${publicUrl.replace(/\/+$/, "")}/org/${job.orgId}/portal?client=${encodeURIComponent(job.client)}`
      : null,
    error: job.error,
  });

  /**
   * Reads a file into the platform's storage, answering the id a send takes. Every file a post carries counts against
   * the workspace's storage (`limits.ts`), as anything else written there does: a workspace past its limit is refused
   * with the same `storage.full`/`storage.daily_full` a Drive upload gets, before a byte is written.
   */
  const keep = async (orgId: string, name: string, bytes: Uint8Array, contentType: string) => {
    if (bytes.byteLength > PORTAL_FILE_BYTES) throw new ApprovalPortalError(413, "That file is too large to send");
    await assertStorageRoom(db, orgId, bytes.byteLength).catch((error: unknown) => {
      if (error instanceof ConflictError) throw new ApprovalPortalError(409, error.message);
      throw error;
    });
    const [row] = await db
      .insert(portalUploads)
      .values({
        orgId,
        name,
        contentType,
        size: bytes.byteLength,
        blobKey: `${PORTAL_BLOB_PREFIX(orgId)}/uploads/${Bun.randomUUIDv7()}/${name}`,
      })
      .returning();
    if (!row) throw new ApprovalPortalError(500, "The file could not be kept");
    await blobs.put(row.blobKey, bytes, { contentType });
    return row;
  };

  /** The uploads a send names, in its order, or a refusal. */
  const uploadsOf = async (orgId: string, ids: string[], tx: Executor = db) => {
    const rows = ids.length
      ? await tx
          .select()
          .from(portalUploads)
          .where(and(eq(portalUploads.orgId, orgId), inArray(portalUploads.id, ids)))
      : [];
    const byId = new Map(rows.map((r) => [r.id, r]));
    return ids.map((id) => {
      const row = byId.get(id);
      if (!row) throw new ApprovalPortalError(400, `The upload ${id} isn't here: send it again`);
      return row;
    });
  };

  const jobForKey = async (orgId: string, key: string | undefined, tx: Executor = db) =>
    key
      ? ((
          await tx
            .select()
            .from(portalJobs)
            .where(and(eq(portalJobs.orgId, orgId), eq(portalJobs.key, key)))
            .limit(1)
        )[0] ?? null)
      : null;

  /**
   * The job a send or a new version leaves for the client's notice, in the caller's own transaction: a post and its
   * notice are kept together, so a notice is never queued for a post the transaction rolled back, and never lost for
   * one it committed. A failure here fails the send: a post the client is never told of is a post they never see.
   */
  const notify = (tx: Executor, orgId: string, client: string, postId: string, version: number) =>
    enqueue(tx, {
      orgId,
      kind: "portal.notify",
      // The client is named in the payload: a retry that comes back at the end of the hour tells that client whatever
      // became of this post (`announcePortalPost`), so the notice is never lost with the post it first came with.
      payload: { postId, version, client },
      // The same post and version tell once (`portalNotifyPostKey`, portal-notices.ts); a new version is another key.
      dedupeKey: portalNotifyPostKey(postId, version),
    });

  return {
    state: async (): Promise<PortalState> => ({ stale: false, readAt: new Date().toISOString(), queued: 0 }),

    items: async () => {
      const orgId = await org();
      const posts = await postsOf(orgId);
      const [files, notes] = await Promise.all([
        filesOf(
          orgId,
          posts.map((p) => p.id),
        ),
        notesOf(
          orgId,
          posts.map((p) => p.id),
        ),
      ]);
      return posts.map((post) =>
        itemOf(
          post,
          files.filter((f) => f.postId === post.id),
          notes.filter((n) => n.postId === post.id),
        ),
      );
    },

    cards: async (client) => {
      const orgId = await org();
      const rows = client
        ? await db
            .select()
            .from(portalCards)
            .where(and(eq(portalCards.orgId, orgId), eq(portalCards.client, client)))
            .orderBy(asc(portalCards.order))
        : await db.select().from(portalCards).where(eq(portalCards.orgId, orgId)).orderBy(asc(portalCards.order));
      const shelves = await shelvesOf(orgId);
      return rows.map((card) => cardOf(card, !!card.list && shelves.has(card.list)));
    },

    createCard: async (client, input) => {
      const orgId = await org();
      const [card] = await db
        .insert(portalCards)
        .values({
          orgId,
          client,
          title: input.title,
          ...(input.type !== undefined ? { type: input.type } : {}),
          ...(input.state !== undefined ? { state: input.state } : {}),
          ...(input.caption !== undefined ? { caption: input.caption } : {}),
          ...(input.date !== undefined ? { date: input.date } : {}),
          ...(input.editor !== undefined ? { editor: input.editor } : {}),
          ...(input.owner !== undefined ? { owner: input.owner } : {}),
          ...(input.note !== undefined ? { note: input.note } : {}),
          ...(input.files !== undefined ? { files: input.files } : {}),
          ...(input.produceOn !== undefined ? { produceOn: input.produceOn } : {}),
          ...(input.list !== undefined ? { list: input.list } : {}),
          ...(input.description !== undefined ? { description: input.description } : {}),
          ...(input.labels !== undefined ? { labels: input.labels } : {}),
          ...(input.members !== undefined ? { members: input.members } : {}),
          ...(input.checklist !== undefined ? { checklist: input.checklist } : {}),
          ...(input.item !== undefined ? { item: input.item } : {}),
          ...(input.task !== undefined ? { task: input.task } : {}),
          ...(input.done !== undefined ? { done: input.done } : {}),
        })
        .returning();
      if (!card) throw new ApprovalPortalError(500, "The card could not be made");
      return cardOf(card, false);
    },

    updateCard: async (id, input) => {
      const orgId = await org();
      const [card] = await db
        .update(portalCards)
        .set({
          ...(input.title !== undefined ? { title: input.title } : {}),
          ...(input.type !== undefined ? { type: input.type } : {}),
          ...(input.state !== undefined ? { state: input.state } : {}),
          ...(input.caption !== undefined ? { caption: input.caption } : {}),
          ...(input.date !== undefined ? { date: input.date } : {}),
          ...(input.editor !== undefined ? { editor: input.editor } : {}),
          ...(input.owner !== undefined ? { owner: input.owner } : {}),
          ...(input.note !== undefined ? { note: input.note } : {}),
          ...(input.files !== undefined ? { files: input.files } : {}),
          ...(input.produceOn !== undefined ? { produceOn: input.produceOn } : {}),
          ...(input.list !== undefined ? { list: input.list } : {}),
          ...(input.order !== undefined ? { order: input.order } : {}),
          ...(input.description !== undefined ? { description: input.description } : {}),
          ...(input.labels !== undefined ? { labels: input.labels } : {}),
          ...(input.members !== undefined ? { members: input.members } : {}),
          ...(input.checklist !== undefined ? { checklist: input.checklist } : {}),
          ...(input.item !== undefined ? { item: input.item } : {}),
          ...(input.task !== undefined ? { task: input.task } : {}),
          ...(input.done !== undefined ? { done: input.done } : {}),
          updatedAt: new Date(),
        })
        .where(and(eq(portalCards.orgId, orgId), eq(portalCards.id, id)))
        .returning();
      if (!card) throw new ApprovalPortalError(404, "card not found");
      const shelves = await shelvesOf(orgId);
      return cardOf(card, !!card.list && shelves.has(card.list));
    },

    deleteCard: async (id) => {
      const orgId = await org();
      await db.delete(portalCards).where(and(eq(portalCards.orgId, orgId), eq(portalCards.id, id)));
    },

    comment: async (cardId, text, by) => {
      const orgId = await org();
      const [card] = await db
        .select()
        .from(portalCards)
        .where(and(eq(portalCards.orgId, orgId), eq(portalCards.id, cardId)));
      if (!card) throw new ApprovalPortalError(404, "card not found");
      const next = [...card.comments, { id: Bun.randomUUIDv7(), by, text, at: Date.now() }];
      const [saved] = await db
        .update(portalCards)
        .set({ comments: next, updatedAt: new Date() })
        .where(eq(portalCards.id, cardId))
        .returning();
      const shelves = await shelvesOf(orgId);
      return cardOf(saved ?? { ...card, comments: next }, !!card.list && shelves.has(card.list));
    },

    deleteComment: async (cardId, commentId) => {
      const orgId = await org();
      const [card] = await db
        .select()
        .from(portalCards)
        .where(and(eq(portalCards.orgId, orgId), eq(portalCards.id, cardId)));
      if (!card) throw new ApprovalPortalError(404, "card not found");
      const next = card.comments.filter((c) => c.id !== commentId);
      const [saved] = await db
        .update(portalCards)
        .set({ comments: next, updatedAt: new Date() })
        .where(eq(portalCards.id, cardId))
        .returning();
      const shelves = await shelvesOf(orgId);
      return cardOf(saved ?? { ...card, comments: next }, !!card.list && shelves.has(card.list));
    },

    lists: async (client) => {
      const orgId = await org();
      const rows = await db
        .select()
        .from(portalLists)
        .where(and(eq(portalLists.orgId, orgId), eq(portalLists.client, client)))
        .orderBy(asc(portalLists.position), asc(portalLists.createdAt));
      return rows.map((l) => ({ id: l.id, name: l.name, kind: l.kind }));
    },

    createList: async (client, name, kind = "plan") => {
      const orgId = await org();
      const rows = await db
        .select()
        .from(portalLists)
        .where(and(eq(portalLists.orgId, orgId), eq(portalLists.client, client)));
      const same = rows.find((l) => l.name.toLowerCase() === name.toLowerCase());
      if (same) return { id: same.id, name: same.name, kind: same.kind };
      const [row] = await db
        .insert(portalLists)
        .values({ orgId, client, name, kind, position: rows.length })
        .returning();
      if (!row) throw new ApprovalPortalError(500, "The list could not be made");
      return { id: row.id, name: row.name, kind: row.kind };
    },

    renameList: async (id, name) => {
      const orgId = await org();
      const [row] = await db
        .update(portalLists)
        .set({ name })
        .where(and(eq(portalLists.orgId, orgId), eq(portalLists.id, id)))
        .returning();
      if (!row) throw new ApprovalPortalError(404, "list not found");
      return { id: row.id, name: row.name, kind: row.kind };
    },

    setListKind: async (id, kind) => {
      const orgId = await org();
      const [row] = await db
        .update(portalLists)
        .set({ kind })
        .where(and(eq(portalLists.orgId, orgId), eq(portalLists.id, id)))
        .returning();
      if (!row) throw new ApprovalPortalError(404, "list not found");
      return { id: row.id, name: row.name, kind: row.kind };
    },

    orderLists: async (client, ids) => {
      const orgId = await org();
      const rows = await db
        .select()
        .from(portalLists)
        .where(and(eq(portalLists.orgId, orgId), eq(portalLists.client, client)));
      if (ids.length !== rows.length || rows.some((l) => !ids.includes(l.id))) {
        throw new ApprovalPortalError(409, "the order must carry every list once");
      }
      for (const [position, id] of ids.entries()) {
        await db
          .update(portalLists)
          .set({ position })
          .where(and(eq(portalLists.orgId, orgId), eq(portalLists.id, id)));
      }
      return ids.map((id) => {
        const row = rows.find((l) => l.id === id) as (typeof rows)[number];
        return { id: row.id, name: row.name, kind: row.kind };
      });
    },

    deleteList: async (id) => {
      const orgId = await org();
      await db
        .update(portalCards)
        .set({ list: null })
        .where(and(eq(portalCards.orgId, orgId), eq(portalCards.list, id)));
      await db.delete(portalLists).where(and(eq(portalLists.orgId, orgId), eq(portalLists.id, id)));
    },

    labels: async () => {
      const orgId = await org();
      const rows = await db
        .select()
        .from(portalLabels)
        .where(eq(portalLabels.orgId, orgId))
        .orderBy(asc(portalLabels.createdAt));
      return rows.map((l) => ({ id: l.id, name: l.name, color: l.color as never }));
    },

    createLabel: async (name, color) => {
      const orgId = await org();
      const [row] = await db.insert(portalLabels).values({ orgId, name, color }).returning();
      if (!row) throw new ApprovalPortalError(500, "The label could not be made");
      return { id: row.id, name: row.name, color: row.color as never };
    },

    updateLabel: async (id, change) => {
      const orgId = await org();
      const [row] = await db
        .update(portalLabels)
        .set({
          ...(change.name !== undefined ? { name: change.name } : {}),
          ...(change.color !== undefined ? { color: change.color } : {}),
        })
        .where(and(eq(portalLabels.orgId, orgId), eq(portalLabels.id, id)))
        .returning();
      if (!row) throw new ApprovalPortalError(404, "label not found");
      return { id: row.id, name: row.name, color: row.color as never };
    },

    deleteLabel: async (id) => {
      const orgId = await org();
      await db.delete(portalLabels).where(and(eq(portalLabels.orgId, orgId), eq(portalLabels.id, id)));
      const cards = await db.select().from(portalCards).where(eq(portalCards.orgId, orgId));
      for (const card of cards) {
        if (!card.labels.includes(id)) continue;
        await db
          .update(portalCards)
          .set({ labels: card.labels.filter((l) => l !== id) })
          .where(eq(portalCards.id, card.id));
      }
    },

    clientLooks: async () => {
      const orgId = await org();
      const rows = await db
        .select({ client: portalClients.client, color: portalClients.color, logo: portalClients.logo })
        .from(portalClients)
        .where(eq(portalClients.orgId, orgId));
      const colors: Record<string, never> = {};
      const logos: Record<string, string> = {};
      for (const row of rows) {
        if (row.color) colors[row.client] = row.color as never;
        if (row.logo) logos[row.client] = row.logo;
      }
      return { colors, logos };
    },

    setClientColor: async (client, color) => {
      const orgId = await org();
      await db
        .update(portalClients)
        .set({ color, updatedAt: new Date() })
        .where(and(eq(portalClients.orgId, orgId), eq(portalClients.client, client)));
    },

    setClientLogo: async (client, file) => {
      const orgId = await org();
      await db
        .update(portalClients)
        .set({ logo: file, updatedAt: new Date() })
        .where(and(eq(portalClients.orgId, orgId), eq(portalClients.client, client)));
    },

    upload: async (name, bytes) => {
      const orgId = await org();
      return (await keep(orgId, name, bytes, portalContentType(name))).id;
    },

    send: async (input) => {
      const orgId = await org();
      // One send per key, whatever arrives at the same moment: the job's `(org_id, key)` is unique, so a second
      // request's insert loses and answers the first one's row instead of sending a second post. Without a key the
      // insert always goes, as the contract says (a key is the caller's own way of making a send idempotent).
      const [job] = await db
        .transaction(async (tx) => {
          // One send at a time for this key, across every process on the database: a transaction-scoped advisory lock
          // taken before the read, so two requests at the same moment line up instead of both reading "no job" and
          // both inserting. The lock is the transaction's own: it goes when the transaction ends, whatever the answer.
          await tx.execute(
            sql`select pg_advisory_xact_lock(hashtext(${`${orgId}:${input.key ?? input.files.join("+")}`}))`,
          );
          const before = input.key ? await jobForKey(orgId, input.key, tx) : null;
          if (before) return [before];
          const uploads = await uploadsOf(orgId, input.files, tx);
          const cover = input.cover ? (await uploadsOf(orgId, [input.cover], tx))[0] : null;
          const video = input.type === "reel" || uploads.some((u) => isVideoFile(u.name, u.contentType));
          // A post's title: the send's own, else the card's it finishes, else its first file's name.
          const title = input.title?.trim() || (await cardTitle(orgId, input.card, tx)) || uploads[0]?.name || "";
          const [post] = await tx
            .insert(portalPosts)
            .values({
              orgId,
              client: input.client,
              title,
              type: input.type,
              status: "sent",
              caption: input.caption ?? "",
              editor: input.editor ?? null,
              video,
              version: 1,
              card: input.card ?? null,
            })
            .returning();
          if (!post) throw new ApprovalPortalError(500, "The post could not be sent");
          const files = [
            ...uploads.map((u, position) => ({ u, position, role: "media" as const })),
            ...(cover ? [{ u: cover, position: 0, role: "cover" as const }] : []),
          ];
          for (const { u, position, role } of files) {
            await tx.insert(portalPostFiles).values({
              orgId,
              postId: post.id,
              version: 1,
              position,
              role,
              name: u.name,
              contentType: u.contentType,
              size: u.size,
              blobKey: u.blobKey,
              storageConfigId: u.storageConfigId,
            });
          }
          await tx
            .delete(portalUploads)
            .where(and(eq(portalUploads.orgId, orgId), inArray(portalUploads.id, input.files)));
          if (cover) await tx.delete(portalUploads).where(eq(portalUploads.id, cover.id));
          // A card that is sent stays in its list, tied to the post it became (ADR 9001 §8).
          if (input.card) {
            await tx
              .update(portalCards)
              .set({ item: post.id, updatedAt: new Date() })
              .where(and(eq(portalCards.orgId, orgId), eq(portalCards.id, input.card)));
          }
          const [made] = await tx
            .insert(portalJobs)
            .values({
              orgId,
              state: "done",
              client: input.client,
              item: post.id,
              title,
              missing: missingOf(post, !!cover),
              key: input.key ?? null,
            })
            // The same key again, from another process (this one's lock is the database's, so it lines the two up: what
            // is left is a send whose row landed after this transaction's read). The insert adds nothing, and the
            // transaction is rolled back: the post, its files and the card it would have tied are undone with it.
            .onConflictDoNothing()
            .returning();
          if (!made) throw SEND_TAKEN;
          // The client's notice goes in this same transaction: a send either keeps the post, its files and the job that
          // tells the client, or none of them.
          await notify(tx, orgId, input.client, post.id, 1);
          return [made];
        })
        .catch(async (error: unknown) => {
          // The other request's row is the answer, and the transaction it was found in is rolled back.
          if (error !== SEND_TAKEN) throw error;
          const first = input.key ? await jobForKey(orgId, input.key) : null;
          if (!first) throw new ApprovalPortalError(500, "The send could not be kept");
          return [first];
        });
      if (!job) throw new ApprovalPortalError(500, "The send could not be kept");
      return jobOf(job);
    },

    job: async (id) => {
      const orgId = await org();
      const [job] = await db
        .select()
        .from(portalJobs)
        .where(and(eq(portalJobs.orgId, orgId), eq(portalJobs.id, id)));
      return job ? jobOf(job) : null;
    },

    newVersion: async (client, item, input) => {
      const orgId = await org();
      // Idempotent by key, and one version per post waiting on the client: the post's row is turned in the same
      // statement that reads its version, so a second send at the same moment (a retried request) finds the post
      // already `adjusted` and is refused, as the contract's own second send would be.
      const [job] = await db.transaction(async (tx) => {
        const before = input.key ? await jobForKey(orgId, input.key, tx) : null;
        if (before) return [before];
        const [post] = await tx
          .select()
          .from(portalPosts)
          .where(and(eq(portalPosts.orgId, orgId), eq(portalPosts.client, client), eq(portalPosts.id, item)));
        if (!post) throw new ApprovalPortalError(404, "item not found");
        if (post.status !== "adjust_requested" && post.status !== "adjusting") {
          throw new ApprovalPortalError(409, "a new version only goes up on a post the client asked a change on");
        }
        const uploads = await uploadsOf(orgId, input.files, tx);
        const version = post.version + 1;
        for (const [position, u] of uploads.entries()) {
          await tx.insert(portalPostFiles).values({
            orgId,
            postId: post.id,
            version,
            position,
            role: "media",
            name: u.name,
            contentType: u.contentType,
            size: u.size,
            blobKey: u.blobKey,
            storageConfigId: u.storageConfigId,
          });
        }
        await tx
          .delete(portalUploads)
          .where(and(eq(portalUploads.orgId, orgId), inArray(portalUploads.id, input.files)));
        const [turned] = await tx
          .update(portalPosts)
          .set({
            version,
            status: "adjusted",
            video: uploads.some((u) => isVideoFile(u.name, u.contentType)) || post.video,
            updatedAt: new Date(),
          })
          .where(
            and(eq(portalPosts.id, post.id), inArray(portalPosts.status, ["adjust_requested", "adjusting"] as const)),
          )
          .returning({ id: portalPosts.id });
        if (!turned)
          throw new ApprovalPortalError(409, "a new version only goes up on a post the client asked a change on");
        const [made] = await tx
          .insert(portalJobs)
          .values({
            orgId,
            state: "done",
            client,
            item: post.id,
            title: post.title,
            missing: [],
            key: input.key ?? null,
          })
          .onConflictDoNothing()
          .returning();
        if (!made) return [];
        // The notice names the version this transaction turned, and goes with it: a version and the note that tells
        // the client are kept together or not at all.
        await notify(tx, orgId, client, post.id, version);
        return [made];
      });
      if (!job) {
        const first = input.key ? await jobForKey(orgId, input.key) : null;
        if (!first) throw new ApprovalPortalError(500, "The version could not be kept");
        return jobOf(first);
      }
      return jobOf(job);
    },

    editItem: async (client, item, edit) => {
      const orgId = await org();
      const [post] = await db
        .select()
        .from(portalPosts)
        .where(and(eq(portalPosts.orgId, orgId), eq(portalPosts.client, client), eq(portalPosts.id, item)));
      if (!post) throw new ApprovalPortalError(404, "item not found");
      await db
        .update(portalPosts)
        .set({
          ...(edit.title !== undefined ? { title: edit.title } : {}),
          ...(edit.caption !== undefined ? { caption: edit.caption } : {}),
          ...(edit.scheduledFor !== undefined ? { scheduledFor: null } : {}),
          ...(edit.status !== undefined ? { status: edit.status } : {}),
          ...(edit.editor !== undefined ? { editor: edit.editor } : {}),
          updatedAt: new Date(),
        })
        .where(eq(portalPosts.id, post.id));
    },

    scheduleItem: async (client, item, when) => {
      const orgId = await org();
      const [post] = await db
        .select()
        .from(portalPosts)
        .where(and(eq(portalPosts.orgId, orgId), eq(portalPosts.client, client), eq(portalPosts.id, item)));
      if (!post) throw new ApprovalPortalError(404, "item not found");
      if (post.status !== "approved") throw new ApprovalPortalError(409, "only an approved post is scheduled");
      if (post.released) throw new ApprovalPortalError(409, "this post was already released");
      // This server has no publishing service: a released post is `scheduled` at once, for the team to publish and
      // say so with `markPublished` (docs/adr/doug-0031-embedded-approval-portal.md).
      await db
        .update(portalPosts)
        .set({ released: true, scheduledFor: new Date(when), status: "scheduled", updatedAt: new Date() })
        .where(eq(portalPosts.id, post.id));
    },

    markPublished: async (client, item, input) => {
      const orgId = await org();
      const [post] = await db
        .select()
        .from(portalPosts)
        .where(and(eq(portalPosts.orgId, orgId), eq(portalPosts.client, client), eq(portalPosts.id, item)));
      if (!post) throw new ApprovalPortalError(404, "item not found");
      if (post.status !== "scheduled") throw new ApprovalPortalError(409, "only a scheduled post is marked posted");
      const at = input.at ? new Date(input.at) : new Date();
      if (Number.isNaN(at.getTime())) throw new ApprovalPortalError(400, "that isn't a date");
      await db
        .update(portalPosts)
        .set({
          status: "published",
          publishedAt: at,
          ...(input.postUrl !== undefined && input.postUrl !== null ? { postUrl: input.postUrl } : {}),
          updatedAt: new Date(),
        })
        .where(eq(portalPosts.id, post.id));
    },
  };

  async function cardTitle(orgId: string, cardId: string | undefined, tx: Executor = db) {
    if (!cardId) return null;
    const [card] = await tx
      .select({ title: portalCards.title })
      .from(portalCards)
      .where(and(eq(portalCards.orgId, orgId), eq(portalCards.id, cardId)));
    return card?.title ?? null;
  }
}
