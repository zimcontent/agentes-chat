import { sql } from "drizzle-orm";
import { index, integer, jsonb, pgTable, text, timestamp, uniqueIndex, uuid } from "drizzle-orm/pg-core";
import { users } from "./auth";

/** What a form sent again after a confirmation carries, kept until its own link is opened. */
export interface CompanyResend {
  name: string;
  company: string;
  whatsapp: string;
  teamSize: string;
  interests: string[];
  message: string;
  locale: string;
  sentAt: string;
}

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
    /** The page's language (a code of `@dougbot/i18n/locale`). */
    locale: text().notNull().default("en"),
    /** Where it came from ("companies", the page). */
    source: text().notNull().default("companies"),
    /**
     * The consent to keep and use this (LGPD): when it was given, and the version of the notice it was given for.
     * Without it the row is never written. Both stay as the first form gave them, so a later form never rewrites the
     * consent the row was made under.
     */
    consentAt: timestamp({ withTimezone: true }).notNull(),
    consentVersion: text().notNull(),
    /**
     * Double opt-in: the request counts as confirmed once the link in the confirmation email is opened, and the
     * installation's owner hears of it only then. Null until then.
     */
    confirmedAt: timestamp({ withTimezone: true }),
    /** sha256 of the token in the latest confirmation link (the token itself is only in the email). */
    confirmTokenHash: text(),
    /** When the latest confirmation email was queued (its link expires `COMPANY_CONFIRM_TTL_MS` after). */
    confirmSentAt: timestamp({ withTimezone: true }),
    /** How many confirmation emails went out, capped so the form can't flood an inbox. */
    confirmSends: integer().notNull().default(0),
    /**
     * A form sent again after this row was confirmed: when it was sent, what it carries, and sha256 of the token in
     * its confirmation link. The row keeps the confirmed data until the person opens that link, and the consent taken
     * the first time (`consentAt`, `consentVersion`) is never rewritten.
     */
    resendAt: timestamp({ withTimezone: true }),
    resendTokenHash: text(),
    resendData: jsonb().$type<CompanyResend | null>(),
    /** When the data standing now was confirmed: the first form's, or a resend's. */
    confirmedUpdatedAt: timestamp({ withTimezone: true }),
    /**
     * The delete link its confirmation email carries: sha256 of the token (the token itself only ever in the email),
     * and when it was made. Its own token, apart from the confirmation's: the two links do different things, and this
     * one works for longer. The person who filled the form erases their own request with it, once.
     */
    deleteTokenHash: text(),
    deleteTokenAt: timestamp({ withTimezone: true }),
    /** `new`, `talking`, `invited`, `deployed` (a client) or `discarded`, the team's own step (`REQUEST_STATUSES`). */
    status: text().notNull().default("new"),
    /**
     * The client's code on this installation (`064`), kept once the company becomes one: the deployments take it
     * when the workspace is made for them. Null until then, and one company's alone.
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
    // Two companies never share the code their deployment reads (`064`).
    uniqueIndex("company_requests_client_code").on(t.clientCode).where(sql`${t.clientCode} is not null`),
    uniqueIndex("company_requests_confirm_token").on(t.confirmTokenHash),
    uniqueIndex("company_requests_delete_token").on(t.deleteTokenHash).where(sql`${t.deleteTokenHash} is not null`),
    index("company_requests_status").on(t.status, t.createdAt, t.id),
    index("company_requests_created").on(t.createdAt, t.id),
    // The retention sweep (`sweepCompanyRequests`): the rows it may delete, by when they last moved.
    index("company_requests_retention").on(t.status, t.updatedAt),
  ],
);
