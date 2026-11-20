import { index, jsonb, pgTable, text, timestamp, uniqueIndex, uuid } from "drizzle-orm/pg-core";
import { users } from "./auth";
import { artifacts } from "./storage";
import { organizations } from "./tenancy";

/**
 * What a button of a card the server made does when pressed (docs/adr/doug-0020-doug-sector-cards.md): the block's
 * spec names it (`act`), this row holds what it is and what it acts on, so nothing the apps send decides the action.
 * It runs once: `doneAt` is claimed before it runs. Created by `EXTRA_COLUMNS`, outside the numbered migrations.
 */
export const blockActions = pgTable(
  "block_actions",
  {
    id: uuid()
      .primaryKey()
      .$defaultFn(() => Bun.randomUUIDv7()),
    orgId: uuid()
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    artifactId: uuid()
      .notNull()
      .references(() => artifacts.id, { onDelete: "cascade" }),
    /** The button's `act`. */
    act: text().notNull(),
    /**
     * What it does: `ask_agent` (the person's own message to the agent), `whatsapp_mine` (the person takes it),
     * `make_routine` / `skip_routine` (the offer under "Aprendi a fazer isso", ADR 0120 addendum 2026-11-20: one press
     * claims every button of its block).
     */
    kind: text().notNull(),
    /** What it acts on, by kind (`{ text }`, `{ accountId, chatId }`). */
    payload: jsonb().$type<Record<string, unknown>>().notNull().default({}),
    /** Only this person may press it (the card is theirs); null: anyone who reads its conversation. */
    forUserId: text().references(() => users.id, { onDelete: "cascade" }),
    doneAt: timestamp({ withTimezone: true }),
    doneByUserId: text().references(() => users.id, { onDelete: "set null" }),
    createdAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex("block_actions_act").on(t.artifactId, t.act),
    index("block_actions_org").on(t.orgId, t.createdAt),
  ],
);
