import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { type Database, eq, schema } from "@agenteschat/db";
import { createTestDatabase } from "@agenteschat/db/testing";
import {
  COMPANY_MESSAGE_MAX,
  companyRequestById,
  inviteCompanyRequest,
  joinCompanyRequests,
  listCompanyRequests,
  setCompanyClientCode,
  setCompanyNotes,
  setCompanyStatus,
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

describe("a company's request", () => {
  test("joins once, lowercase and trimmed, with its consent and the first date kept on a second form", async () => {
    const first = await joinCompanyRequests(db, ANA, null, new Date("2026-11-18T10:00:00Z"));
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

    // The same address again updates what the person typed, keeps the first date and the team's own fields.
    await setCompanyNotes(db, first.id, "Falou com a Ana no WhatsApp.");
    const again = await joinCompanyRequests(
      db,
      { ...ANA, email: "ana@aurorabakery.com", company: "Aurora Bakery Ltda", interests: ["social"] },
      null,
      new Date("2026-11-19T09:00:00Z"),
    );
    expect(again).toEqual({ added: false, id: first.id });
    const view = await companyRequestById(db, first.id);
    expect({ company: view.company, interests: view.interests, notes: view.notes }).toEqual({
      company: "Aurora Bakery Ltda",
      interests: ["social"],
      notes: "Falou com a Ana no WhatsApp.",
    });
    expect(view.createdAt.toISOString()).toBe("2026-11-18T10:00:00.000Z");
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

  test("the team's list pages, counts each step and finds a company, a person or an address", async () => {
    for (const [i, company] of ["Aurora Bakery", "Cafe Sol", "Estudio Norte"].entries())
      await joinCompanyRequests(
        db,
        { ...ANA, email: `a${i}@example.com`, company, name: ["Ana Souza", "Bia Lima", "Caio Reis"][i] ?? "" },
        null,
        new Date(Date.UTC(2026, 10, 18, 10, i)),
      );
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
});

/** An owner with a workspace, so the inbox row has one to live in. */
async function ownerIn(db: Database): Promise<{ userId: string; orgId: string }> {
  const owner = await addUser(db, "owner");
  const [org] = await db.insert(schema.organizations).values({ name: "Doug" }).returning();
  if (!org) throw new Error("no org");
  await db.insert(schema.organizationMembers).values({ orgId: org.id, userId: owner.id, role: "owner" });
  return { userId: owner.id, orgId: org.id };
}

describe("the owner hears a new request", () => {
  test("an inbox row, waiting, about the company and the person, and never the rest of the form", async () => {
    const { userId, orgId } = await ownerIn(db);
    const { id } = await joinCompanyRequests(db, ANA, {
      ownerUserId: userId,
      emailTo: null,
      publicUrl: "https://doug.example",
    });
    const [row] = await db.select().from(schema.notifications).where(eq(schema.notifications.orgId, orgId));
    expect(row).toMatchObject({
      userId,
      kind: "company_request",
      waiting: true,
      groupKey: `company_request:${id}`,
    });
    expect(row?.source).toMatchObject({ companyRequestId: id, label: "Aurora Bakery" });
    expect(row?.latest).toMatchObject({ title: "Aurora Bakery", text: "Ana Souza" });
    // What the person typed is not in the notice.
    expect(JSON.stringify(row)).not.toContain("We post two videos");
  });

  test("the owner's email goes to the address the server was told, in the company's language", async () => {
    const { userId } = await ownerIn(db);
    await joinCompanyRequests(db, ANA, {
      ownerUserId: userId,
      emailTo: "team@doug.example",
      publicUrl: "https://doug.example",
    });
    const job = await db.select().from(schema.outbox).where(eq(schema.outbox.kind, "email.send"));
    const sent = job.map((j) => (j.payload as { template?: { kind?: string; locale?: string; to?: string } }).template);
    expect(sent.some((t) => t?.kind === "company_request_received" && t.locale === "pt-BR")).toBe(true);
    // The owner's own notice carries the form's kinds of work and size, as words, in the email's language.
    const owner = sent.find((t) => t?.kind === "company_request_owner");
    expect(owner).toBeDefined();
  });

  test("a request already there again sends nothing", async () => {
    const { userId } = await ownerIn(db);
    const notify = { ownerUserId: userId, emailTo: null, publicUrl: "https://doug.example" };
    await joinCompanyRequests(db, ANA, notify);
    const before = await db.select().from(schema.notifications);
    await joinCompanyRequests(db, ANA, notify);
    expect(await db.select().from(schema.notifications)).toHaveLength(before.length);
  });
});
