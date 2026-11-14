import { jidPhone, parseEvolutionEvent, type WhatsAppEvent, type WhatsAppMessage } from "@agenteschat/adapters";
import { and, type Database, eq, inArray, schema, sql } from "@agenteschat/db";
import { NotFoundError } from "../errors";
import { hookHash, publishWhatsAppChanged, type WhatsAppAccountRow, type WhatsAppDeps } from "./accounts";

type InboundDeps = Pick<WhatsAppDeps, "db" | "pubsub">;

/** What the list shows for a message without words. */
export function whatsappPreview(message: Pick<WhatsAppMessage, "kind" | "text">) {
  return message.text.slice(0, 200);
}

/**
 * One message into its conversation: the chat is made on its first message, an event told twice changes nothing.
 * Returns the chat's id, and whether the message was new.
 */
export async function storeWhatsAppMessage(
  db: Database,
  account: Pick<WhatsAppAccountRow, "id" | "orgId">,
  message: WhatsAppMessage,
  sentByUserId: string | null = null,
) {
  // The other side's name: in a one-to-one chat, what their phone says when they write; a group's, its own.
  const name = message.group ? message.groupName : message.fromMe ? "" : message.senderName;
  const [chat] = await db
    .insert(schema.whatsappChats)
    .values({ orgId: account.orgId, accountId: account.id, jid: message.chat, name, group: message.group })
    .onConflictDoUpdate({
      target: [schema.whatsappChats.accountId, schema.whatsappChats.jid],
      set: name ? { name } : { jid: message.chat },
    })
    .returning({ id: schema.whatsappChats.id });
  if (!chat) throw new Error("whatsapp chat not stored");
  const inserted = await db
    .insert(schema.whatsappMessages)
    .values({
      orgId: account.orgId,
      accountId: account.id,
      chatId: chat.id,
      waId: message.id,
      fromMe: message.fromMe,
      senderJid: message.sender,
      senderName: message.senderName,
      kind: message.kind,
      body: message.text,
      replyToWaId: message.replyTo,
      media: message.media,
      raw: message.raw,
      status: message.fromMe ? "sent" : "received",
      sentByUserId,
      at: message.at,
    })
    .onConflictDoNothing({ target: [schema.whatsappMessages.accountId, schema.whatsappMessages.waId] })
    .returning({ id: schema.whatsappMessages.id });
  const fresh = inserted.length > 0;
  if (fresh) {
    // Only a message later than the one shown moves the list: history told late doesn't.
    await db
      .update(schema.whatsappChats)
      .set({
        lastAt: message.at,
        lastText: whatsappPreview(message),
        lastKind: message.kind,
        lastFromMe: message.fromMe,
      })
      .where(
        and(
          eq(schema.whatsappChats.id, chat.id),
          sql`(${schema.whatsappChats.lastAt} is null or ${schema.whatsappChats.lastAt} <= ${message.at.toISOString()}::timestamptz)`,
        ),
      );
    if (!message.fromMe) {
      await db
        .update(schema.whatsappChats)
        .set({ unread: sql`${schema.whatsappChats.unread} + 1` })
        .where(eq(schema.whatsappChats.id, chat.id));
    }
  }
  return { chatId: chat.id, fresh, messageId: inserted[0]?.id ?? null };
}

async function apply(deps: InboundDeps, account: WhatsAppAccountRow, event: WhatsAppEvent) {
  const { db } = deps;
  const accounts = schema.whatsappAccounts;
  switch (event.kind) {
    case "qr": {
      // A code that arrives for a connected number is a stale event: the session it would replace is the live one.
      if (account.status === "connected") return null;
      await db
        .update(accounts)
        .set({ status: "qr", qrImage: event.image, qrAt: new Date() })
        .where(eq(accounts.id, account.id));
      return {};
    }
    case "connected": {
      await db
        .update(accounts)
        .set({
          status: "connected",
          jid: event.jid,
          phone: jidPhone(event.jid),
          pushName: event.name || account.pushName,
          qrImage: null,
          qrAt: null,
          lastError: null,
        })
        .where(eq(accounts.id, account.id));
      return {};
    }
    case "disconnected": {
      const status =
        event.reason === "logged_out" ? "logged_out" : event.reason === "dropped" ? "disconnected" : "pending";
      // A code nobody read ends a session that never was: a connected number isn't touched by it.
      if (event.reason === "qr_timeout" && account.status === "connected") return null;
      await db.update(accounts).set({ status, qrImage: null, qrAt: null }).where(eq(accounts.id, account.id));
      return {};
    }
    case "message": {
      // A reaction changes another message; until reactions are drawn, nothing of it is kept.
      if (event.message.kind === "reaction") return null;
      // Status updates ("stories") and channels aren't conversations.
      if (event.message.chat.endsWith("@broadcast") || event.message.chat.endsWith("@newsletter")) return null;
      const stored = await storeWhatsAppMessage(db, account, event.message);
      return stored.fresh ? { chatId: stored.chatId } : null;
    }
    case "receipt": {
      // Delivered never takes back a read.
      const from = event.state === "read" ? ["sent", "delivered"] : ["sent"];
      const changed = await db
        .update(schema.whatsappMessages)
        .set({ status: event.state })
        .where(
          and(
            eq(schema.whatsappMessages.accountId, account.id),
            eq(schema.whatsappMessages.fromMe, true),
            inArray(schema.whatsappMessages.waId, event.ids),
            inArray(schema.whatsappMessages.status, from as ("sent" | "delivered")[]),
          ),
        )
        .returning({ chatId: schema.whatsappMessages.chatId });
      return changed[0] ? { chatId: changed[0].chatId } : null;
    }
  }
}

/**
 * One event the gateway posted to `/api/webhooks/whatsapp/{secret}`. The secret in the address says which number
 * (the gateway signs nothing), and the event must name that number's own instance. `NotFoundError`: no number
 * listens at this address.
 */
export async function handleWhatsAppEvent(deps: InboundDeps, secret: string, payload: unknown) {
  const [account] = await deps.db
    .select()
    .from(schema.whatsappAccounts)
    .where(eq(schema.whatsappAccounts.hookHash, hookHash(secret)));
  if (!account) throw new NotFoundError("No WhatsApp number listens at this address");
  const event = parseEvolutionEvent(payload);
  if (!event) return { kind: "ignored" as const };
  if (event.instanceId !== account.instanceId) throw new NotFoundError("No WhatsApp number listens at this address");
  const changed = await apply(deps, account, event);
  if (changed) await publishWhatsAppChanged(deps, account, changed);
  return { kind: event.kind };
}
