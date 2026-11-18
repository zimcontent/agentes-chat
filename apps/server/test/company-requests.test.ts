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

/** The token the latest confirmation email carries. */
function lastConfirmToken(t: TestServer): string {
  const urls = t.email.sent
    .filter((m) => m.subject.includes("Confirme") || m.subject.includes("Confirm"))
    .map((m) => /confirm=([A-Za-z0-9_-]{32})/.exec(`${m.subject} ${m.text} ${m.html}`)?.[1] ?? "");
  return urls.filter(Boolean).at(-1) ?? "";
}

/** Confirms the address through the public route, as its link's page does. */
async function confirm(t: TestServer, token: string) {
  return browser(t)("/api/companies/confirm", { json: { token } });
}

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
  // Nothing confirmed yet: it is not in the team's list.
  expect(row?.confirmedAt).toBeNull();

  await t.drain();
  expect(t.email.sent.map((m) => [m.to, m.subject])).toEqual([
    [["ana@aurorabakery.com"], "Confirme seu pedido do DougBot para Aurora Bakery"],
  ]);

  // Sending it again within the window updates the one request and mails nothing new.
  const before = t.email.sent.length;
  const again = await browser(t)("/api/companies", { json: { ...ana, company: "Aurora Bakery Ltda" } });
  expect(again.status).toBe(202);
  expect(await t.db.select().from(schema.companyRequests)).toHaveLength(1);
  await t.drain();
  expect(t.email.sent).toHaveLength(before);
});

test("the address confirms itself, and only then is the request in the team's list", async () => {
  await browser(t)("/api/companies", { json: ana });
  await t.drain();
  const token = lastConfirmToken(t);
  expect(token.length).toBe(32);
  const res = await confirm(t, token);
  expect(res.status).toBe(200);
  const [row] = await t.db.select().from(schema.companyRequests);
  expect(row?.confirmedAt).toBeInstanceOf(Date);
  // The link works once; an unknown one is refused.
  expect((await confirm(t, token)).status).toBe(200);
  expect((await confirm(t, "x".repeat(32))).status).toBe(400);
});

test("a raw browser tag reads as its language: en-US and es-MX are never refused with 400", async () => {
  const en = await browser(t)("/api/companies", { json: { ...ana, email: "en@x.com", locale: "en-US" } });
  expect(en.status).toBe(202);
  const es = await browser(t)("/api/companies", { json: { ...ana, email: "es@x.com", locale: "es-MX" } });
  expect(es.status).toBe(202);
  // An unknown tag reads English, never a 400.
  const xx = await browser(t)("/api/companies", { json: { ...ana, email: "xx@x.com", locale: "xx-YY" } });
  expect(xx.status).toBe(202);
  const rows = await t.db.select().from(schema.companyRequests).where(eq(schema.companyRequests.email, "en@x.com"));
  expect(rows[0]?.locale).toBe("en");
});

test("an address a comma or a query breaks is refused by the server too", async () => {
  const comma = await browser(t)("/api/companies", { json: { ...ana, email: "a,victim@x.com" } });
  expect(comma.status).toBe(400);
  expect(await errorCode(comma)).toBe("invalid_email");
  const query = await browser(t)("/api/companies", { json: { ...ana, email: "a@b.co?cc=x" } });
  expect(query.status).toBe(400);
  expect(await errorCode(query)).toBe("invalid_email");
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

test("agentes.chat's own servers serve neither the form nor its confirmation", async () => {
  await t.close();
  t = await createTestServer({ env: { ALLOW_SIGNUP: "true", PUBLIC_URL: "https://app.agentes.chat" } });
  const res = await browser(t)("/api/companies", {
    json: ana,
    origin: "https://app.agentes.chat",
  });
  expect(res.status).toBe(404);
  expect(await t.db.select().from(schema.companyRequests)).toEqual([]);
});

/** The installation's owner: the first account. */
async function owner(b: ReturnType<typeof browser>) {
  await signUp(b, "owner@doug.example");
  await (await b("/api/app/organizations", { json: { name: "Doug", context: "The team." } })).json();
}

/** A request confirmed through the public flow, its id. */
async function confirmedRequest(t: TestServer, body = ana): Promise<string> {
  await browser(t)("/api/companies", { json: body });
  await t.drain();
  await confirm(t, lastConfirmToken(t));
  const [row] = await t.db
    .select()
    .from(schema.companyRequests)
    .where(eq(schema.companyRequests.email, String(body.email).trim().toLowerCase()));
  return row?.id ?? "";
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
  const id = await confirmedRequest(t);

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

test("the owner deletes a request, and it is gone", async () => {
  const b = browser(t);
  await owner(b);
  const id = await confirmedRequest(t);
  const res = await b(`/api/app/companies/${id}`, { method: "DELETE" });
  expect(res.status).toBe(204);
  expect(await t.db.select().from(schema.companyRequests)).toEqual([]);
  expect((await b(`/api/app/companies/${id}`)).status).toBe(404);
});

test("a client's code belongs to one company: the second one is refused with 409", async () => {
  const b = browser(t);
  await owner(b);
  const first = await confirmedRequest(t);
  const second = await confirmedRequest(t, { ...ana, email: "bia@example.com" });
  await b(`/api/app/companies/${first}/client-code`, { method: "PUT", json: { clientCode: "064" } });
  const taken = await b(`/api/app/companies/${second}/client-code`, {
    method: "PUT",
    json: { clientCode: "064" },
  });
  expect(taken.status).toBe(409);
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
test("with COMPANY_REQUESTS_NOTIFY_EMAIL the owner's email goes out once the address confirms", async () => {
  await t.close();
  t = await createTestServer({ env: { ALLOW_SIGNUP: "true", COMPANY_REQUESTS_NOTIFY_EMAIL: "team@doug.example" } });
  const b = browser(t);
  await owner(b);
  await browser(t)("/api/companies", { json: ana });
  await t.drain();
  // Before the confirmation: only the company's own email went out.
  expect(t.email.sent.filter((m) => m.to.includes("team@doug.example"))).toHaveLength(0);
  await confirm(t, lastConfirmToken(t));
  await t.drain();
  const toTeam = t.email.sent.filter((m) => m.to.includes("team@doug.example"));
  expect(toTeam).toHaveLength(1);
  expect(toTeam[0]?.subject).toBe("Aurora Bakery pediu o DougBot");
  // The owner's inbox row is waiting now.
  const [n] = await t.db.select().from(schema.notifications).where(eq(schema.notifications.kind, "company_request"));
  expect(n?.waiting).toBe(true);
});

test("a resend of a confirmed request mails once, and the team keeps the old data until it is confirmed", async () => {
  const b = browser(t);
  await owner(b);
  const id = await confirmedRequest(t);
  const before = t.email.sent.length;
  // A second form a few minutes later, past the window.
  await browser(t)("/api/companies", { json: { ...ana, company: "Aurora Bakery Ltda" } });
  await t.drain();
  expect(t.email.sent.length).toBe(before + 1);
  expect(t.email.sent.at(-1)?.subject).toBe("Confirme as mudanças no pedido do DougBot para Aurora Bakery Ltda");
  const kept = (await (await b(`/api/app/companies/${id}`)).json()) as {
    company: string;
    pendingResendAt: string | null;
  };
  expect(kept.company).toBe("Aurora Bakery");
  expect(kept.pendingResendAt).not.toBeNull();
});
