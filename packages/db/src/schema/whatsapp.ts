import { sql } from "drizzle-orm";
import { boolean, index, integer, jsonb, pgTable, text, timestamp, uniqueIndex, uuid } from "drizzle-orm/pg-core";
import { agents } from "./agents";
import { users } from "./auth";
import { organizations } from "./tenancy";

/**
 * A WhatsApp number the workspace connected through the gateway (`WHATSAPP_GATEWAY_URL`). The gateway keeps the
 * session; this row keeps who may use the number and where its events arrive. These tables are this instance's
 * own, outside the numbered migrations (`EXTRA_COLUMNS` in `client.ts`).
 */
export const whatsappAccounts = pgTable(
  "whatsapp_accounts",
  {
    id: uuid()
      .primaryKey()
      .$defaultFn(() => Bun.randomUUIDv7()),
    orgId: uuid()
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    /** Shown to people ("Comercial", "Suporte"). */
    label: text().notNull(),
    /**
     * `pending` (made, no QR code yet), `qr` (a code is waiting to be read), `connected`, `disconnected` (the
     * session dropped and comes back by itself) or `logged_out` (the phone removed it: only a new code brings it back).
     */
    status: text().$type<"pending" | "qr" | "connected" | "disconnected" | "logged_out">().notNull().default("pending"),
    /** The number's own address once connected, and its digits. */
    jid: text(),
    phone: text(),
    /**
     * The number's hidden id (`…@lid`), learned from what it sends in a group: groups name their members by it, so a
     * mention of this number may carry it instead of `jid` (docs/adr/doug-0007-whatsapp-groups.md). Null: not yet.
     */
    lid: text(),
    /** The name the phone shows for itself. */
    pushName: text().notNull().default(""),
    /** The gateway's id for this number. */
    instanceId: text().notNull(),
    /** The number's token at the gateway, sealed (bound to org and row). */
    tokenCiphertext: text().notNull(),
    wrappedDataKey: text().notNull(),
    kekId: text().notNull(),
    /** SHA-256 of the secret in the address the gateway posts this number's events to. */
    hookHash: text().notNull(),
    /** The QR code to read now, a `data:image/png` address, and when it came. Gone once connected. */
    qrImage: text(),
    qrAt: timestamp({ withTimezone: true }),
    /** The people who may read and answer this number's conversations (user ids). */
    people: text().array().notNull().default(sql`'{}'::text[]`),
    /** The agent that answers this number; null: only people do. */
    agentId: uuid().references(() => agents.id, { onDelete: "set null" }),
    /**
     * How the agent carries itself on this number, in the workspace's own words (Markdown): its tone, what it may
     * promise, when it hands over to a person. On top of the agent's own instructions, for this number alone.
     */
    instructions: text().notNull().default(""),
    /** The agent answers this number's conversations now. Off: it is chosen, and says nothing. */
    agentOn: boolean().notNull().default(false),
    /**
     * How the agent talks on this number: how long it waits after a message before reading the conversation
     * (seconds), how fast it "types" (`fast`, `natural`, `slow`), the most messages one answer is split in, and how
     * long it stays quiet in a conversation a person answered (minutes).
     */
    agentWaitSeconds: integer().notNull().default(8),
    agentPace: text().$type<"fast" | "natural" | "slow">().notNull().default("natural"),
    agentMessages: integer().notNull().default(3),
    agentQuietMinutes: integer().notNull().default(60),
    /**
     * The agent sends voice notes now and then (docs/adr/doug-0004-whatsapp-bridge.md, addendum 2026-11-15): always to a
     * voice message, sometimes on its own. `agentVoice`: the voice (a provider's id); null: the default one.
     */
    agentVoiceNotes: boolean().notNull().default(true),
    agentVoice: text(),
    /**
     * The AI the number answers with when it isn't its agent's own (docs/adr/doug-0004-whatsapp-bridge.md):
     * `{ brain, model, account, effort }`, read by `whatsappBrainOf`. Null: the agent's own AI.
     */
    brain: jsonb().$type<Record<string, unknown> | null>(),
    lastError: text(),
    createdBy: text().references(() => users.id, { onDelete: "set null" }),
    createdAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [uniqueIndex("whatsapp_accounts_hook").on(t.hookHash), index("whatsapp_accounts_org").on(t.orgId)],
);

/** One conversation of a number: a person or a group. */
export const whatsappChats = pgTable(
  "whatsapp_chats",
  {
    id: uuid()
      .primaryKey()
      .$defaultFn(() => Bun.randomUUIDv7()),
    orgId: uuid()
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    accountId: uuid()
      .notNull()
      .references(() => whatsappAccounts.id, { onDelete: "cascade" }),
    /** The chat's address on WhatsApp. */
    jid: text().notNull(),
    /** The person's or the group's name as WhatsApp tells it (outside text); empty until one arrives. */
    name: text().notNull().default(""),
    /** The person's hidden id on WhatsApp (`…@lid`), when told: messages addressed to it are this conversation's. */
    lid: text(),
    group: boolean().notNull().default(false),
    /** The latest message, for the list: when, its words and whether this number sent it. */
    lastAt: timestamp({ withTimezone: true }),
    lastText: text().notNull().default(""),
    lastKind: text().notNull().default("text"),
    lastFromMe: boolean().notNull().default(false),
    /** Messages received since someone last opened the chat here. */
    unread: integer().notNull().default(0),
    /** Someone turned the number's agent off in this conversation: it stays quiet here until they turn it back on. */
    agentOff: boolean().notNull().default(false),
    /** When a person last wrote here (in the app or on the phone): the agent stays quiet for a while after it. */
    personAt: timestamp({ withTimezone: true }),
    /** The agent left this conversation to a person, and why in its own words (written by a model: shown as text). */
    needsPerson: boolean().notNull().default(false),
    agentNote: text().notNull().default(""),
    /**
     * Who the contact is (docs/adr/doug-0004-whatsapp-bridge.md, addendum 2026-11-15): a member of the workspace (their
     * messages go to their conversation with the number's agent, which answers with all it has), or a client of the
     * approval portal (the answers read that client's own work). Null: someone else.
     */
    memberUserId: text(),
    portalClient: text(),
    /**
     * A group only: the agent is in the conversation until then. Called (a mention, its name, a reply to it) opens it;
     * every message in the group moves it to that message plus `WHATSAPP_GROUP_SESSION_MINUTES`; past it the agent
     * waits to be called again (docs/adr/doug-0007-whatsapp-groups.md).
     */
    agentSessionUntil: timestamp({ withTimezone: true }),
    /**
     * Where its profile photo is on WhatsApp's servers, as the gateway last told (null: none, or hidden from this
     * number), and when it was asked: asked again a day later, or when the address stops answering.
     */
    photoUrl: text(),
    photoAt: timestamp({ withTimezone: true }),
    createdAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex("whatsapp_chats_jid").on(t.accountId, t.jid),
    index("whatsapp_chats_recent").on(t.accountId, t.lastAt),
  ],
);

/** One message of a conversation, either way. */
export const whatsappMessages = pgTable(
  "whatsapp_messages",
  {
    id: uuid()
      .primaryKey()
      .$defaultFn(() => Bun.randomUUIDv7()),
    orgId: uuid()
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    accountId: uuid()
      .notNull()
      .references(() => whatsappAccounts.id, { onDelete: "cascade" }),
    chatId: uuid()
      .notNull()
      .references(() => whatsappChats.id, { onDelete: "cascade" }),
    /** WhatsApp's own id: an event told twice is one message. */
    waId: text().notNull(),
    fromMe: boolean().notNull(),
    senderJid: text().notNull(),
    senderName: text().notNull().default(""),
    kind: text().notNull().default("text"),
    /** The words: a text, a file's caption. Outside text. */
    body: text().notNull().default(""),
    replyToWaId: text(),
    /** A file's type, name and length. */
    media: jsonb().$type<{ mimeType: string; fileName: string | null; seconds: number | null }>(),
    /** A file's message as WhatsApp carries it: what the gateway needs back to fetch the file. */
    raw: jsonb(),
    /** Ours: `sent`, `delivered`, `read`. Theirs: `received`. */
    status: text().$type<"received" | "sent" | "delivered" | "read">().notNull(),
    /** Who wrote it in our app; null when it came from the phone or from outside. */
    sentByUserId: text().references(() => users.id, { onDelete: "set null" }),
    /** The agent that wrote it, when the number's agent answered. */
    sentByAgentId: uuid().references(() => agents.id, { onDelete: "set null" }),
    /**
     * What a received file shows or says, in words, for the number's agent (docs/adr/doug-0034-whatsapp-files.md): a
     * picture or a document read by a model that sees, a video's frames and sound. Null: not looked at yet; empty:
     * looked at, nothing could be made of it. Outside text, like the file.
     */
    seen: text(),
    /** The Drive file a received file became, for a member's conversation with the agent; null: none yet. */
    artifactId: uuid(),
    at: timestamp({ withTimezone: true }).notNull(),
    createdAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex("whatsapp_messages_wa").on(t.accountId, t.waId),
    index("whatsapp_messages_chat").on(t.chatId, t.at),
  ],
);
