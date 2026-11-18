import type { PubSub } from "@agenteschat/adapters";
import { and, type Database, desc, type Executor, eq, type SQL, schema, sql } from "@agenteschat/db";
import { type AppLocale, appLocale } from "@agenteschat/i18n/locale";
import { z } from "zod";
import { decodeCursor, encodeCursor } from "./cursor";
import { type EarlyAccessOutcome, inviteEarlyAccess } from "./early-access";
import { type EmailLocale, emailLocale, queueEmail } from "./email";
import { NotFoundError, ValidationError } from "./errors";
import { notify } from "./notifications";

/**
 * Companies that asked for DougBot on the installation's public page ("Quero o DougBot na minha empresa"), and the
 * team's list of them: each is written once, read and moved through its own steps by the installation's owner,
 * invited through the same early access every invitation goes by, and marked with its client's code once it
 * becomes one. A consent given at the form, a bot check and a rate limit keep it lawful and quiet. Its own list,
 * apart from the product's email waiting list.
 */

const { companyRequests } = schema;

/** The notice a new request consents to; a change to what the form promises bumps it. */
export const COMPANY_CONSENT_VERSION = "2026-11-18";

export const COMPANY_INTERESTS = ["design", "video", "ads", "social", "code", "finance"] as const;
export const COMPANY_INTERESTS_MAX = COMPANY_INTERESTS.length;
export const COMPANY_TEAM_SIZES = ["1-5", "6-20", "21-50", "51-200", "200+"] as const;
export const COMPANY_STATUSES = ["new", "talking", "invited", "deployed", "discarded"] as const;
export type CompanyStatus = (typeof COMPANY_STATUSES)[number];

/** The client's code a deployment gives a company ("064"): three digits. */
export const COMPANY_CLIENT_CODE = /^\d{3}$/;
/** The free text's limit. */
export const COMPANY_MESSAGE_MAX = 2000;
export const COMPANY_NAME_MAX = 120;
export const COMPANY_COMPANY_MAX = 120;
export const COMPANY_NOTES_MAX = 4000;

/** Digits, spaces and `+ ( ) . -`: E.164 (`+5511912345678`) or a number as typed. */
const PHONE = /^[\d\s()+.-]{8,40}$/;
const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;

const oneOf = <T extends string>(list: readonly T[], value: string): value is T =>
  (list as readonly string[]).includes(value);

/** Lowercase and trimmed; null when it doesn't look like an email. */
export function companyRequestEmail(raw: string): string | null {
  const email = raw.trim().toLowerCase();
  return email.length <= 254 && EMAIL.test(email) ? email : null;
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

/** Who hears a new request: the installation's owner's inbox, and the address the email goes to. */
export interface CompanyNotify {
  pubsub?: PubSub;
  /** The installation's owner: the inbox row is theirs. Null: only the email goes. */
  ownerUserId: string | null;
  /** Where the email goes; null: nowhere. */
  emailTo: string | null;
  publicUrl: string;
}

/**
 * Writes a company's request, or updates it when the address is there already (the latest form wins what the person
 * typed, the team's step, notes and code stay). A consent is required: without it nothing is kept. A new request
 * reaches the installation's owner's inbox and, when told where, their email, in the company's language. Answers
 * whether it was new.
 */
export async function joinCompanyRequests(
  db: Database,
  input: CompanyRequestInput,
  notify: CompanyNotify | null,
  now = new Date(),
): Promise<{ added: boolean; id: string }> {
  if (!input.consent) throw new ValidationError("Aceite a Política de Privacidade para continuar", "consent_required");
  const email = companyRequestEmail(input.email);
  if (!email) throw new ValidationError("Use um e-mail como nome@empresa.com", "invalid_email");
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
  const locale: AppLocale = appLocale([input.locale], true) ?? "en";

  const result = await db.transaction(async (tx) => {
    const [entry] = await tx
      .insert(companyRequests)
      .values({
        name,
        email,
        whatsapp,
        company,
        teamSize: input.teamSize,
        interests,
        message,
        locale,
        source: input.source ?? "companies",
        consentAt: now,
        consentVersion: COMPANY_CONSENT_VERSION,
        createdAt: now,
        updatedAt: now,
      })
      .onConflictDoNothing({ target: companyRequests.email })
      .returning({ id: companyRequests.id });
    if (entry) return { added: true, id: entry.id };
    const [updated] = await tx
      .update(companyRequests)
      .set({
        name,
        whatsapp,
        company,
        teamSize: input.teamSize,
        interests,
        message,
        locale,
        consentAt: now,
        consentVersion: COMPANY_CONSENT_VERSION,
        updatedAt: now,
      })
      .where(eq(companyRequests.email, email))
      .returning({ id: companyRequests.id });
    return { added: false, id: updated?.id ?? "" };
  });

  if (result.added && notify) await announceCompanyRequest(db, notify, result.id).catch(() => {});
  return result;
}

/**
 * The confirmation to the company, in its language, and the owner's notice of it: an inbox row (waiting) and, where
 * told, the email. A server without an owner's workspace keeps the email's link on the instance's own address.
 */
async function announceCompanyRequest(db: Database, said: CompanyNotify, id: string): Promise<void> {
  const [row] = await db.select().from(companyRequests).where(eq(companyRequests.id, id));
  if (!row) return;
  await queueEmail(db, {
    orgId: null,
    key: `company-request-received:${id}`,
    to: [row.email],
    template: {
      kind: "company_request_received",
      locale: emailLocale(row.locale),
      company: row.company,
      url: `${said.publicUrl.replace(/\/$/, "")}/empresas`,
    },
  });
  if (!said.ownerUserId) return;
  // The inbox row belongs to a workspace, and the owner always has one: the first it made.
  const [org] = await db
    .select({ id: schema.organizationMembers.orgId })
    .from(schema.organizationMembers)
    .where(eq(schema.organizationMembers.userId, said.ownerUserId))
    .orderBy(desc(schema.organizationMembers.orgId))
    .limit(1);
  if (org) {
    await notify(
      { db, pubsub: said.pubsub },
      {
        orgId: org.id,
        userIds: [said.ownerUserId],
        kind: "company_request",
        groupKey: `company_request:${id}`,
        waiting: true,
        source: { companyRequestId: id, label: row.company },
        latest: { title: row.company, text: row.name },
      },
    );
  }
  if (!said.emailTo) return;
  await queueEmail(db, {
    orgId: org?.id ?? null,
    key: `company-request-owner:${id}`,
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
      url: `${said.publicUrl.replace(/\/$/, "")}${org ? `/org/${org.id}` : ""}/settings/companies`,
    },
  });
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
 * The requests, newest first, in keyset pages, with how many are in each state (whatever the filters). One box
 * finds a company, a person or an address.
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
    .where(and(query.status ? eq(companyRequests.status, query.status) : undefined, match, before))
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
    .from(companyRequests);
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

/** The team's step for a request; a step it already is answers the same. */
export async function setCompanyStatus(db: Database, id: string, status: CompanyStatus, now = new Date()) {
  if (!oneOf(COMPANY_STATUSES, status)) throw new ValidationError("Etapa desconhecida", "invalid_status");
  const [row] = await db
    .update(companyRequests)
    .set({ status, updatedAt: now })
    .where(eq(companyRequests.id, id))
    .returning({ id: companyRequests.id });
  if (!row) throw new NotFoundError("Nenhuma inscrição com este id");
  return companyRequestById(db, id);
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
 * digits, or is already another company's, is refused.
 */
export async function setCompanyClientCode(db: Database, id: string, code: string | null, now = new Date()) {
  const clientCode = code?.trim() || null;
  if (clientCode !== null) {
    if (!COMPANY_CLIENT_CODE.test(clientCode))
      throw new ValidationError("O código do cliente tem três dígitos", "invalid_client_code");
    const [taken] = await db
      .select({ id: companyRequests.id })
      .from(companyRequests)
      .where(and(eq(companyRequests.clientCode, clientCode), sql`${companyRequests.id} <> ${id}`));
    if (taken) throw new ValidationError("Outra empresa já tem este código", "client_code_taken");
  }
  const [row] = await db
    .update(companyRequests)
    .set({ clientCode, updatedAt: now })
    .where(eq(companyRequests.id, id))
    .returning({ id: companyRequests.id });
  if (!row) throw new NotFoundError("Nenhuma inscrição com este id");
  return companyRequestById(db, id);
}

export interface InviteCompanyResult {
  request: CompanyRequestView;
  outcome: EarlyAccessOutcome;
}

/**
 * Sends the company's address its early-access invitation, through the same mechanism every invitation goes by, and
 * moves it to `invited` with who sent it. Its email is in the company's own language. An address already invited
 * answers its invitation's outcome, so inviting twice sends once, and one already deployed is left as it is.
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
  if (outcome === "invited" || outcome === "resent" || outcome === "allowed")
    await db
      .update(companyRequests)
      .set({ invitedAt: now, invitedByUserId: input.byUserId, updatedAt: now, status: "invited" })
      .where(and(eq(companyRequests.id, id), sql`${companyRequests.status} <> 'deployed'`));
  return { request: await companyRequestById(db, id), outcome };
}
