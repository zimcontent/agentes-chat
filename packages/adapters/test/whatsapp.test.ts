import { describe, expect, test } from "bun:test";
import { bareJid, createEvolutionGoGateway, jidPhone, parseEvolutionEvent, WhatsAppGatewayError } from "../src";

/** The WhatsApp gateway: what we ask Evolution Go, and what we read of the events it posts. */

/** A fake Evolution Go: answers each path with what the test says, and keeps what it was asked. */
function evolution(answers: Record<string, { status?: number; body: unknown }>) {
  const asked: { method: string; path: string; apikey: string | null; body: unknown }[] = [];
  const http = (async (input: string | URL | Request, init?: RequestInit) => {
    const url = new URL(String(input));
    asked.push({
      method: init?.method ?? "GET",
      path: url.pathname,
      apikey: new Headers(init?.headers).get("apikey"),
      body: init?.body ? JSON.parse(String(init.body)) : undefined,
    });
    const answer = answers[url.pathname] ?? { status: 404, body: { error: "no route" } };
    return new Response(JSON.stringify(answer.body), { status: answer.status ?? 200 });
  }) as typeof fetch;
  return {
    asked,
    gateway: createEvolutionGoGateway({ url: "http://whatsapp:8080/", apiKey: "admin-key", fetch: http }),
  };
}

const AT = "2026-11-13T12:00:00Z";
const info = (over: Record<string, unknown> = {}) => ({
  Chat: "5511999990000@s.whatsapp.net",
  Sender: "5511999990000:7@s.whatsapp.net",
  IsFromMe: false,
  IsGroup: false,
  ID: "3EB0AAA",
  PushName: "Ana",
  Timestamp: AT,
  ...over,
});
const posted = (event: string, data: unknown, extra: Record<string, unknown> = {}) => ({
  event,
  data,
  instanceId: "inst-1",
  instanceToken: "token",
  instanceName: "agentes-1",
  ...extra,
});

describe("calls to the gateway", () => {
  test("an instance is made with the admin key and connected with its own token, asking for our events", async () => {
    const { gateway, asked } = evolution({
      "/instance/create": { body: { message: "success", data: { id: "inst-1", name: "agentes-1" } } },
      "/instance/connect": { body: { message: "success", data: { jid: "", webhookUrl: "x" } } },
    });
    expect(await gateway.createInstance({ name: "agentes-1", token: "tok" })).toEqual({ instanceId: "inst-1" });
    await gateway.connect("tok", { webhookUrl: "http://agentes:3000/api/webhooks/whatsapp/s3cret" });
    expect(asked).toEqual([
      { method: "POST", path: "/instance/create", apikey: "admin-key", body: { name: "agentes-1", token: "tok" } },
      {
        method: "POST",
        path: "/instance/connect",
        apikey: "tok",
        body: {
          webhookUrl: "http://agentes:3000/api/webhooks/whatsapp/s3cret",
          subscribe: ["MESSAGE", "SEND_MESSAGE", "READ_RECEIPT", "CONNECTION", "QRCODE"],
        },
      },
    ]);
  });

  test("a text goes to the chat's address, answering a message when asked, and comes back with WhatsApp's id", async () => {
    const { gateway, asked } = evolution({
      "/send/text": { body: { message: "success", data: { Info: { ID: "3EB0SENT", Timestamp: AT } } } },
    });
    const sent = await gateway.sendText("tok", { to: "5511999990000@s.whatsapp.net", text: "oi", replyTo: "3EB0AAA" });
    expect(sent).toEqual({ id: "3EB0SENT", at: new Date(AT) });
    expect(asked[0]?.body).toEqual({
      number: "5511999990000@s.whatsapp.net",
      text: "oi",
      quoted: { messageId: "3EB0AAA" },
    });
  });

  test("the gateway's refusal carries its status and words; no answer is status 0", async () => {
    const { gateway } = evolution({ "/send/text": { status: 500, body: { error: "no active session found" } } });
    const refused = await gateway.sendText("tok", { to: "x@s.whatsapp.net", text: "oi" }).catch((e) => e);
    expect(refused).toBeInstanceOf(WhatsAppGatewayError);
    expect([refused.status, refused.message]).toEqual([500, "no active session found"]);

    const down = createEvolutionGoGateway({
      url: "http://whatsapp:8080",
      apiKey: "k",
      fetch: (async () => {
        throw new Error("connect ECONNREFUSED");
      }) as unknown as typeof fetch,
    });
    expect((await down.status("tok").catch((e) => e)).status).toBe(0);
  });

  test("nothing is asked to mark no message as read", async () => {
    const { gateway, asked } = evolution({});
    await gateway.markRead("tok", { chat: "x@s.whatsapp.net", ids: [] });
    expect(asked).toEqual([]);
  });
});

describe("events the gateway posts", () => {
  test("a text from someone: who, where, when and the words, without the sender's device", () => {
    const event = parseEvolutionEvent(posted("Message", { Info: info(), Message: { conversation: "bom dia" } }));
    expect(event).toEqual({
      kind: "message",
      instanceId: "inst-1",
      message: {
        id: "3EB0AAA",
        chat: "5511999990000@s.whatsapp.net",
        sender: "5511999990000@s.whatsapp.net",
        senderName: "Ana",
        fromMe: false,
        group: false,
        groupName: "",
        at: new Date(AT),
        kind: "text",
        text: "bom dia",
        replyTo: null,
        media: null,
        raw: null,
      },
    });
  });

  test("an answer names the message it answers", () => {
    const event = parseEvolutionEvent(
      posted("Message", {
        Info: info(),
        Message: { extendedTextMessage: { text: "sim", contextInfo: { stanzaID: "3EB0OLD" } } },
      }),
    );
    expect(event?.kind === "message" && [event.message.text, event.message.replyTo]).toEqual(["sim", "3EB0OLD"]);
  });

  test("a photo keeps its caption, its type and WhatsApp's message, never the file the gateway inlined", () => {
    const event = parseEvolutionEvent(
      posted("Message", {
        Info: info(),
        Message: { imageMessage: { caption: "olha", mimetype: "image/jpeg", URL: "https://mmg/x" }, base64: "AAAA" },
      }),
    );
    if (event?.kind !== "message") throw new Error("not a message");
    expect([event.message.kind, event.message.text]).toEqual(["image", "olha"]);
    expect(event.message.media).toEqual({ mimeType: "image/jpeg", fileName: null, seconds: null });
    expect(event.message.raw).toEqual({
      imageMessage: { caption: "olha", mimetype: "image/jpeg", URL: "https://mmg/x" },
    });
  });

  test("a voice note inside a disappearing chat is still an audio, with its length", () => {
    const event = parseEvolutionEvent(
      posted("Message", {
        Info: info(),
        Message: {
          ephemeralMessage: { message: { audioMessage: { mimetype: "audio/ogg; codecs=opus", seconds: 12 } } },
        },
      }),
    );
    expect(event?.kind === "message" && [event.message.kind, event.message.media?.seconds]).toEqual(["audio", 12]);
  });

  test("a group's message says its group and who wrote it", () => {
    const event = parseEvolutionEvent(
      posted("Message", {
        Info: info({ Chat: "120363000000000000@g.us", Sender: "5511988887777@s.whatsapp.net", IsGroup: true }),
        Message: { conversation: "pessoal" },
        groupData: { Name: "Equipe" },
      }),
    );
    if (event?.kind !== "message") throw new Error("not a message");
    expect([event.message.group, event.message.groupName, event.message.sender]).toEqual([
      true,
      "Equipe",
      "5511988887777@s.whatsapp.net",
    ]);
  });

  test("what the number sent through the gateway is its own, whatever the event's Info says", () => {
    const event = parseEvolutionEvent(
      posted("SendMessage", { Info: info({ IsFromMe: false, ID: "3EB0SENT" }), Message: { conversation: "oi" } }),
    );
    expect(event?.kind === "message" && event.message.fromMe).toBe(true);
  });

  test("an edit or a deletion riding on a message is nothing a person reads", () => {
    expect(
      parseEvolutionEvent(posted("Message", { Info: info(), Message: { protocolMessage: { type: 0 } } })),
    ).toBeNull();
  });

  test("the QR code, the connection and its ends", () => {
    expect(parseEvolutionEvent(posted("QRCode", { qrcode: "data:image/png;base64,AA", code: "2@abc" }))).toEqual({
      kind: "qr",
      instanceId: "inst-1",
      image: "data:image/png;base64,AA",
      code: "2@abc",
    });
    expect(
      parseEvolutionEvent(
        posted("Connected", { status: "open", jid: "5511911112222:3@s.whatsapp.net", pushName: "Zim" }),
      ),
    ).toEqual({
      kind: "connected",
      instanceId: "inst-1",
      jid: "5511911112222@s.whatsapp.net",
      name: "Zim",
    });
    expect(parseEvolutionEvent(posted("LoggedOut", { reason: "Logged out" }))).toEqual({
      kind: "disconnected",
      instanceId: "inst-1",
      reason: "logged_out",
    });
    expect(parseEvolutionEvent(posted("QRTimeout", {}))?.kind).toBe("disconnected");
  });

  test("receipts say which messages were delivered or read; our own reading elsewhere says nothing", () => {
    const data = { Chat: "5511999990000@s.whatsapp.net", MessageIDs: ["A", "B"] };
    expect(parseEvolutionEvent(posted("Receipt", data, { state: "Read" }))).toEqual({
      kind: "receipt",
      instanceId: "inst-1",
      chat: "5511999990000@s.whatsapp.net",
      ids: ["A", "B"],
      state: "read",
    });
    expect(parseEvolutionEvent(posted("Receipt", data, { state: "Delivered" }))?.kind).toBe("receipt");
    expect(parseEvolutionEvent(posted("Receipt", data, { state: "ReadSelf" }))).toBeNull();
  });

  test("events we keep nothing of, and anything that isn't an event, are null", () => {
    expect(parseEvolutionEvent(posted("Presence", {}))).toBeNull();
    expect(parseEvolutionEvent({ event: "Message", data: { Info: info(), Message: {} } })).toBeNull();
    expect(parseEvolutionEvent("x")).toBeNull();
    expect(parseEvolutionEvent(null)).toBeNull();
  });
});

describe("addresses", () => {
  test("the device part goes, the phone comes out of a person's address only", () => {
    expect(bareJid("5511999990000:12@s.whatsapp.net")).toBe("5511999990000@s.whatsapp.net");
    expect(jidPhone("5511999990000:12@s.whatsapp.net")).toBe("5511999990000");
    expect(jidPhone("120363000000000000@g.us")).toBeNull();
    expect(jidPhone("98765432101234@lid")).toBeNull();
  });
});
