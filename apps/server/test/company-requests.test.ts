import { afterEach, beforeEach, expect, test } from "bun:test";
import { eq, schema } from "@agenteschat/db";
import {
  browser,
  createTestServer,
  fakeCloudflare,
  signUp,
  type TestServer,
  TURNSTILE_TEST_TOKEN,
  turnstileCheck,
} from "./harness";

let t: TestServer;
beforeEach(async () => {
  t = await createTestServer({ env: { ALLOW_SIGNUP: "true" } });
});
afterEach(async () => {
  await t.close();
});

const errorCode = async (res: Response) => ((await res.json()) as { error: { code: string } }).error.code;

/** The public form's body: a company asking for DougBot, with the consent. */
const ana = {
  name: " Ana Souza ",
  email: "  Ana@AuroraBakery.com ",
  whatsapp: "+5511912345678",
  company: "Aurora Bakery",
  teamSize: "6-20",
  interests: ["design", "video"],
  message: " Two videos a week by hand. ",
  locale: "pt-BR",
  consent: true,
};

test("the public page joins: the request, a confirmation email in its language, never a list to probe", async () => {
  const res = await browser(t)("/api/companies", { json: ana });
  expect(res.status).toBe(202);
  expect(await res.json()).toEqual({ ok: true });
  const [row] = await t.db.select().from(schema.companyRequests);
  expect(row).toMatchObject({
    email: "ana@aurorabakery.com",
    name: "Ana Souza",
    company: "Aurora Bakery",
    teamSize: "6-20",
    status: "new",
    message: "Two videos a week by hand.",
  });
  expect(row?.interests).toEqual(["design", "video"]);
  expect(row?.consentAt).toBeInstanceOf(Date);

  await t.drain();
  expect(t.email.sent.map((m) => [m.to, m.subject])).toEqual([
    [["ana@aurorabakery.com"], "Recebemos seu pedido do DougBot para Aurora Bakery"],
  ]);

  // Sending it again updates the one request, and answers the same.
  const again = await browser(t)("/api/companies", { json: { ...ana, company: "Aurora Bakery Ltda" } });
  expect(again.status).toBe(202);
  expect(await t.db.select().from(schema.companyRequests)).toHaveLength(1);
});

test("the consent is required, and a bad field is refused with its own code", async () => {
  const noConsent = await browser(t)("/api/companies", { json: { ...ana, consent: false } });
  expect(noConsent.status).toBe(400);
  expect(await errorCode(noConsent)).toBe("consent_required");
  expect(await t.db.select().from(schema.companyRequests)).toEqual([]);
  for (const [patch, code] of [
    [{ email: "nope" }, "invalid_email"],
    [{ whatsapp: "12" }, "invalid_whatsapp"],
    [{ teamSize: "huge" }, "invalid_request"],
    [{ interests: ["nope"] }, "invalid_request"],
  ] as const) {
    const res = await browser(t)("/api/companies", { json: { ...ana, ...patch } });
    expect(await errorCode(res)).toBe(code);
  }
});

test("the form is guarded by the bot check when this server has one", async () => {
  await t.close();
  const cloud = fakeCloudflare();
  t = await createTestServer({ env: { ALLOW_SIGNUP: "true" }, humanCheck: turnstileCheck(cloud.fetch) });
  // No token: refused before the form is read.
  const refused = await browser(t)("/api/companies", { json: ana });
  expect(refused.status).toBe(403);
  expect(await errorCode(refused)).toBe("human_check");
  // A token this server's widget made passes, and the request is kept.
  const passed = await browser(t)("/api/companies", {
    json: ana,
    headers: { "x-captcha-response": TURNSTILE_TEST_TOKEN },
  });
  expect(passed.status).toBe(202);
  expect(await t.db.select().from(schema.companyRequests)).toHaveLength(1);
});

test("only our own origin may join", async () => {
  const evil = await browser(t)("/api/companies", { json: ana, origin: "https://evil.example" });
  expect(evil.status).toBe(403);
  expect(await errorCode(evil)).toBe("bad_origin");
  expect(await t.db.select().from(schema.companyRequests)).toEqual([]);
});

/** The installation's owner: the first account. */
async function owner(b: ReturnType<typeof browser>) {
  await signUp(b, "owner@doug.example");
  await (await b("/api/app/organizations", { json: { name: "Doug", context: "The team." } })).json();
}

test("the team's list is the installation owner's alone: 404 to everyone else, and to a signed-out call", async () => {
  const anon = await browser(t)("/api/app/companies");
  expect(anon.status).toBe(401);
  // The first account owns the installation; a later one gets a 404.
  await owner(browser(t));
  const member = browser(t);
  await signUp(member, "member@doug.example");
  const refused = await member("/api/app/companies");
  expect(refused.status).toBe(404);
});

test("the owner reads, moves, notes, codes and invites a request", async () => {
  const b = browser(t);
  await owner(b);
  await browser(t)("/api/companies", { json: ana });
  const [row] = await t.db.select().from(schema.companyRequests);
  const id = row?.id ?? "";

  // The owner reads the list and the one.
  const page = (await (await b("/api/app/companies")).json()) as {
    requests: { id: string; company: string }[];
    counts: { all: number };
  };
  expect(page.requests.map((r) => r.company)).toEqual(["Aurora Bakery"]);
  expect(page.counts.all).toBe(1);

  // Moves it, notes it, gives it a client's code.
  expect((await b(`/api/app/companies/${id}/status`, { method: "PUT", json: { status: "talking" } })).status).toBe(200);
  expect(
    (await b(`/api/app/companies/${id}/notes`, { method: "PUT", json: { notes: "Falou com a Ana." } })).status,
  ).toBe(200);
  const coded = await b(`/api/app/companies/${id}/client-code`, { method: "PUT", json: { clientCode: "064" } });
  expect(coded.status).toBe(200);
  expect(((await coded.json()) as { clientCode: string }).clientCode).toBe("064");

  // Invites it: the early-access email goes out, and the request is invited.
  const invited = await b(`/api/app/companies/${id}/invite`, { method: "POST", json: {} });
  expect(invited.status).toBe(200);
  const answer = (await invited.json()) as { request: { status: string }; outcome: string };
  expect(answer.outcome).toBe("invited");
  expect(answer.request.status).toBe("invited");
});

test("a client's code belongs to one company: the second one is refused with 409", async () => {
  const b = browser(t);
  await owner(b);
  await browser(t)("/api/companies", { json: ana });
  await browser(t)("/api/companies", { json: { ...ana, email: "bia@example.com" } });
  const rows = await t.db.select().from(schema.companyRequests);
  await b(`/api/app/companies/${rows[0]?.id}/client-code`, { method: "PUT", json: { clientCode: "064" } });
  const taken = await b(`/api/app/companies/${rows[1]?.id}/client-code`, {
    method: "PUT",
    json: { clientCode: "064" },
  });
  expect(taken.status).toBe(400);
  expect(await errorCode(taken)).toBe("client_code_taken");
});

/** The owner's session cookie, for the auth-config, which is public but tells the owner their section. */
test("auth-config tells the installation owner their section, and nobody else", async () => {
  const ownerBrowser = browser(t);
  await owner(ownerBrowser);
  const mine = (await (await ownerBrowser("/api/app/auth-config")).json()) as { companyRequests?: boolean };
  expect(mine.companyRequests).toBe(true);
  const other = browser(t);
  await signUp(other, "other@doug.example");
  const theirs = (await (await other("/api/app/auth-config")).json()) as { companyRequests?: boolean };
  expect(theirs.companyRequests).toBe(false);
  const anon = (await (await browser(t)("/api/app/auth-config")).json()) as { companyRequests?: boolean };
  expect(anon.companyRequests).toBe(false);
});

/** The `COMPANY_REQUESTS_NOTIFY_EMAIL` case: the owner hears it by email too, at the address the server was told. */
test("with COMPANY_REQUESTS_NOTIFY_EMAIL the owner's email goes out too", async () => {
  await t.close();
  t = await createTestServer({ env: { ALLOW_SIGNUP: "true", COMPANY_REQUESTS_NOTIFY_EMAIL: "team@doug.example" } });
  const b = browser(t);
  await owner(b);
  await browser(t)("/api/companies", { json: ana });
  await t.drain();
  const toTeam = t.email.sent.filter((m) => m.to.includes("team@doug.example"));
  expect(toTeam).toHaveLength(1);
  expect(toTeam[0]?.subject).toBe("Aurora Bakery pediu o DougBot");
  // The confirmation to the company went out too, in its language.
  expect(t.email.sent.some((m) => m.to.includes("ana@aurorabakery.com"))).toBe(true);
  // The owner's inbox row is waiting.
  const [n] = await t.db.select().from(schema.notifications).where(eq(schema.notifications.kind, "company_request"));
  expect(n?.waiting).toBe(true);
});
