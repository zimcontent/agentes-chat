import { index, integer, jsonb, pgTable, text, timestamp, uuid } from "drizzle-orm/pg-core";
import { agents } from "./agents";
import { users } from "./auth";
import { organizations } from "./tenancy";

/**
 * A person's phone line (docs/adr/doug-0035-phone-calls.md): the address of the calling service that dials a number and
 * carries the call to a voice, and its token, sealed like provider keys (ADR 0007), never returned, shown by its last 4
 * characters. A workspace owner's own, one per person, not per workspace: the Doug of every workspace they own calls
 * through it. Created by `EXTRA_COLUMNS` (`packages/db/src/client.ts`), not by a numbered migration.
 */
export const phoneLines = pgTable("phone_lines", {
  userId: text()
    .primaryKey()
    .references(() => users.id, { onDelete: "cascade" }),
  url: text().notNull(),
  /** The number calls come from, as the service says it (E.164), only to show. */
  fromNumber: text().notNull().default(""),
  ciphertext: text().notNull(),
  wrappedDataKey: text().notNull(),
  kekId: text().notNull(),
  tokenHint: text().notNull(),
  /** The voices the service can call with, as it says (`gpt-live`, `qwen`). */
  engines: jsonb().$type<string[]>().notNull().default(["gpt-live"]),
  updatedAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
});

export interface PhoneCallLine {
  who: "agent" | "person";
  text: string;
}

/**
 * One call an agent made (`phone_call`, approved by a person): where it was asked, so what was said comes back there
 * when it ends. `hook_hash` is the SHA-256 of the one-use secret in the address the service reports to.
 */
export const phoneCalls = pgTable(
  "phone_calls",
  {
    id: uuid().primaryKey(),
    orgId: uuid()
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    agentId: uuid()
      .notNull()
      .references(() => agents.id, { onDelete: "cascade" }),
    runId: uuid(),
    channelId: uuid().notNull(),
    threadId: uuid(),
    triggerMessageId: uuid(),
    requestedBy: text().references(() => users.id, { onDelete: "set null" }),
    /** Whose line it went out on. */
    lineUserId: text(),
    to: text().notNull(),
    brief: text().notNull(),
    /** `calling` until the service reports; then `ended` (someone answered) or `failed` (nobody, or it broke). */
    status: text().notNull().default("calling"),
    hookHash: text().notNull(),
    providerCallId: text(),
    /** The voice it went out with (`gpt-live`, `qwen`). */
    engine: text().notNull().default("gpt-live"),
    seconds: integer(),
    /** Credits charged for it (a house voice only); null until charged. */
    credits: integer(),
    lines: jsonb().$type<PhoneCallLine[]>().notNull().default([]),
    createdAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
    endedAt: timestamp({ withTimezone: true }),
  },
  (t) => [index().on(t.orgId, t.createdAt)],
);
