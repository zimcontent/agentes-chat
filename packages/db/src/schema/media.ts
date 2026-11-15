import { index, integer, jsonb, pgTable, text, timestamp, uuid } from "drizzle-orm/pg-core";
import { agents } from "./agents";
import { users } from "./auth";
import { organizations } from "./tenancy";

/**
 * An image or video a person or an agent generated through the Zim Mídia service (ADR doug-0010). The id is the
 * service's own; the wallet and the provider live there, this row keeps who asked, where the result goes and the
 * Drive file it became. Created by `EXTRA_COLUMNS`, outside the numbered migrations.
 */
export const mediaGenerations = pgTable(
  "media_generations",
  {
    id: uuid().primaryKey(),
    orgId: uuid()
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    kind: text().$type<"image" | "video">().notNull(),
    model: text().notNull(),
    prompt: text().notNull(),
    options: jsonb()
      .$type<{ quality: string; aspect: string; seconds: number; audio: boolean }>()
      .notNull()
      .default({} as never),
    credits: integer().notNull(),
    /** `running`, `succeeded` (the file is in the Drive), `failed` (the credits went back). */
    status: text().$type<"running" | "succeeded" | "failed">().notNull().default("running"),
    error: text(),
    /** Who asked: a person, or an agent (then also its run and where it was talking). */
    userId: text().references(() => users.id, { onDelete: "set null" }),
    agentId: uuid().references(() => agents.id, { onDelete: "set null" }),
    runId: uuid(),
    channelId: uuid(),
    threadId: uuid(),
    artifactId: uuid(),
    createdAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
    finishedAt: timestamp({ withTimezone: true }),
  },
  (t) => [
    index("media_generations_org").on(t.orgId, t.createdAt),
    index("media_generations_agent").on(t.agentId, t.createdAt),
  ],
);
