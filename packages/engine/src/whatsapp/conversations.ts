import { createHmac, timingSafeEqual } from "node:crypto";
import {
  bareJid,
  isGroupJid,
  WhatsAppGatewayError,
  type WhatsAppMessage,
  whatsappFileKind,
  whatsappFileMessage,
} from "@agenteschat/adapters";
import { and, desc, eq, inArray, lt, schema, sql } from "@agenteschat/db";
import { sniffImage } from "../avatars";
import { NotFoundError, ValidationError } from "../errors";
import {
  accountToken,
  publishWhatsAppChanged,
  requireWhatsAppUse,
  type WhatsAppAccountRow,
  type WhatsAppDeps,
  whatsappGateway,
} from "./accounts";
import { type WhatsAppAgentState, whatsappAgentState } from "./agent";
import { storeWhatsAppMessage } from "./inbound";

export const WHATSAPP_PAGE = 50;
export const WHATSAPP_PAGE_MAX = 100;
/** WhatsApp's own limit for a text. */
export const WHATSAPP_TEXT_MAX = 4096;
/** Read receipts sent when a chat is opened: the latest ones are what the other side's ticks follow. */
const READ_BATCH = 50;

type ChatRow = typeof schema.whatsappChats.$inferSelect;
type MessageRow = typeof schema.whatsappMessages.$inferSelect;

export interface WhatsAppChatView {
  id: string;
  /** The other person's digits; null for a group or a hidden number. */
  phone: string | null;
  /** Outside text; empty until WhatsApp tells one. */
  name: string;
  group: boolean;
  lastAt: string | null;
  lastText: string;
  lastKind: string;
  lastFromMe: boolean;
  /** While the latest message is ours: how far it got (the list's ticks); null for theirs. */
  lastStatus: MessageRow["status"] | null;
  unread: number;
  /** Where the number's agent stands here (`whatsappAgentState`); null: no agent answers this conversation. */
  agent: WhatsAppAgentState;
  /** While `agent` is `quiet`: when it answers again. */
  agentQuietUntil: string | null;
  /** While `agent` is `person`: why it left, in its own words, or `limit` / `failed`. */
  agentNote: string;
  /** Its profile photo may be loaded (`whatsappChatPhoto`); false: it has none we know of, so draw its initials. */
  photo: boolean;
  /** Who the contact is (`whatsapp/contacts.ts`): a member of the workspace (their user id), or a portal client. */
  member: string | null;
  client: string | null;
}

export interface WhatsAppMessageView {
  id: string;
  chatId: string;
  fromMe: boolean;
  /** In a group, who wrote it (outside text). */
  senderName: string;
  senderPhone: string | null;
  kind: string;
  /** Outside text. */
  body: string;
  /** The message this one answers, by this API's id; null when it isn't here. */
  replyToId: string | null;
  media: MessageRow["media"];
  /** Its file can be asked for (`whatsappMessageFile`): it arrived with one and we kept what fetches it. */
  file: boolean;
  status: MessageRow["status"];
  /** Who wrote it in our app. */
  sentByUserId: string | null;
  /** The agent that wrote it. */
  sentByAgentId: string | null;
  at: string;
}

const phoneOf = (jid: string) => /^(\d{6,20})@s\.whatsapp\.net$/.exec(jid)?.[1] ?? null;

type AgentOf = Pick<typeof schema.whatsappAccounts.$inferSelect, "agentId" | "agentOn" | "agentQuietMinutes">;

const chatView = (
  row: ChatRow,
  account: AgentOf,
  now = new Date(),
  lastStatus: MessageRow["status"] | null = null,
): WhatsAppChatView => {
  const agent = whatsappAgentState(account, row, now);
  return {
    id: row.id,
    phone: phoneOf(row.jid),
    name: row.name,
    group: row.group,
    lastAt: row.lastAt?.toISOString() ?? null,
    lastText: row.lastText,
    lastKind: row.lastKind,
    lastFromMe: row.lastFromMe,
    lastStatus: row.lastFromMe ? lastStatus : null,
    unread: row.unread,
    agent: agent.state,
    agentQuietUntil: agent.quietUntil?.toISOString() ?? null,
    agentNote: agent.state === "person" ? row.agentNote : "",
    photo: !(row.photoUrl === null && photoFresh(row, now)),
    member: row.memberUserId,
    client: row.portalClient,
  };
};

/** How long what the gateway told of a conversation's photo holds before it is asked again. */
export const WHATSAPP_PHOTO_FRESH_MS = 24 * 60 * 60_000;
/** A profile photo's preview is about 5 KB; anything near this isn't one. */
const PHOTO_MAX_BYTES = 512 * 1024;
const PHOTO_TIMEOUT_MS = 15_000;

const photoFresh = (row: Pick<ChatRow, "photoAt">, now = new Date()) =>
  row.photoAt !== null && now.getTime() - row.photoAt.getTime() < WHATSAPP_PHOTO_FRESH_MS;

/** Only WhatsApp's own servers, over HTTPS: the address comes from the gateway, never from a person. */
function whatsappPhotoAddress(url: string): URL | null {
  try {
    const address = new URL(url);
    const host = address.hostname.toLowerCase();
    return address.protocol === "https:" && (host === "whatsapp.net" || host.endsWith(".whatsapp.net"))
      ? address
      : null;
  } catch {
    return null;
  }
}

/**
 * A conversation's profile photo, for the number's people: the small one WhatsApp shows in its list, fetched by
 * this server from WhatsApp's own (never by the browser: its address tells WhatsApp nothing of who looks). Where it
 * is gets asked of the gateway once a day, or again when the address stops answering. `NotFoundError`: none, or
 * hidden from this number.
 */
export async function whatsappChatPhoto(
  deps: WhatsAppDeps & { fetch?: typeof fetch },
  userId: string,
  orgId: string,
  accountId: string,
  chatId: string,
) {
  const account = await requireWhatsAppUse(deps.db, userId, orgId, accountId);
  const chat = await chatOf(deps, accountId, chatId);
  const http = deps.fetch ?? fetch;
  const ask = async () => {
    if (account.status !== "connected") return null;
    const gateway = whatsappGateway(deps);
    // A photo WhatsApp never answers for (its own `0@s.whatsapp.net`, which the gateway waits 75 s on) counts as
    // none for the day, so the list doesn't ask for it again each time it opens.
    const url = await gateway
      .profilePhoto(await accountToken(deps, account), { jid: chat.jid })
      .catch((error: unknown) => {
        if (error instanceof WhatsAppGatewayError && /timed? ?out/i.test(error.message)) return null;
        throw error;
      });
    const photoUrl = url && whatsappPhotoAddress(url) ? url : null;
    await deps.db
      .update(schema.whatsappChats)
      .set({ photoUrl, photoAt: new Date() })
      .where(eq(schema.whatsappChats.id, chat.id));
    return photoUrl;
  };
  const load = async (url: string) => {
    const address = whatsappPhotoAddress(url);
    if (!address) return null;
    try {
      const res = await http(address, { redirect: "error", signal: AbortSignal.timeout(PHOTO_TIMEOUT_MS) });
      if (!res.ok) return null;
      const bytes = new Uint8Array(await res.arrayBuffer());
      const mimeType = bytes.byteLength <= PHOTO_MAX_BYTES ? sniffImage(bytes) : null;
      return mimeType ? { bytes, mimeType } : null;
    } catch {
      return null;
    }
  };
  const fresh = photoFresh(chat);
  let url = fresh ? chat.photoUrl : await ask();
  let photo = url ? await load(url) : null;
  // A known address that stopped answering: WhatsApp moved the photo, so ask where it is now (once).
  if (!photo && fresh && url) {
    url = await ask();
    photo = url ? await load(url) : null;
  }
  if (!photo) throw new NotFoundError("This conversation has no photo");
  return photo;
}

/** A number's conversations, the latest first. `before`: the `lastAt` of the page before's last one. */
export async function listWhatsAppChats(
  deps: WhatsAppDeps,
  userId: string,
  orgId: string,
  accountId: string,
  page: { before?: string; limit?: number } = {},
) {
  const account = await requireWhatsAppUse(deps.db, userId, orgId, accountId);
  const limit = Math.min(page.limit ?? WHATSAPP_PAGE, WHATSAPP_PAGE_MAX);
  const chats = schema.whatsappChats;
  const rows = await deps.db
    .select()
    .from(chats)
    .where(
      and(
        eq(chats.accountId, accountId),
        sql`${chats.lastAt} is not null`,
        page.before ? lt(chats.lastAt, new Date(page.before)) : undefined,
      ),
    )
    .orderBy(desc(chats.lastAt), desc(chats.id))
    .limit(limit + 1);
  const shown = rows.slice(0, limit);
  const statuses = await lastStatuses(
    deps,
    shown.filter((row) => row.lastFromMe).map((row) => row.id),
  );
  const now = new Date();
  return {
    chats: shown.map((row) => chatView(row, account, now, statuses.get(row.id) ?? null)),
    next: rows.length > limit ? (shown.at(-1)?.lastAt?.toISOString() ?? null) : null,
  };
}

/** How far each conversation's latest message got (its ticks in the list), for the ones whose latest is ours. */
async function lastStatuses(deps: WhatsAppDeps, chatIds: string[]) {
  const found = new Map<string, MessageRow["status"]>();
  if (chatIds.length === 0) return found;
  const messages = schema.whatsappMessages;
  const rows = await deps.db
    .selectDistinctOn([messages.chatId], { chatId: messages.chatId, status: messages.status })
    .from(messages)
    .where(inArray(messages.chatId, chatIds))
    .orderBy(messages.chatId, desc(messages.at), desc(messages.createdAt));
  for (const row of rows) found.set(row.chatId, row.status);
  return found;
}

async function chatOf(deps: WhatsAppDeps, accountId: string, chatId: string) {
  const [chat] = await deps.db
    .select()
    .from(schema.whatsappChats)
    .where(and(eq(schema.whatsappChats.accountId, accountId), eq(schema.whatsappChats.id, chatId)));
  if (!chat) throw new NotFoundError("Conversation not found");
  return chat;
}

/** A conversation's messages, the latest first. `before`: the `at` of the page before's last one. */
export async function listWhatsAppMessages(
  deps: WhatsAppDeps,
  userId: string,
  orgId: string,
  accountId: string,
  chatId: string,
  page: { before?: string; limit?: number } = {},
) {
  const account = await requireWhatsAppUse(deps.db, userId, orgId, accountId);
  const chat = await chatOf(deps, accountId, chatId);
  const limit = Math.min(page.limit ?? WHATSAPP_PAGE, WHATSAPP_PAGE_MAX);
  const messages = schema.whatsappMessages;
  const rows = await deps.db
    .select()
    .from(messages)
    .where(and(eq(messages.chatId, chatId), page.before ? lt(messages.at, new Date(page.before)) : undefined))
    .orderBy(desc(messages.at), desc(messages.id))
    .limit(limit + 1);
  const shown = rows.slice(0, limit);
  const replies = [...new Set(shown.flatMap((row) => (row.replyToWaId ? [row.replyToWaId] : [])))];
  const answered = replies.length
    ? await deps.db
        .select({ id: messages.id, waId: messages.waId })
        .from(messages)
        .where(and(eq(messages.accountId, accountId), inArray(messages.waId, replies)))
    : [];
  const idOf = new Map(answered.map((row) => [row.waId, row.id]));
  return {
    chat: chatView(chat, account),
    messages: shown.map(
      (row): WhatsAppMessageView => ({
        id: row.id,
        chatId: row.chatId,
        fromMe: row.fromMe,
        senderName: row.senderName,
        senderPhone: phoneOf(row.senderJid),
        kind: row.kind,
        body: row.body,
        replyToId: row.replyToWaId ? (idOf.get(row.replyToWaId) ?? null) : null,
        media: row.media,
        file: row.media !== null && whatsappFileMessage(row.raw) !== null,
        status: row.status,
        sentByUserId: row.sentByUserId,
        sentByAgentId: row.sentByAgentId,
        at: row.at.toISOString(),
      }),
    ),
    next: rows.length > limit ? (shown.at(-1)?.at.toISOString() ?? null) : null,
  };
}

/** A phone number as people type it, to WhatsApp's address: digits only, country code included. */
export function whatsappJidOf(phone: string) {
  const digits = phone.replace(/\D/g, "");
  if (digits.length < 8 || digits.length > 15) throw new ValidationError("Type the number with its country code");
  return `${digits}@s.whatsapp.net`;
}

/**
 * A text out through the gateway and into its conversation here, as the number's own (`fromMe`): the one way a text
 * leaves, whoever asked for it (a person in the app, or the approval portal's notice in `portal-notice.ts`). The
 * conversation is made on its first message. Nothing here wakes the number's agent: only what the other side writes
 * does (`inbound.ts`).
 */
export async function deliverWhatsAppText(
  deps: WhatsAppDeps,
  account: WhatsAppAccountRow,
  input: { to: string; text: string; replyTo?: string | null },
  by: { userId?: string | null; agentId?: string | null } = {},
) {
  const gateway = whatsappGateway(deps);
  const replyTo = input.replyTo ?? null;
  const sent = await gateway.sendText(await accountToken(deps, account), { to: input.to, text: input.text, replyTo });
  const message: WhatsAppMessage = {
    id: sent.id,
    chat: bareJid(input.to),
    sender: account.jid ?? "",
    senderName: account.pushName,
    fromMe: true,
    group: isGroupJid(input.to),
    groupName: "",
    at: sent.at,
    kind: "text",
    text: input.text,
    replyTo,
    media: null,
    raw: null,
  };
  return { sent, stored: await storeWhatsAppMessage(deps.db, account, message, by) };
}

/**
 * Sends a text from the number: into a conversation it has (`chatId`), or to a phone number it never talked to
 * (`phone`), which starts one. The message is kept as the person's (`sentByUserId`).
 */
export async function sendWhatsAppText(
  deps: WhatsAppDeps,
  userId: string,
  orgId: string,
  accountId: string,
  input: { chatId?: string; phone?: string; text: string; replyToId?: string | null },
) {
  const account = await requireWhatsAppUse(deps.db, userId, orgId, accountId);
  // Without a gateway, the refusal comes before anything is read.
  whatsappGateway(deps);
  if (account.status !== "connected") throw new ValidationError("This number isn't connected");
  const text = input.text.trim();
  if (!text) throw new ValidationError("Write a message");
  if (text.length > WHATSAPP_TEXT_MAX)
    throw new ValidationError(`A message has at most ${WHATSAPP_TEXT_MAX} characters`);
  const to = input.chatId
    ? (await chatOf(deps, accountId, input.chatId)).jid
    : input.phone
      ? whatsappJidOf(input.phone)
      : null;
  if (!to) throw new ValidationError("Say which conversation");
  let replyTo: string | null = null;
  if (input.replyToId) {
    const [answered] = await deps.db
      .select({ waId: schema.whatsappMessages.waId })
      .from(schema.whatsappMessages)
      .where(and(eq(schema.whatsappMessages.accountId, accountId), eq(schema.whatsappMessages.id, input.replyToId)));
    if (!answered) throw new ValidationError("That message isn't in this number's conversations");
    replyTo = answered.waId;
  }
  const { sent, stored } = await deliverWhatsAppText(deps, account, { to, text, replyTo }, { userId });
  // The gateway's own event for this message may have arrived first: it is the person's all the same.
  if (!stored.fresh) {
    await deps.db
      .update(schema.whatsappMessages)
      .set({ sentByUserId: userId })
      .where(and(eq(schema.whatsappMessages.accountId, accountId), eq(schema.whatsappMessages.waId, sent.id)));
  }
  // A person took the conversation: the number's agent stays quiet in it for a while (`whatsappAgentState`).
  await deps.db
    .update(schema.whatsappChats)
    .set({ personAt: new Date(), needsPerson: false, agentNote: "" })
    .where(eq(schema.whatsappChats.id, stored.chatId));
  await publishWhatsAppChanged(deps, account, { chatId: stored.chatId });
  return { chatId: stored.chatId };
}

/** The largest file sent from the app: above what phones send each other day to day, within what a form may carry. */
export const WHATSAPP_SEND_FILE_MAX_BYTES = 32 * 1024 * 1024;

/**
 * Sends a file into a conversation, as the person: a picture, a video, a voice message (`voice`: a recording made
 * in the app) or a document, by its type (`whatsappFileKind`). `caption` goes with it where WhatsApp shows one.
 */
export async function sendWhatsAppFile(
  deps: WhatsAppDeps,
  userId: string,
  orgId: string,
  accountId: string,
  input: { chatId: string; bytes: Uint8Array; mimeType: string; fileName: string; caption?: string; voice?: boolean },
) {
  const account = await requireWhatsAppUse(deps.db, userId, orgId, accountId);
  const gateway = whatsappGateway(deps);
  if (account.status !== "connected") throw new ValidationError("This number isn't connected");
  if (input.bytes.byteLength === 0) throw new ValidationError("The file is empty");
  if (input.bytes.byteLength > WHATSAPP_SEND_FILE_MAX_BYTES) throw new ValidationError("The file is too large to send");
  const chat = await chatOf(deps, accountId, input.chatId);
  const mimeType = input.mimeType || "application/octet-stream";
  const kind = whatsappFileKind(mimeType, input.voice);
  const fileName = input.fileName.replace(/[\\/\r\n]/g, "_").slice(0, 200) || "file";
  // A voice message carries no words, and a caption is at most a message long.
  const caption = kind === "audio" ? "" : (input.caption ?? "").trim().slice(0, WHATSAPP_TEXT_MAX);
  const sent = await gateway.sendFile(await accountToken(deps, account), {
    to: chat.jid,
    kind,
    bytes: input.bytes,
    mimeType,
    fileName,
    caption,
  });
  const message: WhatsAppMessage = {
    id: sent.id,
    chat: bareJid(chat.jid),
    sender: account.jid ?? "",
    senderName: account.pushName,
    fromMe: true,
    group: isGroupJid(chat.jid),
    groupName: "",
    at: sent.at,
    kind,
    text: caption,
    replyTo: null,
    media: { mimeType, fileName: kind === "document" ? fileName : null, seconds: null },
    // What the gateway sent, kept to open the file here later.
    raw: sent.message,
  };
  const stored = await storeWhatsAppMessage(deps.db, account, message, { userId });
  if (!stored.fresh) {
    await deps.db
      .update(schema.whatsappMessages)
      .set({ sentByUserId: userId })
      .where(and(eq(schema.whatsappMessages.accountId, accountId), eq(schema.whatsappMessages.waId, sent.id)));
  }
  await deps.db
    .update(schema.whatsappChats)
    .set({ personAt: new Date(), needsPerson: false, agentNote: "" })
    .where(eq(schema.whatsappChats.id, stored.chatId));
  await publishWhatsAppChanged(deps, account, { chatId: stored.chatId });
  return { chatId: stored.chatId, kind };
}

/** Stickers offered to send again: the number's latest ones, each once. */
export const WHATSAPP_STICKERS = 60;
/** How long the gateway has to fetch a sticker it was asked to send. */
const STICKER_LINK_MS = 2 * 60_000;

type AccountRow = typeof schema.whatsappAccounts.$inferSelect;

/**
 * The signature on a sticker's one-use address: the gateway fetches the picture itself, with no session, so the
 * address carries the proof. Keyed by the number's own `hook_hash`, which only this server holds.
 */
const stickerSignature = (account: Pick<AccountRow, "hookHash">, messageId: string, expires: number) =>
  createHmac("sha256", account.hookHash).update(`${messageId}:${expires}`).digest("hex");

/**
 * The stickers this number sent or received lately, the latest first and each once: what its people pick from to
 * send one again. Each is a message's id, loaded like any message's file.
 */
export async function listWhatsAppStickers(deps: WhatsAppDeps, userId: string, orgId: string, accountId: string) {
  await requireWhatsAppUse(deps.db, userId, orgId, accountId);
  const messages = schema.whatsappMessages;
  const rows = await deps.db
    .select({ id: messages.id, raw: messages.raw, at: messages.at })
    .from(messages)
    .where(and(eq(messages.accountId, accountId), eq(messages.kind, "sticker"), sql`${messages.raw} is not null`))
    .orderBy(desc(messages.at))
    .limit(WHATSAPP_STICKERS * 5);
  const seen = new Set<string>();
  const stickers: { messageId: string; at: string }[] = [];
  for (const row of rows) {
    const part = (whatsappFileMessage(row.raw)?.stickerMessage ?? {}) as Record<string, unknown>;
    // The same sticker sent twice is one file: WhatsApp names it by its hash.
    const key = typeof part.fileSHA256 === "string" && part.fileSHA256 ? part.fileSHA256 : row.id;
    if (seen.has(key)) continue;
    seen.add(key);
    stickers.push({ messageId: row.id, at: row.at.toISOString() });
    if (stickers.length >= WHATSAPP_STICKERS) break;
  }
  return { stickers };
}

/**
 * Sends a sticker this number already has (`messageId`: a message that carried it) into a conversation. The
 * gateway fetches the picture from this server, at an address signed for two minutes (`whatsappStickerFile`).
 */
export async function sendWhatsAppSticker(
  deps: WhatsAppDeps,
  userId: string,
  orgId: string,
  accountId: string,
  input: { chatId: string; messageId: string },
) {
  const account = await requireWhatsAppUse(deps.db, userId, orgId, accountId);
  const gateway = whatsappGateway(deps);
  if (account.status !== "connected") throw new ValidationError("This number isn't connected");
  const chat = await chatOf(deps, accountId, input.chatId);
  const [source] = await deps.db
    .select({ id: schema.whatsappMessages.id, raw: schema.whatsappMessages.raw, kind: schema.whatsappMessages.kind })
    .from(schema.whatsappMessages)
    .where(and(eq(schema.whatsappMessages.accountId, accountId), eq(schema.whatsappMessages.id, input.messageId)));
  if (!source || source.kind !== "sticker" || !whatsappFileMessage(source.raw)) {
    throw new ValidationError("That message isn't a sticker of this number");
  }
  const expires = Date.now() + STICKER_LINK_MS;
  const url = `${deps.hookBase}/api/webhooks/whatsapp-sticker/${source.id}?e=${expires}&s=${stickerSignature(account, source.id, expires)}`;
  const sent = await gateway.sendSticker(await accountToken(deps, account), { to: chat.jid, url });
  const message: WhatsAppMessage = {
    id: sent.id,
    chat: bareJid(chat.jid),
    sender: account.jid ?? "",
    senderName: account.pushName,
    fromMe: true,
    group: isGroupJid(chat.jid),
    groupName: "",
    at: sent.at,
    kind: "sticker",
    text: "",
    replyTo: null,
    media: { mimeType: "image/webp", fileName: null, seconds: null },
    raw: sent.message,
  };
  const stored = await storeWhatsAppMessage(deps.db, account, message, { userId });
  if (!stored.fresh) {
    await deps.db
      .update(schema.whatsappMessages)
      .set({ sentByUserId: userId })
      .where(and(eq(schema.whatsappMessages.accountId, accountId), eq(schema.whatsappMessages.waId, sent.id)));
  }
  await deps.db
    .update(schema.whatsappChats)
    .set({ personAt: new Date(), needsPerson: false, agentNote: "" })
    .where(eq(schema.whatsappChats.id, stored.chatId));
  await publishWhatsAppChanged(deps, account, { chatId: stored.chatId });
  return { chatId: stored.chatId };
}

/**
 * A sticker's picture for the gateway, at the address `sendWhatsAppSticker` signed: no session, only the
 * signature, and only until it expires. `NotFoundError` for anything else.
 */
export async function whatsappStickerFile(
  deps: WhatsAppDeps,
  messageId: string,
  expires: number,
  signature: string,
  now = Date.now(),
) {
  const gone = new NotFoundError("No sticker at this address");
  if (!Number.isFinite(expires) || expires < now) throw gone;
  const [row] = await deps.db.select().from(schema.whatsappMessages).where(eq(schema.whatsappMessages.id, messageId));
  const message = row?.kind === "sticker" ? whatsappFileMessage(row.raw) : null;
  if (!row || !message) throw gone;
  const [account] = await deps.db
    .select()
    .from(schema.whatsappAccounts)
    .where(eq(schema.whatsappAccounts.id, row.accountId));
  if (!account) throw gone;
  const expected = Buffer.from(stickerSignature(account, messageId, expires));
  const given = Buffer.from(signature);
  if (expected.length !== given.length || !timingSafeEqual(expected, given)) throw gone;
  return whatsappGateway(deps).downloadMedia(await accountToken(deps, account), { message });
}

/** Older messages asked of the phone at a time: what WhatsApp's own apps ask for. */
export const WHATSAPP_HISTORY_COUNT = 50;

/**
 * Asks the phone for the messages before the oldest one we have of a conversation. They arrive as a piece of
 * history a moment later (told by `whatsapp.changed`), only while the phone is on and has them.
 */
export async function requestWhatsAppHistory(
  deps: WhatsAppDeps,
  userId: string,
  orgId: string,
  accountId: string,
  chatId: string,
) {
  const account = await requireWhatsAppUse(deps.db, userId, orgId, accountId);
  const gateway = whatsappGateway(deps);
  const chat = await chatOf(deps, accountId, chatId);
  if (account.status !== "connected") throw new ValidationError("This number isn't connected");
  const messages = schema.whatsappMessages;
  const [oldest] = await deps.db
    .select({ waId: messages.waId, fromMe: messages.fromMe, at: messages.at })
    .from(messages)
    .where(eq(messages.chatId, chatId))
    .orderBy(messages.at, messages.id)
    .limit(1);
  if (!oldest) throw new ValidationError("This conversation has no message to look before");
  await gateway.requestHistory(await accountToken(deps, account), {
    chat: chat.jid,
    before: { id: oldest.waId, fromMe: oldest.fromMe, at: oldest.at },
    count: WHATSAPP_HISTORY_COUNT,
  });
  return { asked: WHATSAPP_HISTORY_COUNT };
}

/** The largest file served: WhatsApp's own limit for a document is far above what a browser tab should hold. */
export const WHATSAPP_FILE_MAX_BYTES = 64 * 1024 * 1024;

/**
 * A message's file, for the number's people: fetched from WhatsApp by the gateway each time (nothing of it is
 * kept here). `NotFoundError` for a message without one; the gateway refuses a file WhatsApp no longer has.
 */
export async function whatsappMessageFile(
  deps: WhatsAppDeps,
  userId: string,
  orgId: string,
  accountId: string,
  messageId: string,
) {
  const account = await requireWhatsAppUse(deps.db, userId, orgId, accountId);
  const gateway = whatsappGateway(deps);
  const [row] = await deps.db
    .select()
    .from(schema.whatsappMessages)
    .where(and(eq(schema.whatsappMessages.accountId, accountId), eq(schema.whatsappMessages.id, messageId)));
  const message = row ? whatsappFileMessage(row.raw) : null;
  if (!row || !message) throw new NotFoundError("This message has no file");
  if (account.status !== "connected") throw new ValidationError("This number isn't connected");
  const file = await gateway.downloadMedia(await accountToken(deps, account), { message });
  if (file.bytes.byteLength > WHATSAPP_FILE_MAX_BYTES) throw new ValidationError("This file is too large to open here");
  return {
    bytes: file.bytes,
    // What the message itself said it is: the gateway's answer names the same type, less reliably.
    mimeType: row.media?.mimeType || file.mimeType,
    fileName: row.media?.fileName ?? null,
    kind: row.kind,
  };
}

/**
 * The person opened the conversation: nothing in it is unread here, and the other side sees it read (as opening
 * it on the phone does). A gateway that doesn't answer keeps the receipts from going, never the chat from opening.
 */
export async function readWhatsAppChat(
  deps: WhatsAppDeps,
  userId: string,
  orgId: string,
  accountId: string,
  chatId: string,
) {
  const account = await requireWhatsAppUse(deps.db, userId, orgId, accountId);
  const chat = await chatOf(deps, accountId, chatId);
  if (chat.unread === 0) return { read: 0 };
  const messages = schema.whatsappMessages;
  const unread = await deps.db
    .select({ waId: messages.waId })
    .from(messages)
    .where(and(eq(messages.chatId, chatId), eq(messages.fromMe, false)))
    .orderBy(desc(messages.at))
    .limit(Math.min(chat.unread, READ_BATCH));
  await deps.db.update(schema.whatsappChats).set({ unread: 0 }).where(eq(schema.whatsappChats.id, chatId));
  if (deps.gateway && account.status === "connected" && unread.length > 0) {
    await deps.gateway
      .markRead(await accountToken(deps, account), { chat: chat.jid, ids: unread.map((row) => row.waId) })
      .catch(() => {});
  }
  await publishWhatsAppChanged(deps, account, { chatId });
  return { read: unread.length };
}

/**
 * The person is writing in the conversation (or stopped): the other side sees "typing…", as it does when someone
 * writes in WhatsApp's own apps. Best effort: a gateway that doesn't answer never stops anyone from writing.
 */
export async function typingInWhatsAppChat(
  deps: WhatsAppDeps,
  userId: string,
  orgId: string,
  accountId: string,
  chatId: string,
  typing: boolean,
) {
  const account = await requireWhatsAppUse(deps.db, userId, orgId, accountId);
  const chat = await chatOf(deps, accountId, chatId);
  if (!deps.gateway || account.status !== "connected") return { told: false };
  const told = await deps.gateway
    .setTyping(await accountToken(deps, account), { chat: chat.jid, typing })
    .then(() => true)
    .catch(() => false);
  return { told };
}
