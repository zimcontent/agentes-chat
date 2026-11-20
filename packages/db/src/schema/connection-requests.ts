import { index, jsonb, pgTable, text, timestamp, uuid } from "drizzle-orm/pg-core";
import { agents } from "./agents";
import { users } from "./auth";
import { organizations } from "./tenancy";

/**
 * An agent's request to connect a service its task needs (`request_connection`,
 * docs/adr/doug-0039-connect-and-continue.md): the card in the conversation, the run that waits on it, and what it does
 * once the service is connected. `state`: `waiting` until the agent holds a working connection of `service` (then
 * `connected`), or until `expires_at` (`expired`). Created by `EXTRA_COLUMNS` (`packages/db/src/client.ts`), not by a
 * numbered migration.
 */
export const connectionRequests = pgTable(
  "connection_requests",
  {
    id: uuid().primaryKey(),
    orgId: uuid()
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    agentId: uuid()
      .notNull()
      .references(() => agents.id, { onDelete: "cascade" }),
    runId: uuid().notNull(),
    channelId: uuid().notNull(),
    threadId: uuid(),
    /** The card's message. */
    messageId: uuid(),
    /** Whom the agent works for (the person behind the run). */
    requestedForUserId: text().references(() => users.id, { onDelete: "set null" }),
    /** A catalog connector's id or a one-click preset's (`catalogConnector`). */
    service: text().notNull(),
    label: text().notNull(),
    why: text().notNull(),
    /** What the agent does once it is connected, in its own words: what a new run reads when the old one ended. */
    nextStep: text().notNull(),
    /** Who was asked to connect it because the person can't (`admin_ask`, reason `connector`). */
    askedUserIds: jsonb().$type<string[]>().notNull().default([]),
    state: text().notNull().default("waiting"),
    /** The connection that settled it. */
    connectionId: uuid(),
    createdAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
    expiresAt: timestamp({ withTimezone: true }).notNull(),
    endedAt: timestamp({ withTimezone: true }),
  },
  (t) => [index().on(t.orgId, t.state), index().on(t.runId)],
);
