import { boolean, index, integer, jsonb, pgTable, real, text, timestamp, uniqueIndex, uuid } from "drizzle-orm/pg-core";
import { users } from "./auth";
import { organizations } from "./tenancy";

/**
 * The approval portal kept in this server (docs/adr/doug-0031-embedded-approval-portal.md): the clients a team makes
 * work for, the posts it sends them, the board's cards, the schedule's lists and labels. Only the installation's
 * portal workspace reads or writes them, and every row carries its `org_id`. Created by `EXTRA_COLUMNS`
 * (`packages/db/src/client.ts`), outside the numbered migrations, as every table of this instance's own features.
 */

/** One of a client's contacts: who is told when a post waits on them. */
export interface PortalContact {
  id: string;
  name: string;
  email: string | null;
  /** Digits only, country code first. */
  whatsapp: string | null;
}

export const portalClients = pgTable(
  "portal_clients",
  {
    id: uuid()
      .primaryKey()
      .$defaultFn(() => Bun.randomUUIDv7()),
    orgId: uuid()
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    /** The id the board and the agents call it by ("acme"). */
    client: text().notNull(),
    /** The name people read ("Padaria Aurora"). */
    name: text().notNull(),
    contacts: jsonb().$type<PortalContact[]>().notNull().default([]),
    /** One of the twelve colours the apps draw (`PORTAL_CLIENT_COLORS`). */
    color: text(),
    /** The name of the logo's stored file (`PORTAL_LOGO_FILE`). */
    logo: text(),
    /**
     * The language this client's notices are written in (`portal_ready` emails and texts), one of `LOCALE_CODES`: the
     * team picks it, the client has no account to hold a choice. Null: the workspace owner's own language.
     */
    locale: text(),
    createdBy: text().references(() => users.id, { onDelete: "set null" }),
    createdAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [uniqueIndex("portal_clients_org_client").on(t.orgId, t.client)],
);

/**
 * A client's link (`<PUBLIC_URL>/p/<token>`): the only way into its page, with no account. Only the token's hash
 * is kept, so the address can be shown again while a copy of it isn't in the database.
 */
export const portalClientLinks = pgTable(
  "portal_client_links",
  {
    id: uuid()
      .primaryKey()
      .$defaultFn(() => Bun.randomUUIDv7()),
    orgId: uuid()
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    clientId: uuid()
      .notNull()
      .references(() => portalClients.id, { onDelete: "cascade" }),
    tokenHash: text().notNull(),
    createdBy: text().references(() => users.id, { onDelete: "set null" }),
    createdAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
    lastUsedAt: timestamp({ withTimezone: true }),
    /** Set when the team revokes it: the address answers nothing from then on. */
    revokedAt: timestamp({ withTimezone: true }),
  },
  (t) => [
    uniqueIndex("portal_client_links_token").on(t.tokenHash),
    index("portal_client_links_client").on(t.orgId, t.clientId),
  ],
);

/**
 * A post at the portal: what the team sent a client to approve. `version` grows with each new version after a change
 * the client asked for; `files` and the client's notes are kept per version.
 */
export const portalPosts = pgTable(
  "portal_posts",
  {
    id: uuid()
      .primaryKey()
      .$defaultFn(() => Bun.randomUUIDv7()),
    orgId: uuid()
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    /** The client's id (`portal_clients.client`). */
    client: text().notNull(),
    title: text().notNull().default(""),
    type: text().$type<"reel" | "carousel" | "image" | "story">().notNull().default("image"),
    status: text()
      .$type<"sent" | "seen" | "approved" | "adjust_requested" | "adjusting" | "adjusted" | "scheduled" | "published">()
      .notNull()
      .default("sent"),
    caption: text().notNull().default(""),
    editor: text(),
    /** The post's own kind, read from its files: a video plays in the client's page. */
    video: boolean().notNull().default(false),
    version: integer().notNull().default(1),
    scheduledFor: timestamp({ withTimezone: true }),
    /** Released for publication at `scheduledFor`: never released twice. */
    released: boolean().notNull().default(false),
    publishedAt: timestamp({ withTimezone: true }),
    postUrl: text(),
    /** The card this post finished, once it is tied to it. */
    card: text(),
    /** When the client last looked at it. */
    seenAt: timestamp({ withTimezone: true }),
    createdAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("portal_posts_client").on(t.orgId, t.client, t.updatedAt)],
);

/** One file of a post's version, in the carousel's order. Its bytes stay in the platform's storage. */
export const portalPostFiles = pgTable(
  "portal_post_files",
  {
    id: uuid()
      .primaryKey()
      .$defaultFn(() => Bun.randomUUIDv7()),
    orgId: uuid()
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    postId: uuid()
      .notNull()
      .references(() => portalPosts.id, { onDelete: "cascade" }),
    /** The version it belongs to. */
    version: integer().notNull().default(1),
    /** Its place in the carousel: lower first. */
    position: integer().notNull().default(0),
    /** `media`, or `cover` (a reel's picture, shown before it plays). */
    role: text().$type<"media" | "cover">().notNull().default("media"),
    name: text().notNull(),
    contentType: text().notNull(),
    size: integer().notNull().default(0),
    blobKey: text().notNull(),
    storageConfigId: uuid(),
    createdAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("portal_post_files_post").on(t.postId, t.version, t.role, t.position)],
);

/**
 * What the client wrote on a post: a comment on the whole, or a mark on a point of it (a second of a video, a spot of
 * a slide). Outside text.
 */
export const portalPostNotes = pgTable(
  "portal_post_notes",
  {
    id: uuid()
      .primaryKey()
      .$defaultFn(() => Bun.randomUUIDv7()),
    orgId: uuid()
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    postId: uuid()
      .notNull()
      .references(() => portalPosts.id, { onDelete: "cascade" }),
    /** The post's version it is on. */
    version: integer().notNull().default(1),
    /** Where in a video, in seconds; null: not a point in time. */
    atSeconds: real(),
    /** A carousel's slide, from 1; null: none. */
    page: integer(),
    x: real(),
    y: real(),
    text: text().notNull(),
    /** Links the client attached: none from this page, kept for the fixture's shape. */
    files: jsonb().$type<string[]>().notNull().default([]),
    /** The contact's name, as the team reads it. */
    by: text(),
    /** `approve` or `adjust`: what the note came with. */
    kind: text().$type<"approve" | "adjust">(),
    at: timestamp({ withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("portal_post_notes_post").on(t.postId, t.at)],
);

/** A card of the team's board: a post still to make (`todo`) or being made (`doing`). */
export const portalCards = pgTable(
  "portal_cards",
  {
    id: uuid()
      .primaryKey()
      .$defaultFn(() => Bun.randomUUIDv7()),
    orgId: uuid()
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    client: text().notNull(),
    title: text().notNull().default(""),
    type: text().$type<"reel" | "carousel" | "image" | "story">().notNull().default("image"),
    state: text().$type<"todo" | "doing">().notNull().default("todo"),
    caption: text().notNull().default(""),
    /** The day the post goes out (`YYYY-MM-DD`). */
    date: text(),
    /** The day whoever is on it makes it (`YYYY-MM-DD`). */
    produceOn: text(),
    editor: text(),
    owner: text(),
    note: text().notNull().default(""),
    /** Drive files that go up with it. */
    files: jsonb().$type<{ id: string; name: string }[]>().notNull().default([]),
    /** The schedule's list it is in. */
    list: uuid(),
    /** Its place in the list: lower first. */
    order: integer().notNull().default(0),
    description: text().notNull().default(""),
    labels: jsonb().$type<string[]>().notNull().default([]),
    members: jsonb().$type<string[]>().notNull().default([]),
    checklist: jsonb().$type<{ id: string; text: string; done: boolean }[]>().notNull().default([]),
    comments: jsonb().$type<{ id: string; by: string; text: string; at: number }[]>().notNull().default([]),
    /** The post it became, once sent. */
    item: text(),
    /** The workspace task that stands for it. */
    task: text(),
    done: boolean().notNull().default(false),
    createdAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("portal_cards_org_client").on(t.orgId, t.client, t.order)],
);

/** A list of a client's: a week of the strategic schedule, or a shelf of the client's materials. */
export const portalLists = pgTable(
  "portal_lists",
  {
    id: uuid()
      .primaryKey()
      .$defaultFn(() => Bun.randomUUIDv7()),
    orgId: uuid()
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    client: text().notNull(),
    name: text().notNull(),
    kind: text().$type<"plan" | "materials">().notNull().default("plan"),
    position: integer().notNull().default(0),
    createdAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("portal_lists_org_client").on(t.orgId, t.client, t.position)],
);

/** A label of the team's own, the same for every client. */
export const portalLabels = pgTable(
  "portal_labels",
  {
    id: uuid()
      .primaryKey()
      .$defaultFn(() => Bun.randomUUIDv7()),
    orgId: uuid()
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    name: text().notNull(),
    color: text().notNull().default("gray"),
    createdAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("portal_labels_org").on(t.orgId, t.createdAt)],
);

/**
 * A send's job: uploaded, then at the client's. With this server's own portal both happen in one transaction, so a
 * job is `done` before the caller reads it; the row keeps the answer and the same key never sends twice.
 */
export const portalJobs = pgTable(
  "portal_jobs",
  {
    id: uuid()
      .primaryKey()
      .$defaultFn(() => Bun.randomUUIDv7()),
    orgId: uuid()
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    state: text().$type<"sending" | "done" | "failed">().notNull().default("done"),
    client: text().notNull(),
    item: text(),
    title: text(),
    missing: jsonb().$type<string[]>().notNull().default([]),
    error: text(),
    /** The idempotency key of the send that made it. */
    key: text(),
    createdAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [uniqueIndex("portal_jobs_key").on(t.orgId, t.key)],
);

/** A file read and kept for a moment, before the send that ties it to a post (`ApprovalPortal.upload`). */
export const portalUploads = pgTable(
  "portal_uploads",
  {
    id: uuid()
      .primaryKey()
      .$defaultFn(() => Bun.randomUUIDv7()),
    orgId: uuid()
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    name: text().notNull(),
    contentType: text().notNull(),
    size: integer().notNull().default(0),
    blobKey: text().notNull(),
    storageConfigId: uuid(),
    createdAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("portal_uploads_org").on(t.orgId, t.createdAt)],
);

/**
 * A notice a client was sent (docs/adr/doug-0031-embedded-approval-portal.md §7): which client, by which way
 * (`email`, `whatsapp`), to which of its contacts, about which post and version, and when. It is what the limits are
 * read from: a contact hears about one post at most twice a day, and a notice for a client inside `PORTAL_NOTICE_GROUP_MS`
 * of another is that one, whose `posts[]` it joins. A row is written only when something went out, so a client with no
 * contact that reaches is never counted.
 */
export const portalNotices = pgTable(
  "portal_notices",
  {
    id: uuid()
      .primaryKey()
      .$defaultFn(() => Bun.randomUUIDv7()),
    orgId: uuid()
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    /** The client's id (`portal_clients.client`). */
    client: text().notNull(),
    /** `email` or `whatsapp`: the way it went. */
    channel: text().$type<"email" | "whatsapp">().notNull(),
    /** The contact it reached (`portal_clients.contacts[].id`), when it was one. */
    contactId: text(),
    postId: uuid(),
    version: integer(),
    at: timestamp({ withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index("portal_notices_client").on(t.orgId, t.client, t.at),
    index("portal_notices_outcome").on(t.orgId, t.client, t.channel, t.contactId, t.at),
  ],
);
