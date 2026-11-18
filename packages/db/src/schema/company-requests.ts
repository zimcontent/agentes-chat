import { index, pgTable, text, timestamp, uniqueIndex, uuid } from "drizzle-orm/pg-core";
import { users } from "./auth";

/**
 * Companies that asked for DougBot on the installation's own page ("Quero o DougBot na minha empresa"): the team
 * reads each one, talks to it, and sends the invitation when it is time. Its own list, apart from the product's
 * email waiting list (`waitlist_entries`): nobody here is invited by a launch wave, and what the form asks is about
 * the company, not the person. Not tenant-owned: it exists before any organization. Created by `EXTRA_COLUMNS`,
 * outside the numbered migrations.
 */
export const companyRequests = pgTable(
  "company_requests",
  {
    id: uuid()
      .primaryKey()
      .$defaultFn(() => Bun.randomUUIDv7()),
    /** Who filled the form. */
    name: text().notNull(),
    /** Lowercase and trimmed; one request per address, sending the form again updates it. */
    email: text().notNull(),
    /** As sent, with the country code: E.164 ("+5511912345678") or a number as typed. */
    whatsapp: text().notNull(),
    company: text().notNull(),
    /** Which size band, a code of `TEAM_SIZES` (`6-20`, `200+`). */
    teamSize: text().notNull(),
    /** What they want to automate, codes of `COMPANY_INTERESTS` (`design`, `video`, `ads`, `social`, `code`, `finance`). */
    interests: text().array().notNull().default([]),
    /** Their words, in a field of its own: what the form doesn't ask. */
    message: text().notNull().default(""),
    /** The page's language (a code of `@agenteschat/i18n/locale`). */
    locale: text().notNull().default("en"),
    /** Where it came from ("companies", the page). */
    source: text().notNull().default("companies"),
    /**
     * The consent to keep and use this (LGPD): when it was given, and the version of the notice it was given for.
     * Without it the row is never written.
     */
    consentAt: timestamp({ withTimezone: true }).notNull(),
    consentVersion: text().notNull(),
    /** `new`, `talking`, `invited`, `deployed` (a client) or `discarded`, the team's own step (`REQUEST_STATUSES`). */
    status: text().notNull().default("new"),
    /**
     * The client's code on this installation (`064`), kept once the company becomes one: the deployments take it
     * when the workspace is made for them. Null until then.
     */
    clientCode: text(),
    /** What the team wrote about this company, for itself. */
    notes: text().notNull().default(""),
    /** When the invitation went out, and by whom. */
    invitedAt: timestamp({ withTimezone: true }),
    invitedByUserId: text().references(() => users.id, { onDelete: "set null" }),
    createdAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex("company_requests_email").on(t.email),
    index("company_requests_status").on(t.status, t.createdAt, t.id),
    index("company_requests_created").on(t.createdAt, t.id),
  ],
);
