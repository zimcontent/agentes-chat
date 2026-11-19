import { bigint, index, integer, jsonb, pgTable, text, timestamp, uuid } from "drizzle-orm/pg-core";
import { users } from "./auth";
import { organizations } from "./tenancy";

/**
 * A workspace's OpenAI key for live voice (ADR doug-0006), sealed like provider keys (ADR 0007): never returned, shown by
 * its last 4 characters. One per workspace; the voice calls and "Ouvir" of every member spend it. Created by
 * `EXTRA_COLUMNS` (`packages/db/src/client.ts`), not by a numbered migration.
 */
export const liveVoiceKeys = pgTable("live_voice_keys", {
  orgId: uuid()
    .primaryKey()
    .references(() => organizations.id, { onDelete: "cascade" }),
  ciphertext: text().notNull(),
  wrappedDataKey: text().notNull(),
  kekId: text().notNull(),
  keyHint: text().notNull(),
  updatedBy: text().references(() => users.id, { onDelete: "set null" }),
  updatedAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
});

/**
 * One live voice session with OpenAI (ADR doug-0006): an agent's voice on a call (`call`, one per agent, sharing `callId`),
 * a message told by voice (`listen`) or a voice's sample (`sample`). What it cost is settled once, when it ends
 * (`endedAt`), from OpenAI's own count of seconds when the server heard it, else from the clock.
 */
export const liveVoiceSessions = pgTable(
  "live_voice_sessions",
  {
    id: uuid()
      .primaryKey()
      .$defaultFn(() => crypto.randomUUID()),
    orgId: uuid()
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    userId: text().references(() => users.id, { onDelete: "set null" }),
    kind: text().$type<"call" | "agent" | "listen" | "sample">().notNull(),
    /** The agent speaking; null for a message a person wrote, told by the narrator's voice. No foreign key: history. */
    agentId: uuid(),
    channelId: uuid(),
    messageId: uuid(),
    /** The call it belongs to: every agent's session on one call shares it. */
    callId: uuid(),
    /** OpenAI's id for the session (`sess_…`). */
    providerSessionId: text(),
    voice: text().notNull(),
    startedAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
    endedAt: timestamp({ withTimezone: true }),
    /** `close_requested`, `expired`, `connection_lost`… as OpenAI says it, or `ended` (the app), `swept`. */
    endReason: text(),
    seconds: integer().notNull().default(0),
    costNanoUsd: bigint({ mode: "number" }).notNull().default(0),
    /**
     * Where its audio goes (docs/adr/doug-0036-house-voice.md): `gpt-live` (OpenAI over WebRTC, the workspace's key) or
     * `house` (the house voice, relayed by this server, paid in credits).
     */
    engine: text().$type<"gpt-live" | "house">().notNull().default("gpt-live"),
    /** `house`: the credits it was charged, once it ended. */
    credits: integer().notNull().default(0),
  },
  (t) => [index().on(t.orgId, t.startedAt), index().on(t.userId, t.startedAt)],
);

export interface LiveRoomPerson {
  userId: string;
  joinedAt: string;
  /** Its last sign of life (the app pings while it is in): past a minute, it left. */
  seenAt: string;
  leftAt: string | null;
  /**
   * In from the phone app: it can't pass the agents' voices on to the others, so a person on the web or the desktop
   * app runs them when one is in (docs/adr/doug-0006-live-voice.md, the phone app).
   */
  phone?: boolean;
}

export interface LiveRoomLine {
  at: string;
  who: { type: "person" | "agent"; id: string };
  text: string;
}

/**
 * A voice room in a conversation (ADR doug-0006): people and agents on one call. At most one is live per conversation.
 * `hostUserId` runs the agents' voices from their app; when they leave, the next person in takes over. `lines` is what
 * was said, for the notes the room leaves in the conversation when it ends (`reportMessageId`).
 */
export const liveVoiceRooms = pgTable(
  "live_voice_rooms",
  {
    id: uuid()
      .primaryKey()
      .$defaultFn(() => crypto.randomUUID()),
    orgId: uuid()
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    channelId: uuid().notNull(),
    hostUserId: text(),
    agentIds: jsonb().$type<string[]>().notNull().default([]),
    people: jsonb().$type<LiveRoomPerson[]>().notNull().default([]),
    lines: jsonb().$type<LiveRoomLine[]>().notNull().default([]),
    status: text().$type<"live" | "ended">().notNull().default("live"),
    /**
     * `live`: one GPT-Live session per agent, run by the host's app. `maestro`: the server decides who speaks and what,
     * each person's words come transcribed and the agents speak by text to speech (docs/adr/doug-0006-live-voice.md
     * §11). Created by `EXTRA_COLUMNS`.
     */
    mode: text().$type<"live" | "maestro">().notNull().default("live"),
    /** What the call opens on (a maestro room started to debate something). */
    topic: text(),
    reportMessageId: uuid(),
    startedAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
    endedAt: timestamp({ withTimezone: true }),
  },
  (t) => [index().on(t.orgId, t.channelId, t.status)],
);
