import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { type Database, eq, schema } from "@agenteschat/db";
import { createTestDatabase } from "@agenteschat/db/testing";
import {
  COMPANY_CONFIRM_TTL_MS,
  COMPANY_MAX_SENDS,
  COMPANY_MESSAGE_MAX,
  COMPANY_TOKEN,
  COMPANY_UNCONFIRMED_GRACE_MS,
  companyRequestById,
  companyRequestEmail,
  confirmCompanyRequest,
  deleteCompanyRequest,
  deleteCompanyRequestByToken,
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

/** The delete token of the latest confirmation email, as its own link carries it (its `?delete=`). */
async function lastDeleteToken(db: Database): Promise<string> {
  const jobs = await db.select().from(schema.outbox).where(eq(schema.outbox.kind, "email.send"));
  const urls = jobs
    .map((j) => (j.payload as { template?: { kind?: string; deleteUrl?: string } }).template)
    .filter((t) => t?.kind === "company_request_confirm")
    .map((t) => t?.deleteUrl ?? "")
    .filter(Boolean);
  return new URL(urls.at(-1) ?? "https://x.test/empresas", "https://x.test").searchParams.get("delete") ?? "";
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
    // The same moment: the claim is refused (the window), and nothing changes at all, the data included.
    const again = await joinCompanyRequests(db, { ...ANA, company: "Aurora Bakery Ltda" }, null, now);
    expect(again).toEqual({ added: false, id: first.id });
    const mails = await db.select().from(schema.outbox).where(eq(schema.outbox.kind, "email.send"));
    expect(mails).toHaveLength(1);
    expect((await companyRequestById(db, first.id)).company).toBe("Aurora Bakery");
    // Past the window the claim goes, and the new data and a link of its own replace what stood, together.
    const later = new Date(now.getTime() + 5 * 60_000);
    expect(await joinCompanyRequests(db, { ...ANA, company: "Aurora Bakery Ltda" }, null, later)).toEqual({
      added: false,
      id: first.id,
    });
    expect((await companyRequestById(db, first.id)).company).toBe("Aurora Bakery Ltda");
    expect(await db.select().from(schema.outbox).where(eq(schema.outbox.kind, "email.send"))).toHaveLength(2);
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

  test("the person's own delete link erases the request, once, and an unknown or old one erases nothing", async () => {
    const sent = new Date("2026-11-18T10:00:00Z");
    await joinCompanyRequests(db, ANA, null, sent);
    const token = await lastDeleteToken(db);
    expect(COMPANY_TOKEN.test(token)).toBe(true);
    // The team never deletes anything here: the link is the person's own. It erases, and spent once, answers false.
    expect(await deleteCompanyRequestByToken(db, token, new Date(sent.getTime() + 3600_000))).toBe(true);
    expect(await db.select().from(schema.companyRequests)).toEqual([]);
    expect(await deleteCompanyRequestByToken(db, token)).toBe(false);
    // An unknown token, and a malformed one, are refused.
    expect(await deleteCompanyRequestByToken(db, "x".repeat(32))).toBe(false);
    expect(await deleteCompanyRequestByToken(db, "short")).toBe(false);
  });

  test("the person's delete link has its own lifetime, longer than the confirmation's, and then stops", async () => {
    const sent = new Date("2026-11-18T10:00:00Z");
    await joinCompanyRequests(db, ANA, null, sent);
    const token = await lastDeleteToken(db);
    // A month on: the confirmation may be spent, but the delete link still works.
    expect(await deleteCompanyRequestByToken(db, token, new Date(sent.getTime() + 30 * 24 * 3600_000))).toBe(true);
  });

  test("the person's delete link stops after its lifetime", async () => {
    const { COMPANY_DELETE_TTL_MS } = await import("../src");
    const sent = new Date("2026-11-18T10:00:00Z");
    await joinCompanyRequests(db, ANA, null, sent);
    const token = await lastDeleteToken(db);
    expect(
      await deleteCompanyRequestByToken(db, token, new Date(sent.getTime() + COMPANY_DELETE_TTL_MS + 3600_000)),
    ).toBe(false);
    expect(await db.select().from(schema.companyRequests)).toHaveLength(1);
  });

  test("a delete link stops working when a new confirmation email goes out for the same request", async () => {
    const now = new Date("2026-11-18T10:00:00Z");
    await joinCompanyRequests(db, ANA, null, now);
    const first = await lastDeleteToken(db);
    await joinCompanyRequests(
      db,
      { ...ANA, company: "Aurora Bakery Ltda" },
      null,
      new Date(now.getTime() + 5 * 60_000),
    );
    const second = await lastDeleteToken(db);
    expect(second).not.toBe(first);
    // The one the older email carried no longer erases.
    expect(await deleteCompanyRequestByToken(db, first)).toBe(false);
    expect(await deleteCompanyRequestByToken(db, second)).toBe(true);
    expect(await db.select().from(schema.companyRequests)).toEqual([]);
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

  test("the retention sweep deletes old confirmed requests that never became clients, and keeps the rest", async () => {
    const old = new Date("2025-01-01T10:00:00Z");
    // Confirmed at `old`, so their confirmation's link is long spent by the sweep; only retention speaks for them.
    const confirmAt = async (at: Date) =>
      confirmCompanyRequest(db, await lastToken(db, "company_request_confirm"), null, at);
    const stale = await joinCompanyRequests(db, ANA, null, old);
    await confirmAt(old);
    await setCompanyStatus(db, stale.id, "discarded", old);
    // A client of the same age stays, and one the team invited stays.
    const client = await joinCompanyRequests(db, { ...ANA, email: "client@example.com" }, null, old);
    await confirmAt(old);
    await setCompanyStatus(db, client.id, "deployed", old);
    const invited = await joinCompanyRequests(db, { ...ANA, email: "invited@example.com" }, null, old);
    await confirmAt(old);
    await setCompanyStatus(db, invited.id, "invited", old);
    const fresh = new Date("2026-11-18T10:00:00Z");
    const swept = await sweepCompanyRequests(db, 365, fresh);
    expect(swept.swept).toBe(1);
    const left = (await db.select().from(schema.companyRequests)).map((r) => r.email).sort();
    expect(left).toEqual(["client@example.com", "invited@example.com"]);
    // 0 keeps everything, and the unconfirmed past their link are gone by then anyway (a test of their own).
    expect((await sweepCompanyRequests(db, 0, fresh)).swept).toBe(0);
  });

  test("a request its address never confirmed goes once its link expired, plus a week, whatever its step", async () => {
    const sent = new Date("2026-11-01T10:00:00Z");
    const { id } = await joinCompanyRequests(db, ANA, null, sent);
    // The team moved it on in the meantime; that never confirms an address.
    await setCompanyStatus(db, id, "talking", new Date(sent.getTime() + 3600_000));
    // Before the link's own expiry and the week's grace are up, nothing goes.
    const almost = new Date(sent.getTime() + COMPANY_CONFIRM_TTL_MS + COMPANY_UNCONFIRMED_GRACE_MS - 3600_000);
    expect((await sweepCompanyRequests(db, 365, almost)).swept).toBe(0);
    // Past it, the request goes, notices included.
    const after = new Date(sent.getTime() + COMPANY_CONFIRM_TTL_MS + COMPANY_UNCONFIRMED_GRACE_MS + 3600_000);
    expect((await sweepCompanyRequests(db, 365, after)).swept).toBe(1);
    expect(await db.select().from(schema.companyRequests)).toEqual([]);
  });

  test("the sweep erases the notices of what it deletes", async () => {
    const { userId, orgId } = await ownerIn(db);
    const notify = { ownerUserId: userId, emailTo: null, publicUrl: "https://doug.example" };
    const sent = new Date("2025-01-01T10:00:00Z");
    const { id } = await joinCompanyRequests(db, ANA, notify, sent);
    await confirmCompanyRequest(db, await lastToken(db, "company_request_confirm"), notify, sent);
    await setCompanyStatus(db, id, "discarded", sent);
    expect(await db.select().from(schema.notifications).where(eq(schema.notifications.orgId, orgId))).toHaveLength(1);
    await sweepCompanyRequests(db, 365, new Date("2026-11-18T10:00:00Z"));
    expect(await db.select().from(schema.notifications)).toEqual([]);
  });

  test("notes are kept and trimmed", async () => {
    const { id } = await joinCompanyRequests(db, ANA, null);
    expect((await setCompanyNotes(db, id, "  Falou com a Ana.  ")).notes).toBe("Falou com a Ana.");
  });

  test("an attacker filling the form for someone else's address changes nothing and mails nothing", async () => {
    const now = new Date("2026-11-18T10:00:00Z");
    // The real person asks first.
    await joinCompanyRequests(db, ANA, null, now);
    const victimToken = await lastToken(db, "company_request_confirm");
    // An attacker sends the form for the same address at once: the claim is refused, so neither the data nor the
    // link move, and no email goes to the victim.
    const attack = await joinCompanyRequests(
      db,
      { ...ANA, company: "Attacker LLC", whatsapp: "+5511900000000" },
      null,
      now,
    );
    expect(attack.added).toBe(false);
    const [row] = await db.select().from(schema.companyRequests);
    expect(row?.company).toBe("Aurora Bakery");
    expect(row?.whatsapp).toBe("+5511912345678");
    // The victim's own link is the one that works.
    expect(await confirmCompanyRequest(db, victimToken, null, now)).toMatchObject({ confirmed: true });
    // One email, in all.
    expect(await db.select().from(schema.outbox).where(eq(schema.outbox.kind, "email.send"))).toHaveLength(1);
  });

  test("past the window, an accepted claim brings the new data and a new link together", async () => {
    const now = new Date("2026-11-18T10:00:00Z");
    const { id } = await joinCompanyRequests(db, ANA, null, now);
    const before = await lastDeleteToken(db);
    const later = new Date(now.getTime() + 5 * 60_000);
    expect(await joinCompanyRequests(db, { ...ANA, company: "Aurora Bakery Ltda" }, null, later)).toEqual({
      added: false,
      id,
    });
    expect((await companyRequestById(db, id)).company).toBe("Aurora Bakery Ltda");
    expect(await lastDeleteToken(db)).not.toBe(before);
  });

  test("one request gets at most five confirmation emails a day, and the day resets a new send", async () => {
    const start = new Date("2026-11-18T10:00:00Z");
    await joinCompanyRequests(db, ANA, null, start);
    // More forms, each past the two-minute window but inside a day: the fifth send is the last.
    for (let i = 1; i < 8; i++) {
      await joinCompanyRequests(db, ANA, null, new Date(start.getTime() + i * 5 * 60_000));
    }
    const mails = async () =>
      (await db.select().from(schema.outbox).where(eq(schema.outbox.kind, "email.send"))).length;
    expect(await mails()).toBe(COMPANY_MAX_SENDS);
    // A whole day after the last send went, the window restarts and a new one goes.
    const tomorrow = new Date(start.getTime() + 24 * 3600_000 + 60 * 60_000);
    await joinCompanyRequests(db, ANA, null, tomorrow);
    expect(await mails()).toBe(COMPANY_MAX_SENDS + 1);
  });

  test("deleting the request clears its notice for good, not merely resolving it", async () => {
    const { userId, orgId } = await ownerIn(db);
    const notify = { ownerUserId: userId, emailTo: null, publicUrl: "https://doug.example" };
    const { id } = await joinCompanyRequests(db, ANA, notify);
    await confirmCompanyRequest(db, await lastToken(db, "company_request_confirm"), notify);
    expect(await db.select().from(schema.notifications).where(eq(schema.notifications.orgId, orgId))).toHaveLength(1);
    // The team's Delete takes the request and the notice; nothing of the company is left in the inbox.
    await deleteCompanyRequest(db, id);
    expect(await db.select().from(schema.notifications)).toEqual([]);
  });

  test("the person's own delete takes the notice too", async () => {
    const { userId, orgId } = await ownerIn(db);
    const notify = { ownerUserId: userId, emailTo: null, publicUrl: "https://doug.example" };
    await joinCompanyRequests(db, ANA, notify);
    await confirmCompanyRequest(db, await lastToken(db, "company_request_confirm"), notify);
    expect(await db.select().from(schema.notifications).where(eq(schema.notifications.orgId, orgId))).toHaveLength(1);
    expect(await deleteCompanyRequestByToken(db, await lastDeleteToken(db))).toBe(true);
    expect(await db.select().from(schema.notifications)).toEqual([]);
  });

  test("deleting a person's account takes the notices of the requests their address left too", async () => {
    const { userId, orgId } = await ownerIn(db);
    const notify = { ownerUserId: userId, emailTo: null, publicUrl: "https://doug.example" };
    await joinCompanyRequests(db, ANA, notify);
    await confirmCompanyRequest(db, await lastToken(db, "company_request_confirm"), notify);
    expect(await db.select().from(schema.notifications).where(eq(schema.notifications.orgId, orgId))).toHaveLength(1);
    await deleteCompanyRequestsByEmail(db, ["ana@aurorabakery.com"]);
    expect(await db.select().from(schema.notifications)).toEqual([]);
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
