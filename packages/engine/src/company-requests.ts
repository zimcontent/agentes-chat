import type { PubSub } from "@agenteschat/adapters";
import {
  and,
  asc,
  type Database,
  desc,
  type Executor,
  eq,
  inArray,
  isNotNull,
  isNull,
  lt,
  or,
  type SQL,
  schema,
  sql,
} from "@agenteschat/db";
import { type AppLocale, appLocale } from "@agenteschat/i18n/locale";
import { z } from "zod";
import { randomToken, sha256 } from "./crypto";
import { decodeCursor, encodeCursor } from "./cursor";
import { type EarlyAccessOutcome, inviteEarlyAccess } from "./early-access";
import { type EmailLocale, emailLocale, queueEmail } from "./email";
import { ConflictError, isUniqueViolation, NotFoundError, ValidationError } from "./errors";
import { clearCompanyNotifications, notify, resolveNotifications } from "./notifications";
import { pinnedOwner } from "./organizations";

/**
 * Companies that asked for DougBot on the installation's public page ("Quero o DougBot na minha empresa"), and the
 * team's list of them: each is written once, confirmed by its address (double opt-in), read and moved through its own
 * steps by the installation's owner, invited through the same early access every invitation goes by, and marked with
 * its client's code once it becomes one. A consent given at the form, a bot check and a rate limit keep it lawful and
 * quiet, and a request the team never made a client is deleted past its retention. Its own list, apart from the
 * product's email waiting list.
 */

const { companyRequests } = schema;

/** The notice a new request consents to; a change to what the form promises bumps it. */
export const COMPANY_CONSENT_VERSION = "2026-11-18";

export const COMPANY_INTERESTS = ["design", "video", "ads", "social", "code", "finance"] as const;
export const COMPANY_INTERESTS_MAX = COMPANY_INTERESTS.length;
export const COMPANY_TEAM_SIZES = ["1-5", "6-20", "21-50", "51-200", "200+"] as const;
export const COMPANY_STATUSES = ["new", "talking", "invited", "deployed", "discarded"] as const;
export type CompanyStatus = (typeof COMPANY_STATUSES)[number];
/** The steps the retention sweep deletes: a request that never became an invitation or a client. */
const SWEPT_STATUSES: readonly CompanyStatus[] = ["new", "talking", "discarded"];

/** The client's code a deployment gives a company ("064"): three digits. */
export const COMPANY_CLIENT_CODE = /^\d{3}$/;
/** The free text's limit. */
export const COMPANY_MESSAGE_MAX = 2000;
export const COMPANY_NAME_MAX = 120;
export const COMPANY_COMPANY_MAX = 120;
export const COMPANY_NOTES_MAX = 4000;

/** A confirmation email waits this long after the previous one, and one request gets at most this many in that window. */
export const COMPANY_RESEND_AFTER_MS = 2 * 60_000;
export const COMPANY_MAX_SENDS = 5;
/** The window `COMPANY_MAX_SENDS` counts in: a request gets at most that many confirmation emails a day. */
export const COMPANY_SENDS_WINDOW_MS = 24 * 3600_000;
/**
 * Emails one *address* gets in a day, over every request of it: the confirmations and a second form's resends share
 * it, so a flood meets a wall before any row's own window lets another through. Counted by the rate limiter, in the
 * public routes (`companyEmailLimitKey`), which also keeps it across replicas.
 */
export const COMPANY_MAX_EMAILS_PER_ADDRESS_DAY = 3;
/** A confirmation link works this long. */
export const COMPANY_CONFIRM_TTL_MS = 48 * 3600_000;
/** A week past its expired link, an unconfirmed request the sweep deletes: an address that comes back late keeps hope. */
export const COMPANY_UNCONFIRMED_GRACE_MS = 7 * 24 * 3600_000;
/**
 * The delete link works this long: longer than the confirmation's, since it is what erases what was collected, and the
 * person may come back to it months later. A request the sweep deletes answers its link the same as gone.
 */
export const COMPANY_DELETE_TTL_MS = 400 * 24 * 3600_000;
/** What `randomToken()` makes: base64url, 32 characters for 24 bytes. */
export const COMPANY_TOKEN = /^[A-Za-z0-9_-]{32}$/;
/** The rate limit key of one address's confirmation emails (`RateLimiter.consume`): counted by the public routes. */
export const companyEmailLimitKey = (email: string) => `company-request-addr:${email}`;

/** Digits, spaces and `+ ( ) . -`: E.164 (`+5511912345678`) or a number as typed. */
const PHONE = /^[\d\s()+.-]{8,40}$/;
/** The addresses a mailbox and the database both take: no comma, semicolon, angle bracket, quote or query. */
const EMAIL = z.email();

const oneOf = <T extends string>(list: readonly T[], value: string): value is T =>
  (list as readonly string[]).includes(value);

/** Lowercase and trimmed; null when it doesn't look like an email (`z.email()`: `a,victim@x.com` never is). */
export function companyRequestEmail(raw: string): string | null {
  const email = raw.trim().toLowerCase();
  return email.length <= 254 && EMAIL.safeParse(email).success ? email : null;
}

/**
 * The page's language: the app's own resolved language (`pt-BR`, `es`…) or any tag it falls back from (`en-US` reads
 * English, `es-MX` Spanish). Never refused: a form is worth more than a strict language check.
 */
export function companyRequestLocale(locale: string | undefined): AppLocale {
  return appLocale([locale], true) ?? "en";
}

export interface CompanyRequestInput {
  name: string;
  email: string;
  whatsapp: string;
  company: string;
  teamSize: string;
  interests?: readonly string[];
  message?: string;
  locale?: string;
  source?: string;
  /** The form sent `consent: true`: the privacy notice was read and accepted. Anything else is refused. */
  consent: boolean;
}

/** What the form carries besides who filled it, once each field is checked. */
interface CompanyForm {
  name: string;
  whatsapp: string;
  company: string;
  teamSize: string;
  interests: string[];
  message: string;
  locale: AppLocale;
}

/** Every field checked, with its own code; the address apart, since a resend keeps the one the row has. */
function checkedForm(input: CompanyRequestInput): CompanyForm {
  const name = input.name.trim();
  if (!name || name.length > COMPANY_NAME_MAX) throw new ValidationError("Diga seu nome", "invalid_name");
  const whatsapp = input.whatsapp.trim();
  const digits = whatsapp.replace(/\D/g, "").length;
  if (!PHONE.test(whatsapp) || digits < 8 || digits > 15)
    throw new ValidationError("Use um WhatsApp com o código do país, como +5511912345678", "invalid_whatsapp");
  const company = input.company.trim();
  if (!company || company.length > COMPANY_COMPANY_MAX)
    throw new ValidationError("Diga o nome da empresa", "invalid_company");
  if (!oneOf(COMPANY_TEAM_SIZES, input.teamSize))
    throw new ValidationError("Escolha o tamanho do time", "invalid_team_size");
  const interests = [...new Set(input.interests ?? [])];
  if (interests.length > COMPANY_INTERESTS_MAX || interests.some((i) => !oneOf(COMPANY_INTERESTS, i)))
    throw new ValidationError("Escolha o que quer automatizar", "invalid_interests");
  const message = (input.message ?? "").trim();
  if (message.length > COMPANY_MESSAGE_MAX) throw new ValidationError("O recado é longo demais", "invalid_message");
  return {
    name,
    whatsapp,
    company,
    teamSize: input.teamSize,
    interests,
    message,
    locale: companyRequestLocale(input.locale),
  };
}

/** Who hears a confirmed request: the installation's owner's inbox, and the address the owner's email goes to. */
export interface CompanyNotify {
  pubsub?: PubSub;
  /** The installation's owner: the inbox row is theirs. Null: only the email goes. */
  ownerUserId: string | null;
  /** Where the owner's email goes; null: nowhere. */
  emailTo: string | null;
  publicUrl: string;
}

/** The page a confirmation link opens: the public form, which opens it. */
const confirmUrl = (notify: CompanyNotify | null, token: string) =>
  `${(notify?.publicUrl ?? process.env.PUBLIC_URL ?? "").replace(/\/+$/, "")}/empresas?confirm=${token}`;

/**
 * The page a delete link opens: the same public page with `?delete=`, which asks before erasing (its button posts to
 * `/api/companies/delete`, so a mail scanner that only fetches the URL deletes nothing).
 */
const deleteUrl = (notify: CompanyNotify | null, token: string) =>
  `${(notify?.publicUrl ?? process.env.PUBLIC_URL ?? "").replace(/\/+$/, "")}/empresas?delete=${token}`;

/**
 * Writes a company's request, or, when the address already asked, asks its owner to confirm what a second form
 * changes. A new request is `unconfirmed` until the link in its confirmation email is opened: the owner hears of it
 * then, never before, so an address that isn't the sender's plants nothing. A confirmed request's second form leaves
 * the row exactly as the team knows it, its consent as first given, and keeps the form apart until that form's own
 * link is opened (the resend is recorded beside it). A consent is required: without it nothing is kept. Answers
 * whether it was new.
 */
export async function joinCompanyRequests(
  db: Database,
  input: CompanyRequestInput,
  notifyOwner: CompanyNotify | null,
  now = new Date(),
): Promise<{ added: boolean; id: string }> {
  if (!input.consent) throw new ValidationError("Aceite a Política de Privacidade para continuar", "consent_required");
  const email = companyRequestEmail(input.email);
  if (!email) throw new ValidationError("Use um e-mail como nome@empresa.com", "invalid_email");
  const form = checkedForm(input);
  const token = randomToken();
  const deleteToken = randomToken();

  return db.transaction(async (tx) => {
    const [entry] = await tx
      .insert(companyRequests)
      .values({
        ...form,
        email,
        source: input.source ?? "companies",
        consentAt: now,
        consentVersion: COMPANY_CONSENT_VERSION,
        confirmTokenHash: sha256(token),
        confirmSentAt: now,
        confirmSends: 1,
        // The one link that erases it is the person's own, and this is the only moment its token exists in clear: the
        // row keeps its hash, the email carries it.
        deleteTokenHash: sha256(deleteToken),
        deleteTokenAt: now,
        createdAt: now,
        updatedAt: now,
      })
      .onConflictDoNothing({ target: companyRequests.email })
      .returning({ id: companyRequests.id });
    if (entry) {
      await queueEmail(tx, {
        orgId: null,
        key: `company-request-confirm:${entry.id}:${now.getTime()}`,
        to: [email],
        template: {
          kind: "company_request_confirm",
          locale: emailLocale(form.locale),
          company: form.company,
          url: confirmUrl(notifyOwner, token),
          deleteUrl: deleteUrl(notifyOwner, deleteToken),
        },
      });
      return { added: true, id: entry.id };
    }
    const [row] = await tx.select().from(companyRequests).where(eq(companyRequests.email, email));
    // The address went as the insert ran: the form is tried again, and answers like any other refusal.
    if (!row) throw new Error("company request vanished between insert and update");
    if (!row.confirmedAt) {
      // Not confirmed yet: the form again replaces what it carried and gets a link of its own, but only when the
      // claim is taken. A refused claim (too soon, or the day's emails spent) changes nothing at all: the data that
      // stands and the link that works stay as they were, so a second sender never overwrites a row it may not mail.
      const claimed = await claimConfirmSend(tx, row.id, now, token, deleteToken);
      if (!claimed) return { added: false, id: row.id };
      await queueEmail(tx, {
        orgId: null,
        // Keyed by the moment, as a resend is: the send's number restarts with each day's window, so it alone would
        // collide with the first email's and the outbox would hold the second back.
        key: `company-request-confirm:${row.id}:${now.getTime()}`,
        to: [email],
        template: {
          kind: "company_request_confirm",
          locale: emailLocale(form.locale),
          company: form.company,
          url: confirmUrl(notifyOwner, token),
          deleteUrl: deleteUrl(notifyOwner, deleteToken),
        },
      });
      await tx
        .update(companyRequests)
        .set({ ...form, updatedAt: now })
        .where(eq(companyRequests.id, row.id));
      return { added: false, id: row.id };
    }
    // Confirmed already: the form is kept apart, and only applies once its own link is opened.
    const resendToken = randomToken();
    const claimed = await claimResend(tx, row.id, now, resendToken);
    if (claimed) {
      await tx
        .update(companyRequests)
        .set({ resendData: { ...form, sentAt: now.toISOString() } })
        .where(eq(companyRequests.id, row.id));
      await queueEmail(tx, {
        orgId: null,
        key: `company-request-resend:${row.id}:${now.getTime()}`,
        to: [email],
        template: {
          kind: "company_request_resend",
          locale: emailLocale(form.locale),
          company: form.company,
          url: confirmUrl(notifyOwner, resendToken),
        },
      });
    }
    return { added: false, id: row.id };
  });
}

/**
 * Claims the right to send a confirmation email now: one per `COMPANY_RESEND_AFTER_MS`, and at most
 * `COMPANY_MAX_SENDS` in a `COMPANY_SENDS_WINDOW_MS` day (the window restarts when a send a day or more after the
 * previous one comes). The token of the email being sent, and that of its delete link, go in with the claim, so the
 * link the email carries is the one that works and the previous one stops working. Answers the send's number, or null
 * when the claim is refused (too soon, or the day's sends spent), in which case the caller changes nothing.
 */
async function claimConfirmSend(
  tx: Executor,
  id: string,
  now: Date,
  token: string,
  deleteToken: string,
): Promise<{ sends: number } | null> {
  const restart = or(
    isNull(companyRequests.confirmSentAt),
    lt(companyRequests.confirmSentAt, new Date(now.getTime() - COMPANY_SENDS_WINDOW_MS)),
  );
  const [claimed] = await tx
    .update(companyRequests)
    .set({
      confirmTokenHash: sha256(token),
      confirmSentAt: now,
      confirmSends: sql`case when ${restart} then 1 else ${companyRequests.confirmSends} + 1 end`,
      deleteTokenHash: sha256(deleteToken),
      deleteTokenAt: now,
    })
    .where(
      and(
        eq(companyRequests.id, id),
        isNull(companyRequests.confirmedAt),
        or(restart, lt(companyRequests.confirmSends, COMPANY_MAX_SENDS)),
        // A row with no send yet (an old one) may send at once; the window only spaces out what came before.
        lt(companyRequests.confirmSentAt, new Date(now.getTime() - COMPANY_RESEND_AFTER_MS)),
      ),
    )
    .returning({ sends: companyRequests.confirmSends });
  return claimed ? { sends: claimed.sends } : null;
}

/** Claims a resend: one at a time, and never sooner than the previous one. */
async function claimResend(tx: Executor, id: string, now: Date, token: string): Promise<boolean> {
  const [claimed] = await tx
    .update(companyRequests)
    .set({ resendAt: now, resendTokenHash: sha256(token) })
    .where(
      and(
        eq(companyRequests.id, id),
        isNotNull(companyRequests.confirmedAt),
        or(
          isNull(companyRequests.resendAt),
          lt(companyRequests.resendAt, new Date(now.getTime() - COMPANY_RESEND_AFTER_MS)),
        ),
      ),
    )
    .returning({ id: companyRequests.id });
  return Boolean(claimed);
}

/** What a confirmation link did, so the route knows whether the owner's notice has to be reopened. */
export interface CompanyConfirmResult {
  confirmed: boolean;
  /** The link carried a confirmed request's second form, now applied (and its notice reopened). */
  resend: boolean;
  id: string | null;
}

/**
 * Confirms an address behind a link from a confirmation or a resend email. A first confirmation makes the request
 * confirmed and tells the installation's owner; a resend's applies the form it carried and reopens that notice,
 * with a `discarded` request back to `new`. Opening the same link again answers `confirmed`; an unknown or expired
 * one, not.
 */
export async function confirmCompanyRequest(
  db: Database,
  token: string,
  notifyOwner: CompanyNotify | null,
  now = new Date(),
): Promise<CompanyConfirmResult> {
  if (!COMPANY_TOKEN.test(token)) return { confirmed: false, resend: false, id: null };
  const hash = sha256(token);
  const [row] = await db.select().from(companyRequests).where(eq(companyRequests.confirmTokenHash, hash));
  if (row) return confirmFirst(db, row, notifyOwner, now);
  const [pending] = await db
    .select()
    .from(companyRequests)
    .where(and(eq(companyRequests.resendTokenHash, hash), isNotNull(companyRequests.confirmedAt)));
  if (!pending) return { confirmed: false, resend: false, id: null };
  return confirmResend(db, pending, notifyOwner, now);
}

async function confirmFirst(
  db: Database,
  row: typeof companyRequests.$inferSelect,
  notifyOwner: CompanyNotify | null,
  now: Date,
): Promise<CompanyConfirmResult> {
  if (row.confirmedAt) return { confirmed: true, resend: false, id: row.id };
  if (!row.confirmSentAt || now.getTime() - row.confirmSentAt.getTime() > COMPANY_CONFIRM_TTL_MS)
    return { confirmed: false, resend: false, id: null };
  const confirmed = await db.transaction(async (tx) => {
    const [done] = await tx
      .update(companyRequests)
      .set({ confirmedAt: now, confirmedUpdatedAt: now, updatedAt: now })
      .where(and(eq(companyRequests.id, row.id), isNull(companyRequests.confirmedAt)))
      .returning({ id: companyRequests.id });
    return Boolean(done);
  });
  if (confirmed && notifyOwner)
    await announceCompanyRequest(db, notifyOwner, row.id).catch((error) => logFailure("confirm", error));
  return { confirmed: true, resend: false, id: row.id };
}

async function confirmResend(
  db: Database,
  row: typeof companyRequests.$inferSelect,
  notifyOwner: CompanyNotify | null,
  now: Date,
): Promise<CompanyConfirmResult> {
  const resendTokenHash = row.resendTokenHash;
  if (!row.resendAt || now.getTime() - row.resendAt.getTime() > COMPANY_CONFIRM_TTL_MS)
    return { confirmed: false, resend: false, id: null };
  const data = row.resendData;
  // The link that was opened is spent, so it applies once; the row keeps its original consent.
  const applied = await db.transaction(async (tx) => {
    const [done] = await tx
      .update(companyRequests)
      .set({
        ...(data
          ? {
              name: data.name,
              company: data.company,
              whatsapp: data.whatsapp,
              teamSize: data.teamSize,
              interests: data.interests,
              message: data.message,
              locale: companyRequestLocale(data.locale),
            }
          : {}),
        confirmedUpdatedAt: now,
        updatedAt: now,
        resendAt: null,
        resendTokenHash: null,
        resendData: null,
        // A request the team set aside comes back to the start of the list, and its owner's notice reopens.
        status: sql`case when ${companyRequests.status} = 'discarded' then 'new' else ${companyRequests.status} end`,
      })
      .where(and(eq(companyRequests.id, row.id), eq(companyRequests.resendTokenHash, resendTokenHash ?? "")))
      .returning({ id: companyRequests.id });
    return Boolean(done);
  });
  if (applied && notifyOwner)
    await reopenOwnerNotice(db, notifyOwner, row.id).catch((error) => logFailure("resend", error));
  return { confirmed: applied, resend: applied, id: row.id };
}

/** The installation's owner's oldest workspace: where the team's list lives. */
async function ownerOrgId(db: Executor, userId: string): Promise<string | null> {
  const [org] = await db
    .select({ id: schema.organizations.id })
    .from(schema.organizationMembers)
    .innerJoin(schema.organizations, eq(schema.organizations.id, schema.organizationMembers.orgId))
    .where(eq(schema.organizationMembers.userId, userId))
    .orderBy(asc(schema.organizations.createdAt), asc(schema.organizations.id))
    .limit(1);
  return org?.id ?? null;
}

/**
 * The installation's owner's notice of a confirmed request: an inbox row (waiting) and, where told, the email, to
 * the owner's oldest workspace, the one the section is opened from. The confirmation to the company went out when it
 * joined; never the rest of the form here.
 */
async function announceCompanyRequest(db: Database, said: CompanyNotify, id: string): Promise<void> {
  if (!said.ownerUserId) return;
  const [row] = await db.select().from(companyRequests).where(eq(companyRequests.id, id));
  if (!row) return;
  const orgId = await ownerOrgId(db, said.ownerUserId);
  if (orgId)
    await notify(
      { db, pubsub: said.pubsub },
      {
        orgId,
        userIds: [said.ownerUserId],
        kind: "company_request",
        groupKey: `company_request:${id}`,
        waiting: true,
        source: { companyRequestId: id, label: row.company },
        latest: { title: row.company, text: row.name },
      },
    ).catch((error) => logFailure("owner inbox", error));
  if (!said.emailTo) return;
  await queueEmail(db, {
    orgId,
    key: `company-request-owner:${id}:${Math.max(row.createdAt.getTime(), row.confirmedUpdatedAt?.getTime() ?? 0)}`,
    to: [said.emailTo],
    template: {
      kind: "company_request_owner",
      locale: emailLocale(row.locale),
      company: row.company,
      person: row.name,
      email: row.email,
      whatsapp: row.whatsapp,
      teamSize: row.teamSize,
      interests: row.interests,
      message: row.message,
      url: `${said.publicUrl.replace(/\/$/, "")}${orgId ? `/org/${orgId}` : ""}/settings/companies`,
    },
  });
}

/** A confirmed resend reopens the owner's notice: the inbox row waits again, on top. */
async function reopenOwnerNotice(db: Database, said: CompanyNotify, id: string): Promise<void> {
  if (!said.ownerUserId) return;
  const [row] = await db.select().from(companyRequests).where(eq(companyRequests.id, id));
  if (!row) return;
  const orgId = await ownerOrgId(db, said.ownerUserId);
  if (orgId)
    await notify(
      { db, pubsub: said.pubsub },
      {
        orgId,
        userIds: [said.ownerUserId],
        kind: "company_request",
        groupKey: `company_request:${id}`,
        waiting: true,
        source: { companyRequestId: id, label: row.company },
        latest: { title: row.company, text: row.name },
      },
    ).catch((error) => logFailure("owner inbox", error));
}

/** Logs a background failure (the owner's notice) instead of swallowing it. */
function logFailure(what: string, error: unknown): void {
  console.error(`company request: ${what} failed`, error);
}

export interface CompanyRequestView {
  id: string;
  name: string;
  email: string;
  whatsapp: string;
  company: string;
  teamSize: string;
  interests: string[];
  message: string;
  locale: EmailLocale;
  status: CompanyStatus;
  clientCode: string | null;
  notes: string;
  /** When the address confirmed it; a request is never listed before it is. */
  confirmedAt: Date | null;
  /** A confirmed form sent again whose link is not opened yet. */
  pendingResendAt: Date | null;
  invitedAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
}

const viewOf = (row: typeof companyRequests.$inferSelect): CompanyRequestView => ({
  id: row.id,
  name: row.name,
  email: row.email,
  whatsapp: row.whatsapp,
  company: row.company,
  teamSize: row.teamSize,
  interests: row.interests,
  message: row.message,
  locale: emailLocale(row.locale),
  status: oneOf(COMPANY_STATUSES, row.status) ? row.status : "new",
  clientCode: row.clientCode,
  notes: row.notes,
  confirmedAt: row.confirmedAt,
  pendingResendAt: row.resendAt,
  invitedAt: row.invitedAt,
  createdAt: row.createdAt,
  updatedAt: row.updatedAt,
});

// Cut to milliseconds (what a JS Date and the cursor carry), so paging compares exactly what it returned.
const createdMs = sql<Date>`date_trunc('milliseconds', ${companyRequests.createdAt})`.mapWith(
  (v: string | Date) => new Date(v),
);
const Cursor = z.tuple([z.iso.datetime(), z.uuid()]);

export interface CompanyQuery {
  status?: CompanyStatus;
  /** Any part of the company's name, the person's name or the address, in any case. */
  q?: string;
  limit: number;
  /** `next` of the previous page. */
  cursor?: string;
}

/**
 * The requests, newest first, in keyset pages, with how many are in each state (whatever the filters). One box finds
 * a company, a person or an address. A request whose address has not confirmed itself is not listed: the owner hears
 * of it only once it is.
 */
export async function listCompanyRequests(db: Database, query: CompanyQuery) {
  const after = query.cursor ? decodeCursor(query.cursor, Cursor) : null;
  const q = query.q?.trim();
  const like = q ? `%${q.replace(/[\\%_]/g, (m) => `\\${m}`)}%` : null;
  const match: SQL | undefined = like
    ? sql`(${companyRequests.company} ilike ${like} or ${companyRequests.name} ilike ${like} or ${companyRequests.email} ilike ${like})`
    : undefined;
  const before: SQL | undefined = after
    ? sql`(${createdMs}, ${companyRequests.id}) < (${after[0]}::timestamptz, ${after[1]}::uuid)`
    : undefined;
  const rows = await db
    .select()
    .from(companyRequests)
    .where(
      and(
        isNotNull(companyRequests.confirmedAt),
        query.status ? eq(companyRequests.status, query.status) : undefined,
        match,
        before,
      ),
    )
    .orderBy(desc(createdMs), desc(companyRequests.id))
    .limit(query.limit + 1);
  const page = rows.slice(0, query.limit).map(viewOf);
  const last = page.at(-1);
  const next = rows.length > query.limit && last ? encodeCursor([last.createdAt.toISOString(), last.id]) : null;
  const count = (state: CompanyStatus) =>
    sql<number>`count(*) filter (where ${companyRequests.status} = ${state})`.mapWith(Number);
  const [counts] = await db
    .select({
      all: sql<number>`count(*)::int`.mapWith(Number),
      new: count("new"),
      talking: count("talking"),
      invited: count("invited"),
      deployed: count("deployed"),
      discarded: count("discarded"),
    })
    .from(companyRequests)
    .where(isNotNull(companyRequests.confirmedAt));
  return {
    requests: page,
    counts: counts ?? { all: 0, new: 0, talking: 0, invited: 0, deployed: 0, discarded: 0 },
    next,
  };
}

export async function companyRequestById(db: Executor, id: string): Promise<CompanyRequestView> {
  const [row] = await db.select().from(companyRequests).where(eq(companyRequests.id, id));
  if (!row) throw new NotFoundError("Nenhuma inscrição com este id");
  return viewOf(row);
}

/** The team's step for a request; a step it already is answers the same. Moving it resolves the owner's notice. */
export async function setCompanyStatus(db: Database, id: string, status: CompanyStatus, now = new Date()) {
  if (!oneOf(COMPANY_STATUSES, status)) throw new ValidationError("Etapa desconhecida", "invalid_status");
  const [row] = await db
    .update(companyRequests)
    .set({ status, updatedAt: now })
    .where(eq(companyRequests.id, id))
    .returning({ id: companyRequests.id });
  if (!row) throw new NotFoundError("Nenhuma inscrição com este id");
  await resolveOwnerNotice(db, id).catch((error) => logFailure("status resolve", error));
  return companyRequestById(db, id);
}

/**
 * The owner's notice of a request is done (the team answered it by moving it on). The notice lives in the owner's
 * oldest workspace alone (`announceCompanyRequest` puts it there), so only that workspace is swept: a second workspace
 * of the owner's, or any other, never held a row for it.
 */
async function resolveOwnerNotice(db: Database, id: string): Promise<void> {
  const owner = await pinnedOwner(db);
  if (!owner) return;
  const orgId = await ownerOrgId(db, owner);
  if (orgId) await resolveNotifications({ db }, orgId, { groupKey: `company_request:${id}` });
}

/** Saves the team's notes about a company. */
export async function setCompanyNotes(db: Database, id: string, notes: string, now = new Date()) {
  const text = notes.trim().slice(0, COMPANY_NOTES_MAX);
  const [row] = await db
    .update(companyRequests)
    .set({ notes: text, updatedAt: now })
    .where(eq(companyRequests.id, id))
    .returning({ id: companyRequests.id });
  if (!row) throw new NotFoundError("Nenhuma inscrição com este id");
  return companyRequestById(db, id);
}

/**
 * Keeps the client's code (`064`) once the company becomes one, which its deployment reads. A code that isn't three
 * digits is refused; one another company already holds is a conflict (`client_code_taken`, a 409). The database's
 * unique index holds even when two requests race for it.
 */
export async function setCompanyClientCode(db: Database, id: string, code: string | null, now = new Date()) {
  const clientCode = code?.trim() || null;
  if (clientCode !== null && !COMPANY_CLIENT_CODE.test(clientCode))
    throw new ValidationError("O código do cliente tem três dígitos", "invalid_client_code");
  try {
    const [row] = await db
      .update(companyRequests)
      .set({ clientCode, updatedAt: now })
      .where(eq(companyRequests.id, id))
      .returning({ id: companyRequests.id });
    if (!row) throw new NotFoundError("Nenhuma inscrição com este id");
  } catch (error) {
    if (isUniqueViolation(error)) throw new ConflictError("Outra empresa já tem este código", "client_code_taken");
    throw error;
  }
  return companyRequestById(db, id);
}

/**
 * Deletes a request for good (the team's "Apagar", and the LGPD's right to erasure): everything it holds goes, and
 * so does every notice about it, erased rather than resolved.
 */
export async function deleteCompanyRequest(db: Database, id: string): Promise<void> {
  const [row] = await db
    .delete(companyRequests)
    .where(eq(companyRequests.id, id))
    .returning({ id: companyRequests.id });
  if (!row) throw new NotFoundError("Nenhuma inscrição com este id");
  await clearCompanyNotifications({ db }, [id]).catch((error) => logFailure("delete notices", error));
  await resolveOwnerNotice(db, id).catch((error) => logFailure("delete resolve", error));
}

/**
 * The person who filled the form erases it themselves, with the delete link its confirmation email carries. The link
 * is its own token, good for `COMPANY_DELETE_TTL_MS`, spent once. An unknown or expired token erases nothing and
 * answers `false`; a request the retention sweep already took is gone, and reads as erased.
 */
export async function deleteCompanyRequestByToken(db: Database, token: string, now = new Date()): Promise<boolean> {
  if (!COMPANY_TOKEN.test(token)) return false;
  const hash = sha256(token);
  const [row] = await db
    .delete(companyRequests)
    .where(
      and(
        eq(companyRequests.deleteTokenHash, hash),
        isNotNull(companyRequests.deleteTokenAt),
        // A link issued for more than its lifetime answers the same as an unknown one.
        sql`${companyRequests.deleteTokenAt} > ${new Date(now.getTime() - COMPANY_DELETE_TTL_MS)}`,
      ),
    )
    .returning({ id: companyRequests.id });
  if (!row) return false;
  await clearCompanyNotifications({ db }, [row.id]).catch((error) => logFailure("delete notices", error));
  return true;
}

/** Deletes every request an address left (a person deleting their account), quietly: nothing to answer. */
export async function deleteCompanyRequestsByEmail(db: Executor, emails: readonly string[]): Promise<number> {
  const wanted = emails.map((e) => e.trim().toLowerCase()).filter(Boolean);
  if (wanted.length === 0) return 0;
  const rows = await db
    .delete(companyRequests)
    .where(inArray(companyRequests.email, wanted))
    .returning({ id: companyRequests.id });
  await clearCompanyNotifications(
    { db },
    rows.map((r) => r.id),
  ).catch((error) => logFailure("delete notices", error));
  return rows.length;
}

/**
 * Deletes the requests the team never acted on, past their retention: the ones still `new`, `talking` or `discarded`
 * that nothing touched for `days` (LGPD). An invitation or a client is kept: it is the record of a relation that
 * still stands. A request whose address never confirmed it goes as soon as its link has expired (the confirmation
 * after `COMPANY_CONFIRM_TTL_MS`, plus a week's grace for anyone who comes back to it): nothing reaches the team
 * before the address confirms, so a row like that is not a relation yet. Job `company_requests.sweep`, and run
 * directly by the tests.
 */
export async function sweepCompanyRequests(db: Database, days: number, now = new Date()): Promise<{ swept: number }> {
  // The unconfirmed go past their link's expiry whether or not a retention is set: they were never a request. A row
  // always carries the moment its email was queued, so only a real link's expiry is what speaks; one without it is
  // left for a person to look at, never deleted on a missing date.
  const expired = new Date(now.getTime() - (COMPANY_CONFIRM_TTL_MS + COMPANY_UNCONFIRMED_GRACE_MS));
  const gone: string[] = (
    await db
      .delete(companyRequests)
      .where(
        and(
          isNull(companyRequests.confirmedAt),
          isNotNull(companyRequests.confirmSentAt),
          lt(companyRequests.confirmSentAt, expired),
        ),
      )
      .returning({ id: companyRequests.id })
  ).map((r) => r.id);
  if (days > 0) {
    const cutoff = new Date(now.getTime() - days * 24 * 3600_000);
    const old = await db
      .delete(companyRequests)
      .where(
        and(
          inArray(companyRequests.status, [...SWEPT_STATUSES]),
          isNotNull(companyRequests.confirmedAt),
          lt(companyRequests.updatedAt, cutoff),
        ),
      )
      .returning({ id: companyRequests.id });
    gone.push(...old.map((r) => r.id));
  }
  await clearCompanyNotifications({ db }, gone).catch((error) => logFailure("sweep notices", error));
  return { swept: gone.length };
}

export interface InviteCompanyResult {
  request: CompanyRequestView;
  outcome: EarlyAccessOutcome;
}

/**
 * Sends the company's address its early-access invitation, through the same mechanism every invitation goes by, and
 * moves it to `invited` with who sent it. Its email is in the company's own language. An address already invited
 * answers its invitation's outcome, so inviting twice sends once, and one already deployed is left as it is. Moving
 * it to invited resolves the owner's notice.
 */
export async function inviteCompanyRequest(
  db: Database,
  id: string,
  input: { publicUrl: string; byUserId: string },
  now = new Date(),
): Promise<InviteCompanyResult> {
  const before = await companyRequestById(db, id);
  const [result] = await inviteEarlyAccess(
    db,
    { emails: [before.email], locale: before.locale, resend: true, publicUrl: input.publicUrl },
    now,
  );
  const outcome = result?.outcome ?? "invalid_email";
  if (outcome === "invalid_email") throw new ValidationError("Este endereço não serve", "invalid_email");
  if (outcome === "invited" || outcome === "resent" || outcome === "allowed") {
    await db
      .update(companyRequests)
      .set({ invitedAt: now, invitedByUserId: input.byUserId, updatedAt: now, status: "invited" })
      .where(and(eq(companyRequests.id, id), sql`${companyRequests.status} <> 'deployed'`));
    await resolveOwnerNotice(db, id).catch((error) => logFailure("invite resolve", error));
  }
  return { request: await companyRequestById(db, id), outcome };
}
