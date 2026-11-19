import { bareJid, DEFAULT_VOICE_OUT, VOICE_OUT_MAX_CHARS, type WhatsAppMessage } from "@dougbot/adapters";
import { and, desc, eq, schema } from "@dougbot/db";
import { accountToken, type WhatsAppAccountRow, type WhatsAppDeps, whatsappGateway } from "./accounts";
import { storeWhatsAppMessage } from "./inbound";

/**
 * The number's agent speaking (docs/adr/doug-0004-whatsapp-bridge.md, addendum 2026-11-15): a voice note in its voice,
 * as WhatsApp's own apps send one. When is code: a voice message gets one back, and the agent may choose one now and
 * then on its own, never two in its last few answers. What it says is never something to copy or click (a link, a
 * long number, a list) and never long: that is written.
 */

/** The longest answer spoken: past it, it is written. */
export const WHATSAPP_VOICE_MAX_CHARS = 600;
/** The agent's own choice of a voice note waits this many of its messages since its last one. */
const SPOKEN_EVERY = 4;

/** Words that are better read than heard: a link, an e-mail, a long number, a list, code. */
export function writtenOnly(text: string) {
  return (
    /https?:\/\/|www\.|\S+@\S+\.\S+/i.test(text) ||
    /\d[\d .\-/]{7,}\d/.test(text) ||
    /^\s*([-*•]|\d+[.)])\s/m.test(text) ||
    /`/.test(text)
  );
}

/**
 * Whether this answer goes as a voice note: the number lets its agent speak and a voice is there, the answer is short
 * and sayable, and either the person's latest message was a voice message or the agent asked for one (`wanted`) and
 * none of its last few messages here was one.
 */
export async function speaksNow(
  deps: Pick<WhatsAppDeps, "db" | "voiceOut">,
  account: Pick<WhatsAppAccountRow, "agentVoiceNotes">,
  chatId: string,
  input: { text: string; wanted: boolean },
) {
  if (!deps.voiceOut || !account.agentVoiceNotes) return false;
  const text = input.text.trim();
  if (!text || text.length > WHATSAPP_VOICE_MAX_CHARS || writtenOnly(text)) return false;
  const messages = schema.whatsappMessages;
  const recent = await deps.db
    .select({ fromMe: messages.fromMe, kind: messages.kind, agent: messages.sentByAgentId })
    .from(messages)
    .where(eq(messages.chatId, chatId))
    .orderBy(desc(messages.at), desc(messages.createdAt))
    .limit(20);
  const theirs = recent.find((m) => !m.fromMe);
  if (theirs?.kind === "audio") return true;
  if (!input.wanted) return false;
  const mine = recent.filter((m) => m.fromMe && m.agent).slice(0, SPOKEN_EVERY);
  return !mine.some((m) => m.kind === "audio");
}

/** What a voice says of a text: no marks, no emoji codes, one line. */
export function sayable(text: string) {
  return text
    .replace(/\*\*?|__?|~~|#{1,6}\s/g, "")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, VOICE_OUT_MAX_CHARS);
}

/**
 * Sends `text` as a voice note in the number's voice, stored as the agent's message with the words as its body (the
 * app shows them under the recording, the agent reads them as "[audio] …"). Throws when the voice or the gateway
 * fails: the caller writes instead.
 */
export async function sendVoiceNote(
  deps: WhatsAppDeps,
  account: WhatsAppAccountRow,
  chat: Pick<typeof schema.whatsappChats.$inferSelect, "id" | "jid" | "personAt"> &
    Partial<Pick<typeof schema.whatsappChats.$inferSelect, "group" | "name">>,
  agentId: string,
  text: string,
) {
  const voiceOut = deps.voiceOut;
  if (!voiceOut) throw new Error("no voice on this server");
  const words = sayable(text);
  const audio = await voiceOut.speak({ voice: account.agentVoice ?? DEFAULT_VOICE_OUT, text: words });
  const gateway = whatsappGateway(deps);
  const token = await accountToken(deps, account);
  const sent = await gateway.sendFile(token, {
    to: chat.jid,
    kind: "audio",
    bytes: audio.bytes,
    mimeType: audio.mimeType,
    fileName: "audio.mp3",
  });
  const message: WhatsAppMessage = {
    id: sent.id,
    chat: bareJid(chat.jid),
    sender: account.jid ?? "",
    senderName: account.pushName,
    fromMe: true,
    group: chat.group ?? false,
    groupName: chat.group ? (chat.name ?? "") : "",
    at: sent.at,
    kind: "audio",
    text: words,
    replyTo: null,
    media: { mimeType: "audio/ogg; codecs=opus", fileName: null, seconds: null },
    raw: sent.message,
  };
  const stored = await storeWhatsAppMessage(deps.db, account, message, { agentId });
  if (!stored.fresh) {
    // The gateway's own event came first: it reads as a person on the phone, with no words and no agent.
    await deps.db
      .update(schema.whatsappMessages)
      .set({ sentByAgentId: agentId, body: words })
      .where(and(eq(schema.whatsappMessages.accountId, account.id), eq(schema.whatsappMessages.waId, sent.id)));
    await deps.db
      .update(schema.whatsappChats)
      .set({ personAt: chat.personAt })
      .where(eq(schema.whatsappChats.id, chat.id));
  }
  return sent;
}
