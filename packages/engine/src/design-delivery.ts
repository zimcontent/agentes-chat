import type { ApprovalPortal, PortalJob } from "@dougbot/adapters";
import { and, type Database, eq, schema } from "@dougbot/db";
import { publishMessageCreated } from "./events";
import { insertMessage, messageView } from "./messages";
import { enqueue } from "./outbox";
import { rightHandId } from "./right-hand";
import type { VideoReviewDeps } from "./video-reviews";
import { reviewVersionFile } from "./video-reviews";

const { issues, portalClientSettings, users, videoReviews, videoReviewVersions } = schema;

/*
 * What follows "Aprovar" on a design piece (docs/adr/doug-0010-design-review.md §8): the approved slides go to the
 * client's approval portal by code, the same send the team's tools make (ADR 9001 §4). Each client says, on its own
 * page in the Portal, what an approval in the Revisor means for it: `portal`, the client approves it there (the
 * default), or `direct`, the team's approval is the last one, so the post is marked approved and scheduled for the
 * day its card says. Whatever happened is said in the review's conversation, in words written here.
 */

export const AFTER_APPROVE = ["portal", "direct"] as const;
export type AfterApprove = (typeof AFTER_APPROVE)[number];
export const DESIGN_DELIVER_JOB = "design_review.deliver";

export type DesignDelivery = {
  state: "sending" | "sent" | "scheduled" | "approved" | "failed";
  job?: string;
  item?: string | null;
  link?: string | null;
  when?: string | null;
  error?: string;
  at: string;
};

/** What an approval means for each client the team set; one not listed goes to the client (`portal`). */
export async function portalClientSettingsOf(db: Database, orgId: string) {
  return db
    .select({ client: portalClientSettings.client, afterApprove: portalClientSettings.afterApprove })
    .from(portalClientSettings)
    .where(eq(portalClientSettings.orgId, orgId));
}

export async function afterApproveOf(db: Database, orgId: string, client: string): Promise<AfterApprove> {
  const [row] = await db
    .select({ afterApprove: portalClientSettings.afterApprove })
    .from(portalClientSettings)
    .where(and(eq(portalClientSettings.orgId, orgId), eq(portalClientSettings.client, client)));
  return row?.afterApprove === "direct" ? "direct" : "portal";
}

export async function setAfterApprove(
  db: Database,
  orgId: string,
  client: string,
  value: AfterApprove,
  userId: string,
) {
  await db
    .insert(portalClientSettings)
    .values({ orgId, client, afterApprove: value, updatedBy: userId })
    .onConflictDoUpdate({
      target: [portalClientSettings.orgId, portalClientSettings.client],
      set: { afterApprove: value, updatedBy: userId, updatedAt: new Date() },
    });
}

/**
 * The portal's client and card a piece belongs to, from the task the agent names (`#125`): a portal task carries
 * both (ADR 9001 §11). A task of another kind, or none: only `client` when given.
 */
export async function portalPlaceOf(
  db: Database,
  orgId: string,
  input: { task?: string | number; client?: string },
): Promise<{ client: string | null; card: string | null }> {
  const number = typeof input.task === "number" ? input.task : Number(String(input.task ?? "").replace(/^#/, ""));
  if (Number.isInteger(number) && number > 0) {
    const [task] = await db
      .select({ source: issues.source })
      .from(issues)
      .where(and(eq(issues.orgId, orgId), eq(issues.number, number)));
    const source = (task?.source ?? {}) as { type?: string; client?: string; cardId?: string };
    if (source.type === "portal" && source.client) return { client: source.client, card: source.cardId ?? null };
  }
  const client = input.client?.trim().toLowerCase();
  return { client: client || null, card: null };
}

/**
 * The caption the post's card at the portal holds: what goes up with a send that names no caption of its own (a
 * post's caption is written on its card, ADR 9001 §11). The card is the review's own, else the card of the task it
 * delivers. Best effort: a portal that doesn't answer, or a card gone, is no caption.
 */
export async function cardCaptionOf(
  db: Database,
  portal: ApprovalPortal | null | undefined,
  review: { orgId: string; portalClient: string | null; portalCard: string | null; taskId: string | null },
): Promise<string> {
  if (!portal) return "";
  let client = review.portalClient;
  let cardId = review.portalCard;
  if (!cardId && review.taskId) {
    const [task] = await db
      .select({ source: issues.source })
      .from(issues)
      .where(and(eq(issues.orgId, review.orgId), eq(issues.id, review.taskId)));
    const source = (task?.source ?? {}) as { type?: string; client?: string; cardId?: string };
    if (source.type === "portal" && source.cardId) {
      cardId = source.cardId;
      client ??= source.client ?? null;
    }
  }
  if (!client || !cardId) return "";
  const cards = await portal.cards(client).catch(() => []);
  return (cards.find((c) => c.id === cardId)?.caption ?? "").trim();
}

/** Asks for the delivery of an approved design version, once per version (a second approval is refused before). */
export async function queueDesignDelivery(db: Database, orgId: string, reviewId: string, version: number) {
  await enqueue(db, { orgId, kind: DESIGN_DELIVER_JOB, payload: { reviewId, version }, maxAttempts: 6 });
}

type DeliveryDeps = Pick<VideoReviewDeps, "db" | "pubsub" | "artifacts"> & { portal: ApprovalPortal | null };

async function setDelivery(db: Database, reviewId: string, delivery: DesignDelivery) {
  await db.update(videoReviews).set({ delivery }).where(eq(videoReviews.id, reviewId));
}

/** A line in the review's conversation, from the workspace's assistant (written here, never by a model). */
async function say(deps: DeliveryDeps, review: typeof videoReviews.$inferSelect, body: string) {
  const author = await rightHandId(deps.db, review.orgId);
  if (!author || !deps.pubsub) return;
  const message = await insertMessage(deps.db, {
    orgId: review.orgId,
    channelId: review.channelId,
    threadId: review.threadId,
    author: { type: "agent", agentId: author, runId: null, hop: 1, stretchId: null },
    body,
    meta: { videoReview: { id: review.id, version: review.version, decision: "delivered" } },
  });
  await publishMessageCreated(deps.pubsub, messageView(message));
}

/**
 * Job `design_review.deliver`: the approved version's slides go up and are sent to the portal (the same key never
 * sends twice, so a retried job finds its send); then, for a `direct` client, the post is marked approved, and a person
 * schedules it (ADR 9001, addendum 2026-11-17). A version made by hand has no pictures: the agent was told to render and send them itself.
 */
export async function deliverDesign(deps: DeliveryDeps, reviewId: string, version: number): Promise<void> {
  const [review] = await deps.db.select().from(videoReviews).where(eq(videoReviews.id, reviewId));
  if (!review || review.medium !== "design" || !review.portalClient || !deps.portal) return;
  if (review.status !== "approved" || review.version !== version) return;
  const done = (review.delivery ?? null) as DesignDelivery | null;
  if (done && done.state !== "sending" && done.state !== "failed") return;
  const portal = deps.portal;
  const client = review.portalClient;
  const [v] = await deps.db
    .select()
    .from(videoReviewVersions)
    .where(and(eq(videoReviewVersions.reviewId, review.id), eq(videoReviewVersions.version, version)));
  const pages = v?.pages ?? [];
  if (pages.length === 0) return;
  const mode = await afterApproveOf(deps.db, review.orgId, client);
  const [decider] = review.decidedBy
    ? await deps.db.select({ name: users.name }).from(users).where(eq(users.id, review.decidedBy))
    : [];

  // The send, or the one a retry already started.
  let job: PortalJob | null = done?.job ? await portal.job(done.job).catch(() => null) : null;
  if (!job || job.state === "failed") {
    const files: string[] = [];
    for (const [i, page] of pages.entries()) {
      const file = await reviewVersionFile(deps, review.orgId, page.artifactId);
      const object = file ? await file.store.get(file.blobKey) : null;
      if (!object) throw new Error(`slide ${i + 1} of review ${review.id} is missing`);
      files.push(await portal.upload(`${String(i + 1).padStart(2, "0")}.png`, object.body));
    }
    // The caption the team confirmed on "Aprovar", else the card's: a post never goes up without the caption it has.
    const caption = review.post?.caption?.trim() || (await cardCaptionOf(deps.db, portal, review));
    job = await portal.send({
      client,
      type: pages.length > 1 ? "carousel" : "image",
      files,
      title: review.title,
      ...(caption ? { caption } : {}),
      card: review.portalCard ?? undefined,
      key: `review:${review.id}:v${version}`,
      by: decider?.name ?? undefined,
    });
  }
  // The bridge sends in the background: read it for a while, then let the job come back.
  for (let i = 0; i < 20 && job.state === "sending"; i++) {
    await new Promise((r) => setTimeout(r, 3000));
    job = (await portal.job(job.id)) ?? job;
  }
  if (job.state === "sending") {
    await setDelivery(deps.db, review.id, { state: "sending", job: job.id, at: new Date().toISOString() });
    throw new Error("the portal is still sending");
  }
  if (job.state === "failed" || !job.item) {
    const error = job.error ?? (job.missing.length ? `faltou: ${job.missing.join(", ")}` : "o portal recusou");
    await setDelivery(deps.db, review.id, { state: "failed", job: job.id, error, at: new Date().toISOString() });
    await say(deps, review, `«${review.title}» foi aprovado, mas não subiu ao portal: ${error}.`);
    return;
  }
  const link = job.link ? ` ${job.link}` : "";
  if (mode === "portal") {
    await setDelivery(deps.db, review.id, {
      state: "sent",
      job: job.id,
      item: job.item,
      link: job.link,
      at: new Date().toISOString(),
    });
    await say(deps, review, `«${review.title}» foi para a aprovação do cliente no portal.${link}`);
    return;
  }
  // Direct: the team's approval is the last one, so the post turns approved. Scheduling it is the team's, by hand,
  // at the Portal: never the card's date on its own (ADR 9001, addendum 2026-11-17).
  await portal.editItem(client, job.item, { status: "approved" }, decider?.name ?? undefined);
  await setDelivery(deps.db, review.id, {
    state: "approved",
    job: job.id,
    item: job.item,
    link: job.link,
    when: null,
    at: new Date().toISOString(),
  });
  await say(
    deps,
    review,
    `«${review.title}» aprovado e pronto no portal. Quando sai é a equipe que decide: agende o post no Portal, com o dia e a hora.${link}`,
  );
}

/** A review's delivery as stored, or null before any. */
export const deliveryOf = (row: { delivery: unknown }) => (row.delivery ?? null) as DesignDelivery | null;
