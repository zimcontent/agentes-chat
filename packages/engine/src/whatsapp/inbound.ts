import {
  bareJid,
  jidPhone,
  parseEvolutionEvent,
  type WhatsAppEvent,
  type WhatsAppHistoryChat,
  type WhatsAppMessage,
} from "@dougbot/adapters";
import { and, asc, type Database, desc, eq, inArray, or, schema, sql } from "@dougbot/db";
import { NotFoundError } from "../errors";
import { enqueue } from "../outbox";
import { hookHash, publishWhatsAppChanged, type WhatsAppAccountRow, type WhatsAppDeps } from "./accounts";

type InboundDeps = Pick<WhatsAppDeps, "db" | "pubsub">;

/** The number's agent answers a conversation (`answerWhatsAppChat`). */
export const WHATSAPP_AGENT_JOB = "whatsapp.agent_reply";
/**
 * The agent waits the number's own time after a message before it reads the conversation (`agent_wait_seconds`):
 * someone who writes three messages in a row gets one answer, and no answer comes back faster than a person could
 * have read. Plus up to this much more, so the wait is never the same twice.
 */
export const WHATSAPP_AGENT_JITTER_MS = 5_000;
/** A message older than this when it arrives (kept by WhatsApp while the number was out) starts no answer. */
export const WHATSAPP_AGENT_FRESH_MS = 10 * 60_000;
export const WHATSAPP_AGENT_ATTEMPTS = 4;
/**
 * In a group the agent speaks only once called (an @ to the number, its name, a reply to one of its messages), and
 * stays in the conversation, without being called again, until the group goes this long without a message
 * (docs/adr/doug-0007-whatsapp-groups.md).
 */
export const WHATSAPP_GROUP_SESSION_MINUTES = 30;

const plain = (text: string) => text.toLowerCase().normalize("NFD").replace(/\p{M}/gu, "");

/** Whether `text` says `name` as a word of its own ("Doug, me ajuda", "valeu doug"), whatever its accents and case. */
export function namesAgent(text: string, name: string) {
  const wanted = plain(name).trim();
  if (wanted.length < 2) return false;
  const escaped = wanted.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return new RegExp(`(^|[^\\p{L}\\p{N}])@?${escaped}($|[^\\p{L}\\p{N}])`, "u").test(plain(text));
}

/**
 * Whether a group message calls the number's agent: an @ to the number (by either of its addresses), the agent's
 * name in the words, or a reply to a message this number sent.
 */
async function callsAgent(
  db: Database,
  account: Pick<WhatsAppAccountRow, "id" | "jid" | "lid" | "agentId">,
  message: WhatsAppMessage,
) {
  const ours = [account.jid, account.lid].filter((jid): jid is string => !!jid).map(bareJid);
  if (message.mentions?.some((jid) => ours.includes(bareJid(jid)))) return true;
  if (account.agentId) {
    const [agent] = await db
      .select({ name: schema.agents.name, handle: schema.agents.handle })
      .from(schema.agents)
      .where(eq(schema.agents.id, account.agentId));
    if (agent && (namesAgent(message.text, agent.name) || namesAgent(message.text, agent.handle))) return true;
  }
  if (message.replyTo) {
    const [quoted] = await db
      .select({ fromMe: schema.whatsappMessages.fromMe })
      .from(schema.whatsappMessages)
      .where(and(eq(schema.whatsappMessages.accountId, account.id), eq(schema.whatsappMessages.waId, message.replyTo)));
    if (quoted?.fromMe) return true;
  }
  return false;
}

/** What the list shows for a message without words. */
export function whatsappPreview(message: Pick<WhatsAppMessage, "kind" | "text">) {
  return message.text.slice(0, 200);
}

/**
 * The conversation an address belongs to, made when it is new. WhatsApp names one person by two addresses, their
 * number and a hidden id (`lid`), and uses either: a conversation is found by both, kept under the number once it is
 * known, and two rows that turn out to be the same person (made before the pair was told) become one, with all
 * their messages. `name` replaces the one kept, or with `keepName` only fills an empty one.
 */
export async function whatsappChatFor(
  db: Database,
  account: Pick<WhatsAppAccountRow, "id" | "orgId">,
  input: { jid: string; lid?: string | null; name: string; group: boolean; keepName?: boolean },
) {
  const chats = schema.whatsappChats;
  const lid = input.lid && input.lid !== input.jid ? input.lid : input.jid.endsWith("@lid") ? input.jid : null;
  const addresses = lid && lid !== input.jid ? [input.jid, lid] : [input.jid];
  const found = await db
    .select()
    .from(chats)
    .where(and(eq(chats.accountId, account.id), or(inArray(chats.jid, addresses), inArray(chats.lid, addresses))))
    .orderBy(asc(chats.createdAt));
  if (found.length === 0) {
    const [made] = await db
      .insert(chats)
      .values({
        orgId: account.orgId,
        accountId: account.id,
        jid: input.jid,
        lid,
        name: input.name,
        group: input.group,
      })
      .onConflictDoUpdate({ target: [chats.accountId, chats.jid], set: { jid: input.jid } })
      .returning({ id: chats.id });
    if (!made) throw new Error("whatsapp chat not stored");
    return made.id;
  }
  // The row under the person's number is the one kept; else the oldest.
  const kept = found.find((row) => !row.jid.endsWith("@lid")) ?? (found[0] as (typeof found)[number]);
  const extra = found.filter((row) => row.id !== kept.id);
  for (const row of extra) {
    await db.update(schema.whatsappMessages).set({ chatId: kept.id }).where(eq(schema.whatsappMessages.chatId, row.id));
    await db.delete(chats).where(eq(chats.id, row.id));
  }
  const name =
    input.name && (!input.keepName || !kept.name) ? input.name : kept.name || extra.find((r) => r.name)?.name;
  const jid = kept.jid.endsWith("@lid") && !input.jid.endsWith("@lid") ? input.jid : kept.jid;
  const set = {
    ...(jid !== kept.jid ? { jid } : {}),
    ...(lid && lid !== kept.lid ? { lid } : {}),
    ...(name && name !== kept.name ? { name } : {}),
    ...(extra.length > 0
      ? {
          unread: kept.unread + extra.reduce((n, row) => n + row.unread, 0),
          agentOff: kept.agentOff || extra.some((row) => row.agentOff),
        }
      : {}),
  };
  if (Object.keys(set).length > 0) await db.update(chats).set(set).where(eq(chats.id, kept.id));
  if (extra.length > 0) {
    // What the list shows comes from the joined conversation's own latest message.
    const [latest] = await db
      .select()
      .from(schema.whatsappMessages)
      .where(eq(schema.whatsappMessages.chatId, kept.id))
      .orderBy(desc(schema.whatsappMessages.at), desc(schema.whatsappMessages.createdAt))
      .limit(1);
    if (latest) {
      await db
        .update(chats)
        .set({
          lastAt: latest.at,
          lastText: latest.body.slice(0, 200),
          lastKind: latest.kind,
          lastFromMe: latest.fromMe,
        })
        .where(eq(chats.id, kept.id));
    }
  }
  return kept.id;
}

/**
 * One message into its conversation: the chat is made on its first message, an event told twice changes nothing.
 * Returns the chat's id, and whether the message was new.
 */
export async function storeWhatsAppMessage(
  db: Database,
  account: Pick<WhatsAppAccountRow, "id" | "orgId">,
  message: WhatsAppMessage,
  by: { userId?: string | null; agentId?: string | null } = {},
) {
  // The other side's name: in a one-to-one chat, what their phone says when they write; a group's, its own.
  const name = message.group ? message.groupName : message.fromMe ? "" : message.senderName;
  const chat = {
    id: await whatsappChatFor(db, account, { jid: message.chat, lid: message.chatLid, name, group: message.group }),
  };
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
      sentByUserId: by.userId ?? null,
      sentByAgentId: by.agentId ?? null,
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

/** Messages written in one statement: a piece of history carries thousands. */
const HISTORY_BATCH = 500;

/**
 * A piece of the number's history into its conversations: what the phone had before it was linked here, or older
 * messages someone asked for. Nothing in it is new to anyone, so it counts as read, starts no answer from the
 * agent and moves a conversation in the list only when it is later than what the list shows. A message already
 * here stays as it is. Returns how many messages were new.
 */
export async function storeWhatsAppHistory(
  db: Database,
  account: Pick<WhatsAppAccountRow, "id" | "orgId" | "jid" | "pushName">,
  chats: WhatsAppHistoryChat[],
  names: { jid: string; name: string }[] = [],
) {
  const nameOf = new Map(names.map((entry) => [entry.jid, entry.name]));
  let added = 0;
  for (const history of chats) {
    const group = history.jid.endsWith("@g.us");
    const name = history.name || nameOf.get(history.jid) || "";
    const chat = {
      id: await whatsappChatFor(db, account, { jid: history.jid, lid: history.lid, name, group, keepName: true }),
    };
    for (let from = 0; from < history.messages.length; from += HISTORY_BATCH) {
      const rows = await db
        .insert(schema.whatsappMessages)
        .values(
          history.messages.slice(from, from + HISTORY_BATCH).map((message) => ({
            orgId: account.orgId,
            accountId: account.id,
            chatId: chat.id,
            waId: message.id,
            fromMe: message.fromMe,
            senderJid: message.fromMe ? (account.jid ?? "") : message.sender,
            senderName: message.fromMe ? account.pushName : message.senderName,
            kind: message.kind,
            body: message.text,
            replyToWaId: message.replyTo,
            media: message.media,
            raw: message.raw,
            status: message.status,
            at: message.at,
          })),
        )
        .onConflictDoNothing({ target: [schema.whatsappMessages.accountId, schema.whatsappMessages.waId] })
        .returning({ id: schema.whatsappMessages.id });
      added += rows.length;
    }
    const latest = history.messages.reduce<(typeof history.messages)[number] | null>(
      (best, message) => (!best || message.at > best.at ? message : best),
      null,
    );
    if (!latest) continue;
    await db
      .update(schema.whatsappChats)
      .set({
        lastAt: latest.at,
        lastText: whatsappPreview(latest),
        lastKind: latest.kind,
        lastFromMe: latest.fromMe,
      })
      .where(
        and(
          eq(schema.whatsappChats.id, chat.id),
          sql`(${schema.whatsappChats.lastAt} is null or ${schema.whatsappChats.lastAt} < ${latest.at.toISOString()}::timestamptz)`,
        ),
      );
  }
  // People's own names, for the conversations that have none yet.
  for (const [jid, name] of nameOf) {
    await db
      .update(schema.whatsappChats)
      .set({ name })
      .where(
        and(
          eq(schema.whatsappChats.accountId, account.id),
          eq(schema.whatsappChats.jid, jid),
          eq(schema.whatsappChats.name, ""),
        ),
      );
  }
  return added;
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
      // What this number sends in a group tells its hidden id there (also the agent's own messages, stored before
      // their event comes back): mentions may name it by that.
      const sender = bareJid(event.message.sender);
      if (event.message.group && event.message.fromMe && sender.endsWith("@lid") && sender !== account.lid) {
        await db.update(accounts).set({ lid: sender }).where(eq(accounts.id, account.id));
      }
      const stored = await storeWhatsAppMessage(db, account, event.message);
      if (!stored.fresh) return null;
      const fresh = Date.now() - event.message.at.getTime() < WHATSAPP_AGENT_FRESH_MS;
      let answers = !event.message.group;
      if (event.message.group) {
        // Any message keeps an open conversation going; a call opens one. Past it, the agent waits to be called.
        const [chat] = await db
          .select({ until: schema.whatsappChats.agentSessionUntil })
          .from(schema.whatsappChats)
          .where(eq(schema.whatsappChats.id, stored.chatId));
        const open = !!chat?.until && chat.until.getTime() > event.message.at.getTime();
        const called =
          !event.message.fromMe && fresh && account.agentId && account.agentOn
            ? await callsAgent(db, account, event.message)
            : false;
        if (open || called) {
          await db
            .update(schema.whatsappChats)
            .set({
              agentSessionUntil: new Date(event.message.at.getTime() + WHATSAPP_GROUP_SESSION_MINUTES * 60_000),
            })
            .where(eq(schema.whatsappChats.id, stored.chatId));
        }
        answers = open || called;
      }
      if (event.message.fromMe) {
        // Written on the phone itself (what the app or the agent sends is stored before its event arrives, or
        // put right after): a person took the conversation, so the agent stays quiet there for a while.
        await db
          .update(schema.whatsappChats)
          .set({ personAt: event.message.at, needsPerson: false, agentNote: "" })
          .where(eq(schema.whatsappChats.id, stored.chatId));
      } else if (stored.messageId && account.agentId && account.agentOn && answers && fresh) {
        await enqueue(db, {
          orgId: account.orgId,
          kind: WHATSAPP_AGENT_JOB,
          payload: { chatId: stored.chatId, messageId: stored.messageId },
          dedupeKey: `whatsapp.agent:${stored.messageId}`,
          // The number's own wait, never the same twice: a little more, up to half of it again.
          runAt: new Date(
            Date.now() +
              account.agentWaitSeconds * 1000 +
              Math.floor(Math.random() * Math.min(WHATSAPP_AGENT_JITTER_MS, account.agentWaitSeconds * 500)),
          ),
          maxAttempts: WHATSAPP_AGENT_ATTEMPTS,
        });
      }
      return { chatId: stored.chatId };
    }
    case "history": {
      const added = await storeWhatsAppHistory(db, account, event.chats, event.names);
      return added > 0 || event.names.length > 0 ? {} : null;
    }
    case "read_self": {
      // Read on the phone: read here too, without telling WhatsApp again.
      const changed = await db
        .update(schema.whatsappChats)
        .set({ unread: 0 })
        .where(
          and(
            eq(schema.whatsappChats.accountId, account.id),
            or(eq(schema.whatsappChats.jid, event.chat), eq(schema.whatsappChats.lid, event.chat)),
            sql`${schema.whatsappChats.unread} > 0`,
          ),
        )
        .returning({ id: schema.whatsappChats.id });
      return changed[0] ? { chatId: changed[0].id } : null;
    }
    case "revoked":
    case "edited": {
      // Its words go (or change) and the row stays: the conversation still says something was there.
      const set =
        event.kind === "revoked"
          ? { kind: "deleted", body: "", media: null, raw: null, replyToWaId: null }
          : { body: event.text };
      const [changed] = await db
        .update(schema.whatsappMessages)
        .set(set)
        .where(and(eq(schema.whatsappMessages.accountId, account.id), eq(schema.whatsappMessages.waId, event.id)))
        .returning({ chatId: schema.whatsappMessages.chatId, at: schema.whatsappMessages.at });
      if (!changed) return null;
      // The list's line follows when it was the conversation's latest message.
      await db
        .update(schema.whatsappChats)
        .set(event.kind === "revoked" ? { lastText: "", lastKind: "deleted" } : { lastText: event.text.slice(0, 200) })
        .where(and(eq(schema.whatsappChats.id, changed.chatId), eq(schema.whatsappChats.lastAt, changed.at)));
      return { chatId: changed.chatId };
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

/** Whether a number listens at this address: asked before an event's body is read. */
export async function whatsappHookKnown(deps: Pick<InboundDeps, "db">, secret: string) {
  const [account] = await deps.db
    .select({ id: schema.whatsappAccounts.id })
    .from(schema.whatsappAccounts)
    .where(eq(schema.whatsappAccounts.hookHash, hookHash(secret)));
  return account !== undefined;
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
