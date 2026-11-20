import { describe, expect, test } from "bun:test";
import {
  bareJid,
  createEvolutionGoGateway,
  jidPhone,
  parseEvolutionEvent,
  WhatsAppGatewayError,
  whatsappFileMessage,
} from "../src";

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
          subscribe: ["MESSAGE", "SEND_MESSAGE", "READ_RECEIPT", "CONNECTION", "QRCODE", "HISTORY_SYNC"],
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

  test("a profile photo is its small one's address; none, or hidden, is null; a silent gateway still fails", async () => {
    const url = "https://pps.whatsapp.net/v/t61/ana.jpg?stp=dst-jpg_s96x96";
    const { gateway, asked } = evolution({ "/user/avatar": { body: { data: { url, type: "image" } } } });
    expect(await gateway.profilePhoto("tok", { jid: "x@s.whatsapp.net" })).toBe(url);
    expect(asked[0]).toMatchObject({
      path: "/user/avatar",
      apikey: "tok",
      body: { number: "x@s.whatsapp.net", preview: true },
    });
    const none = evolution({ "/user/avatar": { status: 500, body: { error: "no profile picture found" } } });
    expect(await none.gateway.profilePhoto("tok", { jid: "x@s.whatsapp.net" })).toBeNull();
    const down = createEvolutionGoGateway({
      url: "http://whatsapp:8080",
      apiKey: "k",
      fetch: (async () => {
        throw new Error("connect ECONNREFUSED");
      }) as unknown as typeof fetch,
    });
    expect((await down.profilePhoto("tok", { jid: "x@s.whatsapp.net" }).catch((e) => e)).status).toBe(0);
  });

  test("typing is told as WhatsApp's own states, and its end too", async () => {
    const { gateway, asked } = evolution({ "/message/presence": { body: { message: "success" } } });
    await gateway.setTyping("tok", { chat: "x@s.whatsapp.net", typing: true });
    await gateway.setTyping("tok", { chat: "x@s.whatsapp.net", typing: false });
    expect(asked.map((call) => call.body)).toEqual([
      { number: "x@s.whatsapp.net", state: "composing" },
      { number: "x@s.whatsapp.net", state: "paused" },
    ]);
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
        chatLid: null,
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

  test("receipts say which messages were delivered or read, and when the number read a conversation elsewhere", () => {
    const data = { Chat: "5511999990000@s.whatsapp.net", MessageIDs: ["A", "B"] };
    expect(parseEvolutionEvent(posted("Receipt", data, { state: "Read" }))).toEqual({
      kind: "receipt",
      instanceId: "inst-1",
      chat: "5511999990000@s.whatsapp.net",
      ids: ["A", "B"],
      state: "read",
    });
    expect(parseEvolutionEvent(posted("Receipt", data, { state: "Delivered" }))?.kind).toBe("receipt");
    expect(parseEvolutionEvent(posted("Receipt", data, { state: "ReadSelf" }))?.kind).toBe("read_self");
    expect(parseEvolutionEvent(posted("Receipt", data, { state: "Played" }))).toBeNull();
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

describe("a message's file", () => {
  const picture = { URL: "https://mmg.whatsapp.net/x", mimetype: "image/jpeg", mediaKey: "a2V5", fileLength: 4 };

  test("the file's own message comes out of what the event carried, without WhatsApp's wrappers", () => {
    expect(whatsappFileMessage({ imageMessage: picture })).toEqual({
      imageMessage: picture,
    });
    const wrapped = { ephemeralMessage: { message: { viewOnceMessageV2: { message: { imageMessage: picture } } } } };
    expect(whatsappFileMessage(wrapped)).toEqual({ imageMessage: picture });
    expect(whatsappFileMessage({ conversation: "oi" })).toBeNull();
    expect(whatsappFileMessage(null)).toBeNull();
  });

  test("a sticker whose address is WhatsApp's bare placeholder is fetched at its path on the media server", () => {
    const sticker = { URL: "https://a.whatsapp.net", directPath: "/v/t62.15575-24/1_n.enc?ccb=11-4", mediaKey: "a2V5" };
    expect(whatsappFileMessage({ stickerMessage: sticker })).toEqual({
      stickerMessage: { ...sticker, URL: "https://mmg.whatsapp.net/v/t62.15575-24/1_n.enc?ccb=11-4" },
    });
    // No path to go by: left as it came.
    expect(whatsappFileMessage({ stickerMessage: { URL: "https://a.whatsapp.net" } })).toEqual({
      stickerMessage: { URL: "https://a.whatsapp.net" },
    });
  });

  test("the gateway is handed that message and answers with the bytes and their type", async () => {
    const { gateway, asked } = evolution({
      "/message/downloadmedia": {
        body: { message: "success", data: { base64: `data:image/jpeg;base64,${btoa("JPEG")}`, timestamp: AT } },
      },
    });
    const file = await gateway.downloadMedia("tok", { message: { imageMessage: picture } });
    expect([file.mimeType, new TextDecoder().decode(file.bytes)]).toEqual(["image/jpeg", "JPEG"]);
    expect(asked[0]).toMatchObject({ apikey: "tok", body: { message: { imageMessage: picture } } });
  });

  test("an answer without a file is the gateway's failure", async () => {
    const { gateway } = evolution({ "/message/downloadmedia": { body: { message: "success", data: {} } } });
    const refused = await gateway.downloadMedia("tok", { message: {} }).catch((e) => e);
    expect(refused).toBeInstanceOf(WhatsAppGatewayError);
  });
});

describe("history", () => {
  const web = (id: string, seconds: number, message: unknown, over: Record<string, unknown> = {}) => ({
    message: {
      key: { remoteJID: "5511999990000@s.whatsapp.net", fromMe: false, ID: id },
      message,
      messageTimestamp: seconds,
      ...over,
    },
  });
  const piece = posted("HistorySync", {
    Data: {
      syncType: 2,
      conversations: [
        {
          ID: "5511999990000@s.whatsapp.net",
          messages: [
            web("H1", 1_700_000_000, { conversation: "oi" }, { pushName: "Ana" }),
            web("H2", 1_700_000_060, { conversation: "tudo bem" }, { key: { fromMe: true, ID: "H2" }, status: 4 }),
            web("H3", 1_700_000_120, { imageMessage: { mimetype: "image/jpeg", caption: "olha" } }),
            // Lines WhatsApp writes itself, reactions and broken entries are left out.
            { message: { key: { ID: "H4" }, messageStubType: 27, messageTimestamp: 1_700_000_180 } },
            web("H5", 1_700_000_200, { reactionMessage: { text: "👍", key: { ID: "H1" } } }),
            web("", 1_700_000_210, { conversation: "sem id" }),
          ],
        },
        {
          ID: "120363000000000000@g.us",
          name: "Produção",
          messages: [
            web(
              "G1",
              1_700_000_300,
              { conversation: "bom dia" },
              { participant: "5511888880000:3@s.whatsapp.net", pushName: "Caio" },
            ),
          ],
        },
        // Filed under the person's number when WhatsApp names it; status updates aren't conversations.
        {
          ID: "98765432101234@lid",
          pnJID: "5511777770000@s.whatsapp.net",
          messages: [web("L1", 1_700_000_400, { conversation: "olá" })],
        },
        { ID: "status@broadcast", messages: [web("S1", 1_700_000_500, { conversation: "story" })] },
      ],
      pushnames: [
        { ID: "5511777770000@s.whatsapp.net", pushname: "Bia" },
        { ID: "5511666660000@s.whatsapp.net", pushname: "-" },
      ],
    },
  });

  test("conversations come with their messages as they were: who, when, what and how far ours got", () => {
    const event = parseEvolutionEvent(piece);
    if (event?.kind !== "history") throw new Error("not history");
    expect(event.chats.map((c) => [c.jid, c.name, c.messages.map((m) => m.id)])).toEqual([
      ["5511999990000@s.whatsapp.net", "", ["H1", "H2", "H3"]],
      ["120363000000000000@g.us", "Produção", ["G1"]],
      ["5511777770000@s.whatsapp.net", "", ["L1"]],
    ]);
    const [first, mine, picture] = event.chats[0]?.messages ?? [];
    expect([first?.senderName, first?.status, first?.at.toISOString()]).toEqual([
      "Ana",
      "received",
      "2023-11-14T22:13:20.000Z",
    ]);
    expect([mine?.fromMe, mine?.status]).toEqual([true, "read"]);
    expect([picture?.kind, picture?.text, picture?.media?.mimeType]).toEqual(["image", "olha", "image/jpeg"]);
    expect(event.chats[1]?.messages[0]).toMatchObject({ sender: "5511888880000@s.whatsapp.net", group: true });
    expect(event.names).toEqual([{ jid: "5511777770000@s.whatsapp.net", name: "Bia" }]);
  });

  test("older messages are asked of the phone by the oldest one we have", async () => {
    const { gateway, asked } = evolution({ "/chat/history-sync": { body: { message: "success", data: {} } } });
    await gateway.requestHistory("tok", {
      chat: "5511999990000@s.whatsapp.net",
      before: { id: "H1", fromMe: false, at: new Date(1_700_000_000_000) },
      count: 50,
    });
    expect(asked[0]).toMatchObject({
      path: "/chat/history-sync",
      apikey: "tok",
      body: {
        count: 50,
        messageInfo: {
          Chat: "5511999990000@s.whatsapp.net",
          ID: "H1",
          IsFromMe: false,
          IsGroup: false,
          Timestamp: "2023-11-14T22:13:20.000Z",
        },
      },
    });
  });
});

describe("one person, two addresses", () => {
  const LID = "98765432101234@lid";
  const PN = "5511999990000@s.whatsapp.net";
  const says = (over: Record<string, unknown>) => {
    const event = parseEvolutionEvent(posted("Message", { Info: info(over), Message: { conversation: "oi" } }));
    if (event?.kind !== "message") throw new Error("not a message");
    return [event.message.chat, event.message.chatLid, event.message.sender];
  };

  test("a message filed under the hidden id lands on the number when the event names it, either way", () => {
    // Received, addressed by the hidden id, the number told beside it.
    expect(says({ Chat: LID, Sender: `${LID.split("@")[0]}:4@lid`, SenderAlt: PN })).toEqual([PN, LID, PN]);
    // Sent from the phone to the hidden id: the recipient's number is told beside it.
    expect(says({ Chat: LID, IsFromMe: true, Sender: "5511911112222:3@s.whatsapp.net", RecipientAlt: PN })).toEqual([
      PN,
      LID,
      "5511911112222@s.whatsapp.net",
    ]);
    // Addressed by the number, the hidden id told beside it: kept for later.
    expect(says({ Chat: PN, Sender: PN, SenderAlt: LID })).toEqual([PN, LID, PN]);
    // The hidden id alone: the conversation is under it until the number is told.
    expect(says({ Chat: LID, Sender: LID })).toEqual([LID, LID, LID]);
    expect(says({ Chat: PN, Sender: PN })).toEqual([PN, null, PN]);
  });
});

describe("what the phone did elsewhere", () => {
  test("a conversation read on the phone, a message taken back and one edited each name what they change", () => {
    expect(
      parseEvolutionEvent(
        posted("Receipt", { Chat: "5511999990000@s.whatsapp.net", MessageIDs: ["A1"] }, { state: "ReadSelf" }),
      ),
    ).toEqual({ kind: "read_self", instanceId: "inst-1", chat: "5511999990000@s.whatsapp.net" });
    expect(
      parseEvolutionEvent(
        posted("Message", { Info: info({ ID: "R1" }), Message: { protocolMessage: { type: 0, key: { ID: "A1" } } } }),
      ),
    ).toEqual({ kind: "revoked", instanceId: "inst-1", id: "A1" });
    expect(
      parseEvolutionEvent(
        posted("Message", {
          Info: info({ ID: "E1" }),
          Message: { protocolMessage: { type: 14, key: { ID: "A1" }, editedMessage: { conversation: "bom dia!" } } },
        }),
      ),
    ).toEqual({ kind: "edited", instanceId: "inst-1", id: "A1", text: "bom dia!" });
    // Any other protocol message (a key exchange) is still nothing a person reads.
    expect(
      parseEvolutionEvent(posted("Message", { Info: info(), Message: { protocolMessage: { type: 5 } } })),
    ).toBeNull();
  });
});
