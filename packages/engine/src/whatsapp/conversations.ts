import { bareJid, isGroupJid, type WhatsAppMessage } from "@agenteschat/adapters";
import { and, desc, eq, inArray, lt, schema, sql } from "@agenteschat/db";
import { NotFoundError, ValidationError } from "../errors";
import {
  accountToken,
  publishWhatsAppChanged,
  requireWhatsAppUse,
  type WhatsAppDeps,
  whatsappGateway,
} from "./accounts";
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
  unread: number;
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
  status: MessageRow["status"];
  /** Who wrote it in our app. */
  sentByUserId: string | null;
  at: string;
}

const phoneOf = (jid: string) => /^(\d{6,20})@s\.whatsapp\.net$/.exec(jid)?.[1] ?? null;

const chatView = (row: ChatRow): WhatsAppChatView => ({
  id: row.id,
  phone: phoneOf(row.jid),
  name: row.name,
  group: row.group,
  lastAt: row.lastAt?.toISOString() ?? null,
  lastText: row.lastText,
  lastKind: row.lastKind,
  lastFromMe: row.lastFromMe,
  unread: row.unread,
});

/** A number's conversations, the latest first. `before`: the `lastAt` of the page before's last one. */
export async function listWhatsAppChats(
  deps: WhatsAppDeps,
  userId: string,
  orgId: string,
  accountId: string,
  page: { before?: string; limit?: number } = {},
) {
  await requireWhatsAppUse(deps.db, userId, orgId, accountId);
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
  return {
    chats: shown.map(chatView),
    next: rows.length > limit ? (shown.at(-1)?.lastAt?.toISOString() ?? null) : null,
  };
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
  await requireWhatsAppUse(deps.db, userId, orgId, accountId);
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
    chat: chatView(chat),
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
        status: row.status,
        sentByUserId: row.sentByUserId,
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
  const gateway = whatsappGateway(deps);
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
  const sent = await gateway.sendText(await accountToken(deps, account), { to, text, replyTo });
  const message: WhatsAppMessage = {
    id: sent.id,
    chat: bareJid(to),
    sender: account.jid ?? "",
    senderName: account.pushName,
    fromMe: true,
    group: isGroupJid(to),
    groupName: "",
    at: sent.at,
    kind: "text",
    text,
    replyTo,
    media: null,
    raw: null,
  };
  const stored = await storeWhatsAppMessage(deps.db, account, message, userId);
  // The gateway's own event for this message may have arrived first: it is the person's all the same.
  if (!stored.fresh) {
    await deps.db
      .update(schema.whatsappMessages)
      .set({ sentByUserId: userId })
      .where(and(eq(schema.whatsappMessages.accountId, accountId), eq(schema.whatsappMessages.waId, sent.id)));
  }
  await publishWhatsAppChanged(deps, account, { chatId: stored.chatId });
  return { chatId: stored.chatId };
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
