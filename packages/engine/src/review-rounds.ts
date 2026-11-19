import { bareJid, isGroupJid, type PortalItem, type WhatsAppMessage } from "@dougbot/adapters";
import { and, asc, type Database, desc, eq, inArray, isNull, schema, sql } from "@dougbot/db";
import type { DesignDelivery } from "./design-delivery";
import { NotFoundError, ValidationError } from "./errors";
import { requirePermission } from "./organizations";
import { enqueue } from "./outbox";
import { timecode } from "./video-reviews";
import { accountToken, type WhatsAppDeps, whatsappGateway } from "./whatsapp/accounts";
import { whatsappText } from "./whatsapp/contacts";
import { storeWhatsAppMessage } from "./whatsapp/inbound";

const {
  issues,
  organizationMembers,
  reviewWhatsapp,
  users,
  videoReviewNotes,
  videoReviewRounds,
  videoReviews,
  whatsappAccounts,
  whatsappChats,
} = schema;
type ReviewRow = typeof videoReviews.$inferSelect;
type RoundRow = typeof videoReviewRounds.$inferSelect;

/*
 * Rounds of changes asked of the person who sent work for review (docs/adr/doug-0012-editor-delivery.md §10–§12): a
 * round opens when the team asks for changes or the client asks at the portal, is seen when that person opens the
 * review, and is answered by their next version. Each is a row, the log the team reads of how the work goes. The
 * person is told in the app (the decision names them) and, when the team set one, in a WhatsApp conversation of a
 * number the workspace has: a line written here, never by a model. Nothing in it is about video: any person who sends
 * work for review gets the same.
 */

export const ROUND_NOTIFY_JOB = "review_round.notify";

export interface ReviewRoundView {
  id: string;
  version: number;
  askedBy: string;
  fromClient: boolean;
  notes: number;
  askedAt: string;
  /** Told beyond the app: where and when, or why it couldn't be. */
  notified: { whatsapp?: { at: string; chat: string }; error?: string; none?: boolean } | null;
  seenAt: string | null;
  answeredAt: string | null;
  answeredVersion: number | null;
}

const view = (r: RoundRow): ReviewRoundView => ({
  id: r.id,
  version: r.version,
  askedBy: r.askedByName,
  fromClient: r.fromClient,
  notes: r.notes,
  askedAt: r.askedAt.toISOString(),
  notified: (r.notified as ReviewRoundView["notified"]) ?? null,
  seenAt: r.seenAt?.toISOString() ?? null,
  answeredAt: r.answeredAt?.toISOString() ?? null,
  answeredVersion: r.answeredVersion,
});

/** A review's rounds, oldest first. */
export async function roundsOf(db: Database, reviewId: string): Promise<ReviewRoundView[]> {
  const rows = await db
    .select()
    .from(videoReviewRounds)
    .where(eq(videoReviewRounds.reviewId, reviewId))
    .orderBy(asc(videoReviewRounds.askedAt));
  return rows.map(view);
}

/** The newest round of each review, for the lists. */
export async function latestRounds(db: Database, reviewIds: string[]): Promise<Map<string, ReviewRoundView>> {
  if (reviewIds.length === 0) return new Map();
  const rows = await db
    .select()
    .from(videoReviewRounds)
    .where(inArray(videoReviewRounds.reviewId, reviewIds))
    .orderBy(desc(videoReviewRounds.askedAt));
  const out = new Map<string, ReviewRoundView>();
  for (const r of rows) if (!out.has(r.reviewId)) out.set(r.reviewId, view(r));
  return out;
}

/** Opens a round for the review's sender and asks for them to be told. Nothing for a review an agent sent. */
export async function openRound(
  db: Database,
  review: Pick<ReviewRow, "id" | "orgId" | "senderUserId" | "version">,
  input: { askedByUserId: string | null; askedByName: string; fromClient: boolean; notes: number },
) {
  if (!review.senderUserId) return null;
  const [row] = await db
    .insert(videoReviewRounds)
    .values({
      orgId: review.orgId,
      reviewId: review.id,
      version: review.version,
      forUserId: review.senderUserId,
      askedByUserId: input.askedByUserId,
      askedByName: input.askedByName.slice(0, 120),
      fromClient: input.fromClient,
      notes: input.notes,
    })
    .returning({ id: videoReviewRounds.id });
  if (row)
    await enqueue(db, { orgId: review.orgId, kind: ROUND_NOTIFY_JOB, payload: { roundId: row.id }, maxAttempts: 4 });
  return row?.id ?? null;
}

/** The sender sent the next version: every open round of the review is answered by it. */
export async function answerRounds(db: Database, reviewId: string, version: number) {
  await db
    .update(videoReviewRounds)
    .set({ answeredAt: new Date(), answeredVersion: version })
    .where(and(eq(videoReviewRounds.reviewId, reviewId), isNull(videoReviewRounds.answeredAt)));
}

/** The person a round is for opened the review: the first time is kept. */
export async function seeRounds(db: Database, reviewId: string, userId: string) {
  await db
    .update(videoReviewRounds)
    .set({ seenAt: new Date() })
    .where(
      and(
        eq(videoReviewRounds.reviewId, reviewId),
        eq(videoReviewRounds.forUserId, userId),
        isNull(videoReviewRounds.seenAt),
      ),
    );
}

// ---------- where a person is told ----------

export interface ReviewWhatsAppTarget {
  userId: string;
  accountId: string;
  accountLabel: string;
  chatId: string;
  chatName: string;
}

/** Every person's WhatsApp conversation for the changes asked of them, in this workspace. */
export async function reviewWhatsAppTargets(db: Database, orgId: string): Promise<ReviewWhatsAppTarget[]> {
  const rows = await db
    .select({
      userId: reviewWhatsapp.userId,
      accountId: reviewWhatsapp.accountId,
      accountLabel: whatsappAccounts.label,
      chatId: reviewWhatsapp.chatId,
      chatName: whatsappChats.name,
      jid: whatsappChats.jid,
    })
    .from(reviewWhatsapp)
    .innerJoin(whatsappAccounts, eq(whatsappAccounts.id, reviewWhatsapp.accountId))
    .innerJoin(whatsappChats, eq(whatsappChats.id, reviewWhatsapp.chatId))
    .where(eq(reviewWhatsapp.orgId, orgId));
  return rows.map(({ jid, ...r }) => ({ ...r, chatName: r.chatName || bareJid(jid) }));
}

/**
 * Where a member is told of the changes asked of them: a conversation (a group, or a person) of one of the workspace's
 * WhatsApp numbers; null takes it away. Whoever may give work sets it.
 */
export async function setReviewWhatsApp(
  db: Database,
  actorId: string,
  orgId: string,
  userId: string,
  target: { accountId: string; chatId: string } | null,
) {
  await requirePermission(db, actorId, orgId, "assign_work");
  const [member] = await db
    .select({ userId: organizationMembers.userId })
    .from(organizationMembers)
    .where(and(eq(organizationMembers.orgId, orgId), eq(organizationMembers.userId, userId)));
  if (!member) throw new NotFoundError("No such member");
  if (!target) {
    await db.delete(reviewWhatsapp).where(and(eq(reviewWhatsapp.orgId, orgId), eq(reviewWhatsapp.userId, userId)));
    return null;
  }
  const [chat] = await db
    .select({ id: whatsappChats.id })
    .from(whatsappChats)
    .innerJoin(whatsappAccounts, eq(whatsappAccounts.id, whatsappChats.accountId))
    .where(
      and(
        eq(whatsappAccounts.orgId, orgId),
        eq(whatsappAccounts.id, target.accountId),
        eq(whatsappChats.id, target.chatId),
      ),
    );
  if (!chat)
    throw new ValidationError("That conversation isn't one of this workspace's numbers", "review.bad_whatsapp");
  await db
    .insert(reviewWhatsapp)
    .values({ orgId, userId, accountId: target.accountId, chatId: target.chatId, updatedBy: actorId })
    .onConflictDoUpdate({
      target: [reviewWhatsapp.orgId, reviewWhatsapp.userId],
      set: { accountId: target.accountId, chatId: target.chatId, updatedBy: actorId, updatedAt: new Date() },
    });
  return (await reviewWhatsAppTargets(db, orgId)).find((t) => t.userId === userId) ?? null;
}

/** What the WhatsApp line says, written here: who asked, what, and the two links. */
export function roundMessage(input: {
  name: string;
  title: string;
  version: number;
  askedBy: string;
  fromClient: boolean;
  client: string;
  notes: { atMs: number | null; body: string }[];
  reviewLink: string;
  taskLink: string | null;
}) {
  const first = input.name.split(" ")[0] || input.name;
  const lines = [
    input.fromClient
      ? `Olá, ${first}! O cliente${input.client ? ` ${input.client}` : ""} pediu um ajuste em *${input.title}* (V${input.version}).`
      : `Olá, ${first}! Chegou um novo ajuste para você em *${input.title}* (V${input.version}), pedido por ${input.askedBy}.`,
  ];
  const shown = input.notes.slice(0, 8);
  if (shown.length > 0) {
    lines.push("");
    for (const n of shown) {
      const body = n.body.replace(/\s+/g, " ").trim().slice(0, 240);
      lines.push(`• ${n.atMs === null ? "" : `[${timecode(n.atMs)}] `}${body}`);
    }
    if (input.notes.length > shown.length) lines.push(`• e mais ${input.notes.length - shown.length} no player`);
  }
  lines.push("", `Ver as notas no player: ${input.reviewLink}`);
  if (input.taskLink) {
    lines.push(
      input.fromClient
        ? `Quando terminar, mande a V${input.version + 1} na tarefa (Enviar vídeo), ela vai direto para o cliente: ${input.taskLink}`
        : `Quando terminar, mande a V${input.version + 1} na tarefa (Enviar vídeo): ${input.taskLink}`,
    );
  }
  return whatsappText(lines.join("\n"));
}

/**
 * Job `review_round.notify`: the round's person is told in their WhatsApp conversation, from the number the team
 * chose, as that number's agent. What happened is kept on the round (the log shows it).
 */
export async function notifyRound(
  deps: { db: Database; publicUrl: string; whatsapp?: Pick<WhatsAppDeps, "db" | "gateway" | "keyWrappers"> | null },
  roundId: string,
  options: { finalAttempt: boolean },
) {
  const { db } = deps;
  const [round] = await db.select().from(videoReviewRounds).where(eq(videoReviewRounds.id, roundId));
  if (!round || round.notified || !round.forUserId) return;
  const settle = (notified: Record<string, unknown>) =>
    db.update(videoReviewRounds).set({ notified }).where(eq(videoReviewRounds.id, round.id));
  const [target] = await db
    .select()
    .from(reviewWhatsapp)
    .where(and(eq(reviewWhatsapp.orgId, round.orgId), eq(reviewWhatsapp.userId, round.forUserId)));
  if (!target || !deps.whatsapp?.gateway) {
    await settle({ none: true });
    return;
  }
  const [review] = await db.select().from(videoReviews).where(eq(videoReviews.id, round.reviewId));
  const [account] = await db.select().from(whatsappAccounts).where(eq(whatsappAccounts.id, target.accountId));
  const [chat] = await db.select().from(whatsappChats).where(eq(whatsappChats.id, target.chatId));
  const [person] = await db.select({ name: users.name }).from(users).where(eq(users.id, round.forUserId));
  if (!review || !account || !chat) {
    await settle({ error: "a conversa do WhatsApp não existe mais" });
    return;
  }
  if (account.status !== "connected") {
    if (options.finalAttempt) await settle({ error: "o número do WhatsApp está desconectado" });
    throw new Error("the WhatsApp number is not connected");
  }
  const notes = await db
    .select({ atMs: videoReviewNotes.atMs, body: videoReviewNotes.body })
    .from(videoReviewNotes)
    .where(and(eq(videoReviewNotes.reviewId, review.id), eq(videoReviewNotes.version, round.version)))
    .orderBy(sql`${videoReviewNotes.atMs} asc nulls first`, asc(videoReviewNotes.createdAt));
  const [task] = review.taskId
    ? await db.select({ number: issues.number }).from(issues).where(eq(issues.id, review.taskId))
    : [];
  const base = deps.publicUrl.replace(/\/+$/, "");
  const text = roundMessage({
    name: person?.name ?? "",
    title: review.title,
    version: round.version,
    askedBy: round.askedByName,
    fromClient: round.fromClient,
    client: review.client,
    notes,
    reviewLink: `${base}/org/${review.orgId}/review/${review.id}`,
    taskLink: task ? `${base}/org/${review.orgId}/issues/${task.number}` : null,
  });
  try {
    const gateway = whatsappGateway(deps.whatsapp as WhatsAppDeps);
    const sent = await gateway.sendText(await accountToken(deps.whatsapp as WhatsAppDeps, account), {
      to: chat.jid,
      text,
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
      kind: "text",
      text,
      replyTo: null,
      media: null,
      raw: null,
    };
    await storeWhatsAppMessage(db, account, message, { agentId: account.agentId });
    await settle({ whatsapp: { at: new Date().toISOString(), chat: chat.name || bareJid(chat.jid) } });
  } catch (error) {
    if (options.finalAttempt) {
      await settle({ error: error instanceof Error ? error.message.slice(0, 200) : String(error) });
    }
    throw error;
  }
}

// ---------- the client's notes from the portal ----------

/**
 * What the client wrote at the portal on an editor's post comes into its review as notes on the version they saw, at
 * the second or the spot they marked (each brought once). When the client asked for a change and the review isn't
 * already waiting on one, it turns to "changes" and a round opens for the editor, who is told like for the team's.
 * The client's words are outside text: they are notes for people, never a prompt.
 */
export async function bringClientNotes(db: Database, orgId: string, items: PortalItem[]) {
  const reviews = await db
    .select()
    .from(videoReviews)
    .where(
      and(
        eq(videoReviews.orgId, orgId),
        sql`${videoReviews.senderUserId} is not null`,
        sql`${videoReviews.delivery}->>'item' is not null`,
      ),
    );
  let brought = 0;
  for (const review of reviews) {
    const delivery = (review.delivery ?? null) as DesignDelivery | null;
    const item = items.find((i) => i.id === delivery?.item && i.client === review.portalClient);
    if (!item?.clientNotes?.length) continue;
    const map = review.portalVersions ?? {};
    const ourVersion = (v: number) => map[String(v)] ?? review.version;
    const fresh = [];
    for (const n of item.clientNotes) {
      const [row] = await db
        .insert(videoReviewNotes)
        .values({
          orgId,
          reviewId: review.id,
          version: Math.min(ourVersion(n.version), review.version),
          atMs: n.atSeconds === null ? null : Math.max(0, Math.round(n.atSeconds * 1000)),
          page: n.page,
          x: n.x,
          y: n.x === null ? null : n.y,
          body: n.text,
          attachments: n.files
            .slice(0, 8)
            .map((url, i) => ({ type: "link" as const, url, label: `Anexo do cliente ${i + 1}` })),
          authorName:
            `Cliente${review.client ? ` (${review.client})` : ""}${n.by && n.by !== review.client ? ` · ${n.by}` : ""}`.slice(
              0,
              120,
            ),
          externalId: `portal:${n.id}`,
          fromClient: true,
          // Read only, like a note already sent: it isn't the team's to take back.
          sentAt: new Date(),
        })
        .onConflictDoNothing({ target: [videoReviewNotes.reviewId, videoReviewNotes.externalId] })
        .returning({ id: videoReviewNotes.id, version: videoReviewNotes.version });
      if (row) fresh.push(row);
    }
    if (fresh.length === 0) continue;
    brought += fresh.length;
    // A change asked: the editor has a round, and the review waits on them.
    if (item.status === "adjust_requested" || item.status === "adjusting") {
      const onLatest = fresh.filter((f) => f.version === review.version).length;
      if (onLatest === 0) continue;
      await db
        .update(videoReviews)
        .set({ status: "changes", decidedBy: null, decidedAt: new Date(), updatedAt: new Date() })
        .where(eq(videoReviews.id, review.id));
      await openRound(db, review, {
        askedByUserId: null,
        askedByName: `Cliente${review.client ? ` (${review.client})` : ""}`,
        fromClient: true,
        notes: onLatest,
      });
    }
  }
  return brought;
}
