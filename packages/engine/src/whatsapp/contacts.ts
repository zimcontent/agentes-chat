import { bareJid, type WhatsAppMessage } from "@dougbot/adapters";
import { and, desc, eq, gt, lt, schema, sql } from "@dougbot/db";
import type { ArtifactDeps } from "../artifacts";
import { recordAudit } from "../audit";
import { openPersonAgentDm } from "../dms";
import { ForbiddenError, NotFoundError, ValidationError } from "../errors";
import { can, getMembership } from "../organizations";
import {
  accountToken,
  publishWhatsAppChanged,
  requireWhatsAppUse,
  type WhatsAppAccountRow,
  type WhatsAppDeps,
  whatsappGateway,
} from "./accounts";
import { keepWhatsAppFile, sendWhatsAppArtifact, WHATSAPP_CAPTION_MAX, WHATSAPP_FILE_KINDS } from "./files";
import { storeWhatsAppMessage } from "./inbound";
import { sendVoiceNote, speaksNow } from "./voice-notes";

/**
 * Who a WhatsApp contact is (docs/adr/doug-0004-whatsapp-bridge.md, addendum 2026-11-15). The number's agent is one
 * person who knows the whole operation; what it says depends on who asks:
 *
 * - A member of the workspace: their messages go to their own conversation with the agent, as if written there, and
 *   the agent answers with everything it has (its tools, under that person's rights). What it says in that turn goes
 *   back to WhatsApp (`mirrorAgentReply`).
 * - A client of the approval portal: each answer reads that client's own work, read here by code (`clientWorkFor`),
 *   never anyone else's.
 * - Anyone else: the answers know what is public about the business and nothing internal.
 */

type ChatRow = typeof schema.whatsappChats.$inferSelect;

/** A portal client's name as the board keys it (`lexeer`, `fontes`). */
const CLIENT = /^[a-z0-9][a-z0-9_-]{0,59}$/;

/** How long after a member wrote from WhatsApp their agent's answers in that conversation go back there. */
export const WHATSAPP_MIRROR_MS = 2 * 60 * 60_000;

/** The portal's clients this workspace has work for, from its tasks (`approval-portal-tasks.ts`). */
export async function whatsappPortalClients(deps: Pick<WhatsAppDeps, "db">, orgId: string): Promise<string[]> {
  const rows = await deps.db
    .selectDistinct({ client: sql<string>`${schema.issues.source}->>'client'` })
    .from(schema.issues)
    .where(and(eq(schema.issues.orgId, orgId), sql`${schema.issues.source}->>'type' = 'portal'`));
  return rows
    .map((r) => r.client)
    .filter((c): c is string => typeof c === "string" && CLIENT.test(c))
    .sort();
}

/**
 * `PUT …/chats/{chatId}/contact`: who the contact is. A member is set only by that member or by someone who manages
 * the workspace's members (it lets that phone speak as them); a client by any of the number's people. One or the
 * other. Audited.
 */
export async function setWhatsAppContact(
  deps: WhatsAppDeps,
  userId: string,
  orgId: string,
  accountId: string,
  chatId: string,
  input: { member?: string | null; client?: string | null },
) {
  const account = await requireWhatsAppUse(deps.db, userId, orgId, accountId);
  const chats = schema.whatsappChats;
  const [chat] = await deps.db
    .select()
    .from(chats)
    .where(and(eq(chats.accountId, accountId), eq(chats.id, chatId)));
  if (!chat) throw new NotFoundError("Conversation not found");
  if (chat.group) throw new ValidationError("A group is no one person");
  const member = input.member ?? null;
  const client = member ? null : (input.client ?? null);
  if (member !== null) {
    const them = await getMembership(deps.db, member, orgId);
    if (!them) throw new ValidationError("Choose a member of this workspace", "whatsapp.not_member");
    if (member !== userId) {
      const me = await getMembership(deps.db, userId, orgId);
      if (!can(me, "manage_members")) {
        throw new ForbiddenError("Only that person, or someone who manages members, says a contact is them");
      }
    }
  }
  if (client !== null) {
    if (!CLIENT.test(client) || !(await whatsappPortalClients(deps, orgId)).includes(client)) {
      throw new ValidationError("Choose one of the portal's clients", "whatsapp.not_client");
    }
  }
  await deps.db.update(chats).set({ memberUserId: member, portalClient: client }).where(eq(chats.id, chat.id));
  await recordAudit(deps.db, {
    orgId,
    actor: { type: "person", id: userId },
    action: "whatsapp.contact_set",
    target: { type: "whatsapp_chat", id: chat.id },
    details: {
      accountId,
      from: { member: chat.memberUserId, client: chat.portalClient },
      to: { member, client },
    },
  });
  await publishWhatsAppChanged(deps, account, { chatId: chat.id, also: [userId] });
  return { member, client };
}

/** A card's stage as a client reads it. */
const STAGE: Record<string, string> = {
  todo: "na fila de produção",
  doing: "em produção",
  approval: "esperando a aprovação do cliente",
  adjusting: "em ajuste",
  approved: "aprovado",
  scheduled: "agendado",
  posted: "publicado",
};
const KIND: Record<string, string> = { reel: "reel", carousel: "carrossel", image: "post", story: "story" };
/** Work done or canceled stays in the list this long: "and the one from last week?" */
const RECENT_DAYS = 14;
const CLIENT_WORK_ITEMS = 40;

/**
 * A portal client's own work, for the answers to them: each post's title, kind, stage and production day, from the
 * workspace's tasks. Nothing of who works on it, nothing of other clients. Empty when there is none.
 */
export async function clientWorkFor(deps: Pick<WhatsAppDeps, "db">, orgId: string, client: string, now = new Date()) {
  const { issues } = schema;
  const since = new Date(now.getTime() - RECENT_DAYS * 86_400_000);
  const rows = await deps.db
    .select({ title: issues.title, status: issues.status, due: issues.dueDate, source: issues.source })
    .from(issues)
    .where(
      and(
        eq(issues.orgId, orgId),
        sql`${issues.source}->>'type' = 'portal'`,
        sql`${issues.source}->>'client' = ${client}`,
        sql`(${issues.status} not in ('done', 'canceled') or ${issues.updatedAt} > ${since})`,
      ),
    )
    .orderBy(sql`${issues.dueDate} asc nulls last`, desc(issues.updatedAt))
    .limit(CLIENT_WORK_ITEMS);
  return rows
    .map((row) => {
      const card = (row.source as { synced?: { card?: { stage?: string; kind?: string } } } | null)?.synced?.card;
      const stage = row.status === "canceled" ? "cancelado" : (STAGE[card?.stage ?? ""] ?? row.status);
      const kind = KIND[card?.kind ?? ""] ?? card?.kind ?? "";
      const due = row.due ? `, produção prevista para ${row.due}` : "";
      return `- ${row.title.replace(/\s+/g, " ").trim().slice(0, 160)}${kind ? ` (${kind})` : ""}: ${stage}${due}`;
    })
    .join("\n");
}

/** The latest messages a member sent from WhatsApp since the number last wrote, oldest first. */
async function unanswered(deps: Pick<WhatsAppDeps, "db">, chat: ChatRow) {
  const messages = schema.whatsappMessages;
  const [lastOut] = await deps.db
    .select({ at: messages.at })
    .from(messages)
    .where(and(eq(messages.chatId, chat.id), eq(messages.fromMe, true)))
    .orderBy(desc(messages.at))
    .limit(1);
  const rows = await deps.db
    .select()
    .from(messages)
    .where(
      and(eq(messages.chatId, chat.id), eq(messages.fromMe, false), lastOut ? gt(messages.at, lastOut.at) : undefined),
    )
    .orderBy(desc(messages.at))
    .limit(10);
  return rows.reverse();
}

/** How a file reads in the member's conversation with the agent, beside the file itself. */
const FILE_WORD: Record<string, string> = {
  image: "foto",
  sticker: "figurinha",
  video: "vídeo",
  audio: "áudio",
  document: "documento",
};
const hasFile = (kind: string) => (WHATSAPP_FILE_KINDS as readonly string[]).includes(kind);

/**
 * One message as it reads in the member's conversation with the agent: a text as written; a file as its kind and
 * its words (a caption, a voice message heard by `whatsapp/transcribe.ts`), the file itself attached beside it.
 */
export function relayLine(m: { kind: string; body: string }, attached: boolean) {
  const words = m.body.trim();
  if (m.kind === "text") return words;
  const word = FILE_WORD[m.kind];
  if (!word) return `[${m.kind}]${words ? ` ${words}` : ""}`;
  const mark = attached || m.kind === "audio" ? `(${word})` : `(${word} que não pôde ser aberto aqui)`;
  return words ? `${mark} ${words}` : mark;
}

/**
 * A member wrote from WhatsApp: what they wrote goes to their own conversation with the number's agent, as theirs, and
 * the agent answers there as it does any message of theirs. Every file they sent goes with it as a Drive file of
 * theirs (`keepWhatsAppFile`), which the agent opens as any file in the app: a picture seen, a voice message or a
 * video's sound heard, a document read. `post` is `postPersonMessage` (kept out of this module's imports). Null:
 * nothing to relay.
 */
export async function relayToMember(
  deps: WhatsAppDeps & { artifacts?: ArtifactDeps },
  account: WhatsAppAccountRow,
  chat: ChatRow,
  post: (
    userId: string,
    orgId: string,
    channelId: string,
    input: { body: string; meta: Record<string, unknown>; attachments?: string[] },
  ) => Promise<unknown>,
) {
  if (!chat.memberUserId || !account.agentId) return null;
  const rows = await unanswered(deps, chat);
  if (rows.length === 0) return null;
  const dm = await openPersonAgentDm(deps.db, account.orgId, chat.memberUserId, account.agentId);
  const attachments: string[] = [];
  const said: string[] = [];
  for (const row of rows) {
    const kept =
      hasFile(row.kind) && attachments.length < MAX_RELAY_FILES
        ? await keepWhatsAppFile(deps, account, row, { userId: chat.memberUserId, channelId: dm.id })
        : null;
    if (kept && !attachments.includes(kept)) attachments.push(kept);
    const line = relayLine(row, kept !== null);
    if (line) said.push(line);
  }
  if (said.length === 0 && attachments.length === 0) return null;
  // They spoke: the agent's answer goes back as a voice note when it is short and sayable (`whatsapp/voice-notes.ts`).
  const spoke = rows.some((m) => m.kind === "audio");
  await post(chat.memberUserId, account.orgId, dm.id, {
    body: said.join("\n"),
    meta: { whatsapp: { accountId: account.id, chatId: chat.id, ...(spoke ? { voice: true } : {}) } },
    ...(attachments.length > 0 ? { attachments } : {}),
  });
  return dm.id;
}

/** The most files one relayed message carries (a message takes ten). */
const MAX_RELAY_FILES = 10;

/** WhatsApp's own marks for what Markdown says: bold is one asterisk, a heading a bold line, no links' brackets. */
export function whatsappText(markdown: string) {
  return markdown
    .replace(/\*\*(.+?)\*\*/g, "*$1*")
    .replace(/__(.+?)__/g, "_$1_")
    .replace(/^#{1,6}\s+(.+)$/gm, "*$1*")
    .replace(/\[([^\]]+)\]\((https?:[^)\s]+)\)/g, "$1 ($2)")
    .trim();
}

const PIECE = 4000;
/** A long answer in pieces WhatsApp takes (4096 at most), cut at a paragraph or a line where it can. */
export function whatsappPieces(text: string): string[] {
  const out: string[] = [];
  let rest = text;
  while (rest.length > PIECE) {
    const cut = Math.max(rest.lastIndexOf("\n\n", PIECE), rest.lastIndexOf("\n", PIECE));
    const at = cut > PIECE / 2 ? cut : PIECE;
    out.push(rest.slice(0, at).trim());
    rest = rest.slice(at).trim();
  }
  if (rest) out.push(rest);
  return out;
}

/**
 * An agent spoke in a person's conversation with it: when that person's latest message there came from WhatsApp in the
 * last `WHATSAPP_MIRROR_MS`, the agent's words go back to that conversation on WhatsApp, as the number, stored as the
 * agent's. Anything the person writes in the app afterwards keeps the answers in the app. Returns how many went.
 */
export async function mirrorAgentReply(
  deps: WhatsAppDeps & { artifacts?: ArtifactDeps },
  message: Pick<
    typeof schema.messages.$inferSelect,
    "id" | "orgId" | "channelId" | "threadId" | "authorType" | "authorAgentId" | "body" | "createdAt"
  > &
    Partial<Pick<typeof schema.messages.$inferSelect, "meta">>,
  now = new Date(),
) {
  // The files the agent attached go too (docs/adr/doug-0034-whatsapp-files.md): a picture, a video, an audio, a document.
  const files = filesOf(message.meta);
  if (message.authorType !== "agent" || !message.authorAgentId || message.threadId) return 0;
  if (!message.body.trim() && files.length === 0) return 0;
  const { messages } = schema;
  const [asked] = await deps.db
    .select({ meta: messages.meta, at: messages.createdAt, userId: messages.authorUserId })
    .from(messages)
    .where(
      and(
        eq(messages.orgId, message.orgId),
        eq(messages.channelId, message.channelId),
        eq(messages.authorType, "person"),
        sql`${messages.threadId} is null`,
        lt(messages.createdAt, message.createdAt),
        gt(messages.createdAt, new Date(now.getTime() - WHATSAPP_MIRROR_MS)),
      ),
    )
    .orderBy(desc(messages.createdAt))
    .limit(1);
  const from = (asked?.meta as { whatsapp?: { accountId?: unknown; chatId?: unknown; voice?: unknown } } | undefined)
    ?.whatsapp;
  if (!asked || typeof from?.accountId !== "string" || typeof from.chatId !== "string") return 0;
  const [account] = await deps.db
    .select()
    .from(schema.whatsappAccounts)
    .where(and(eq(schema.whatsappAccounts.orgId, message.orgId), eq(schema.whatsappAccounts.id, from.accountId)));
  const [chat] = await deps.db
    .select()
    .from(schema.whatsappChats)
    .where(and(eq(schema.whatsappChats.accountId, from.accountId), eq(schema.whatsappChats.id, from.chatId)));
  // Only while the contact is still that person and the number's agent is still this one.
  if (
    !account ||
    !chat ||
    account.status !== "connected" ||
    account.agentId !== message.authorAgentId ||
    !asked.userId ||
    chat.memberUserId !== asked.userId
  ) {
    return 0;
  }
  // They asked by voice: a short, sayable answer goes back as a voice note; a voice that fails is written.
  const said = whatsappText(message.body);
  if (
    files.length === 0 &&
    from.voice === true &&
    (await speaksNow(deps, account, chat.id, { text: said, wanted: false })) &&
    (await sendVoiceNote(deps, account, chat, message.authorAgentId, said).then(
      () => true,
      () => false,
    ))
  ) {
    await publishWhatsAppChanged(deps, account, { chatId: chat.id });
    return 1;
  }
  let sent = 0;
  // One file and a short text: the text is its caption, as a person sends a picture with a line. Else the words first.
  let caption = files.length === 1 && said && said.length <= WHATSAPP_CAPTION_MAX ? said : "";
  if (caption) {
    const out = await sendWhatsAppArtifact(
      deps,
      account,
      chat,
      { artifactId: files[0] as string, actor: { type: "person", userId: asked.userId }, caption },
      { agentId: message.authorAgentId },
    ).catch(() => null);
    if (out) {
      sent++;
      // A voice message takes no caption: its words go after it.
      if (out.kind !== "audio") {
        await publishWhatsAppChanged(deps, account, { chatId: chat.id });
        return sent;
      }
    } else caption = "";
  }
  const gateway = whatsappGateway(deps);
  const token = await accountToken(deps, account);
  for (const text of said ? whatsappPieces(said) : []) {
    const out = await gateway.sendText(token, { to: chat.jid, text });
    const stored: WhatsAppMessage = {
      id: out.id,
      chat: bareJid(chat.jid),
      sender: account.jid ?? "",
      senderName: account.pushName,
      fromMe: true,
      group: false,
      groupName: "",
      at: out.at,
      kind: "text",
      text,
      replyTo: null,
      media: null,
      raw: null,
    };
    const kept = await storeWhatsAppMessage(deps.db, account, stored, { agentId: message.authorAgentId });
    if (!kept.fresh) {
      await deps.db
        .update(schema.whatsappMessages)
        .set({ sentByAgentId: message.authorAgentId })
        .where(and(eq(schema.whatsappMessages.accountId, account.id), eq(schema.whatsappMessages.waId, out.id)));
      // The gateway's own event came first and read as a person writing from the phone, which quiets the agent.
      await deps.db
        .update(schema.whatsappChats)
        .set({ personAt: chat.personAt })
        .where(eq(schema.whatsappChats.id, chat.id));
    }
    sent++;
  }
  // The files after the words (or the one whose caption didn't go): each as WhatsApp shows its type. One that can't go
  // (too large, gone, refused) is said in a line, so the person knows to look in the app.
  for (const artifactId of caption ? [] : files) {
    const out = await sendWhatsAppArtifact(
      deps,
      account,
      chat,
      { artifactId, actor: { type: "person", userId: asked.userId } },
      { agentId: message.authorAgentId },
    ).catch(() => null);
    if (out) sent++;
    else {
      const title = files.length > 1 ? "Um dos arquivos" : "O arquivo";
      const text = `${title} não pôde ir por aqui: está na nossa conversa no app.`;
      await gateway
        .sendText(token, { to: chat.jid, text })
        .then((note) =>
          storeWhatsAppMessage(
            deps.db,
            account,
            {
              id: note.id,
              chat: bareJid(chat.jid),
              sender: account.jid ?? "",
              senderName: account.pushName,
              fromMe: true,
              group: false,
              groupName: "",
              at: note.at,
              kind: "text",
              text,
              replyTo: null,
              media: null,
              raw: null,
            },
            { agentId: message.authorAgentId as string },
          ),
        )
        .catch(() => null);
    }
  }
  await publishWhatsAppChanged(deps, account, { chatId: chat.id });
  return sent;
}

/** The ids of the files on a message (`meta.artifacts`), in order. */
function filesOf(meta: unknown): string[] {
  const list = (meta as { artifacts?: unknown } | null | undefined)?.artifacts;
  if (!Array.isArray(list)) return [];
  return list.flatMap((f) => (f && typeof (f as { id?: unknown }).id === "string" ? [(f as { id: string }).id] : []));
}
