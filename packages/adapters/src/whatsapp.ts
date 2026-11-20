/**
 * WhatsApp numbers people connect to the workspace, through a gateway that speaks WhatsApp Web for them. Optional:
 * the server has it only with `WHATSAPP_GATEWAY_URL` and `WHATSAPP_GATEWAY_KEY`; without them the app shows no
 * WhatsApp anywhere. The gateway keeps the sessions and nothing else: every conversation lives in our database,
 * written from the events it posts to us (`parseEvolutionEvent`). Its admin key and each number's token stay on the
 * server, so a browser never talks to it.
 */

/** A chat's or a person's address on WhatsApp (`5511999999999@s.whatsapp.net`, `…@g.us` for a group). */
export type WhatsAppJid = string;

export type WhatsAppMessageKind =
  | "text"
  | "image"
  | "video"
  | "audio"
  | "document"
  | "sticker"
  | "location"
  | "contact"
  | "poll"
  | "reaction"
  | "other";

/** One message as the gateway tells it, whoever sent it. */
export interface WhatsAppMessage {
  /** WhatsApp's own id: the same message never has two. */
  id: string;
  chat: WhatsAppJid;
  /**
   * The same person's other address. WhatsApp names a person by their number (`…@s.whatsapp.net`) or by a hidden
   * id (`…@lid`), and not always the same one for both directions of one conversation: `chat` is the number
   * whenever the event tells it, and this the hidden id, so both land in one conversation. Null: not told.
   */
  chatLid?: WhatsAppJid | null;
  /** Who wrote it. In a one-to-one chat, the other person or this number. */
  sender: WhatsAppJid;
  /** The sender's name as their own phone tells it (outside text); empty when unknown. */
  senderName: string;
  fromMe: boolean;
  group: boolean;
  /** The group's name when the gateway sent it along; empty otherwise. */
  groupName: string;
  at: Date;
  kind: WhatsAppMessageKind;
  /** The words: a text's body, a file's caption, a reaction's emoji. Outside text. */
  text: string;
  /** The message this one answers, by WhatsApp's id. */
  replyTo: string | null;
  /** Who the message mentions with an @, by address (number or hidden id). Absent: none. */
  mentions?: WhatsAppJid[];
  /** A file's type and name, when it is one. */
  media: { mimeType: string; fileName: string | null; seconds: number | null } | null;
  /**
   * The message as WhatsApp carries it, kept for files alone: what the gateway needs back to fetch the file
   * (`downloadMedia`). Null for anything else.
   */
  raw: unknown;
}

/** What the gateway tells us happened to one of its numbers. */
export type WhatsAppEvent =
  | { kind: "qr"; instanceId: string; image: string; code: string }
  | { kind: "connected"; instanceId: string; jid: WhatsAppJid; name: string }
  /** `logged_out`: the phone removed this device, so only a new QR code brings it back. */
  | { kind: "disconnected"; instanceId: string; reason: "logged_out" | "dropped" | "qr_timeout" }
  | { kind: "message"; instanceId: string; message: WhatsAppMessage }
  | { kind: "receipt"; instanceId: string; chat: WhatsAppJid; ids: string[]; state: "delivered" | "read" }
  /** The conversation was read on the phone, or another device of this number: nothing in it is unread anymore. */
  | { kind: "read_self"; instanceId: string; chat: WhatsAppJid }
  /** A message was deleted for everyone. */
  | { kind: "revoked"; instanceId: string; id: string }
  /** A message's words were changed by whoever wrote it. */
  | { kind: "edited"; instanceId: string; id: string; text: string }
  /**
   * Conversations as the phone had them: WhatsApp sends them in pieces right after a number is linked, and again
   * when older messages of one conversation are asked for (`requestHistory`).
   */
  | { kind: "history"; instanceId: string; chats: WhatsAppHistoryChat[]; names: { jid: WhatsAppJid; name: string }[] };

/** One conversation of a piece of history, with the messages that piece carries. */
export interface WhatsAppHistoryChat {
  jid: WhatsAppJid;
  /** The person's hidden id, when the phone told both (`WhatsAppMessage.chatLid`). */
  lid?: WhatsAppJid | null;
  /** A group's subject, or the contact's name; empty when the phone told none. */
  name: string;
  messages: (WhatsAppMessage & { status: "received" | "sent" | "delivered" | "read" })[];
}

export interface WhatsAppSent {
  id: string;
  at: Date;
}

export interface WhatsAppGateway {
  readonly name: string;
  /** A new number's place in the gateway, not yet connected. `token` is what every call for it carries. */
  createInstance(input: { name: string; token: string }): Promise<{ instanceId: string }>;
  /** Starts the session: the QR code follows as an event, to `webhookUrl`, as does everything after it. */
  connect(token: string, input: { webhookUrl: string }): Promise<void>;
  status(token: string): Promise<{ connected: boolean; loggedIn: boolean }>;
  /** Ends the session on the phone too ("Linked devices"). */
  logout(token: string): Promise<void>;
  deleteInstance(instanceId: string): Promise<void>;
  sendText(token: string, input: { to: WhatsAppJid; text: string; replyTo?: string | null }): Promise<WhatsAppSent>;
  /**
   * Sends a file. `kind` is how WhatsApp shows it: a picture (JPEG, PNG or WebP), a video (MP4), a voice message
   * (`audio`: any recording, which the gateway turns into WhatsApp's own format) or a document (anything). The
   * answer carries the file's message, kept to open the file later.
   */
  sendFile(
    token: string,
    input: {
      to: WhatsAppJid;
      kind: WhatsAppFileKind;
      bytes: Uint8Array;
      mimeType: string;
      fileName: string;
      caption?: string;
      replyTo?: string | null;
      /**
       * A video WhatsApp should play as a GIF (silent, looping, no play button): asked as `gifPlayback`. A gateway
       * that doesn't know the field sends an ordinary short video.
       */
      gif?: boolean;
    },
  ): Promise<WhatsAppSent & { message: Record<string, unknown> | null }>;
  /**
   * Sends a sticker. The gateway fetches the picture itself from `url` (an address it can reach) and sends it as a
   * still sticker: one that moved arrives without its motion.
   */
  sendSticker(
    token: string,
    input: { to: WhatsAppJid; url: string },
  ): Promise<WhatsAppSent & { message: Record<string, unknown> | null }>;
  markRead(token: string, input: { chat: WhatsAppJid; ids: string[] }): Promise<void>;
  /** "Typing…" on the other side's screen, as WhatsApp's own apps show while someone writes; `false` ends it. */
  setTyping(token: string, input: { chat: WhatsAppJid; typing: boolean }): Promise<void>;
  /**
   * A message's file, fetched from WhatsApp and decrypted by the gateway. `message` is the file's message as it
   * arrived (`whatsappFileMessage`). WhatsApp keeps a file for a few weeks: later the gateway refuses.
   */
  downloadMedia(token: string, input: { message: Record<string, unknown> }): Promise<WhatsAppFile>;
  /**
   * Asks the phone for up to `count` messages of one conversation from before `before`, the oldest one we have.
   * They arrive later as a `history` event, only while the phone is on.
   */
  requestHistory(
    token: string,
    input: { chat: WhatsAppJid; before: { id: string; fromMe: boolean; at: Date }; count: number },
  ): Promise<void>;
  /**
   * Where a person's or a group's profile photo is now: a small one (96 px) on WhatsApp's own servers, at an
   * address that lasts some weeks. Null: they have none, or hide it from this number.
   */
  profilePhoto(token: string, input: { jid: WhatsAppJid }): Promise<string | null>;
}

export type WhatsAppFileKind = "image" | "video" | "audio" | "document";

/**
 * How WhatsApp shows a file of this type: only what its apps draw as a picture or play as a video goes as one,
 * a recording goes as a voice message, and everything else as a document.
 */
export function whatsappFileKind(mimeType: string, voice = false): WhatsAppFileKind {
  const type = mimeType.split(";")[0]?.trim().toLowerCase() ?? "";
  if (voice || type.startsWith("audio/")) return "audio";
  if (type === "image/jpeg" || type === "image/png" || type === "image/webp") return "image";
  if (type === "video/mp4") return "video";
  return "document";
}

export interface WhatsAppFile {
  mimeType: string;
  bytes: Uint8Array;
}

/** The gateway refused a call, or didn't answer. `status` 0: no answer. */
export class WhatsAppGatewayError extends Error {
  constructor(
    readonly status: number,
    message: string,
  ) {
    super(message);
    this.name = "WhatsAppGatewayError";
  }
}

export interface EvolutionGoOptions {
  /** The gateway's address as this server reaches it (`http://whatsapp:8080`). */
  url: string;
  /** Its `GLOBAL_API_KEY`: makes and deletes instances. */
  apiKey: string;
  /** Tests pass a fake. */
  fetch?: typeof fetch;
}

/** What every event of a number's is asked for: messages both ways, receipts, the connection and its QR code. */
const SUBSCRIBE = ["MESSAGE", "SEND_MESSAGE", "READ_RECEIPT", "CONNECTION", "QRCODE", "HISTORY_SYNC"];
const TIMEOUT_MS = 30_000;
/** A file is uploaded to WhatsApp before its message goes, and a recording is converted first. */
const FILE_TIMEOUT_MS = 120_000;

/**
 * Evolution Go's REST API (Apache-2.0, a separate service on the network): `apikey` is the global key for
 * `/instance/create` and `/instance/delete`, the instance's own token for everything else. Answers are
 * `{ message, data }` or `{ error }`.
 */
export function createEvolutionGoGateway(options: EvolutionGoOptions): WhatsAppGateway {
  const http = options.fetch ?? fetch;
  const base = options.url.replace(/\/+$/, "");

  const call = async (method: string, path: string, key: string, body?: unknown): Promise<unknown> => {
    let res: Response;
    try {
      res = await http(`${base}${path}`, {
        method,
        headers: { apikey: key, ...(body === undefined ? {} : { "Content-Type": "application/json" }) },
        body: body === undefined ? undefined : JSON.stringify(body),
        signal: AbortSignal.timeout(TIMEOUT_MS),
      });
    } catch (error) {
      throw new WhatsAppGatewayError(0, `The WhatsApp gateway didn't answer: ${String(error)}`);
    }
    const text = await res.text();
    let parsed: unknown = null;
    try {
      parsed = text ? JSON.parse(text) : null;
    } catch {
      // An HTML error page from a proxy in between: the status says enough.
    }
    if (!res.ok) throw new WhatsAppGatewayError(res.status, str(rec(parsed).error) || `HTTP ${res.status}`);
    return rec(parsed).data;
  };

  return {
    name: "evolution-go",
    async createInstance({ name, token }) {
      const data = rec(await call("POST", "/instance/create", options.apiKey, { name, token }));
      const instanceId = str(data.id);
      if (!instanceId) throw new WhatsAppGatewayError(502, "The WhatsApp gateway made an instance without an id");
      return { instanceId };
    },
    async connect(token, { webhookUrl }) {
      await call("POST", "/instance/connect", token, { webhookUrl, subscribe: SUBSCRIBE });
    },
    async status(token) {
      const data = rec(await call("GET", "/instance/status", token));
      return { connected: data.Connected === true, loggedIn: data.LoggedIn === true };
    },
    async logout(token) {
      await call("DELETE", "/instance/logout", token);
    },
    async deleteInstance(instanceId) {
      await call("DELETE", `/instance/delete/${encodeURIComponent(instanceId)}`, options.apiKey);
    },
    async sendText(token, { to, text, replyTo }) {
      const data = rec(
        await call("POST", "/send/text", token, {
          number: to,
          text,
          ...(replyTo ? { quoted: { messageId: replyTo } } : {}),
        }),
      );
      const info = rec(data.Info);
      const id = str(info.ID);
      if (!id) throw new WhatsAppGatewayError(502, "The WhatsApp gateway sent a message without an id");
      return { id, at: date(info.Timestamp) };
    },
    async sendFile(token, { to, kind, bytes, mimeType, fileName, caption, replyTo, gif }) {
      // The file goes as a form (`multipart/form-data`): as JSON it would be a third larger.
      const form = new FormData();
      form.set("number", to);
      form.set("type", kind);
      form.set("filename", fileName);
      if (caption) form.set("caption", caption);
      if (replyTo) form.set("quoted.messageId", replyTo);
      if (gif && kind === "video") form.set("gifPlayback", "true");
      form.set("file", new Blob([bytes], { type: mimeType }), fileName);
      let res: Response;
      try {
        res = await http(`${base}/send/media`, {
          method: "POST",
          headers: { apikey: token },
          body: form,
          signal: AbortSignal.timeout(FILE_TIMEOUT_MS),
        });
      } catch (error) {
        throw new WhatsAppGatewayError(0, `The WhatsApp gateway didn't answer: ${String(error)}`);
      }
      const parsed = rec(await res.json().catch(() => null));
      if (!res.ok) throw new WhatsAppGatewayError(res.status, str(parsed.error) || `HTTP ${res.status}`);
      const data = rec(parsed.data);
      const info = rec(data.Info);
      const id = str(info.ID);
      if (!id) throw new WhatsAppGatewayError(502, "The WhatsApp gateway sent a file without an id");
      const message = rec(data.Message);
      return { id, at: date(info.Timestamp), message: Object.keys(message).length > 0 ? message : null };
    },
    async sendSticker(token, { to, url }) {
      const data = rec(await call("POST", "/send/sticker", token, { number: to, sticker: url }));
      const info = rec(data.Info);
      const id = str(info.ID);
      if (!id) throw new WhatsAppGatewayError(502, "The WhatsApp gateway sent a sticker without an id");
      const message = rec(data.Message);
      return { id, at: date(info.Timestamp), message: Object.keys(message).length > 0 ? message : null };
    },
    async markRead(token, { chat, ids }) {
      if (ids.length > 0) await call("POST", "/message/markread", token, { id: ids, number: chat });
    },
    async setTyping(token, { chat, typing }) {
      await call("POST", "/message/presence", token, { number: chat, state: typing ? "composing" : "paused" });
    },
    async requestHistory(token, { chat, before, count }) {
      await call("POST", "/chat/history-sync", token, {
        messageInfo: {
          Chat: chat,
          IsFromMe: before.fromMe,
          IsGroup: isGroupJid(chat),
          ID: before.id,
          Timestamp: before.at.toISOString(),
        },
        count,
      });
    },
    async profilePhoto(token, { jid }) {
      try {
        const url = str(rec(await call("POST", "/user/avatar", token, { number: jid, preview: true })).url);
        return url || null;
      } catch (error) {
        // The gateway answers an error for "no photo" and "hidden from you" alike; only its silence and a refused
        // token are failures.
        if (error instanceof WhatsAppGatewayError && error.status !== 0 && error.status !== 401) return null;
        throw error;
      }
    },
    async downloadMedia(token, { message }) {
      // The answer is a `data:` address: `data:<type>;base64,<bytes>`.
      const address = str(rec(await call("POST", "/message/downloadmedia", token, { message })).base64);
      const comma = address.indexOf(",");
      if (!address.startsWith("data:") || comma < 0) {
        throw new WhatsAppGatewayError(502, "The WhatsApp gateway answered without a file");
      }
      const mimeType = address.slice(5, comma).split(";")[0] || "application/octet-stream";
      return { mimeType, bytes: new Uint8Array(Buffer.from(address.slice(comma + 1), "base64")) };
    },
  };
}

const rec = (value: unknown): Record<string, unknown> =>
  value && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : {};
const str = (value: unknown): string => (typeof value === "string" ? value : "");
const num = (value: unknown): number | null => (typeof value === "number" && Number.isFinite(value) ? value : null);

/** The gateway's timestamps are RFC 3339; one it can't tell is "now". */
function date(value: unknown): Date {
  const at = typeof value === "string" || typeof value === "number" ? new Date(value) : null;
  return at && !Number.isNaN(at.getTime()) ? at : new Date();
}

/** A JID without the device part WhatsApp adds to a sender (`5511…:12@s.whatsapp.net`). */
export function bareJid(jid: string): WhatsAppJid {
  const at = jid.indexOf("@");
  if (at < 0) return jid;
  return `${jid.slice(0, at).split(":")[0]}${jid.slice(at)}`;
}

export const isGroupJid = (jid: string) => jid.endsWith("@g.us");

/** The phone number in a person's JID, digits only; null for a group, a channel or a hidden number (`@lid`). */
export function jidPhone(jid: string): string | null {
  const match = /^(\d{6,20})(?::\d+)?@s\.whatsapp\.net$/.exec(jid);
  return match?.[1] ?? null;
}

/** The files a message can be, by the field WhatsApp carries each in. */
const MEDIA_FIELDS = [
  ["imageMessage", "image"],
  ["videoMessage", "video"],
  ["audioMessage", "audio"],
  ["documentMessage", "document"],
  ["stickerMessage", "sticker"],
] as const;

/** Wrappers WhatsApp puts around the real message (disappearing chats, view once, a file with a caption). */
const WRAPPERS = [
  "ephemeralMessage",
  "viewOnceMessage",
  "viewOnceMessageV2",
  "viewOnceMessageV2Extension",
  "documentWithCaptionMessage",
];

function unwrap(message: Record<string, unknown>): Record<string, unknown> {
  let current = message;
  for (let depth = 0; depth < 4; depth++) {
    const wrapper = WRAPPERS.find((key) => current[key] !== undefined);
    if (!wrapper) break;
    const inner = rec(rec(current[wrapper]).message);
    if (Object.keys(inner).length === 0) break;
    current = inner;
  }
  return current;
}

/**
 * The file's own message out of the one an event carried (`WhatsAppMessage.raw`), without the wrappers WhatsApp puts
 * around it: what the gateway takes back to fetch the file. Null: it carries no file.
 */
export function whatsappFileMessage(raw: unknown): Record<string, unknown> | null {
  const body = unwrap(rec(raw));
  const field = MEDIA_FIELDS.find(([name]) => body[name] !== undefined)?.[0];
  return field ? { [field]: withMediaAddress(rec(body[field])) } : null;
}

/** WhatsApp's media server, where a file's `directPath` lives. */
const MEDIA_HOST = "https://mmg.whatsapp.net";

/**
 * A file's address as the gateway can fetch it. Some stickers arrive with `URL: "https://a.whatsapp.net"`, a host
 * with no path that doesn't resolve; the gateway fetches `URL` when there is one, so such a file never downloads
 * (and a sticker never goes out again). Its `directPath` on WhatsApp's media server is the real address.
 */
function withMediaAddress(part: Record<string, unknown>): Record<string, unknown> {
  const path = str(part.directPath);
  if (!path.startsWith("/")) return part;
  const url = str(part.URL ?? part.url);
  let usable = false;
  try {
    usable = url !== "" && new URL(url).pathname.length > 1;
  } catch {}
  if (usable) return part;
  const { url: _lower, ...rest } = part;
  return { ...rest, URL: `${MEDIA_HOST}${path}` };
}

/**
 * What the file in a message (`WhatsAppMessage.raw`) is, as WhatsApp itself describes it: its type, name and length.
 * The gateway may convert what it was given (a recording becomes Ogg Opus, the voice message format), so this,
 * not what was handed to it, says what the file is now. Null: it carries no file.
 */
export function whatsappMediaOf(raw: unknown): WhatsAppMessage["media"] {
  return contentOf(rec(raw)).media;
}

/**
 * A voice message's loudness as WhatsApp draws it: the `waveform` its apps send with the recording, one byte per bar
 * (64 of them), each 0 to 100. Null: no voice message, or one sent without it.
 */
export function whatsappWaveOf(raw: unknown): number[] | null {
  const part = rec(unwrap(rec(raw)).audioMessage);
  const coded = str(part.waveform);
  if (!coded) return null;
  const bytes = Buffer.from(coded, "base64");
  if (bytes.length < 8 || bytes.length > 256) return null;
  return [...bytes].map((b) => Math.min(100, b));
}

/** What kind of message it is, its words and the id of the one it answers. */
function contentOf(
  message: Record<string, unknown>,
): Pick<WhatsAppMessage, "kind" | "text" | "replyTo" | "media" | "mentions"> {
  const body = unwrap(message);
  const reply = (part: unknown) => str(rec(rec(part).contextInfo).stanzaID) || null;
  // The people an @ names, as WhatsApp lists them beside the words (`contextInfo.mentionedJID`).
  const mentioned = (part: unknown) => {
    const list = rec(rec(part).contextInfo).mentionedJID;
    const jids = (Array.isArray(list) ? list : []).map((jid) => bareJid(str(jid))).filter(Boolean);
    return jids.length > 0 ? { mentions: jids } : {};
  };

  if (typeof body.conversation === "string" && body.conversation) {
    return { kind: "text", text: body.conversation, replyTo: null, media: null };
  }
  if (body.extendedTextMessage !== undefined) {
    const part = rec(body.extendedTextMessage);
    return { kind: "text", text: str(part.text), replyTo: reply(part), media: null, ...mentioned(part) };
  }
  for (const [field, kind] of MEDIA_FIELDS) {
    if (body[field] === undefined) continue;
    const part = rec(body[field]);
    return {
      kind,
      text: str(part.caption),
      replyTo: reply(part),
      ...mentioned(part),
      media: {
        mimeType: str(part.mimetype) || "application/octet-stream",
        fileName: str(part.fileName) || null,
        seconds: num(part.seconds),
      },
    };
  }
  if (body.reactionMessage !== undefined) {
    const part = rec(body.reactionMessage);
    return { kind: "reaction", text: str(part.text), replyTo: str(rec(part.key).ID) || null, media: null };
  }
  if (body.locationMessage !== undefined || body.liveLocationMessage !== undefined) {
    const part = rec(body.locationMessage ?? body.liveLocationMessage);
    const where = [num(part.degreesLatitude), num(part.degreesLongitude)].filter((n) => n !== null).join(", ");
    return { kind: "location", text: str(part.name) || where, replyTo: reply(part), media: null };
  }
  if (body.contactMessage !== undefined || body.contactsArrayMessage !== undefined) {
    const part = rec(body.contactMessage ?? body.contactsArrayMessage);
    return { kind: "contact", text: str(part.displayName), replyTo: reply(part), media: null };
  }
  const poll = body.pollCreationMessage ?? body.pollCreationMessageV2 ?? body.pollCreationMessageV3;
  if (poll !== undefined) return { kind: "poll", text: str(rec(poll).name), replyTo: null, media: null };
  return { kind: "other", text: "", replyTo: null, media: null };
}

/** One message of the gateway's, from its `Info` (who, where, when) and `Message` (what). Null: not a message. */
function message(data: Record<string, unknown>): WhatsAppMessage | null {
  const info = rec(data.Info);
  const id = str(info.ID);
  const told = bareJid(str(info.Chat));
  if (!id || !told) return null;
  const fromMe = info.IsFromMe === true;
  // One person, two addresses: the event names the other one beside the chat's (`RecipientAlt` on what this number
  // sent, `SenderAlt` on what it received).
  const other = bareJid(str(fromMe ? info.RecipientAlt : info.SenderAlt));
  const hidden = told.endsWith("@lid") ? told : other.endsWith("@lid") ? other : null;
  const chat = told.endsWith("@lid") && other.endsWith("@s.whatsapp.net") ? other : told;
  const body = rec(data.Message);
  const parsed = contentOf(body);
  // Edits, deletions and key exchanges ride on messages too: nothing a person reads.
  if (parsed.kind === "other" && body.protocolMessage !== undefined) return null;
  const group = isGroupJid(chat);
  return {
    id,
    chat,
    chatLid: group ? null : hidden,
    // In a one-to-one chat the other side is the chat itself, under whichever address it wrote from.
    sender: group || fromMe ? bareJid(str(info.Sender)) || chat : chat,
    senderName: str(info.PushName),
    fromMe,
    group,
    groupName: group ? str(rec(data.groupData).Name) : "",
    at: date(info.Timestamp),
    ...parsed,
    // The file itself is fetched later from what WhatsApp sent, never from the event: the gateway's inline copy
    // (`base64`) would make an event as large as the file.
    raw: parsed.media ? withoutInline(body) : null,
  };
}

function withoutInline(body: Record<string, unknown>) {
  const { base64: _base64, mediaUrl: _mediaUrl, ...rest } = body;
  return rest;
}

/** WhatsApp's own mark of how far a sent message got (`WebMessageInfo.status`): 3 delivered, 4 read, 5 played. */
function historyStatus(fromMe: boolean, status: unknown): WhatsAppHistoryChat["messages"][number]["status"] {
  if (!fromMe) return "received";
  const n = num(status) ?? 0;
  return n >= 4 ? "read" : n === 3 ? "delivered" : "sent";
}

/**
 * A piece of history (`events.HistorySync`): `Data.conversations`, each with its messages as WhatsApp keeps them
 * (`WebMessageInfo`: `key`, `message`, `messageTimestamp` in seconds), and `Data.pushnames`, people's own names.
 * A conversation WhatsApp addresses by a hidden id (`@lid`) is filed under the person's number when it names one.
 * Status updates, channels, reactions and the lines WhatsApp writes itself ("you were added") are left out.
 */
function history(data: Record<string, unknown>): Pick<Extract<WhatsAppEvent, { kind: "history" }>, "chats" | "names"> {
  const body = rec(data.Data);
  const chats: WhatsAppHistoryChat[] = [];
  for (const entry of Array.isArray(body.conversations) ? body.conversations : []) {
    const conversation = rec(entry);
    const id = bareJid(str(conversation.ID));
    const jid = id.endsWith("@lid") && str(conversation.pnJID) ? bareJid(str(conversation.pnJID)) : id;
    const lid = id.endsWith("@lid") ? id : bareJid(str(conversation.lidJID)) || null;
    if (!jid || jid.endsWith("@broadcast") || jid.endsWith("@newsletter")) continue;
    const group = isGroupJid(jid);
    const messages: WhatsAppHistoryChat["messages"] = [];
    for (const item of Array.isArray(conversation.messages) ? conversation.messages : []) {
      const info = rec(rec(item).message);
      const key = rec(info.key);
      const waId = str(key.ID);
      const seconds = num(info.messageTimestamp) ?? Number(info.messageTimestamp);
      if (!waId || !Number.isFinite(seconds) || seconds <= 0) continue;
      const content = rec(info.message);
      const parsed = contentOf(content);
      if (parsed.kind === "reaction" || (parsed.kind === "other" && !parsed.text)) continue;
      const fromMe = key.fromMe === true;
      messages.push({
        id: waId,
        chat: jid,
        sender: fromMe ? "" : bareJid(str(info.participant) || str(key.participant)) || jid,
        senderName: fromMe ? "" : str(info.pushName),
        fromMe,
        group,
        groupName: "",
        at: new Date(seconds * 1000),
        ...parsed,
        raw: parsed.media ? withoutInline(content) : null,
        status: historyStatus(fromMe, info.status),
      });
    }
    chats.push({ jid, lid, name: str(conversation.name) || str(conversation.displayName), messages });
  }
  const names = (Array.isArray(body.pushnames) ? body.pushnames : [])
    .map((entry) => ({ jid: bareJid(str(rec(entry).ID)), name: str(rec(entry).pushname) }))
    .filter((entry) => entry.jid && entry.name && entry.name !== "-");
  return { chats, names };
}

/**
 * One event as Evolution Go posts it: `{ event, data, instanceId, instanceToken, instanceName }`. Null for the
 * ones we keep nothing of (presence, calls, labels, history). The caller checks the instance is one of ours.
 */
export function parseEvolutionEvent(payload: unknown): WhatsAppEvent | null {
  const root = rec(payload);
  const instanceId = str(root.instanceId);
  const data = rec(root.data);
  if (!instanceId) return null;
  switch (str(root.event)) {
    case "QRCode": {
      const image = str(data.qrcode);
      return image ? { kind: "qr", instanceId, image, code: str(data.code) } : null;
    }
    case "QRTimeout":
      return { kind: "disconnected", instanceId, reason: "qr_timeout" };
    case "Connected":
    case "PairSuccess": {
      const jid = bareJid(str(data.jid));
      return jid ? { kind: "connected", instanceId, jid, name: str(data.pushName) } : null;
    }
    case "LoggedOut":
      return { kind: "disconnected", instanceId, reason: "logged_out" };
    case "Disconnected":
      return { kind: "disconnected", instanceId, reason: "dropped" };
    case "Message": {
      // A deletion or an edit rides on a message of its own (`protocolMessage`): 0 takes a message back for
      // everyone, 14 carries its new words. Both name the message they change by its id.
      const protocol = rec(unwrap(rec(data.Message)).protocolMessage);
      const target = str(rec(protocol.key).ID);
      if (target && protocol.type === 0) return { kind: "revoked", instanceId, id: target };
      if (target && protocol.type === 14) {
        return { kind: "edited", instanceId, id: target, text: contentOf(rec(protocol.editedMessage)).text };
      }
      const parsed = message(data);
      return parsed ? { kind: "message", instanceId, message: parsed } : null;
    }
    // What this number sent through the gateway: ours, whatever its `Info` says.
    case "SendMessage": {
      const parsed = message(data);
      return parsed ? { kind: "message", instanceId, message: { ...parsed, fromMe: true } } : null;
    }
    case "HistorySync":
      return { kind: "history", instanceId, ...history(data) };
    case "Receipt": {
      const state = str(root.state);
      const ids = Array.isArray(data.MessageIDs) ? data.MessageIDs.filter((id) => typeof id === "string") : [];
      const chat = bareJid(str(data.Chat));
      if (chat && state === "ReadSelf") return { kind: "read_self", instanceId, chat };
      if (!chat || ids.length === 0 || (state !== "Read" && state !== "Delivered")) return null;
      return { kind: "receipt", instanceId, chat, ids, state: state === "Read" ? "read" : "delivered" };
    }
    default:
      return null;
  }
}

/** What a fake gateway was asked to do, in order (tests). */
export type FakeWhatsAppCall =
  | { op: "create"; name: string; token: string }
  | { op: "connect"; token: string; webhookUrl: string }
  | { op: "logout"; token: string }
  | { op: "delete"; instanceId: string }
  | { op: "send"; token: string; to: WhatsAppJid; text: string; replyTo: string | null }
  | {
      op: "file";
      token: string;
      to: WhatsAppJid;
      kind: WhatsAppFileKind;
      fileName: string;
      caption: string;
      size: number;
      gif?: boolean;
    }
  | { op: "sticker"; token: string; to: WhatsAppJid; url: string }
  | { op: "read"; token: string; chat: WhatsAppJid; ids: string[] }
  | { op: "typing"; token: string; chat: WhatsAppJid; typing: boolean }
  | { op: "download"; token: string; message: Record<string, unknown> }
  | { op: "history"; token: string; chat: WhatsAppJid; before: string; count: number }
  | { op: "photo"; token: string; jid: WhatsAppJid };

/** A gateway that only remembers what it was asked (tests): no network, no WhatsApp. */
export function createFakeWhatsAppGateway(): WhatsAppGateway & {
  calls: FakeWhatsAppCall[];
  failNext: string | null;
  /** What `profilePhoto` answers for each address; one not here has none. */
  photos: Map<WhatsAppJid, string>;
  /** The latest call of one kind. */
  last<Op extends FakeWhatsAppCall["op"]>(op: Op): Extract<FakeWhatsAppCall, { op: Op }> | undefined;
} {
  let instances = 0;
  let sent = 0;
  const fake = {
    name: "fake",
    calls: [] as FakeWhatsAppCall[],
    /** The next call throws this, once. */
    failNext: null as string | null,
    photos: new Map<WhatsAppJid, string>(),
  };
  const guard = () => {
    if (!fake.failNext) return;
    const message = fake.failNext;
    fake.failNext = null;
    throw new WhatsAppGatewayError(500, message);
  };
  return Object.assign(fake, {
    last<Op extends FakeWhatsAppCall["op"]>(op: Op) {
      return [...fake.calls].reverse().find((call) => call.op === op) as
        | Extract<FakeWhatsAppCall, { op: Op }>
        | undefined;
    },
    async createInstance({ name, token }: { name: string; token: string }) {
      guard();
      fake.calls.push({ op: "create", name, token });
      return { instanceId: `instance-${++instances}` };
    },
    async connect(token: string, { webhookUrl }: { webhookUrl: string }) {
      guard();
      fake.calls.push({ op: "connect", token, webhookUrl });
    },
    async status() {
      return { connected: true, loggedIn: true };
    },
    async logout(token: string) {
      guard();
      fake.calls.push({ op: "logout", token });
    },
    async deleteInstance(instanceId: string) {
      guard();
      fake.calls.push({ op: "delete", instanceId });
    },
    async sendText(token: string, input: { to: WhatsAppJid; text: string; replyTo?: string | null }) {
      guard();
      fake.calls.push({ op: "send", token, to: input.to, text: input.text, replyTo: input.replyTo ?? null });
      return { id: `SENT${++sent}`, at: new Date() };
    },
    async sendFile(
      token: string,
      input: {
        to: WhatsAppJid;
        kind: WhatsAppFileKind;
        bytes: Uint8Array;
        mimeType: string;
        fileName: string;
        caption?: string;
        gif?: boolean;
      },
    ) {
      guard();
      fake.calls.push({
        op: "file",
        token,
        to: input.to,
        kind: input.kind,
        fileName: input.fileName,
        caption: input.caption ?? "",
        size: input.bytes.byteLength,
        ...(input.gif ? { gif: true } : {}),
      });
      return {
        id: `SENT${++sent}`,
        at: new Date(),
        // As Evolution Go does: a recording goes out as a voice message in Ogg Opus, whatever it was handed.
        message:
          input.kind === "audio"
            ? {
                audioMessage: {
                  mimetype: "audio/ogg; codecs=opus",
                  PTT: true,
                  seconds: 3,
                  waveform: Buffer.from([0, 10, 20, 30, 40, 50, 60, 100]).toString("base64"),
                },
              }
            : { [`${input.kind}Message`]: { mimetype: input.mimeType, fileName: input.fileName } },
      };
    },
    async sendSticker(token: string, input: { to: WhatsAppJid; url: string }) {
      guard();
      fake.calls.push({ op: "sticker", token, to: input.to, url: input.url });
      return { id: `SENT${++sent}`, at: new Date(), message: { stickerMessage: { mimetype: "image/webp" } } };
    },
    async markRead(token: string, { chat, ids }: { chat: WhatsAppJid; ids: string[] }) {
      guard();
      fake.calls.push({ op: "read", token, chat, ids });
    },
    async setTyping(token: string, { chat, typing }: { chat: WhatsAppJid; typing: boolean }) {
      guard();
      fake.calls.push({ op: "typing", token, chat, typing });
    },
    async requestHistory(
      token: string,
      input: { chat: WhatsAppJid; before: { id: string; fromMe: boolean; at: Date }; count: number },
    ) {
      guard();
      fake.calls.push({ op: "history", token, chat: input.chat, before: input.before.id, count: input.count });
    },
    async downloadMedia(token: string, { message }: { message: Record<string, unknown> }) {
      guard();
      fake.calls.push({ op: "download", token, message });
      const part = Object.values(message)[0] as { mimetype?: string } | undefined;
      return { mimeType: part?.mimetype ?? "application/octet-stream", bytes: new TextEncoder().encode("file") };
    },
    async profilePhoto(token: string, { jid }: { jid: WhatsAppJid }) {
      guard();
      fake.calls.push({ op: "photo", token, jid });
      return fake.photos.get(jid) ?? null;
    },
  });
}
