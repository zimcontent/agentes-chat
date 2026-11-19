import { createHash } from "node:crypto";
import { and, desc, eq, gt, schema, sql } from "@dougbot/db";
import { ConflictError, TooManyError, ValidationError } from "../errors";
import { publishWhatsAppChanged, type WhatsAppAccountRow, type WhatsAppDeps, whatsappGateway } from "./accounts";
import { deliverWhatsAppText, whatsappJidOf } from "./conversations";

/**
 * The approval portal's notices on WhatsApp (docs/adr/doug-0001-whatsapp-numbers.md, addendum 2026-11-16). The portal
 * runs on another server and has no WhatsApp of its own: it asks this server, which sends the text from a connected
 * number (`PORTAL_WHATSAPP_FROM`) by the same way a person's message leaves (`deliverWhatsAppText`) and keeps it in
 * the conversation as the number's own. No person and no agent wrote it, so it carries neither; it wakes nothing:
 * only what the other side writes back starts the number's agent, as always.
 */

/** A notice's longest text: a line or two with a link, never a broadcast. */
export const PORTAL_NOTICE_TEXT_MAX = 2000;
/** The longest idempotency key the portal may give. */
export const PORTAL_NOTICE_KEY_MAX = 200;
/** How long a key is remembered: the same one within it sends nothing again. */
export const PORTAL_NOTICE_KEY_MS = 24 * 60 * 60_000;

/** A phone number as the portal writes it: digits only, country code first (E.164 without the plus). */
export const PORTAL_NOTICE_PHONE = /^\d{8,15}$/;

/** `PORTAL_WHATSAPP_TO` as numbers: the only ones a notice may go to. */
export function portalNoticeRecipients(list: string | undefined): string[] {
  return (list ?? "")
    .split(",")
    .map((n) => n.trim())
    .filter((n) => PORTAL_NOTICE_PHONE.test(n));
}

export interface PortalNoticeInput {
  /** The sending number's digits (`PORTAL_WHATSAPP_FROM`). */
  from: string;
  /** The recipient's digits, already checked against the allowed list by the caller. */
  to: string;
  text: string;
  /** The portal's own key for this notice: told twice within a day, it is sent once. */
  key?: string | null;
  /**
   * Asked only when the number never talked to `to`: whether it may start one more conversation today (the same
   * count the app's own "new conversation" spends). False refuses the notice.
   */
  mayStartChat: (account: WhatsAppAccountRow) => Promise<boolean>;
  now?: Date;
}

/** Notices being sent now, by number and key: a second call with the same key waits for the first one's answer. */
const sending = new Map<string, Promise<{ messageId: string }>>();

const keyHash = (key: string) => createHash("sha256").update(key).digest("hex");

/** The connected number with these digits, in whichever workspace connected it; the newest when there are two. */
async function connectedNumber(deps: Pick<WhatsAppDeps, "db">, phone: string) {
  const accounts = schema.whatsappAccounts;
  const [row] = await deps.db
    .select()
    .from(accounts)
    .where(and(eq(accounts.phone, phone), eq(accounts.status, "connected")))
    .orderBy(desc(accounts.createdAt))
    .limit(1);
  return row ?? null;
}

async function sentWithKey(deps: Pick<WhatsAppDeps, "db">, accountId: string, hash: string, since: Date) {
  const messages = schema.whatsappMessages;
  const [row] = await deps.db
    .select({ id: messages.id })
    .from(messages)
    .where(
      and(
        eq(messages.accountId, accountId),
        eq(messages.fromMe, true),
        sql`${messages.raw}->>'portalKey' = ${hash}`,
        gt(messages.createdAt, since),
      ),
    )
    .orderBy(desc(messages.createdAt))
    .limit(1);
  return row?.id ?? null;
}

/**
 * Sends one notice. Refusals: `ValidationError` for a number or a text that can't be sent, `NotFoundError` without a
 * gateway, `ConflictError` (`whatsapp.portal_disconnected`) while the sending number isn't connected, `TooManyError`
 * (`whatsapp.new_chats_limit`) when it would start one conversation too many today, and the gateway's own error when
 * it refuses or doesn't answer.
 */
export async function sendPortalWhatsApp(deps: WhatsAppDeps, input: PortalNoticeInput): Promise<{ messageId: string }> {
  whatsappGateway(deps);
  const text = input.text.trim();
  if (!text) throw new ValidationError("Write a message");
  if (text.length > PORTAL_NOTICE_TEXT_MAX) {
    throw new ValidationError(`A notice has at most ${PORTAL_NOTICE_TEXT_MAX} characters`);
  }
  if (!PORTAL_NOTICE_PHONE.test(input.to)) throw new ValidationError("Type the number with its country code");
  const key = input.key?.trim() || null;
  if (key && key.length > PORTAL_NOTICE_KEY_MAX) {
    throw new ValidationError(`A key has at most ${PORTAL_NOTICE_KEY_MAX} characters`);
  }
  const account = await connectedNumber(deps, input.from);
  if (!account) {
    throw new ConflictError("The number that sends notices isn't connected", "whatsapp.portal_disconnected");
  }

  const send = async () => {
    const hash = key ? keyHash(key) : null;
    if (hash) {
      const since = new Date((input.now ?? new Date()).getTime() - PORTAL_NOTICE_KEY_MS);
      const before = await sentWithKey(deps, account.id, hash, since);
      if (before) return { messageId: before };
    }
    const to = whatsappJidOf(input.to);
    const chats = schema.whatsappChats;
    const [known] = await deps.db
      .select({ id: chats.id })
      .from(chats)
      .where(and(eq(chats.accountId, account.id), eq(chats.jid, to)))
      .limit(1);
    if (!known && !(await input.mayStartChat(account))) {
      throw new TooManyError("This number started too many conversations today", "whatsapp.new_chats_limit");
    }
    const { sent, stored } = await deliverWhatsAppText(deps, account, { to, text });
    const messages = schema.whatsappMessages;
    const mine = and(eq(messages.accountId, account.id), eq(messages.waId, sent.id));
    // The key rides on the message itself (a text has nothing else there), so a repeat finds what was sent.
    if (hash)
      await deps.db
        .update(messages)
        .set({ raw: { portalKey: hash } })
        .where(mine);
    // The gateway's own event for this message may have arrived first: the row is that one.
    const [row] = stored.messageId ? [] : await deps.db.select({ id: messages.id }).from(messages).where(mine);
    const messageId = stored.messageId ?? row?.id;
    if (!messageId) throw new Error("portal notice not stored");
    await publishWhatsAppChanged(deps, account, { chatId: stored.chatId });
    return { messageId };
  };

  if (!key) return send();
  const slot = `${account.id}:${keyHash(key)}`;
  const running = sending.get(slot);
  if (running) return running;
  const mine = send().finally(() => sending.delete(slot));
  sending.set(slot, mine);
  return mine;
}
