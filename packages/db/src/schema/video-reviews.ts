import { boolean, index, integer, jsonb, pgTable, real, text, timestamp, uniqueIndex, uuid } from "drizzle-orm/pg-core";
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
    /** The client it is for ("Alliance"), as the agent says it; a filter in the list. */
    client: text().notNull().default(""),
    /** What was asked of the editor, in the asker's words, and whether there was any direction; "" when not told. */
    brief: text().notNull().default(""),
    /** Where the work comes from and goes: the task, the footage, the delivery. */
    links: jsonb().$type<VideoReviewLink[]>().notNull().default([]),
    status: text().$type<VideoReviewStatus>().notNull().default("in_review"),
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
    /** Sent to the agent with a decision: kept, read only. */
    sentAt: timestamp({ withTimezone: true }),
    createdAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index().on(t.reviewId, t.version)],
);
