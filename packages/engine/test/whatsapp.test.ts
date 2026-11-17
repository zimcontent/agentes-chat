import { afterEach, describe, expect, test } from "bun:test";
import { createFakeWhatsAppGateway, userTopic, WhatsAppGatewayError } from "@agenteschat/adapters";
import { eq, schema } from "@agenteschat/db";
import {
  createWhatsAppAccount,
  handleWhatsAppEvent,
  listWhatsAppAccounts,
  listWhatsAppChats,
  listWhatsAppMessages,
  listWhatsAppStickers,
  readWhatsAppChat,
  reconnectWhatsAppAccount,
  removeWhatsAppAccount,
  requestWhatsAppHistory,
  sendWhatsAppFile,
  sendWhatsAppSticker,
  sendWhatsAppText,
  typingInWhatsAppChat,
  updateWhatsAppAccount,
  type WhatsAppDeps,
  whatsappChatPhoto,
  whatsappStickerFile,
} from "../src";
import { addMember, type Fixture, setup } from "./fixtures";

/** WhatsApp numbers: connecting one, its events into conversations, sending, and who sees what. */

let f: Fixture;
afterEach(() => f?.close());

const ANA = "5511999990000@s.whatsapp.net";
const AT = "2026-11-13T12:00:00Z";

function whatsapp() {
  const gateway = createFakeWhatsAppGateway();
  const deps: WhatsAppDeps = {
    db: f.db,
    gateway,
    keyWrappers: [f.keyWrapper],
    pubsub: f.pubsub,
    hookBase: "http://agentes:3000",
  };
  return { gateway, deps };
}

/** The secret in the address the gateway was told to post a number's events to. */
const secretOf = (gateway: ReturnType<typeof createFakeWhatsAppGateway>) => {
  const connect = gateway.last("connect");
  if (!connect) throw new Error("never connected");
  return connect.webhookUrl.split("/").at(-1) as string;
};

const event = (name: string, data: unknown, extra: Record<string, unknown> = {}) => ({
  event: name,
  data,
  instanceId: "instance-1",
  ...extra,
});
const text = (id: string, body: string, over: Record<string, unknown> = {}) =>
  event("Message", {
    Info: { Chat: ANA, Sender: ANA, IsFromMe: false, ID: id, PushName: "Ana", Timestamp: AT, ...over },
    Message: { conversation: body },
  });

/** A connected number of the owner's, and the way to post its events. */
async function connected() {
  const { gateway, deps } = whatsapp();
  const account = await createWhatsAppAccount(deps, f.owner.id, f.org.id, { label: "Comercial" });
  const post = (payload: unknown) => handleWhatsAppEvent(deps, secretOf(gateway), payload);
  await post(event("Connected", { status: "open", jid: "5511911112222:3@s.whatsapp.net", pushName: "Zim" }));
  return { gateway, deps, account, post };
}

describe("connecting a number", () => {
  test("made at the gateway, its token sealed, its QR code shown until it connects", async () => {
    f = await setup();
    const { gateway, deps } = whatsapp();
    const account = await createWhatsAppAccount(deps, f.owner.id, f.org.id, { label: "  Comercial  " });
    expect([account.label, account.status, account.people, account.qr]).toEqual([
      "Comercial",
      "pending",
      [f.owner.id],
      null,
    ]);
    const [create, connect] = gateway.calls;
    if (create?.op !== "create" || connect?.op !== "connect") throw new Error("gateway not asked");
    expect(connect.token).toBe(create.token);
    expect(connect.webhookUrl).toStartWith("http://agentes:3000/api/webhooks/whatsapp/");
    const [row] = await f.db.select().from(schema.whatsappAccounts);
    expect(JSON.stringify(row)).not.toContain(create.token);
    expect(JSON.stringify(row)).not.toContain(secretOf(gateway));

    await handleWhatsAppEvent(
      deps,
      secretOf(gateway),
      event("QRCode", { qrcode: "data:image/png;base64,AA", code: "2@x" }),
    );
    let { accounts } = await listWhatsAppAccounts(deps, f.owner.id, f.org.id);
    expect([accounts[0]?.status, accounts[0]?.qr]).toEqual(["qr", "data:image/png;base64,AA"]);

    await handleWhatsAppEvent(
      deps,
      secretOf(gateway),
      event("Connected", { status: "open", jid: "5511911112222:3@s.whatsapp.net", pushName: "Zim" }),
    );
    ({ accounts } = await listWhatsAppAccounts(deps, f.owner.id, f.org.id));
    expect(accounts[0]).toMatchObject({ status: "connected", phone: "5511911112222", pushName: "Zim", qr: null });
  });

  test("only someone who manages connectors connects one, and nothing is kept of one the gateway refused", async () => {
    f = await setup();
    const { gateway, deps } = whatsapp();
    const member = await addMember(f.db, f.org.id, "member", "leticia");
    await expect(createWhatsAppAccount(deps, member.id, f.org.id, { label: "X" })).rejects.toThrow();
    gateway.failNext = "no room";
    await expect(createWhatsAppAccount(deps, f.owner.id, f.org.id, { label: "X" })).rejects.toThrow("no room");
    expect(await f.db.select().from(schema.whatsappAccounts)).toEqual([]);
  });

  test("without a gateway the list says off and every call refuses", async () => {
    f = await setup();
    const deps = { ...whatsapp().deps, gateway: null };
    expect(await listWhatsAppAccounts(deps, f.owner.id, f.org.id)).toEqual({ on: false, manage: true, accounts: [] });
    await expect(createWhatsAppAccount(deps, f.owner.id, f.org.id, { label: "X" })).rejects.toThrow("off");
  });

  test("a number the phone logged out takes a new code at a new address; a connected one refuses", async () => {
    f = await setup();
    const { gateway, deps, account, post } = await connected();
    await expect(reconnectWhatsAppAccount(deps, f.owner.id, f.org.id, account.id)).rejects.toThrow("connected");
    const old = secretOf(gateway);
    await post(event("LoggedOut", { reason: "Logged out" }));
    const again = await reconnectWhatsAppAccount(deps, f.owner.id, f.org.id, account.id);
    expect(again.status).toBe("pending");
    expect(secretOf(gateway)).not.toBe(old);
    await expect(handleWhatsAppEvent(deps, old, text("A1", "oi"))).rejects.toThrow("No WhatsApp number");
  });
});

describe("events into conversations", () => {
  test("a message makes its conversation, counts as unread, and told twice is one message", async () => {
    f = await setup();
    const { deps, account, post } = await connected();
    await post(text("A1", "bom dia"));
    await post(text("A1", "bom dia"));
    await post(text("A2", "tudo bem?", { Timestamp: "2026-11-13T12:01:00Z" }));
    const { chats } = await listWhatsAppChats(deps, f.owner.id, f.org.id, account.id);
    expect(chats).toHaveLength(1);
    expect(chats[0]).toMatchObject({
      phone: "5511999990000",
      name: "Ana",
      group: false,
      lastText: "tudo bem?",
      lastFromMe: false,
      lastStatus: null,
      unread: 2,
    });
    const page = await listWhatsAppMessages(deps, f.owner.id, f.org.id, account.id, chats[0]?.id as string);
    expect(page.messages.map((m) => [m.body, m.status, m.fromMe])).toEqual([
      ["tudo bem?", "received", false],
      ["bom dia", "received", false],
    ]);
  });

  test("history told late doesn't move the list, and what the phone itself sent isn't unread", async () => {
    f = await setup();
    const { deps, account, post } = await connected();
    await post(text("A2", "agora", { Timestamp: "2026-11-13T12:05:00Z" }));
    await post(text("A0", "antes", { Timestamp: "2026-11-13T11:00:00Z" }));
    await post(text("M1", "do celular", { IsFromMe: true, Timestamp: "2026-11-13T12:06:00Z" }));
    const { chats } = await listWhatsAppChats(deps, f.owner.id, f.org.id, account.id);
    expect(chats[0]).toMatchObject({ lastText: "do celular", lastFromMe: true, unread: 2, name: "Ana" });
  });

  test("an event for another number's instance, or at an address nobody listens at, is refused", async () => {
    f = await setup();
    const { deps, post } = await connected();
    await expect(post({ ...text("A1", "oi"), instanceId: "instance-9" })).rejects.toThrow("No WhatsApp number");
    await expect(handleWhatsAppEvent(deps, "f".repeat(64), text("A1", "oi"))).rejects.toThrow("No WhatsApp number");
    expect(await f.db.select().from(schema.whatsappMessages)).toEqual([]);
  });

  test("reactions, status updates and events we don't keep change nothing", async () => {
    f = await setup();
    const { post } = await connected();
    expect(await post(event("Presence", {}))).toEqual({ kind: "ignored" });
    await post(
      event("Message", {
        Info: { Chat: ANA, Sender: ANA, ID: "R1", Timestamp: AT },
        Message: { reactionMessage: { text: "👍", key: { ID: "A1" } } },
      }),
    );
    await post(text("S1", "story", { Chat: "status@broadcast" }));
    expect(await f.db.select().from(schema.whatsappChats)).toEqual([]);
  });

  test("the number's people hear a change, nobody else does", async () => {
    f = await setup();
    const outsider = await addMember(f.db, f.org.id, "admin", "outro");
    const { post } = await connected();
    const heard: unknown[] = [];
    const missed: unknown[] = [];
    f.pubsub.subscribe(userTopic(f.org.id, f.owner.id), (e) => heard.push(e));
    f.pubsub.subscribe(userTopic(f.org.id, outsider.id), (e) => missed.push(e));
    await post(text("A1", "oi"));
    expect(heard).toHaveLength(1);
    expect(heard[0]).toMatchObject({ type: "whatsapp.changed" });
    expect(missed).toEqual([]);
  });
});

describe("sending and reading", () => {
  test("a text goes through the gateway, is kept as the person's, and its ticks follow the receipts", async () => {
    f = await setup();
    const { gateway, deps, account, post } = await connected();
    await post(text("A1", "bom dia"));
    const { chats } = await listWhatsAppChats(deps, f.owner.id, f.org.id, account.id);
    const chatId = chats[0]?.id as string;
    const first = (await listWhatsAppMessages(deps, f.owner.id, f.org.id, account.id, chatId)).messages[0];
    await sendWhatsAppText(deps, f.owner.id, f.org.id, account.id, { chatId, text: " oi, Ana ", replyToId: first?.id });
    const send = gateway.last("send");
    expect(send).toMatchObject({ to: ANA, text: "oi, Ana", replyTo: "A1" });
    // The gateway's own event for what it sent: the same message, not a second one.
    await post(
      event("SendMessage", {
        Info: { Chat: ANA, Sender: ANA, ID: "SENT1", Timestamp: AT },
        Message: { conversation: "oi, Ana" },
      }),
    );

    const read = () => listWhatsAppMessages(deps, f.owner.id, f.org.id, account.id, chatId);
    const listed = async () => (await listWhatsAppChats(deps, f.owner.id, f.org.id, account.id)).chats[0];
    let mine = (await read()).messages.filter((m) => m.fromMe);
    expect(mine).toHaveLength(1);
    expect(await listed()).toMatchObject({ lastFromMe: true, lastStatus: "sent" });
    expect(mine[0]).toMatchObject({ body: "oi, Ana", status: "sent", sentByUserId: f.owner.id, replyToId: first?.id });

    await post(event("Receipt", { Chat: ANA, MessageIDs: ["SENT1"] }, { state: "Read" }));
    await post(event("Receipt", { Chat: ANA, MessageIDs: ["SENT1"] }, { state: "Delivered" }));
    mine = (await read()).messages.filter((m) => m.fromMe);
    expect(mine[0]?.status).toBe("read");
    // The list's ticks follow the latest message: blue once read.
    expect((await listed())?.lastStatus).toBe("read");
  });

  test("a phone number starts a conversation; one that isn't a number, an empty text and a number that is out refuse", async () => {
    f = await setup();
    const { gateway, deps, account, post } = await connected();
    const sent = await sendWhatsAppText(deps, f.owner.id, f.org.id, account.id, {
      phone: "+55 (11) 98888-7777",
      text: "olá",
    });
    expect(gateway.last("send")).toMatchObject({ to: "5511988887777@s.whatsapp.net" });
    const { chats } = await listWhatsAppChats(deps, f.owner.id, f.org.id, account.id);
    expect(chats.map((c) => [c.id, c.phone, c.lastFromMe])).toEqual([[sent.chatId, "5511988887777", true]]);

    const send = (input: Parameters<typeof sendWhatsAppText>[4]) =>
      sendWhatsAppText(deps, f.owner.id, f.org.id, account.id, input);
    await expect(send({ phone: "123", text: "x" })).rejects.toThrow("country code");
    await expect(send({ chatId: sent.chatId, text: "   " })).rejects.toThrow("Write a message");
    await expect(send({ text: "x" })).rejects.toThrow("which conversation");
    await post(event("Disconnected", {}));
    await expect(send({ chatId: sent.chatId, text: "x" })).rejects.toThrow("isn't connected");
  });

  test("opening a conversation clears its unread and tells WhatsApp the messages were read", async () => {
    f = await setup();
    const { gateway, deps, account, post } = await connected();
    await post(text("A1", "um"));
    await post(text("A2", "dois", { Timestamp: "2026-11-13T12:01:00Z" }));
    const chatId = (await listWhatsAppChats(deps, f.owner.id, f.org.id, account.id)).chats[0]?.id as string;
    expect(await readWhatsAppChat(deps, f.owner.id, f.org.id, account.id, chatId)).toEqual({ read: 2 });
    expect(gateway.last("read")).toMatchObject({ chat: ANA, ids: ["A2", "A1"] });
    expect((await listWhatsAppChats(deps, f.owner.id, f.org.id, account.id)).chats[0]?.unread).toBe(0);
    expect(await readWhatsAppChat(deps, f.owner.id, f.org.id, account.id, chatId)).toEqual({ read: 0 });
  });
});

describe("sending a file", () => {
  test("a picture goes as a picture with its caption, a recording as a voice message, the rest as a document", async () => {
    f = await setup();
    const { gateway, deps, account, post } = await connected();
    await post(text("A1", "manda a proposta?"));
    const { chats } = await listWhatsAppChats(deps, f.owner.id, f.org.id, account.id);
    const chatId = chats[0]?.id as string;
    const bytes = new TextEncoder().encode("bytes");
    const sendIt = (input: { mimeType: string; fileName: string; caption?: string; voice?: boolean }) =>
      sendWhatsAppFile(deps, f.owner.id, f.org.id, account.id, { chatId, bytes, ...input });
    expect((await sendIt({ mimeType: "image/png", fileName: "foto.png", caption: " olha " })).kind).toBe("image");
    expect((await sendIt({ mimeType: "audio/webm;codecs=opus", fileName: "voice.webm", voice: true })).kind).toBe(
      "audio",
    );
    expect((await sendIt({ mimeType: "application/pdf", fileName: "proposta.pdf" })).kind).toBe("document");
    // A GIF or a MOV isn't one WhatsApp draws from here: it goes as a file.
    expect((await sendIt({ mimeType: "image/gif", fileName: "anim.gif" })).kind).toBe("document");
    expect(gateway.calls.filter((c) => c.op === "file").map((c) => [c.kind, c.fileName, c.caption])).toEqual([
      ["image", "foto.png", "olha"],
      ["audio", "voice.webm", ""],
      ["document", "proposta.pdf", ""],
      ["document", "anim.gif", ""],
    ]);
    const page = await listWhatsAppMessages(deps, f.owner.id, f.org.id, account.id, chatId, { limit: 4 });
    expect(page.messages.map((m) => [m.kind, m.body, m.file, m.sentByUserId === f.owner.id])).toEqual([
      ["document", "", true, true],
      ["document", "", true, true],
      ["audio", "", true, true],
      ["image", "olha", true, true],
    ]);
    await expect(sendIt({ mimeType: "image/png", fileName: "vazio.png" }).then(() => null)).resolves.toBeNull();
    await expect(
      sendWhatsAppFile(deps, f.owner.id, f.org.id, account.id, {
        chatId,
        bytes: new Uint8Array(0),
        mimeType: "image/png",
        fileName: "vazio.png",
      }),
    ).rejects.toThrow("empty");
  });
});

describe("stickers", () => {
  const sticker = (id: string, hash: string, over: Record<string, unknown> = {}) =>
    event("Message", {
      Info: { Chat: ANA, Sender: ANA, IsFromMe: false, ID: id, PushName: "Ana", Timestamp: AT, ...over },
      Message: { stickerMessage: { mimetype: "image/webp", fileSHA256: hash, mediaKey: "a2V5" } },
    });

  test("the number's latest stickers are offered once each, and one is sent again from a signed address", async () => {
    f = await setup();
    const { gateway, deps, account, post } = await connected();
    await post(sticker("S1", "aGFzaDE=", { Timestamp: "2026-11-13T12:00:00Z" }));
    await post(sticker("S2", "aGFzaDI=", { Timestamp: "2026-11-13T12:01:00Z" }));
    await post(sticker("S3", "aGFzaDE=", { Timestamp: "2026-11-13T12:02:00Z" }));
    const { stickers } = await listWhatsAppStickers(deps, f.owner.id, f.org.id, account.id);
    // The same sticker received twice is one, by its hash: the latest message of each.
    expect(stickers).toHaveLength(2);
    const { chats } = await listWhatsAppChats(deps, f.owner.id, f.org.id, account.id);
    const chatId = chats[0]?.id as string;
    const messageId = stickers[0]?.messageId as string;
    await sendWhatsAppSticker(deps, f.owner.id, f.org.id, account.id, { chatId, messageId });
    const url = new URL(gateway.last("sticker")?.url as string);
    expect(url.pathname).toBe(`/api/webhooks/whatsapp-sticker/${messageId}`);
    const expires = Number(url.searchParams.get("e"));
    const signature = url.searchParams.get("s") as string;
    // The gateway fetches it with that signature alone, until it expires.
    const file = await whatsappStickerFile(deps, messageId, expires, signature);
    expect([file.mimeType, new TextDecoder().decode(file.bytes)]).toEqual(["image/webp", "file"]);
    await expect(whatsappStickerFile(deps, messageId, expires, "0".repeat(64))).rejects.toThrow("No sticker");
    await expect(whatsappStickerFile(deps, messageId, expires + 1, signature)).rejects.toThrow("No sticker");
    await expect(whatsappStickerFile(deps, messageId, expires, signature, expires + 1)).rejects.toThrow("No sticker");
    const page = await listWhatsAppMessages(deps, f.owner.id, f.org.id, account.id, chatId, { limit: 1 });
    expect(page.messages[0]).toMatchObject({ kind: "sticker", fromMe: true, sentByUserId: f.owner.id, file: true });
    // A text isn't a sticker to send.
    await post(text("T1", "oi", { Timestamp: new Date(Date.now() + 1000).toISOString() }));
    const [words] = (await listWhatsAppMessages(deps, f.owner.id, f.org.id, account.id, chatId, { limit: 1 })).messages;
    await expect(
      sendWhatsAppSticker(deps, f.owner.id, f.org.id, account.id, { chatId, messageId: words?.id as string }),
    ).rejects.toThrow("isn't a sticker");
  });
});

describe("what the phone did elsewhere", () => {
  test("read on the phone is read here, a message taken back loses its words and an edited one changes them", async () => {
    f = await setup();
    const { gateway, deps, account, post } = await connected();
    await post(text("A1", "bom dia"));
    await post(text("A2", "tudo bem?"));
    const chat = async () => (await listWhatsAppChats(deps, f.owner.id, f.org.id, account.id)).chats[0];
    expect((await chat())?.unread).toBe(2);
    await post(event("Receipt", { Chat: ANA, MessageIDs: ["A2"] }, { state: "ReadSelf" }));
    expect((await chat())?.unread).toBe(0);
    // Reading it there tells WhatsApp nothing from here: the phone already did.
    expect(gateway.calls.some((c) => c.op === "read")).toBe(false);

    await post(
      event("Message", {
        Info: { Chat: ANA, Sender: ANA, ID: "E1", Timestamp: AT },
        Message: { protocolMessage: { type: 14, key: { ID: "A1" }, editedMessage: { conversation: "boa tarde" } } },
      }),
    );
    await post(
      event("Message", {
        Info: { Chat: ANA, Sender: ANA, ID: "R1", Timestamp: AT },
        Message: { protocolMessage: { type: 0, key: { ID: "A2" } } },
      }),
    );
    const page = await listWhatsAppMessages(deps, f.owner.id, f.org.id, account.id, (await chat())?.id as string);
    expect(page.messages.map((m) => [m.kind, m.body]).sort()).toEqual([
      ["deleted", ""],
      ["text", "boa tarde"],
    ]);
  });
});

describe("one person, two addresses", () => {
  const LID = "98765432101234@lid";

  test("an answer written on the phone, addressed by the hidden id, stays in the same conversation", async () => {
    f = await setup();
    const { deps, account, post } = await connected();
    await post(text("A1", "bom dia"));
    await post(
      text("P1", "respondi do celular", {
        Chat: LID,
        IsFromMe: true,
        Sender: "5511911112222@s.whatsapp.net",
        RecipientAlt: ANA,
      }),
    );
    // Later the same person writes under the hidden id alone: still theirs.
    await post(text("A2", "obrigada", { Chat: LID, Sender: LID }));
    const { chats } = await listWhatsAppChats(deps, f.owner.id, f.org.id, account.id);
    expect(chats.map((c) => [c.phone, c.name, c.lastText])).toEqual([["5511999990000", "Ana", "obrigada"]]);
    const page = await listWhatsAppMessages(deps, f.owner.id, f.org.id, account.id, chats[0]?.id as string);
    expect(page.messages.map((m) => m.body)).toEqual(["obrigada", "respondi do celular", "bom dia"]);
  });

  test("two conversations made before the pair was told become one, with every message", async () => {
    f = await setup();
    const { deps, account, post } = await connected();
    await post(text("A1", "pelo número"));
    await post(text("L1", "pelo id escondido", { Chat: LID, Sender: LID }));
    expect((await listWhatsAppChats(deps, f.owner.id, f.org.id, account.id)).chats).toHaveLength(2);
    await post(text("A3", "agora com os dois", { SenderAlt: LID }));
    const { chats } = await listWhatsAppChats(deps, f.owner.id, f.org.id, account.id);
    expect(chats.map((c) => [c.phone, c.unread, c.lastText])).toEqual([["5511999990000", 3, "agora com os dois"]]);
    const page = await listWhatsAppMessages(deps, f.owner.id, f.org.id, account.id, chats[0]?.id as string);
    expect(page.messages).toHaveLength(3);
  });
});

describe("history", () => {
  const old = (id: string, seconds: number, body: string, fromMe = false) => ({
    message: {
      key: { remoteJID: ANA, fromMe, ID: id },
      message: { conversation: body },
      messageTimestamp: seconds,
      status: 4,
      pushName: "Ana",
    },
  });
  const piece = (messages: unknown[], extra: Record<string, unknown> = {}) =>
    event("HistorySync", { Data: { syncType: 2, conversations: [{ ID: ANA, messages }], ...extra } });

  test("what the phone had before comes in as read, in order, and told twice changes nothing", async () => {
    f = await setup();
    const { deps, account, post } = await connected();
    await post(text("A1", "mensagem de agora"));
    const many = Array.from({ length: 1200 }, (_, i) => old(`H${i}`, 1_700_000_000 + i, `antiga ${i}`, i % 2 === 1));
    expect((await post(piece(many, { pushnames: [{ ID: ANA, pushname: "Ana Souza" }] }))).kind).toBe("history");
    await post(piece(many));
    const { chats } = await listWhatsAppChats(deps, f.owner.id, f.org.id, account.id);
    // The list still shows the live message, unread as it was: history is older and nobody's news.
    expect(chats.map((c) => [c.lastText, c.unread, c.name])).toEqual([["mensagem de agora", 1, "Ana"]]);
    const stored = await f.db.select({ id: schema.whatsappMessages.id }).from(schema.whatsappMessages);
    expect(stored).toHaveLength(1201);
    const page = await listWhatsAppMessages(deps, f.owner.id, f.org.id, account.id, chats[0]?.id as string, {
      limit: 3,
    });
    expect(page.messages.map((m) => [m.body, m.fromMe, m.status])).toEqual([
      ["mensagem de agora", false, "received"],
      ["antiga 1199", true, "read"],
      ["antiga 1198", false, "received"],
    ]);
  });

  test("a conversation known only from history shows by its latest message, with the name the phone told", async () => {
    f = await setup();
    const { deps, account, post } = await connected();
    await post(
      piece([old("H1", 1_700_000_000, "primeira"), old("H2", 1_700_000_100, "última", true)], {
        pushnames: [{ ID: ANA, pushname: "Ana Souza" }],
      }),
    );
    const { chats } = await listWhatsAppChats(deps, f.owner.id, f.org.id, account.id);
    expect(chats.map((c) => [c.name, c.lastText, c.lastFromMe, c.unread])).toEqual([["Ana Souza", "última", true, 0]]);
  });

  test("older messages are asked of the phone from the oldest one kept", async () => {
    f = await setup();
    const { gateway, deps, account, post } = await connected();
    await post(piece([old("H7", 1_700_000_700, "sete"), old("H3", 1_700_000_300, "três", true)]));
    const { chats } = await listWhatsAppChats(deps, f.owner.id, f.org.id, account.id);
    const chatId = chats[0]?.id as string;
    expect(await requestWhatsAppHistory(deps, f.owner.id, f.org.id, account.id, chatId)).toEqual({ asked: 50 });
    expect(gateway.last("history")).toMatchObject({ chat: ANA, before: "H3", count: 50 });
    const leticia = await addMember(f.db, f.org.id, "member", "leticia");
    await expect(requestWhatsAppHistory(deps, leticia.id, f.org.id, account.id, chatId)).rejects.toThrow("not found");
  });
});

describe("typing", () => {
  test("the other side is told while a listed person writes; a gateway that fails or a number that is out stops nothing", async () => {
    f = await setup();
    const { gateway, deps, account, post } = await connected();
    await post(text("A1", "oi"));
    const chatId = (await listWhatsAppChats(deps, f.owner.id, f.org.id, account.id)).chats[0]?.id as string;
    const tell = (on: boolean, who = f.owner.id) => typingInWhatsAppChat(deps, who, f.org.id, account.id, chatId, on);
    expect(await tell(true)).toEqual({ told: true });
    expect(gateway.last("typing")).toMatchObject({ chat: ANA, typing: true });
    gateway.failNext = "busy";
    expect(await tell(false)).toEqual({ told: false });
    const outsider = await addMember(f.db, f.org.id, "admin", "outro");
    await expect(tell(true, outsider.id)).rejects.toThrow("not found");
    await post(event("Disconnected", {}));
    expect(await tell(true)).toEqual({ told: false });
  });
});

describe("who sees a number", () => {
  test("only the people on its list read and answer it, an administrator included only once listed", async () => {
    f = await setup();
    const { deps, account, post } = await connected();
    await post(text("A1", "oi"));
    const leticia = await addMember(f.db, f.org.id, "member", "leticia");
    const admin = await addMember(f.db, f.org.id, "admin", "admin");

    expect((await listWhatsAppAccounts(deps, leticia.id, f.org.id)).accounts).toEqual([]);
    await expect(listWhatsAppChats(deps, leticia.id, f.org.id, account.id)).rejects.toThrow("not found");
    // An administrator sees that the number exists (to manage it), never its conversations.
    expect((await listWhatsAppAccounts(deps, admin.id, f.org.id)).accounts[0]).toMatchObject({
      mine: false,
      manage: true,
    });
    await expect(listWhatsAppChats(deps, admin.id, f.org.id, account.id)).rejects.toThrow("not found");

    await updateWhatsAppAccount(deps, f.owner.id, f.org.id, account.id, { people: [f.owner.id, leticia.id] });
    const hers = await listWhatsAppAccounts(deps, leticia.id, f.org.id);
    expect(hers.manage).toBe(false);
    expect(hers.accounts[0]).toMatchObject({ label: "Comercial", mine: true, manage: false });
    expect((await listWhatsAppChats(deps, leticia.id, f.org.id, account.id)).chats).toHaveLength(1);
    await expect(updateWhatsAppAccount(deps, leticia.id, f.org.id, account.id, { label: "Meu" })).rejects.toThrow();
  });

  test("its list takes members only, its agent one of the workspace's", async () => {
    f = await setup();
    const { deps, account } = await connected();
    const change = (input: Parameters<typeof updateWhatsAppAccount>[4]) =>
      updateWhatsAppAccount(deps, f.owner.id, f.org.id, account.id, input);
    await expect(change({ people: ["user_nobody"] })).rejects.toThrow("member");
    await expect(change({ agentId: crypto.randomUUID() })).rejects.toThrow("agent");
    expect((await change({ agentId: f.agent.id })).agentId).toBe(f.agent.id);
    expect((await change({ agentId: null, label: "Suporte" })).label).toBe("Suporte");
  });

  test("how its agent carries itself is kept for the number, shown only to who may change it", async () => {
    f = await setup();
    const { deps, account } = await connected();
    const leticia = await addMember(f.db, f.org.id, "member", "leticia");
    const saved = await updateWhatsAppAccount(deps, f.owner.id, f.org.id, account.id, {
      instructions: "  # Tom\r\nSempre por você, nunca prometa prazo.  ",
      people: [f.owner.id, leticia.id],
    });
    expect(saved.instructions).toBe("# Tom\nSempre por você, nunca prometa prazo.");
    expect((await listWhatsAppAccounts(deps, leticia.id, f.org.id)).accounts[0]?.instructions).toBeNull();
    await expect(
      updateWhatsAppAccount(deps, f.owner.id, f.org.id, account.id, { instructions: "x".repeat(20_001) }),
    ).rejects.toThrow("at most");
  });

  test("removing a number ends its session, deletes it at the gateway and takes its conversations", async () => {
    f = await setup();
    const { gateway, deps, account, post } = await connected();
    await post(text("A1", "oi"));
    expect(await removeWhatsAppAccount(deps, f.owner.id, f.org.id, account.id)).toEqual({
      removed: true,
      leftover: null,
    });
    expect(gateway.calls.slice(-2).map((call) => call.op)).toEqual(["logout", "delete"]);
    expect(await f.db.select().from(schema.whatsappChats)).toEqual([]);
    expect(
      await f.db.select().from(schema.whatsappMessages).where(eq(schema.whatsappMessages.orgId, f.org.id)),
    ).toEqual([]);
  });
});

describe("profile photos", () => {
  const JPEG = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 1, 2, 3, 4]);
  const PHOTO = "https://pps.whatsapp.net/v/t61/ana.jpg?oe=1";

  /** A fetch that answers WhatsApp's photo addresses from `served` and counts what it was asked. */
  function photoFetch(served: Map<string, Uint8Array>) {
    const asked: string[] = [];
    const fetch = (async (input: string | URL | Request) => {
      const url = String(input instanceof Request ? input.url : input);
      asked.push(url);
      const bytes = served.get(url);
      return bytes ? new Response(bytes) : new Response("gone", { status: 403 });
    }) as typeof globalThis.fetch;
    return { fetch, asked };
  }

  test("asked of the gateway once a day, served from WhatsApp's own, and a moved one asked again", async () => {
    f = await setup();
    const { gateway, deps, account, post } = await connected();
    await post(text("A1", "oi"));
    const chatId = (await listWhatsAppChats(deps, f.owner.id, f.org.id, account.id)).chats[0]?.id as string;
    expect((await listWhatsAppChats(deps, f.owner.id, f.org.id, account.id)).chats[0]?.photo).toBe(true);
    gateway.photos.set(ANA, PHOTO);
    const net = photoFetch(new Map([[PHOTO, JPEG]]));
    const photo = await whatsappChatPhoto({ ...deps, fetch: net.fetch }, f.owner.id, f.org.id, account.id, chatId);
    expect(photo.mimeType).toBe("image/jpeg");
    expect([...photo.bytes]).toEqual([...JPEG]);
    // Again within the day: the address kept, the gateway not asked.
    await whatsappChatPhoto({ ...deps, fetch: net.fetch }, f.owner.id, f.org.id, account.id, chatId);
    expect(gateway.calls.filter((c) => c.op === "photo")).toHaveLength(1);
    // WhatsApp moved it: the old address refuses, so the gateway is asked where it is now.
    const moved = "https://pps.whatsapp.net/v/t61/ana-2.jpg";
    gateway.photos.set(ANA, moved);
    const later = photoFetch(new Map([[moved, JPEG]]));
    await whatsappChatPhoto({ ...deps, fetch: later.fetch }, f.owner.id, f.org.id, account.id, chatId);
    expect(later.asked).toEqual([PHOTO, moved]);
    expect(gateway.calls.filter((c) => c.op === "photo")).toHaveLength(2);
  });

  test("none, or hidden: initials for a day; an address off WhatsApp or a page that isn't a picture is none", async () => {
    f = await setup();
    const { gateway, deps, account, post } = await connected();
    await post(text("A1", "oi"));
    const chatId = (await listWhatsAppChats(deps, f.owner.id, f.org.id, account.id)).chats[0]?.id as string;
    const net = photoFetch(new Map([["https://pps.whatsapp.net/page", new TextEncoder().encode("<html>")]]));
    const ask = () => whatsappChatPhoto({ ...deps, fetch: net.fetch }, f.owner.id, f.org.id, account.id, chatId);
    await expect(ask()).rejects.toThrow("no photo");
    expect((await listWhatsAppChats(deps, f.owner.id, f.org.id, account.id)).chats[0]?.photo).toBe(false);
    await expect(ask()).rejects.toThrow("no photo");
    expect(gateway.calls.filter((c) => c.op === "photo")).toHaveLength(1);
    // A day later it is asked again; an address elsewhere is never fetched.
    const dayAgo = new Date(Date.now() - 25 * 60 * 60_000);
    await f.db.update(schema.whatsappChats).set({ photoAt: dayAgo }).where(eq(schema.whatsappChats.id, chatId));
    gateway.photos.set(ANA, "https://evil.example/ana.jpg");
    await expect(ask()).rejects.toThrow("no photo");
    expect(net.asked).toEqual([]);
    await f.db.update(schema.whatsappChats).set({ photoAt: dayAgo }).where(eq(schema.whatsappChats.id, chatId));
    gateway.photos.set(ANA, "https://pps.whatsapp.net/page");
    await expect(ask()).rejects.toThrow("no photo");
    expect(net.asked).toEqual(["https://pps.whatsapp.net/page"]);
  });

  test("only the number's people see it", async () => {
    f = await setup();
    const { deps, account, post } = await connected();
    await post(text("A1", "oi"));
    const chatId = (await listWhatsAppChats(deps, f.owner.id, f.org.id, account.id)).chats[0]?.id as string;
    const stranger = await addMember(f.db, f.org.id, "member", "estranho");
    await expect(whatsappChatPhoto(deps, stranger.id, f.org.id, account.id, chatId)).rejects.toThrow();
  });
});

describe("a photo WhatsApp never answers for", () => {
  test("a timeout counts as none for the day; a gateway that's down doesn't", async () => {
    f = await setup();
    const { gateway, deps, account, post } = await connected();
    await post(text("A1", "oi"));
    const chatId = (await listWhatsAppChats(deps, f.owner.id, f.org.id, account.id)).chats[0]?.id as string;
    const original = gateway.profilePhoto.bind(gateway);
    let failure = "The WhatsApp gateway didn't answer: TimeoutError: The operation timed out.";
    gateway.profilePhoto = async () => {
      throw new WhatsAppGatewayError(0, failure);
    };
    const ask = () => whatsappChatPhoto(deps, f.owner.id, f.org.id, account.id, chatId);
    await expect(ask()).rejects.toThrow("no photo");
    expect((await listWhatsAppChats(deps, f.owner.id, f.org.id, account.id)).chats[0]?.photo).toBe(false);
    await f.db.update(schema.whatsappChats).set({ photoAt: null }).where(eq(schema.whatsappChats.id, chatId));
    failure = "The WhatsApp gateway didn't answer: connect ECONNREFUSED";
    await expect(ask()).rejects.toBeInstanceOf(WhatsAppGatewayError);
    expect((await listWhatsAppChats(deps, f.owner.id, f.org.id, account.id)).chats[0]?.photo).toBe(true);
    gateway.profilePhoto = original;
  });
});
