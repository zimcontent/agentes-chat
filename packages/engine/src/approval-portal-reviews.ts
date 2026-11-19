import type { PortalCard } from "@dougbot/adapters";
import { and, type Database, eq, inArray, schema, sql } from "@dougbot/db";

const { issues, videoReviews } = schema;

/**
 * The team's own review of a card's post (ADR 9001, addendum 2026-11-18): until the post goes up to the client, what
 * the team decided in Review is the card's latest news, so the schedule, the board and each person's work say it.
 * Read from the reviews, never typed on the card: a review that is approved makes its card read "approved by the team"
 * with nobody moving a thing, and the send from the card then ties the post back to the review.
 */
export type CardReviewStatus = "in_review" | "changes" | "approved";

export interface CardReview {
  /** `in_review`: the team still has to look; `changes`: the team asked for some; `approved`: ready to go up. */
  status: CardReviewStatus;
  /** The review to open: the one still waiting, else the newest approved. */
  reviewId: string;
  /** Of the card's pieces in Review that are not with the client yet, how many the team approved. */
  approved: number;
  total: number;
}

/** A delivery that has the post at the portal or on its way there: the review is the client's from then on. */
const AT_PORTAL = sql`coalesce(${videoReviews.delivery}->>'state', '') not in ('', 'failed')`;

/**
 * Each card's review, by card id, for a workspace's reviews not yet with the client. A review belongs to a card by its
 * own `portal_card`, else through the task it was sent from (`task_id`) or whose conversation it came from (the task's
 * room or its thread), which is how an agent's review is tied to a post (doug-0019 §4). A card already sent (`item`)
 * or finished outside the portal has no review here: the portal's stage is the news then.
 */
export async function cardReviews(
  db: Database,
  orgId: string,
  cards: Pick<PortalCard, "id" | "item" | "done" | "material">[],
): Promise<Map<string, CardReview>> {
  const open = new Set(cards.filter((c) => !c.item && !c.done && !c.material).map((c) => c.id));
  const found = new Map<string, CardReview>();
  if (open.size === 0) return found;
  const rows = await db
    .select({
      id: videoReviews.id,
      status: videoReviews.status,
      updatedAt: videoReviews.updatedAt,
      card: videoReviews.portalCard,
      taskCard: sql<string | null>`${issues.source}->>'cardId'`,
    })
    .from(videoReviews)
    .leftJoin(
      issues,
      and(
        eq(issues.orgId, videoReviews.orgId),
        sql`${issues.source}->>'type' = 'portal'`,
        sql`(${issues.id} = ${videoReviews.taskId}
          or (${videoReviews.taskId} is null and (
            ${issues.conversationChannelId} = ${videoReviews.channelId}
            or (${issues.threadChannelId} = ${videoReviews.channelId} and ${issues.threadRootId} = ${videoReviews.threadId}))))`,
      ),
    )
    .where(
      and(
        eq(videoReviews.orgId, orgId),
        inArray(videoReviews.status, ["in_review", "changes", "approved"]),
        sql`not (${AT_PORTAL})`,
      ),
    );
  const byCard = new Map<string, typeof rows>();
  const seen = new Set<string>();
  for (const row of rows) {
    // A review the join found twice (a task's room and its thread): counted once.
    if (seen.has(row.id)) continue;
    seen.add(row.id);
    const card = row.card ?? row.taskCard;
    if (!card || !open.has(card)) continue;
    byCard.set(card, [...(byCard.get(card) ?? []), row]);
  }
  const newest = (a: { updatedAt: Date }, b: { updatedAt: Date }) => b.updatedAt.getTime() - a.updatedAt.getTime();
  for (const [card, list] of byCard) {
    list.sort(newest);
    const waiting = list.find((r) => r.status === "in_review");
    const sentBack = list.find((r) => r.status === "changes");
    const approved = list.filter((r) => r.status === "approved");
    // The card is ready only once every piece of it is: one still in Review or sent back holds it.
    const status: CardReviewStatus = waiting ? "in_review" : sentBack ? "changes" : "approved";
    const open = waiting ?? sentBack ?? approved[0];
    if (!open) continue;
    found.set(card, { status, reviewId: open.id, approved: approved.length, total: list.length });
  }
  return found;
}

/**
 * The reviews of the cards that went up since (ADR 9001, addendum 2026-11-18): a person who sent a card the team
 * approved from the schedule or the board sent its approved files, so the approved review is the post's now, as if
 * Review had sent it. It is marked sent with the post, which is what a change the client asks for and the final are
 * read from (doug-0012). Only the card's own review, approved and with no delivery of its own, is marked.
 */
export async function tieSentCards(
  db: Database,
  orgId: string,
  cards: Pick<PortalCard, "id" | "item" | "task">[],
): Promise<number> {
  const sent = cards.filter((c) => c.item);
  if (sent.length === 0) return 0;
  const rows = await db
    .select({ id: videoReviews.id, card: videoReviews.portalCard, taskId: videoReviews.taskId })
    .from(videoReviews)
    .where(
      and(
        eq(videoReviews.orgId, orgId),
        eq(videoReviews.status, "approved"),
        sql`${videoReviews.delivery} is null`,
        inArray(
          videoReviews.portalCard,
          sent.map((c) => c.id),
        ),
      ),
    );
  let tied = 0;
  const at = new Date().toISOString();
  for (const row of rows) {
    const card = sent.find((c) => c.id === row.card);
    if (!card?.item) continue;
    const [done] = await db
      .update(videoReviews)
      .set({ delivery: { state: "sent", item: card.item, at, by: "card" } })
      .where(and(eq(videoReviews.id, row.id), sql`${videoReviews.delivery} is null`))
      .returning({ id: videoReviews.id });
    if (done) tied++;
  }
  return tied;
}
