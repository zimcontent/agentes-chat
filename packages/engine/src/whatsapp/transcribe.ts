import { firstWords, type SpeechEngine, whatsappFileMessage } from "@dougbot/adapters";
import { and, desc, eq, gt, schema } from "@dougbot/db";
import { accountToken, type WhatsAppAccountRow, type WhatsAppDeps, whatsappGateway } from "./accounts";

/**
 * Voice messages heard before the number's agent reads a conversation (docs/adr/doug-0004-whatsapp-bridge.md, addendum
 * 2026-11-15): each one the contact sent since the number last wrote is fetched from WhatsApp through the gateway and
 * put into words by the server's speech engines (the same that hear the app's voice messages, ADR 0100). The words
 * become the message's body, so the agent reads "[audio] …" instead of a file it can't open, a member's conversation
 * with the agent gets what they said, and the app shows it under the recording. One heard is never heard again.
 */

/** The longest recording heard: past it, the agent reads "[audio]" and hands over, as before. */
export const WHATSAPP_HEAR_MAX_SECONDS = 10 * 60;
/** At most this many recordings per answer: a long run of them is someone's monologue, the latest matter. */
const HEAR_AT_MOST = 5;
/** An engine works alone this long before the next starts beside it. */
const ALONE_MS = 8000;

export interface WhatsAppHearDeps extends WhatsAppDeps {
  /** The server's speech engines, in order; absent or empty: recordings stay "[audio]". */
  speech?: () => SpeechEngine[];
}

/** Hears the contact's unheard recordings in a conversation; returns how many got words. Never throws. */
export async function hearWhatsAppAudio(
  deps: WhatsAppHearDeps,
  account: WhatsAppAccountRow,
  chat: Pick<typeof schema.whatsappChats.$inferSelect, "id">,
  terms: string[] = [],
): Promise<number> {
  const engines = deps.speech?.() ?? [];
  if (engines.length === 0 || !deps.gateway || account.status !== "connected") return 0;
  try {
    const messages = schema.whatsappMessages;
    const [lastOut] = await deps.db
      .select({ at: messages.at })
      .from(messages)
      .where(and(eq(messages.chatId, chat.id), eq(messages.fromMe, true)))
      .orderBy(desc(messages.at))
      .limit(1);
    const rows = await deps.db
      .select({ id: messages.id, raw: messages.raw, media: messages.media })
      .from(messages)
      .where(
        and(
          eq(messages.chatId, chat.id),
          eq(messages.fromMe, false),
          eq(messages.kind, "audio"),
          eq(messages.body, ""),
          lastOut ? gt(messages.at, lastOut.at) : undefined,
        ),
      )
      .orderBy(desc(messages.at))
      .limit(HEAR_AT_MOST);
    if (rows.length === 0) return 0;
    const gateway = whatsappGateway(deps);
    const token = await accountToken(deps, account);
    let heard = 0;
    for (const row of rows.reverse()) {
      const message = whatsappFileMessage(row.raw);
      const seconds = row.media?.seconds ?? null;
      if (!message || (seconds !== null && seconds > WHATSAPP_HEAR_MAX_SECONDS)) continue;
      const words = await gateway
        .downloadMedia(token, { message })
        .then((file) =>
          firstWords(
            engines,
            {
              audio: file.bytes,
              contentType: row.media?.mimeType || file.mimeType,
              // Detected from the audio by the engines that would take this as an order.
              language: null,
              terms,
              orgId: account.orgId,
              ...(seconds !== null ? { durationMs: seconds * 1000 } : {}),
            },
            ALONE_MS,
          ),
        )
        .catch(() => null);
      const text = words?.text.replace(/\s+/g, " ").trim();
      if (!text) continue;
      await deps.db
        .update(messages)
        .set({ body: text.slice(0, 20_000) })
        .where(and(eq(messages.id, row.id), eq(messages.body, "")));
      heard++;
    }
    return heard;
  } catch {
    // Hearing is a help: a gateway or a database that fails leaves the recordings as they were.
    return 0;
  }
}
