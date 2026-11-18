import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { type Database, eq, schema } from "@agenteschat/db";
import { createTestDatabase } from "@agenteschat/db/testing";
import {
  COMPANY_MESSAGE_MAX,
  COMPANY_TOKEN,
  companyRequestById,
  companyRequestEmail,
  confirmCompanyRequest,
  deleteCompanyRequest,
  deleteCompanyRequestsByEmail,
  inviteCompanyRequest,
  joinCompanyRequests,
  listCompanyRequests,
  setCompanyClientCode,
  setCompanyNotes,
  setCompanyStatus,
  sweepCompanyRequests,
} from "../src";
import { addUser } from "./fixtures";

let db: Database;
let close: () => void;
beforeEach(async () => {
  ({ db, close } = await createTestDatabase());
});
afterEach(() => close());

const ANA = {
  name: " Ana Souza ",
  email: "  Ana@AuroraBakery.com ",
  whatsapp: "+5511912345678",
  company: "Aurora Bakery",
  teamSize: "6-20",
  interests: ["design", "video"],
  message: " We post two videos a week. ",
  locale: "pt-BR",
  consent: true,
};

/** The token of the latest email of one kind, as its link carries it (its `?confirm=`). */
async function lastToken(db: Database, kind: "company_request_confirm" | "company_request_resend") {
  const jobs = await db.select().from(schema.outbox).where(eq(schema.outbox.kind, "email.send"));
  const urls = jobs
    .map((j) => (j.payload as { template?: { kind?: string; url?: string } }).template)
    .filter((t) => t?.kind === kind)
    .map((t) => t?.url ?? "")
    .filter(Boolean);
  return new URL(urls.at(-1) ?? "https://x.test/empresas", "https://x.test").searchParams.get("confirm") ?? "";
}

describe("a company's request", () => {
  test("joins once, lowercase and trimmed, unconfirmed until its link is opened", async () => {
    const before = new Date("2026-11-18T10:00:00Z");
    const first = await joinCompanyRequests(db, ANA, null, before);
    expect(first.added).toBe(true);
    const [row] = await db.select().from(schema.companyRequests);
    expect([row?.email, row?.name, row?.company, row?.teamSize, row?.status]).toEqual([
      "ana@aurorabakery.com",
      "Ana Souza",
      "Aurora Bakery",
      "6-20",
      "new",
    ]);
    expect(row?.interests).toEqual(["design", "video"]);
    expect(row?.message).toBe("We post two videos a week.");
    expect(row?.confirmedAt).toBeNull();
    // Its confirmation email goes out at once, in its language, and it is not yet in the team's list.
    const [mail] = (await db.select().from(schema.outbox).where(eq(schema.outbox.kind, "email.send"))).map(
      (j) => (j.payload as { template?: { kind?: string; locale?: string } }).template,
    );
    expect(mail).toMatchObject({ kind: "company_request_confirm", locale: "pt-BR" });
    expect((await listCompanyRequests(db, { limit: 10 })).counts.all).toBe(0);
  });

  test("a consent is required: without it nothing is kept", async () => {
    await expect(joinCompanyRequests(db, { ...ANA, consent: false }, null)).rejects.toMatchObject({
      code: "consent_required",
    });
    expect(await db.select().from(schema.companyRequests)).toEqual([]);
  });

  test("every field is checked, with its own code", async () => {
    const bad: [string, Record<string, unknown>, string][] = [
      ["email", { email: "not-an-email" }, "invalid_email"],
      // What the loose form regex let through, `z.email()` refuses: a comma and a query break the address.
      ["comma", { email: "a,victim@x.com" }, "invalid_email"],
      ["query", { email: "a@b.co?cc=x" }, "invalid_email"],
      ["name", { name: "  " }, "invalid_name"],
      ["whatsapp", { whatsapp: "12" }, "invalid_whatsapp"],
      ["company", { company: "" }, "invalid_company"],
      ["size", { teamSize: "huge" }, "invalid_team_size"],
      ["interests", { interests: ["nope"] }, "invalid_interests"],
      ["message", { message: "x".repeat(COMPANY_MESSAGE_MAX + 1) }, "invalid_message"],
    ];
    for (const [, patch, code] of bad) {
      await expect(joinCompanyRequests(db, { ...ANA, ...patch }, null)).rejects.toMatchObject({ code });
    }
    expect(await db.select().from(schema.companyRequests)).toEqual([]);
  });

  test("a raw browser tag reads as its language: en-US is English, es-MX is Spanish", async () => {
    expect(companyRequestEmail("a@b.co")?.length).toBeGreaterThan(0);
    const a = await joinCompanyRequests(db, { ...ANA, email: "a@x.com", locale: "en-US" }, null);
    const b = await joinCompanyRequests(db, { ...ANA, email: "b@x.com", locale: "es-MX" }, null);
    expect((await companyRequestById(db, a.id)).locale).toBe("en");
    expect((await companyRequestById(db, b.id)).locale).toBe("es");
  });

  test("confirming the address makes it confirmed and keeps the consent it was given under", async () => {
    const { id } = await joinCompanyRequests(db, ANA, null, new Date("2026-11-18T10:00:00Z"));
    const token = await lastToken(db, "company_request_confirm");
    expect(COMPANY_TOKEN.test(token)).toBe(true);
    expect(await confirmCompanyRequest(db, token, null)).toMatchObject({ confirmed: true, resend: false });
    const view = await companyRequestById(db, id);
    expect(view.confirmedAt).toBeInstanceOf(Date);
    // Opening the same link again answers true.
    expect(await confirmCompanyRequest(db, token, null)).toMatchObject({ confirmed: true });
    // It is in the list now, and its consent is the one the first form gave.
    expect((await listCompanyRequests(db, { limit: 10 })).counts.all).toBe(1);
    const [row] = await db.select().from(schema.companyRequests).where(eq(schema.companyRequests.id, id));
    expect(row?.consentVersion).toBe("2026-11-18");
  });

  test("an unknown or expired link confirms nothing", async () => {
    expect(await confirmCompanyRequest(db, "x".repeat(32), null)).toMatchObject({ confirmed: false });
    expect(await confirmCompanyRequest(db, "short", null)).toMatchObject({ confirmed: false });
  });

  test("a second form before confirmation replaces what it carried and sends a new link, rate-limited", async () => {
    const now = new Date("2026-11-18T10:00:00Z");
    const first = await joinCompanyRequests(db, ANA, null, now);
    // The same moment: no second email goes (the window).
    const again = await joinCompanyRequests(db, { ...ANA, company: "Aurora Bakery Ltda" }, null, now);
    expect(again).toEqual({ added: false, id: first.id });
    const mails = await db.select().from(schema.outbox).where(eq(schema.outbox.kind, "email.send"));
    expect(mails).toHaveLength(1);
    // Its data still updates before confirmation.
    expect((await companyRequestById(db, first.id)).company).toBe("Aurora Bakery Ltda");
  });

  test("the team's list pages, counts each step and finds a company, a person or an address", async () => {
    for (const [i, company] of ["Aurora Bakery", "Cafe Sol", "Estudio Norte"].entries()) {
      const { id } = await joinCompanyRequests(
        db,
        { ...ANA, email: `a${i}@example.com`, company, name: ["Ana Souza", "Bia Lima", "Caio Reis"][i] ?? "" },
        null,
        new Date(Date.UTC(2026, 10, 18, 10, i)),
      );
      await confirmCompanyRequest(db, (await lastToken(db, "company_request_confirm")) ?? "", null);
      expect(id).toBeTruthy();
    }
    const all = await listCompanyRequests(db, { limit: 10 });
    expect(all.requests.map((r) => r.company)).toEqual(["Estudio Norte", "Cafe Sol", "Aurora Bakery"]);
    expect(all.counts).toEqual({ all: 3, new: 3, talking: 0, invited: 0, deployed: 0, discarded: 0 });

    const found = await listCompanyRequests(db, { q: "cafe", limit: 10 });
    expect(found.requests.map((r) => r.company)).toEqual(["Cafe Sol"]);
    const byPerson = await listCompanyRequests(db, { q: "bia", limit: 10 });
    expect(byPerson.requests.map((r) => r.name)).toEqual(["Bia Lima"]);

    // A first page of one, then the next.
    const page = await listCompanyRequests(db, { limit: 1 });
    expect(page.requests.map((r) => r.company)).toEqual(["Estudio Norte"]);
    expect(page.next).not.toBeNull();
    const next = await listCompanyRequests(db, { limit: 1, cursor: page.next ?? undefined });
    expect(next.requests.map((r) => r.company)).toEqual(["Cafe Sol"]);
  });

  test("a client's code is three digits and belongs to one company", async () => {
    const first = await joinCompanyRequests(db, ANA, null);
    const second = await joinCompanyRequests(db, { ...ANA, email: "bia@example.com" }, null);
    expect((await setCompanyClientCode(db, first.id, "064")).clientCode).toBe("064");
    await expect(setCompanyClientCode(db, first.id, "64")).rejects.toMatchObject({ code: "invalid_client_code" });
    await expect(setCompanyClientCode(db, second.id, "064")).rejects.toMatchObject({ code: "client_code_taken" });
    expect((await setCompanyClientCode(db, first.id, null)).clientCode).toBeNull();
  });

  test("two requests racing for one client's code: one wins, the other is a conflict, never both", async () => {
    const first = await joinCompanyRequests(db, ANA, null);
    const second = await joinCompanyRequests(db, { ...ANA, email: "bia@example.com" }, null);
    const settled = await Promise.allSettled([
      setCompanyClientCode(db, first.id, "099"),
      setCompanyClientCode(db, second.id, "099"),
    ]);
    const won = settled.filter((s) => s.status === "fulfilled");
    const lost = settled.filter((s) => s.status === "rejected");
    expect(won).toHaveLength(1);
    expect(lost).toHaveLength(1);
    expect((lost[0] as PromiseRejectedResult).reason.code).toBe("client_code_taken");
    const rows = await db.select().from(schema.companyRequests);
    expect(rows.filter((r) => r.clientCode === "099")).toHaveLength(1);
  });

  test("a request moves through its steps", async () => {
    const { id } = await joinCompanyRequests(db, ANA, null);
    expect((await setCompanyStatus(db, id, "talking")).status).toBe("talking");
    expect((await setCompanyStatus(db, id, "discarded")).status).toBe("discarded");
  });

  test("the Invite sends the early-access link and moves the request to invited, once", async () => {
    const owner = await addUser(db, "owner");
    const { id } = await joinCompanyRequests(db, ANA, null);
    const first = await inviteCompanyRequest(db, id, { publicUrl: "https://doug.example", byUserId: owner.id });
    expect(first.outcome).toBe("invited");
    expect(first.request.status).toBe("invited");
    expect(first.request.invitedAt).toBeInstanceOf(Date);

    // Sending it again within the early-access window sends nothing new, and the step stays invited.
    const again = await inviteCompanyRequest(db, id, { publicUrl: "https://doug.example", byUserId: owner.id });
    expect(again.outcome).toBe("recent");
    expect(again.request.status).toBe("invited");
  });

  test("Delete erases the request and everything it holds", async () => {
    const { id } = await joinCompanyRequests(db, ANA, null);
    await confirmCompanyRequest(db, await lastToken(db, "company_request_confirm"), null);
    await setCompanyNotes(db, id, "Falou com a Ana.");
    await deleteCompanyRequest(db, id);
    expect(await db.select().from(schema.companyRequests)).toEqual([]);
    await expect(companyRequestById(db, id)).rejects.toMatchObject({ code: "not_found" });
  });

  test("deleting an account's email takes the request that address left", async () => {
    await joinCompanyRequests(db, ANA, null);
    await joinCompanyRequests(db, { ...ANA, email: "other@example.com" }, null);
    expect(await deleteCompanyRequestsByEmail(db, ["ana@aurorabakery.com"])).toBe(1);
    const left = await db.select().from(schema.companyRequests);
    expect(left.map((r) => r.email)).toEqual(["other@example.com"]);
  });

  test("deleting a person's account erases the request their own address left", async () => {
    const { deleteAccount } = await import("../src");
    // The account's address is what the form carried; the rest of the form is not the account's, it is the team's.
    const person = await addUser(db, "ana");
    await db.update(schema.users).set({ email: "ana@aurorabakery.com" }).where(eq(schema.users.id, person.id));
    await joinCompanyRequests(db, ANA, null);
    await joinCompanyRequests(db, { ...ANA, email: "someone@other.com" }, null);
    await deleteAccount(db, person.id);
    const left = (await db.select().from(schema.companyRequests)).map((r) => r.email);
    expect(left).toEqual(["someone@other.com"]);
  });

  test("the retention sweep deletes old requests that never became clients, and keeps the rest", async () => {
    const old = new Date("2025-01-01T10:00:00Z");
    const fresh = new Date("2026-11-18T10:00:00Z");
    // Written a year before the sweep, so each moved last at `old` (a step set with `old` keeps it that way).
    const stale = await joinCompanyRequests(db, ANA, null, old);
    await setCompanyStatus(db, stale.id, "discarded", old);
    // A client of the same age stays, and one the team invited stays.
    const client = await joinCompanyRequests(db, { ...ANA, email: "client@example.com" }, null, old);
    await setCompanyStatus(db, client.id, "deployed", old);
    const invited = await joinCompanyRequests(db, { ...ANA, email: "invited@example.com" }, null, old);
    await setCompanyStatus(db, invited.id, "invited", old);
    const swept = await sweepCompanyRequests(db, 365, fresh);
    expect(swept.swept).toBe(1);
    const left = (await db.select().from(schema.companyRequests)).map((r) => r.email).sort();
    expect(left).toEqual(["client@example.com", "invited@example.com"]);
    // 0 keeps everything.
    expect((await sweepCompanyRequests(db, 0, fresh)).swept).toBe(0);
  });

  test("notes are kept and trimmed", async () => {
    const { id } = await joinCompanyRequests(db, ANA, null);
    expect((await setCompanyNotes(db, id, "  Falou com a Ana.  ")).notes).toBe("Falou com a Ana.");
  });
});

/** An owner with a workspace, so the inbox row has one to live in. */
async function ownerIn(db: Database): Promise<{ userId: string; orgId: string }> {
  const owner = await addUser(db, "owner");
  const [org] = await db.insert(schema.organizations).values({ name: "Doug" }).returning();
  if (!org) throw new Error("no org");
  await db.insert(schema.organizationMembers).values({ orgId: org.id, userId: owner.id, role: "owner" });
  return { userId: owner.id, orgId: org.id };
}

describe("the owner hears a confirmed request", () => {
  test("nothing reaches the owner before the address confirms", async () => {
    const { userId } = await ownerIn(db);
    const notify = { ownerUserId: userId, emailTo: "team@doug.example", publicUrl: "https://doug.example" };
    await joinCompanyRequests(db, ANA, notify);
    // The only email so far is the company's own confirmation.
    const kinds = (await db.select().from(schema.outbox).where(eq(schema.outbox.kind, "email.send"))).map(
      (j) => (j.payload as { template?: { kind?: string } }).template?.kind,
    );
    expect(kinds).toEqual(["company_request_confirm"]);
    expect(await db.select().from(schema.notifications)).toEqual([]);
  });

  test("an inbox row, waiting, about the company and the person, and never the rest of the form", async () => {
    const { userId, orgId } = await ownerIn(db);
    const notify = { ownerUserId: userId, emailTo: null, publicUrl: "https://doug.example" };
    const { id } = await joinCompanyRequests(db, ANA, notify);
    await confirmCompanyRequest(db, await lastToken(db, "company_request_confirm"), notify);
    const [row] = await db.select().from(schema.notifications).where(eq(schema.notifications.orgId, orgId));
    expect(row).toMatchObject({ userId, kind: "company_request", waiting: true, groupKey: `company_request:${id}` });
    expect(row?.source).toMatchObject({ companyRequestId: id, label: "Aurora Bakery" });
    expect(row?.latest).toMatchObject({ title: "Aurora Bakery", text: "Ana Souza" });
    // What the person typed is not in the notice.
    expect(JSON.stringify(row)).not.toContain("We post two videos");
  });

  test("the owner's email goes to the address the server was told, in the company's language", async () => {
    const { userId } = await ownerIn(db);
    const notify = { ownerUserId: userId, emailTo: "team@doug.example", publicUrl: "https://doug.example" };
    await joinCompanyRequests(db, ANA, notify);
    await confirmCompanyRequest(db, await lastToken(db, "company_request_confirm"), notify);
    const templates = (await db.select().from(schema.outbox).where(eq(schema.outbox.kind, "email.send"))).map(
      (j) => j.payload as { to?: string[]; template?: { kind?: string; locale?: string; company?: string } },
    );
    const owner = templates.find((t) => t.template?.kind === "company_request_owner");
    expect(owner?.template).toMatchObject({ locale: "pt-BR", company: "Aurora Bakery" });
    expect(owner?.to).toEqual(["team@doug.example"]);
  });

  test("a request already confirmed sends no second notice for a plain resend", async () => {
    const { userId } = await ownerIn(db);
    const notify = { ownerUserId: userId, emailTo: null, publicUrl: "https://doug.example" };
    const { id } = await joinCompanyRequests(db, ANA, notify);
    await confirmCompanyRequest(db, await lastToken(db, "company_request_confirm"), notify);
    const before = await db.select().from(schema.notifications);
    // A second form, sent long after the window: kept apart, the row unchanged, nothing new in the inbox.
    await joinCompanyRequests(db, { ...ANA, company: "Aurora Bakery Ltda" }, notify, new Date(Date.now() + 5 * 60_000));
    expect(await db.select().from(schema.notifications)).toHaveLength(before.length);
    expect((await companyRequestById(db, id)).company).toBe("Aurora Bakery");
    expect((await companyRequestById(db, id)).pendingResendAt).toBeInstanceOf(Date);
  });

  test("a confirmed resend applies the form, and a discarded request comes back to new", async () => {
    const { userId } = await ownerIn(db);
    const notify = { ownerUserId: userId, emailTo: null, publicUrl: "https://doug.example" };
    const { id } = await joinCompanyRequests(db, ANA, notify);
    await confirmCompanyRequest(db, await lastToken(db, "company_request_confirm"), notify);
    await setCompanyStatus(db, id, "discarded");
    await joinCompanyRequests(
      db,
      { ...ANA, company: "Aurora Bakery Ltda", message: "Agora com loja física." },
      notify,
      new Date(Date.now() + 5 * 60_000),
    );
    // Not applied yet: the team sees it as discarded, the new form waiting.
    expect((await companyRequestById(db, id)).status).toBe("discarded");
    expect((await companyRequestById(db, id)).company).toBe("Aurora Bakery");
    const result = await confirmCompanyRequest(db, await lastToken(db, "company_request_resend"), notify);
    expect(result).toMatchObject({ confirmed: true, resend: true });
    const view = await companyRequestById(db, id);
    expect(view.company).toBe("Aurora Bakery Ltda");
    expect(view.message).toBe("Agora com loja física.");
    expect(view.status).toBe("new");
    expect(view.pendingResendAt).toBeNull();
    // The consent is still the first one's.
    const [row] = await db.select().from(schema.companyRequests).where(eq(schema.companyRequests.id, id));
    expect(row?.consentVersion).toBe("2026-11-18");
  });

  test("moving a request on resolves its notice", async () => {
    const { userId, orgId } = await ownerIn(db);
    const notify = { ownerUserId: userId, emailTo: null, publicUrl: "https://doug.example" };
    const { id } = await joinCompanyRequests(db, ANA, notify);
    await confirmCompanyRequest(db, await lastToken(db, "company_request_confirm"), notify);
    await setCompanyStatus(db, id, "talking");
    const [row] = await db.select().from(schema.notifications).where(eq(schema.notifications.orgId, orgId));
    expect(row?.doneAt).toBeInstanceOf(Date);
  });
});
