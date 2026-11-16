import { afterEach, describe, expect, test } from "bun:test";
import { createFakeWhatsAppGateway } from "@agenteschat/adapters";
import { eq, schema } from "@agenteschat/db";
import { WHATSAPP_AGENT_JOB } from "@agenteschat/engine";
import { type Browser, browser, createTestServer, seedOrg, signUp, type TestServer } from "./harness";

/**
 * The approval portal's notices on WhatsApp (docs/adr/doug-0001-whatsapp-numbers.md, addendum 2026-11-16):
 * `POST /api/webhooks/approval-portal/whatsapp`, a bearer token, a connected number that sends and the few numbers a
 * notice may go to.
 */

let t: TestServer;
afterEach(async () => {
  const current = t;
  t = undefined as unknown as TestServer;
  await current?.close();
});

const TOKEN = "portal-whatsapp-token-for-tests-0001";
/** The number that sends (DOUG's) and the two a notice may go to. */
const FROM = "13212048550";
const LETICIA = "5511987654321";
const OTHER = "5511912345678";
const PORTAL = { PORTAL_WHATSAPP_TOKEN: TOKEN, PORTAL_WHATSAPP_FROM: FROM, PORTAL_WHATSAPP_TO: `${LETICIA}, ${OTHER}` };

type Account = { id: string };
type Chat = { id: string; name: string; unread: number; lastText: string; lastFromMe?: boolean };

const event = (name: string, data: unknown) => ({ event: name, data, instanceId: "instance-1" });

async function start(
  options: {
    gateway?: ReturnType<typeof createFakeWhatsAppGateway> | null;
    env?: Record<string, string>;
    connected?: boolean;
  } = {},
) {
  const gateway = options.gateway === undefined ? createFakeWhatsAppGateway() : options.gateway;
  t = await createTestServer({
    ...(gateway ? { whatsapp: gateway } : {}),
    env: { WHATSAPP_HOOK_URL: "http://agentes:3000", ...(options.env ?? PORTAL) },
  });
  const owner = browser(t);
  await signUp(owner, "owner@example.com");
  const { orgId, agentId } = await seedOrg(owner);
  const api = (path: string, init?: Parameters<Browser>[1]) =>
    owner(`/api/app/organizations/${orgId}/whatsapp${path}`, init);
  const hook = (payload: unknown) => {
    const connect = gateway?.last("connect");
    if (!connect) throw new Error("never connected");
    return t.app.request(`/api/webhooks/whatsapp/${connect.webhookUrl.split("/").at(-1)}`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(payload),
    });
  };
  let account: Account | null = null;
  if (gateway) {
    account = (await (await api("/accounts", { json: { label: "DOUG" } })).json()) as Account;
    if (options.connected !== false) {
      await hook(event("Connected", { status: "open", jid: `${FROM}:7@s.whatsapp.net`, pushName: "DOUG" }));
    }
  }
  /** The portal calling: no session, no origin, only its token. */
  const notice = (body: unknown, token: string | null = TOKEN) =>
    t.app.request("/api/webhooks/approval-portal/whatsapp", {
      method: "POST",
      headers: { "content-type": "application/json", ...(token === null ? {} : { authorization: `Bearer ${token}` }) },
      body: typeof body === "string" ? body : JSON.stringify(body),
    });
  const sends = () => (gateway?.calls ?? []).filter((call) => call.op === "send");
  return { owner, orgId, agentId, api, hook, notice, sends, gateway, account: account as Account };
}

describe("the approval portal's notices on WhatsApp", () => {
  test("sends the text from the connected number and keeps it in the conversation as the number's own", async () => {
    const { api, notice, sends, account } = await start();
    const res = await notice({ to: LETICIA, text: "Nova versão do post Black Friday: https://mydoug.io/p/42" });
    expect(res.status).toBe(200);
    const body = (await res.json()) as { ok: boolean; messageId: string };
    expect(body.ok).toBe(true);
    expect(body.messageId).toMatch(/^[0-9a-f-]{36}$/);
    expect(sends()).toMatchObject([
      { to: `${LETICIA}@s.whatsapp.net`, text: "Nova versão do post Black Friday: https://mydoug.io/p/42" },
    ]);

    // The conversation was made, and the message is the number's: nobody of the workspace wrote it, and no agent.
    const { chats } = (await (await api(`/accounts/${account.id}/chats`)).json()) as { chats: Chat[] };
    expect(chats).toMatchObject([{ unread: 0, lastText: "Nova versão do post Black Friday: https://mydoug.io/p/42" }]);
    const [row] = await t.db
      .select()
      .from(schema.whatsappMessages)
      .where(eq(schema.whatsappMessages.id, body.messageId));
    expect(row).toMatchObject({
      accountId: account.id,
      chatId: chats[0]?.id,
      fromMe: true,
      status: "sent",
      kind: "text",
      sentByUserId: null,
      sentByAgentId: null,
    });
  });

  test("the number's agent isn't woken by a notice, and isn't told a person took the conversation", async () => {
    const { api, agentId, notice, account } = await start();
    await t.db
      .update(schema.whatsappAccounts)
      .set({ agentId, agentOn: true })
      .where(eq(schema.whatsappAccounts.id, account.id));
    expect((await notice({ to: LETICIA, text: "Post aprovado" })).status).toBe(200);
    expect(await t.db.select().from(schema.outbox).where(eq(schema.outbox.kind, WHATSAPP_AGENT_JOB))).toEqual([]);
    const { chats } = (await (await api(`/accounts/${account.id}/chats`)).json()) as { chats: Chat[] };
    const [chat] = await t.db
      .select({ personAt: schema.whatsappChats.personAt, needsPerson: schema.whatsappChats.needsPerson })
      .from(schema.whatsappChats)
      .where(eq(schema.whatsappChats.id, chats[0]?.id as string));
    expect(chat).toEqual({ personAt: null, needsPerson: false });
  });

  test("the same key within a day sends once and answers the same", async () => {
    const { notice, sends } = await start();
    const first = await notice({ to: LETICIA, text: "Post aprovado", key: "post-42:approved" });
    const again = await notice({ to: LETICIA, text: "Post aprovado", key: "post-42:approved" });
    expect([first.status, again.status]).toEqual([200, 200]);
    const a = (await first.json()) as { ok: boolean; messageId: string };
    expect(await again.json()).toEqual(a);
    expect(sends()).toHaveLength(1);

    // Another key, or none, is another notice.
    const other = (await (await notice({ to: LETICIA, text: "Post aprovado", key: "post-43:approved" })).json()) as {
      messageId: string;
    };
    expect(other.messageId).not.toBe(a.messageId);
    expect((await notice({ to: LETICIA, text: "Post aprovado" })).status).toBe(200);
    expect((await notice({ to: LETICIA, text: "Post aprovado" })).status).toBe(200);
    expect(sends()).toHaveLength(4);
  });

  test("two calls with the same key at once send once", async () => {
    const { notice, sends } = await start();
    const both = await Promise.all([
      notice({ to: LETICIA, text: "Post aprovado", key: "post-44:approved" }),
      notice({ to: LETICIA, text: "Post aprovado", key: "post-44:approved" }),
    ]);
    const [a, b] = await Promise.all(both.map((res) => res.json()));
    expect(both.map((res) => res.status)).toEqual([200, 200]);
    expect(a).toEqual(b);
    expect(sends()).toHaveLength(1);
  });

  test("a key older than a day sends again", async () => {
    const { notice, sends } = await start();
    const first = (await (await notice({ to: LETICIA, text: "Lembrete", key: "reminder" })).json()) as {
      messageId: string;
    };
    await t.db
      .update(schema.whatsappMessages)
      .set({ createdAt: new Date(Date.now() - 25 * 60 * 60_000) })
      .where(eq(schema.whatsappMessages.id, first.messageId));
    const later = (await (await notice({ to: LETICIA, text: "Lembrete", key: "reminder" })).json()) as {
      messageId: string;
    };
    expect(later.messageId).not.toBe(first.messageId);
    expect(sends()).toHaveLength(2);
  });

  test("404 while it is off: without its settings, with only some of them, or with no gateway", async () => {
    const off = await start({ env: {} });
    expect((await off.notice({ to: LETICIA, text: "oi" })).status).toBe(404);
    await t.close();

    const half = await start({ env: { PORTAL_WHATSAPP_TOKEN: TOKEN, PORTAL_WHATSAPP_FROM: FROM } });
    expect((await half.notice({ to: LETICIA, text: "oi" })).status).toBe(404);
    expect(half.sends()).toEqual([]);
    await t.close();

    const noGateway = await start({ gateway: null });
    expect((await noGateway.notice({ to: LETICIA, text: "oi" })).status).toBe(404);
  });

  test("401 without the token or with another one, before anything is read", async () => {
    const { notice, sends } = await start();
    expect((await notice({ to: LETICIA, text: "oi" }, null)).status).toBe(401);
    expect((await notice({ to: LETICIA, text: "oi" }, "another-token-of-the-same-length-000")).status).toBe(401);
    expect((await notice({ to: LETICIA, text: "oi" }, `${TOKEN}x`)).status).toBe(401);
    expect((await notice("not json", "wrong")).status).toBe(401);
    expect(sends()).toEqual([]);
  });

  test("400 for a body that isn't a notice", async () => {
    const { notice, sends } = await start();
    for (const body of [
      "not json",
      {},
      { to: LETICIA },
      { to: LETICIA, text: "" },
      { to: LETICIA, text: "   " },
      { to: LETICIA, text: "x".repeat(2001) },
      { to: `+${LETICIA}`, text: "oi" },
      { to: "55 11 98765-4321", text: "oi" },
      { to: "1234567", text: "oi" },
      { to: LETICIA, text: "oi", key: "" },
      { to: LETICIA, text: "oi", key: "k".repeat(201) },
      { to: 5511987654321, text: "oi" },
    ]) {
      expect({ body, status: (await notice(body)).status }).toEqual({ body, status: 400 });
    }
    expect((await notice({ to: LETICIA, text: "x".repeat(2000) })).status).toBe(200);
    expect(sends()).toHaveLength(1);
  });

  test("403 for a number that isn't on the list", async () => {
    const { notice, sends } = await start();
    expect((await notice({ to: "5511900001111", text: "oi" })).status).toBe(403);
    expect(sends()).toEqual([]);
    expect((await notice({ to: OTHER, text: "oi" })).status).toBe(200);
  });

  test("409 while the sending number isn't connected, and nothing is kept for later", async () => {
    const never = await start({ connected: false });
    expect((await never.notice({ to: LETICIA, text: "oi" })).status).toBe(409);
    expect(never.sends()).toEqual([]);
    await t.close();

    // The phone removed the session ("Linked devices"): only a new code brings the number back.
    const dropped = await start();
    await t.db
      .update(schema.whatsappAccounts)
      .set({ status: "logged_out" })
      .where(eq(schema.whatsappAccounts.id, dropped.account.id));
    const res = await dropped.notice({ to: LETICIA, text: "oi", key: "k1" });
    expect(res.status).toBe(409);
    expect(await res.json()).toMatchObject({ code: "whatsapp.portal_disconnected" });
    expect(dropped.sends()).toEqual([]);
    expect(await t.db.select().from(schema.whatsappMessages)).toEqual([]);
  });

  test("502 when the gateway refuses, and the same key may try again", async () => {
    const { notice, sends, gateway } = await start();
    if (gateway) gateway.failNext = "no active session found";
    const refused = await notice({ to: LETICIA, text: "Post aprovado", key: "post-45:approved" });
    expect(refused.status).toBe(502);
    expect(await refused.json()).toMatchObject({ code: "whatsapp.unavailable" });
    expect(await t.db.select().from(schema.whatsappMessages)).toEqual([]);
    expect((await notice({ to: LETICIA, text: "Post aprovado", key: "post-45:approved" })).status).toBe(200);
    expect(sends()).toHaveLength(1);
  });

  test("a new conversation spends the number's 20 a day; one it already has never does", async () => {
    const many = Array.from({ length: 21 }, (_, i) => `55119000000${10 + i}`);
    const { notice, sends } = await start({ env: { ...PORTAL, PORTAL_WHATSAPP_TO: [LETICIA, ...many].join(",") } });
    for (const to of many.slice(0, 20)) expect((await notice({ to, text: "olá" })).status).toBe(200);
    const refused = await notice({ to: many[20], text: "olá" });
    expect(refused.status).toBe(429);
    expect(await refused.json()).toMatchObject({ code: "whatsapp.new_chats_limit" });
    // The ones it already talks to go on receiving.
    expect((await notice({ to: many[0], text: "de novo" })).status).toBe(200);
    expect(sends()).toHaveLength(21);
  });

  test("the app's own webhooks still answer at their addresses", async () => {
    const { hook } = await start();
    expect((await hook(event("Presence", {}))).status).toBe(200);
    // The portal's other address (the bridge saying something changed) is off without a portal, not this route.
    const res = await t.app.request("/api/webhooks/approval-portal", { method: "POST" });
    expect(res.status).toBe(404);
  });
});
