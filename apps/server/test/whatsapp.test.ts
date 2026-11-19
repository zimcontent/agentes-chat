import { afterEach, describe, expect, test } from "bun:test";
import { createFakeWhatsAppGateway } from "@dougbot/adapters";
import { eq, schema } from "@dougbot/db";
import { type Browser, browser, createTestServer, joinByInvitation, seedOrg, signUp, type TestServer } from "./harness";

/** WhatsApp numbers over HTTP: the app's routes and the address the gateway posts events to. */

let t: TestServer;
afterEach(async () => {
  const current = t;
  t = undefined as unknown as TestServer;
  await current?.close();
});

type Account = { id: string; status: string; qr: string | null; mine: boolean; manage: boolean };
type Chat = { id: string; name: string; unread: number; lastText: string };

async function start(
  gateway: ReturnType<typeof createFakeWhatsAppGateway> | null = createFakeWhatsAppGateway(),
  reply?: NonNullable<Parameters<typeof createTestServer>[0]>["reply"],
) {
  t = await createTestServer({
    ...(gateway ? { whatsapp: gateway } : {}),
    ...(reply ? { reply } : {}),
    env: { WHATSAPP_HOOK_URL: "http://agentes:3000" },
  });
  const owner = browser(t);
  await signUp(owner, "owner@example.com");
  const { orgId, agentId } = await seedOrg(owner);
  const api = (path: string, init?: Parameters<Browser>[1]) =>
    owner(`/api/app/organizations/${orgId}/whatsapp${path}`, init);
  /** The gateway posting an event: no session, no origin, only the secret in the address. */
  const post = (secret: string, payload: unknown) =>
    t.app.request(`/api/webhooks/whatsapp/${secret}`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: typeof payload === "string" ? payload : JSON.stringify(payload),
    });
  const secret = () => {
    const connect = gateway?.last("connect");
    if (!connect) throw new Error("never connected");
    return connect.webhookUrl.split("/").at(-1) as string;
  };
  return { owner, orgId, agentId, api, post, secret, gateway };
}

const event = (name: string, data: unknown) => ({ event: name, data, instanceId: "instance-1" });
const hello = event("Message", {
  Info: {
    Chat: "5511999990000@s.whatsapp.net",
    Sender: "5511999990000@s.whatsapp.net",
    ID: "A1",
    PushName: "Ana",
    Timestamp: "2026-11-13T12:00:00Z",
  },
  Message: { conversation: "bom dia" },
});

describe("WhatsApp over HTTP", () => {
  test("without a gateway the list says off and connecting is a 404", async () => {
    const { api } = await start(null);
    expect(await (await api("")).json()).toEqual({ on: false, manage: true, accounts: [] });
    expect((await api("/accounts", { json: { label: "Comercial" } })).status).toBe(404);
  });

  test("connect by QR code, receive, read and answer", async () => {
    const { api, post, secret, gateway } = await start();
    const made = await api("/accounts", { json: { label: "Comercial" } });
    expect(made.status).toBe(201);
    const account = (await made.json()) as Account;
    expect([account.status, account.mine, account.manage]).toEqual(["pending", true, true]);

    expect((await post(secret(), event("QRCode", { qrcode: "data:image/png;base64,AA", code: "2@x" }))).status).toBe(
      200,
    );
    let list = (await (await api("")).json()) as { accounts: Account[] };
    expect([list.accounts[0]?.status, list.accounts[0]?.qr]).toEqual(["qr", "data:image/png;base64,AA"]);

    await post(
      secret(),
      event("Connected", { status: "open", jid: "5511911112222:3@s.whatsapp.net", pushName: "Zim" }),
    );
    await post(secret(), hello);
    list = (await (await api("")).json()) as { accounts: Account[] };
    expect(list.accounts[0]?.status).toBe("connected");

    const { chats } = (await (await api(`/accounts/${account.id}/chats`)).json()) as { chats: Chat[] };
    expect(chats).toMatchObject([{ name: "Ana", unread: 1, lastText: "bom dia" }]);
    const chatId = chats[0]?.id as string;

    expect(await (await api(`/accounts/${account.id}/chats/${chatId}/read`, { json: {} })).json()).toEqual({ read: 1 });
    const sent = await api(`/accounts/${account.id}/messages`, { json: { chatId, text: "oi, Ana" } });
    expect(sent.status).toBe(201);
    expect(gateway?.last("send")).toMatchObject({ text: "oi, Ana" });
    const page = (await (await api(`/accounts/${account.id}/chats/${chatId}/messages`)).json()) as {
      messages: { body: string; fromMe: boolean }[];
    };
    expect(page.messages.map((m) => [m.body, m.fromMe])).toEqual([
      ["oi, Ana", true],
      ["bom dia", false],
    ]);
  });

  test("the events' address answers only its own secret, and only JSON", async () => {
    const { api, post, secret } = await start();
    await api("/accounts", { json: { label: "Comercial" } });
    expect((await post("0".repeat(64), hello)).status).toBe(404);
    expect((await post(secret(), "not json")).status).toBe(400);
    expect((await post(secret(), { ...hello, instanceId: "instance-9" })).status).toBe(404);
    expect(await (await post(secret(), event("Presence", {}))).json()).toEqual({ ok: true, kind: "ignored" });
  });

  test("a number starts at most 20 conversations by phone number a day, and goes on answering the ones it has", async () => {
    const { api, post, secret, gateway } = await start();
    const account = (await (await api("/accounts", { json: { label: "Comercial" } })).json()) as Account;
    await post(secret(), event("Connected", { status: "open", jid: "5511911112222@s.whatsapp.net", pushName: "Zim" }));
    await post(secret(), hello);
    const { chats } = (await (await api(`/accounts/${account.id}/chats`)).json()) as { chats: Chat[] };
    const cold = (i: number) =>
      api(`/accounts/${account.id}/messages`, { json: { phone: `55119000000${10 + i}`, text: "olá" } });
    for (let i = 0; i < 20; i++) expect((await cold(i)).status).toBe(201);
    const refused = await cold(20);
    expect(refused.status).toBe(429);
    expect(((await refused.json()) as { error: { code: string } }).error.code).toBe("whatsapp.new_chats_limit");
    expect(
      (await api(`/accounts/${account.id}/messages`, { json: { chatId: chats[0]?.id, text: "claro" } })).status,
    ).toBe(201);
    expect((await api(`/accounts/${account.id}/chats/${chats[0]?.id}/typing`, { json: { typing: true } })).status).toBe(
      200,
    );
    expect(gateway?.last("typing")).toMatchObject({ typing: true });
  });

  test("a gateway that refuses is a 502 of ours, and a member who isn't listed finds no number", async () => {
    const { owner, orgId, api, post, secret, gateway } = await start();
    const account = (await (await api("/accounts", { json: { label: "Comercial" } })).json()) as Account;
    await post(secret(), event("Connected", { status: "open", jid: "5511911112222@s.whatsapp.net", pushName: "Zim" }));
    if (gateway) gateway.failNext = "no active session found";
    const refused = await api(`/accounts/${account.id}/messages`, { json: { phone: "5511988887777", text: "olá" } });
    expect(refused.status).toBe(502);
    expect(((await refused.json()) as { error: { code: string } }).error.code).toBe("whatsapp.unavailable");

    const member = await joinByInvitation(t, owner, orgId, "leticia@example.com");
    const hers = await member(`/api/app/organizations/${orgId}/whatsapp`);
    expect(await hers.json()).toEqual({ on: true, manage: false, accounts: [] });
    expect((await member(`/api/app/organizations/${orgId}/whatsapp/accounts/${account.id}/chats`)).status).toBe(404);
    expect((await member(`/api/app/organizations/${orgId}/whatsapp/accounts`, { json: { label: "X" } })).status).toBe(
      403,
    );
  });

  test("a message's file loads for the number's people: a picture is drawn, anything else is only downloaded", async () => {
    const { owner, orgId, api, post, secret, gateway } = await start();
    const account = (await (await api("/accounts", { json: { label: "Comercial" } })).json()) as Account;
    await post(secret(), event("Connected", { status: "open", jid: "5511911112222@s.whatsapp.net", pushName: "Zim" }));
    const file = (id: string, message: Record<string, unknown>) =>
      post(
        secret(),
        event("Message", { Info: { ...(hello.data as { Info: object }).Info, ID: id }, Message: message }),
      );
    await file("F1", { imageMessage: { mimetype: "image/jpeg", caption: "olha", mediaKey: "a2V5" } });
    await file("F2", { documentMessage: { mimetype: "text/html", fileName: 'nota "fiscal".html' } });
    await post(secret(), hello);
    const { chats } = (await (await api(`/accounts/${account.id}/chats`)).json()) as { chats: Chat[] };
    const page = (await (await api(`/accounts/${account.id}/chats/${chats[0]?.id}/messages`)).json()) as {
      messages: { id: string; kind: string; file: boolean }[];
    };
    const of = (kind: string) => page.messages.find((m) => m.kind === kind);
    expect([of("image")?.file, of("document")?.file, of("text")?.file]).toEqual([true, true, false]);

    const picture = await api(`/accounts/${account.id}/messages/${of("image")?.id}/file`);
    expect([picture.status, picture.headers.get("content-type"), await picture.text()]).toEqual([
      200,
      "image/jpeg",
      "file",
    ]);
    expect(picture.headers.get("content-disposition")).toStartWith("inline");
    expect(picture.headers.get("x-content-type-options")).toBe("nosniff");
    expect(gateway?.last("download")?.message).toEqual({
      imageMessage: { mimetype: "image/jpeg", caption: "olha", mediaKey: "a2V5" },
    });
    // A page someone sent never opens as ours: it is bytes to save.
    const page2 = await api(`/accounts/${account.id}/messages/${of("document")?.id}/file`);
    expect([page2.status, page2.headers.get("content-type")]).toEqual([200, "application/octet-stream"]);
    expect(page2.headers.get("content-disposition")).toBe("attachment; filename*=UTF-8''nota%20_fiscal_.html");

    expect((await api(`/accounts/${account.id}/messages/${of("text")?.id}/file`)).status).toBe(404);
    if (gateway) gateway.failNext = "media no longer available";
    expect((await api(`/accounts/${account.id}/messages/${of("image")?.id}/file`)).status).toBe(502);
    const member = await joinByInvitation(t, owner, orgId, "leticia@example.com");
    expect(
      (await member(`/api/app/organizations/${orgId}/whatsapp/accounts/${account.id}/messages/${of("image")?.id}/file`))
        .status,
    ).toBe(404);
  });

  test("a conversation without a photo answers 404 and is listed with its initials after", async () => {
    const { api, post, secret, gateway } = await start();
    const account = (await (await api("/accounts", { json: { label: "Comercial" } })).json()) as Account;
    await post(secret(), event("Connected", { status: "open", jid: "5511911112222@s.whatsapp.net", pushName: "Zim" }));
    await post(secret(), hello);
    const list = async () =>
      ((await (await api(`/accounts/${account.id}/chats`)).json()) as { chats: (Chat & { photo: boolean })[] }).chats;
    const chat = (await list())[0];
    expect(chat?.photo).toBe(true);
    expect((await api(`/accounts/${account.id}/chats/${chat?.id}/photo`)).status).toBe(404);
    expect(gateway?.last("photo")?.jid).toBe("5511999990000@s.whatsapp.net");
    expect((await list())[0]?.photo).toBe(false);
    expect((await api(`/accounts/${account.id}/chats/not-a-chat/photo`)).status).toBe(400);
  });

  test("a file dropped in the conversation is sent as a form and shows there as the person's", async () => {
    const { api, post, secret, gateway } = await start();
    const account = (await (await api("/accounts", { json: { label: "Comercial" } })).json()) as Account;
    await post(secret(), event("Connected", { status: "open", jid: "5511911112222@s.whatsapp.net", pushName: "Zim" }));
    await post(secret(), hello);
    const { chats } = (await (await api(`/accounts/${account.id}/chats`)).json()) as { chats: Chat[] };
    const form = new FormData();
    form.set("file", new File(["%PDF-1.4"], "proposta.pdf", { type: "application/pdf" }));
    form.set("chatId", chats[0]?.id as string);
    form.set("caption", "segue a proposta");
    const sent = await api(`/accounts/${account.id}/files`, { method: "POST", body: form });
    expect([sent.status, await sent.json()]).toEqual([201, { chatId: chats[0]?.id, kind: "document" }]);
    expect(gateway?.last("file")).toMatchObject({
      kind: "document",
      fileName: "proposta.pdf",
      caption: "segue a proposta",
    });
    const page = (await (await api(`/accounts/${account.id}/chats/${chats[0]?.id}/messages`)).json()) as {
      messages: { id: string; kind: string; body: string; file: boolean }[];
    };
    expect(page.messages[0]).toMatchObject({ kind: "document", body: "segue a proposta", file: true });
    // What was sent opens here like what was received.
    expect((await api(`/accounts/${account.id}/messages/${page.messages[0]?.id}/file`)).status).toBe(200);
    const none = new FormData();
    none.set("chatId", chats[0]?.id as string);
    expect((await api(`/accounts/${account.id}/files`, { method: "POST", body: none })).status).toBe(400);
  });

  test("a direction typed in the settings comes back as the whole instructions, nothing saved", async () => {
    const { api, agentId } = await start(createFakeWhatsAppGateway(), () => ({
      chunks: [JSON.stringify({ instructions: "# Atendimento\n- Nunca fale de preço." })],
    }));
    const account = (await (await api("/accounts", { json: { label: "Comercial" } })).json()) as Account;
    const draft = (text: string) => {
      const form = new FormData();
      form.set("text", text);
      form.set("current", "# Atendimento");
      return api(`/accounts/${account.id}/instructions/draft`, { method: "POST", body: form });
    };
    // No agent on the number yet: nothing to write for.
    expect((await draft("não fale de preço")).status).toBe(409);
    await api(`/accounts/${account.id}`, { method: "PATCH", json: { agentId } });
    const made = await draft("não fale de preço");
    expect([made.status, await made.json()]).toEqual([
      200,
      { heard: "", instructions: "# Atendimento\n- Nunca fale de preço." },
    ]);
    const list = (await (await api("")).json()) as { accounts: { instructions: string | null }[] };
    expect(list.accounts[0]?.instructions).toBe("");
  });

  test("a sticker is picked from the number's own and the gateway fetches its picture from a signed address", async () => {
    const { api, post, secret, gateway } = await start();
    const account = (await (await api("/accounts", { json: { label: "Comercial" } })).json()) as Account;
    await post(secret(), event("Connected", { status: "open", jid: "5511911112222@s.whatsapp.net", pushName: "Zim" }));
    await post(
      secret(),
      event("Message", {
        Info: { ...(hello.data as { Info: object }).Info, ID: "S1" },
        Message: { stickerMessage: { mimetype: "image/webp", fileSHA256: "aGFzaA==" } },
      }),
    );
    const { stickers } = (await (await api(`/accounts/${account.id}/stickers`)).json()) as {
      stickers: { messageId: string }[];
    };
    const { chats } = (await (await api(`/accounts/${account.id}/chats`)).json()) as { chats: Chat[] };
    const sent = await api(`/accounts/${account.id}/stickers`, {
      json: { chatId: chats[0]?.id, messageId: stickers[0]?.messageId },
    });
    expect(sent.status).toBe(201);
    const url = new URL(gateway?.last("sticker")?.url as string);
    // The gateway has no session: the address alone opens the picture, and a changed one opens nothing.
    const picture = await t.app.request(`${url.pathname}${url.search}`);
    expect([picture.status, picture.headers.get("content-type"), await picture.text()]).toEqual([
      200,
      "image/webp",
      "file",
    ]);
    expect((await t.app.request(`${url.pathname}?e=${url.searchParams.get("e")}&s=bad`)).status).toBe(404);
  });

  test("the number's own AI takes every kind WhatsApp answers with, Gemini too, and no other", async () => {
    const { agentId, api } = await start();
    const account = (await (await api("/accounts", { json: { label: "Comercial" } })).json()) as Account;
    await api(`/accounts/${account.id}`, { method: "PATCH", json: { agentId } });
    const put = (brain: string) =>
      api(`/accounts/${account.id}/brain`, { method: "PUT", json: { brain: { brain, model: null } } });
    // Past the request's shape to the rules: this agent has no computer for a plan.
    const gemini = await put("antigravity");
    expect([gemini.status, ((await gemini.json()) as { error: { code: string } }).error.code]).toEqual([
      409,
      "brain.no_computer",
    ]);
    expect((await put("grok")).status).toBe(400);
  });

  test("a number's agent, turned on, answers who writes; turned off in the conversation it stops", async () => {
    const { agentId, api, post, secret, gateway } = await start(createFakeWhatsAppGateway(), () => ({
      chunks: [JSON.stringify({ action: "reply", messages: ["Bom dia! Como posso ajudar?"], note: "" })],
    }));
    const account = (await (await api("/accounts", { json: { label: "Comercial" } })).json()) as Account;
    await post(secret(), event("Connected", { status: "open", jid: "5511911112222@s.whatsapp.net", pushName: "Zim" }));
    // Nobody chosen: nothing to turn on.
    expect((await api(`/accounts/${account.id}`, { method: "PATCH", json: { agentOn: true } })).status).toBe(400);
    const on = await api(`/accounts/${account.id}`, { method: "PATCH", json: { agentId, agentOn: true } });
    expect(((await on.json()) as { agentOn: boolean }).agentOn).toBe(true);

    const now = (id: string, words: string) =>
      event("Message", {
        Info: { ...(hello.data as { Info: object }).Info, ID: id, Timestamp: new Date().toISOString() },
        Message: { conversation: words },
      });
    /** The agent's wait is over: its job runs now. */
    const answer = async () => {
      await t.db
        .update(schema.outbox)
        .set({ nextAttemptAt: new Date() })
        .where(eq(schema.outbox.kind, "whatsapp.agent_reply"));
      await t.drain();
    };
    await post(secret(), now("B1", "bom dia"));
    await answer();
    expect(gateway?.last("send")?.text).toBe("Bom dia! Como posso ajudar?");
    type AgentChat = Chat & { agent: string | null };
    const chats = async () =>
      ((await (await api(`/accounts/${account.id}/chats`)).json()) as { chats: AgentChat[] }).chats;
    const [chat] = await chats();
    expect([chat?.agent, chat?.unread]).toEqual(["on", 0]);
    const page = (await (await api(`/accounts/${account.id}/chats/${chat?.id}/messages`)).json()) as {
      messages: { fromMe: boolean; sentByAgentId: string | null }[];
    };
    expect(page.messages[0]).toMatchObject({ fromMe: true, sentByAgentId: agentId });

    expect((await api(`/accounts/${account.id}/chats/${chat?.id}/agent`, { json: { on: false } })).status).toBe(200);
    await post(secret(), now("B2", "e o preço?"));
    await answer();
    expect((await chats())[0]?.agent).toBe("off");
    expect(gateway?.calls.filter((c) => c.op === "send")).toHaveLength(1);
  }, 30_000);
});
