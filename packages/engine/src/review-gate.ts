import type { ApprovalPortal } from "@agenteschat/adapters";
import { and, type Database, eq, inArray, or, schema, sql } from "@agenteschat/db";

const { artifacts, issues, videoReviews, videoReviewVersions } = schema;

/**
 * Nothing an agent made goes up for the client's approval before the team approved it in Review (docs/adr/doug-0019-approved-before-the-client.md): every
 * file an agent's `send_for_approval` names must be the approved version of a review (a video's file, or a design
 * piece's slides), and a cover either the approved version of a review of its own or the cover the team approved on
 * an approved video (`post.coverOk`). The sends Review itself makes after "Aprovar" (`design-delivery.ts`,
 * `editor-delivery.ts`) don't pass here: they are the approval's own.
 */
export interface ReviewGate {
  /** The files that aren't the approved version of any review, by id. */
  unapproved: string[];
  /** The reviews those files are in, still waiting (`in_review`) or sent back (`changes`): what to name to the agent. */
  waiting: { id: string; title: string; status: string; version: number }[];
}

export async function reviewGate(
  db: Database,
  orgId: string,
  input: { artifactIds: string[]; coverArtifactId?: string; reviewId?: string },
): Promise<ReviewGate> {
  const ids = [...new Set([...input.artifactIds, ...(input.coverArtifactId ? [input.coverArtifactId] : [])])];
  if (ids.length === 0) return { unapproved: [], waiting: [] };
  // A design piece approved as its page alone (no slides as pictures): the agent exports the slides after the
  // approval, so the files can't be the version's own. Named by its `review_id`, the approved page stands for them.
  if (input.reviewId && (await approvedAsPageOnly(db, orgId, input.reviewId))) {
    return { unapproved: [], waiting: [] };
  }
  const rows = await db
    .select({
      reviewId: videoReviews.id,
      title: videoReviews.title,
      status: videoReviews.status,
      current: videoReviews.version,
      post: videoReviews.post,
      version: videoReviewVersions.version,
      artifactId: videoReviewVersions.artifactId,
      pages: videoReviewVersions.pages,
    })
    .from(videoReviewVersions)
    .innerJoin(videoReviews, eq(videoReviews.id, videoReviewVersions.reviewId))
    .where(
      and(
        eq(videoReviewVersions.orgId, orgId),
        eq(videoReviews.orgId, orgId),
        or(
          inArray(videoReviewVersions.artifactId, ids),
          sql`exists (select 1 from jsonb_array_elements(${videoReviewVersions.pages}) as p where p->>'artifactId' in (${sql.join(
            ids.map((id) => sql`${id}`),
            sql`, `,
          )}))`,
          and(
            eq(videoReviewVersions.version, videoReviews.version),
            sql`${videoReviews.post}->>'cover' in (${sql.join(
              ids.map((id) => sql`${id}`),
              sql`, `,
            )})`,
          ),
        ),
      ),
    );
  const approved = new Set<string>();
  const seenIn = new Map<string, { id: string; title: string; status: string; version: number }>();
  for (const row of rows) {
    const files = [row.artifactId, ...(row.pages ?? []).map((p) => p.artifactId)];
    const ok = row.status === "approved" && row.version === row.current;
    for (const file of files) {
      if (!ids.includes(file)) continue;
      if (ok) approved.add(file);
      else seenIn.set(row.reviewId, { id: row.reviewId, title: row.title, status: row.status, version: row.current });
    }
    if (ok && row.post?.cover && row.post.coverOk && ids.includes(row.post.cover)) approved.add(row.post.cover);
  }
  const unapproved = ids.filter((id) => !approved.has(id));
  return {
    unapproved,
    waiting: unapproved.length ? [...seenIn.values()] : [],
  };
}

async function approvedAsPageOnly(db: Database, orgId: string, reviewId: string): Promise<boolean> {
  if (!/^[0-9a-f-]{36}$/i.test(reviewId)) return false;
  const [row] = await db
    .select({
      status: videoReviews.status,
      medium: videoReviews.medium,
      pages: videoReviewVersions.pages,
      source: videoReviewVersions.sourceArtifactId,
    })
    .from(videoReviews)
    .innerJoin(
      videoReviewVersions,
      and(eq(videoReviewVersions.reviewId, videoReviews.id), eq(videoReviewVersions.version, videoReviews.version)),
    )
    .where(and(eq(videoReviews.orgId, orgId), eq(videoReviews.id, reviewId)));
  return Boolean(row && row.status === "approved" && row.medium === "design" && row.source && !row.pages?.length);
}

const STATUS_WORDS: Record<string, string> = {
  in_review: "waiting for the team",
  changes: "changes asked",
  approved: "approved on its newest version only: send that version's files",
};

/** The agent's words when the gate holds a send: what is missing and what to do instead. */
export function reviewGateRefusal(gate: ReviewGate): string {
  const waiting = gate.waiting.length
    ? ` Still in Review: ${gate.waiting
        .map((r) => `"${r.title}" (review_id ${r.id}, V${r.version}, ${STATUS_WORDS[r.status] ?? r.status})`)
        .join("; ")}.`
    : "";
  return (
    `Not sent: nothing goes up for the client's approval before the team approves it in Review. ` +
    `${gate.unapproved.length} file(s) aren't the approved version of a review (${gate.unapproved.join(", ")}).` +
    waiting +
    " Send the video with `send_for_review` (or the carousel/cover as a design piece) and wait for the approval; once a" +
    " piece is approved, Review delivers it to the portal by itself, or send exactly the approved version's files."
  );
}

/**
 * The approved version on its task (doug-0019): once the team approves a review that belongs to a post of the approval
 * portal, its files (a video's file, a design piece's slides) are added to the post's card, so the task holds what was
 * approved. The card is the review's own (`portal_card`), else the card of the task it was sent from (`task_id`, or the
 * task whose conversation it came from). Best effort: a portal that is down or a card gone leaves the approval as it is.
 */
export async function approvedOnCard(
  db: Database,
  portal: ApprovalPortal | null | undefined,
  orgId: string,
  reviewId: string,
  by: string,
): Promise<{ card: string; added: number } | null> {
  if (!portal) return null;
  const [review] = await db
    .select({
      status: videoReviews.status,
      version: videoReviews.version,
      client: videoReviews.portalClient,
      card: videoReviews.portalCard,
      taskId: videoReviews.taskId,
      channelId: videoReviews.channelId,
      threadId: videoReviews.threadId,
    })
    .from(videoReviews)
    .where(and(eq(videoReviews.orgId, orgId), eq(videoReviews.id, reviewId)));
  if (review?.status !== "approved") return null;
  let client = review.client;
  let cardId = review.card;
  if (!cardId) {
    const [task] = await db
      .select({ source: issues.source })
      .from(issues)
      .where(
        and(
          eq(issues.orgId, orgId),
          review.taskId
            ? eq(issues.id, review.taskId)
            : or(
                eq(issues.conversationChannelId, review.channelId),
                review.threadId
                  ? and(eq(issues.threadChannelId, review.channelId), eq(issues.threadRootId, review.threadId))
                  : undefined,
              ),
        ),
      )
      .limit(1);
    const source = (task?.source ?? {}) as { type?: string; client?: string; cardId?: string };
    if (source.type !== "portal" || !source.cardId) return null;
    cardId = source.cardId;
    client ??= source.client ?? null;
  }
  if (!client || !cardId) return null;
  const [version] = await db
    .select({ artifactId: videoReviewVersions.artifactId, pages: videoReviewVersions.pages })
    .from(videoReviewVersions)
    .where(and(eq(videoReviewVersions.reviewId, reviewId), eq(videoReviewVersions.version, review.version)));
  if (!version) return null;
  const ids = version.pages?.length ? version.pages.map((p) => p.artifactId) : [version.artifactId];
  const card = (await portal.cards(client)).find((c) => c.id === cardId);
  if (!card) return null;
  const have = new Set(card.files.map((f) => f.id));
  const fresh = ids.filter((id) => !have.has(id));
  if (fresh.length === 0) return { card: card.id, added: 0 };
  const names = new Map(
    (
      await db
        .select({ id: artifacts.id, title: artifacts.title })
        .from(artifacts)
        .where(and(eq(artifacts.orgId, orgId), inArray(artifacts.id, fresh)))
    ).map((a) => [a.id, a.title]),
  );
  await portal.updateCard(
    card.id,
    { files: [...card.files, ...fresh.map((id) => ({ id, name: names.get(id) ?? "" }))] },
    by,
  );
  return { card: card.id, added: fresh.length };
}
