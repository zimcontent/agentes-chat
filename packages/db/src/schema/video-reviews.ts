import {
  boolean,
  index,
  integer,
  jsonb,
  pgTable,
  primaryKey,
  real,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";
import { agents } from "./agents";
import { users } from "./auth";
import { organizations } from "./tenancy";

/**
 * A video an agent made, waiting on the team's review (docs/adr/doug-0007-video-review.md): its versions stack (V1, V2…),
 * people pin notes to a second of a version, and the decision ("approved" or "changes") goes back to the agent in the
 * conversation it sent the video from. Created by `EXTRA_COLUMNS` (`packages/db/src/client.ts`), not by a numbered
 * migration.
 */
export const videoReviews = pgTable(
  "video_reviews",
  {
    id: uuid()
      .primaryKey()
      .$defaultFn(() => crypto.randomUUID()),
    orgId: uuid()
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    /** The agent that made it and gets the notes back. */
    agentId: uuid().references(() => agents.id, { onDelete: "set null" }),
    /** Where the agent sent it from: the notes are posted there, and who reads that conversation reviews it. */
    channelId: uuid().notNull(),
    threadId: uuid(),
    title: text().notNull(),
    /**
     * What is reviewed: a `video`, or a `design` piece (slides as pictures, and the page they were drawn from, which
     * people can edit; docs/adr/doug-0010-design-review.md).
     */
    medium: text().$type<ReviewMedium>().notNull().default("video"),
    /** The client it is for ("Alliance"), as the agent says it; a filter in the list. */
    client: text().notNull().default(""),
    /** What was asked of the editor, in the asker's words, and whether there was any direction; "" when not told. */
    brief: text().notNull().default(""),
    /** Where the work comes from and goes: the task, the footage, the delivery. */
    links: jsonb().$type<VideoReviewLink[]>().notNull().default([]),
    status: text().$type<VideoReviewStatus>().notNull().default("in_review"),
    /** The approval portal's client a design piece is for (its id there, `lexeer`); null: none known. */
    portalClient: text(),
    /** The portal's card it finishes, when it came from one (a portal task, ADR 9001 §11). */
    portalCard: text(),
    /** What happened at the portal after the approval (`design-delivery.ts`); null: nothing yet. */
    delivery: jsonb().$type<Record<string, unknown>>(),
    /**
     * A person who sent the video from a task (an editor on the team, docs/adr/doug-0012-editor-delivery.md); null: an
     * agent sent it (`agentId`).
     */
    senderUserId: text(),
    /** The task it delivers, when it was sent from one: its conversation is the review's. */
    taskId: uuid(),
    /** Its number among the task's videos (a task may ask for several, doug-0012 §13); null: from before, the first. */
    taskPart: integer(),
    /** The post around a person's video: its cover and caption, each approved by the team (`editor-delivery.ts`). */
    post: jsonb().$type<ReviewPost>().notNull().default({}),
    /** The approved original kept as the final, and its backup; null: not yet. */
    final: jsonb().$type<Record<string, unknown>>(),
    /** The portal's version numbers of the post and the review's version each one is (`{ "1": 2 }`). */
    portalVersions: jsonb().$type<Record<string, number>>().notNull().default({}),
    /** The newest version's number. */
    version: integer().notNull().default(1),
    decidedBy: text().references(() => users.id, { onDelete: "set null" }),
    decidedAt: timestamp({ withTimezone: true }),
    createdAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index().on(t.orgId, t.status, t.updatedAt)],
);

export type VideoReviewStatus = "in_review" | "changes" | "approved";
/** The parts of a post besides its video (docs/adr/doug-0012-editor-delivery.md). */
export interface ReviewPost {
  /** The cover, a picture file of the review's conversation; absent: none chosen yet. */
  cover?: string | null;
  /** The post goes without a cover of its own (the portal uses the video's first frame). */
  noCover?: boolean;
  coverOk?: boolean;
  caption?: string;
  captionOk?: boolean;
}
export type ReviewMedium = "video" | "design";
/** One slide of a design version: a picture file (an artifact), in order. */
export interface DesignPage {
  artifactId: string;
}
export interface VideoReviewLink {
  label: string;
  url: string;
}
/** A file a reviewer dropped on a note (stored as a file of the review's conversation), or a link they pasted. */
export type VideoReviewAttachment =
  | { type: "file"; artifactId: string; name: string; media: "image" | "video" | "audio" | "other" }
  | { type: "link"; url: string; label: string };

/** One version of a reviewed video: a file of the Drive or a conversation (an artifact). */
export const videoReviewVersions = pgTable(
  "video_review_versions",
  {
    id: uuid()
      .primaryKey()
      .$defaultFn(() => crypto.randomUUID()),
    orgId: uuid()
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    reviewId: uuid()
      .notNull()
      .references(() => videoReviews.id, { onDelete: "cascade" }),
    version: integer().notNull(),
    artifactId: uuid().notNull(),
    /** What the agent says changed, or what it is (V1). */
    note: text().notNull().default(""),
    /**
     * The light copy for phones, kept beside the file's bytes (`lightKey`): "" not asked yet, `pending` being made,
     * `ready`, `none` (no smaller than the original) or `failed`.
     */
    lightState: text().notNull().default(""),
    /** A design version's slides, as pictures, in order; [] for a video, or for a page a person edited by hand. */
    pages: jsonb().$type<DesignPage[]>().notNull().default([]),
    /** A design version's editable page (one HTML file, everything in it inlined); null: pictures only. */
    sourceArtifactId: uuid(),
    /** A person who made this version in the editor; null: the agent sent it. */
    editedBy: text(),
    /**
     * The copy that goes to the post (H.264 1080, `postKey` beside the file's bytes): "" not asked, `ready`, `failed`
     * (docs/adr/doug-0012-editor-delivery.md).
     */
    postState: text().notNull().default(""),
    createdAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [uniqueIndex().on(t.reviewId, t.version)],
);

/** A person's note on a second of one version: typed, or said and transcribed (`voice`). */
export const videoReviewNotes = pgTable(
  "video_review_notes",
  {
    id: uuid()
      .primaryKey()
      .$defaultFn(() => crypto.randomUUID()),
    orgId: uuid()
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    reviewId: uuid()
      .notNull()
      .references(() => videoReviews.id, { onDelete: "cascade" }),
    version: integer().notNull(),
    /** Where in the video, in milliseconds; null: about the whole video. */
    atMs: integer(),
    /** The slide of a design piece the note is on, from 1; null: a video, or the whole piece. */
    page: integer(),
    /** Where a stretch ends, in milliseconds; null: one point. */
    endMs: integer(),
    /** Where on the picture the reviewer pointed, as fractions of its width and height; null: nowhere in particular. */
    x: real(),
    y: real(),
    /** What the note is about (`REVIEW_NOTE_KINDS` in the engine); null: not said. */
    kind: text(),
    body: text().notNull(),
    /** What the reviewer handed over with the note: files of the conversation (a photo, a clip) and links (B-roll). */
    attachments: jsonb().$type<VideoReviewAttachment[]>().notNull().default([]),
    voice: boolean().notNull().default(false),
    authorUserId: text().references(() => users.id, { onDelete: "set null" }),
    /** Who wrote it when not a member: the client at the portal ("Cliente (lexeer)"). */
    authorName: text(),
    /** The note's id where it came from (`portal:<mark id>`), so it is brought once. */
    externalId: text(),
    /** The client wrote it at the approval portal (docs/adr/doug-0012-editor-delivery.md §12). */
    fromClient: boolean().notNull().default(false),
    /** Sent to the agent with a decision: kept, read only. */
    sentAt: timestamp({ withTimezone: true }),
    createdAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index().on(t.reviewId, t.version)],
);

/**
 * One round of changes asked of the person who sent a review (docs/adr/doug-0012-editor-delivery.md §10): who asked
 * and when, when the person was told and saw it, and when the next version came. The team's log of the work.
 */
export const videoReviewRounds = pgTable(
  "video_review_rounds",
  {
    id: uuid()
      .primaryKey()
      .$defaultFn(() => crypto.randomUUID()),
    orgId: uuid()
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    reviewId: uuid()
      .notNull()
      .references(() => videoReviews.id, { onDelete: "cascade" }),
    /** The version the changes are on. */
    version: integer().notNull(),
    /** Who has to do them: the review's sender. */
    forUserId: text(),
    askedByUserId: text(),
    /** The asker's name as it was: a member's, or the client's. */
    askedByName: text().notNull().default(""),
    fromClient: boolean().notNull().default(false),
    /** How many notes it carried. */
    notes: integer().notNull().default(0),
    askedAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
    /** How the person was told beyond the app (`{ whatsapp: { at, chat } }` or `{ error }`); null: not yet. */
    notified: jsonb().$type<Record<string, unknown>>(),
    seenAt: timestamp({ withTimezone: true }),
    answeredAt: timestamp({ withTimezone: true }),
    answeredVersion: integer(),
  },
  (t) => [index().on(t.reviewId, t.askedAt), index().on(t.orgId, t.forUserId)],
);

/** Where a person is told of the changes asked of them, beyond the app: a WhatsApp conversation of a number. */
export const reviewWhatsapp = pgTable(
  "review_whatsapp",
  {
    orgId: uuid()
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    userId: text().notNull(),
    accountId: uuid().notNull(),
    chatId: uuid().notNull(),
    updatedBy: text(),
    updatedAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [primaryKey({ columns: [t.orgId, t.userId] })],
);

/**
 * What an approval in the Revisor means for one of the approval portal's clients (docs/adr/doug-0010-design-review.md
 * §8): `portal`, the piece goes to the client to approve (the default, for a client with no row), or `direct`, the
 * team's approval is the last one and the post is scheduled.
 */
export const portalClientSettings = pgTable(
  "portal_client_settings",
  {
    orgId: uuid()
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    client: text().notNull(),
    afterApprove: text().notNull().default("portal"),
    /** The name the team shows for the client, when the portal's slug isn't it (ADR 9001, addendum 2026-11-18). */
    displayName: text(),
    /** When the team hid the client from every list (ADR 9001, addendum 2026-11-18); null: shown. */
    hiddenAt: timestamp({ withTimezone: true }),
    updatedBy: text().references(() => users.id, { onDelete: "set null" }),
    updatedAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [primaryKey({ columns: [t.orgId, t.client] })],
);
