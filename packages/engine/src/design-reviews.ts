import { and, type Database, eq, isNull, schema } from "@agenteschat/db";
import { type ArtifactActor, createFileArtifact, storedFileOfArtifact } from "./artifacts";
import { portalPlaceOf } from "./design-delivery";
import { ConflictError, NotFoundError, ValidationError } from "./errors";
import { replyThreadOf } from "./runs";
import type { ToolContext, ToolDefinition, ToolOutput, ToolSource } from "./tools/types";
import {
  cleanLinks,
  cleanReviewBrief,
  cleanReviewText,
  DESIGN_PAGES,
  DESIGN_TOOL_NAME,
  REVIEW_BRIEF_SCHEMA,
  REVIEW_CHANNEL_SCHEMA,
  REVIEW_LINKS_SCHEMA,
  requireVideoReview,
  reviewPath,
  reviewPlace,
  reviewSummaries,
  reviewVersionFile,
  type VideoReviewDeps,
  type VideoReviewSummary,
} from "./video-reviews";

const { videoReviewNotes, videoReviews, videoReviewVersions } = schema;

/*
 * Design review (docs/adr/doug-0010-design-review.md): a designer agent sends a piece (a post, a carousel, a cover)
 * for the team's review in the same Revisor as videos. A version is its slides as pictures, in order, and the page they
 * were drawn from (one HTML file with everything inlined), which people open in the editor: they move, resize, rotate,
 * rewrite and swap what is on a slide and save it as the next version. Notes sit on a slide and a point of it; the
 * decision goes back to the agent like a video's, with the page to work from.
 */

export const SEND_DESIGN_FOR_REVIEW_TOOL = DESIGN_TOOL_NAME;
/** The largest editable page: a carousel with its photos and fonts inlined. */
export const DESIGN_SOURCE_BYTES = 40 * 1024 * 1024;
/** A slide's picture, by the name it was stored with. */
const PICTURE_NAME = /\.(png|jpe?g|webp|avif|gif)$/i;
const PAGE_NAME = /\.html?$/i;

/**
 * What in a page would load from elsewhere: the page runs cut off from the network (ADR 0019), so a photo or a font
 * by address never shows. Attributes that fetch (`src`, a stylesheet's `href`, an SVG image's `href`) and CSS `url()`.
 */
export function outsideReferences(html: string): string[] {
  const found = new Set<string>();
  // `%23` is `#` written inside a data: URL (an SVG's own filter or gradient); an extension's leftover tag loads nothing
  // in the editor's frame and harms nothing.
  const local = (ref: string) =>
    /^(data:|blob:|#|%23|about:|chrome-extension:|moz-extension:)/i.test(ref.trim()) || ref.trim() === "";
  const patterns = [
    /<(?:img|script|source|video|audio|iframe|embed|input)\b[^>]*?\ssrc\s*=\s*["']([^"']*)["']/gi,
    /<link\b[^>]*?\shref\s*=\s*["']([^"']*)["']/gi,
    /<(?:image|use|feImage)\b[^>]*?\s(?:xlink:)?href\s*=\s*["']([^"']*)["']/gi,
    /url\(\s*["']?([^"')]*)["']?\s*\)/gi,
    /@import\s+["']([^"']+)["']/gi,
  ];
  for (const pattern of patterns) {
    for (const match of html.matchAll(pattern)) {
      const ref = match[1] ?? "";
      if (!local(ref)) found.add(ref.length > 80 ? `${ref.slice(0, 77)}...` : ref);
    }
  }
  return [...found];
}

export interface SendDesignInput {
  /** The slides, in order: picture files the agent sees from here. */
  pages: string[];
  /** The page the slides were drawn from, everything inlined; absent: pictures only (nothing to edit). */
  sourceArtifactId?: string;
  title?: string;
  client?: string;
  note?: string;
  /** A design review it sent before: this is its next version. */
  reviewId?: string;
  brief?: string;
  links?: unknown;
  /** The group the review lives in, by name; absent: this conversation (`reviewPlace`). */
  channel?: string;
  /** The portal task the piece is for (`#125`): it gives the portal's client and card (doug-0010 §8). */
  task?: string;
  /** The portal's client id, when there is no task (`lexeer`). */
  portalClient?: string;
}

/** The agent sends a design piece for review, or its next version. */
export async function sendDesignForReview(
  deps: VideoReviewDeps,
  ctx: Pick<ToolContext, "orgId" | "agentId" | "runId" | "channelId" | "threadRootId" | "triggerMessageId">,
  input: SendDesignInput,
): Promise<{ review: VideoReviewSummary; link: string; created: boolean }> {
  const actor: ArtifactActor = {
    type: "agent",
    agentId: ctx.agentId,
    channelId: ctx.channelId,
    threadId: replyThreadOf(ctx),
    runId: ctx.runId,
  };
  const pages = [...new Set(input.pages)];
  if (pages.length === 0) throw new ValidationError("Send at least one slide", "video_review.no_pages");
  if (pages.length > DESIGN_PAGES) {
    throw new ValidationError(`At most ${DESIGN_PAGES} slides a piece`, "video_review.too_many_pages");
  }
  for (const id of pages) {
    const file = await storedFileOfArtifact(deps.artifacts, actor, ctx.orgId, id);
    if (!PICTURE_NAME.test(file.name)) {
      throw new ValidationError(`${file.name} is not a picture (.png, .jpg, .webp)`, "video_review.not_picture");
    }
  }
  if (input.sourceArtifactId) await checkSource(deps, actor, ctx.orgId, input.sourceArtifactId);

  const note = cleanReviewText(input.note ?? "");
  const now = new Date();
  const created = !input.reviewId;
  const portalPlace =
    input.task || input.portalClient
      ? await portalPlaceOf(deps.db, ctx.orgId, { task: input.task, client: input.portalClient })
      : null;
  const version = {
    artifactId: pages[0] as string,
    note,
    pages: pages.map((artifactId) => ({ artifactId })),
    sourceArtifactId: input.sourceArtifactId ?? null,
  };
  const reviewId = await deps.db.transaction(async (tx) => {
    if (input.reviewId) {
      const [review] = await tx
        .select()
        .from(videoReviews)
        .where(and(eq(videoReviews.orgId, ctx.orgId), eq(videoReviews.id, input.reviewId)))
        .for("update");
      if (!review) throw new NotFoundError("No such review");
      if (review.agentId !== ctx.agentId) {
        throw new ValidationError("This review is another agent's piece", "video_review.not_yours");
      }
      if (review.medium !== "design") {
        throw new ValidationError("This review is a video: use send_for_review", "video_review.wrong_medium");
      }
      const next = review.version + 1;
      await tx.insert(videoReviewVersions).values({ orgId: ctx.orgId, reviewId: review.id, version: next, ...version });
      await tx
        .update(videoReviews)
        .set({
          version: next,
          status: "in_review",
          decidedBy: null,
          decidedAt: null,
          updatedAt: now,
          ...(input.title?.trim() ? { title: input.title.trim().slice(0, 200) } : {}),
          ...(input.brief?.trim() ? { brief: cleanReviewBrief(input.brief) } : {}),
          ...(portalPlace?.client
            ? { portalClient: portalPlace.client, portalCard: portalPlace.card ?? review.portalCard }
            : {}),
          ...(input.links !== undefined && cleanLinks(input.links).length > 0
            ? { links: cleanLinks(input.links) }
            : {}),
        })
        .where(eq(videoReviews.id, review.id));
      return review.id;
    }
    const place = await reviewPlace(tx as unknown as Database, ctx, input.channel);
    const [row] = await tx
      .insert(videoReviews)
      .values({
        orgId: ctx.orgId,
        agentId: ctx.agentId,
        ...place,
        medium: "design",
        portalClient: portalPlace?.client ?? null,
        portalCard: portalPlace?.card ?? null,
        title: input.title?.trim().slice(0, 200) || "Peça",
        client: input.client?.trim().slice(0, 80) ?? "",
        brief: cleanReviewBrief(input.brief ?? ""),
        links: cleanLinks(input.links),
      })
      .returning({ id: videoReviews.id });
    if (!row) throw new Error("design review not inserted");
    await tx.insert(videoReviewVersions).values({ orgId: ctx.orgId, reviewId: row.id, version: 1, ...version });
    return row.id;
  });
  const [review] = await reviewSummaries(deps.db, ctx.orgId, [reviewId]);
  if (!review) throw new Error("design review not found after send");
  return { review, link: deps.publicUrl.replace(/\/+$/, "") + reviewPath(ctx.orgId, review.id), created };
}

/** The editable page must be one HTML file, small enough, with nothing loaded from elsewhere. */
async function checkSource(deps: VideoReviewDeps, actor: ArtifactActor, orgId: string, artifactId: string) {
  const file = await storedFileOfArtifact(deps.artifacts, actor, orgId, artifactId);
  if (!PAGE_NAME.test(file.name)) {
    throw new ValidationError(`${file.name} is not an HTML page (.html)`, "video_review.not_page");
  }
  if (file.size > DESIGN_SOURCE_BYTES) {
    throw new ValidationError("The page is larger than 40 MB: shrink its photos", "video_review.page_too_large");
  }
  const stored = await reviewVersionFile(deps, orgId, artifactId);
  const object = stored ? await stored.store.get(stored.blobKey) : null;
  if (!object) throw new NotFoundError("The page's file is missing");
  const outside = outsideReferences(new TextDecoder().decode(object.body));
  if (outside.length > 0) {
    throw new ValidationError(
      `The page loads files from elsewhere, which the editor cannot show: ${outside.slice(0, 4).join(", ")}. Inline every photo, logo and font as a data: URL and upload it again.`,
      "video_review.page_not_inlined",
    );
  }
}

const toolText = (value: unknown) => (typeof value === "string" ? value : "");

function sendDesignTool(deps: VideoReviewDeps): ToolDefinition {
  return {
    name: SEND_DESIGN_FOR_REVIEW_TOOL,
    description:
      'Send a design piece you made (a post, a carousel, a cover, a thumbnail) for the team\'s review: they see the slides, pin notes on a point of a slide, can open the piece in the editor and fix things by hand (move, resize, rewrite, swap a photo), and approve it or ask for changes; the answer comes back to this conversation with every note, its slide and point, and the page to work from. `pages`: the slides as pictures (PNG or JPG at the final size), in order, uploaded here first with `upload_file`. `source_artifact_id`: the HTML the slides were drawn from, so people can edit it: one file, every photo, logo and font inlined as data: URLs (nothing loaded by address), each slide a `<section class="slide">` (or `data-slide`) at its final size, and each thing someone may want to move or change marked `data-layer="Name"` (title, photo, logo, button...). For the next version after changes were asked, pass its `review_id`: never open a second review for the same piece. `note` says in a line what it is or what changed. Then post the link this answers with to the people who review, in your reply.',
    scope: "",
    inputSchema: {
      type: "object",
      properties: {
        pages: {
          type: "array",
          minItems: 1,
          maxItems: DESIGN_PAGES,
          items: { type: "string", minLength: 36, maxLength: 36 },
          description: "The slides' picture files (artifact ids), in order.",
        },
        source_artifact_id: { type: "string", minLength: 36, maxLength: 36 },
        title: { type: "string", maxLength: 200, description: "What the piece is, as the team would call it." },
        client: { type: "string", maxLength: 80, description: "The client it is for." },
        note: { type: "string", maxLength: 2000 },
        review_id: { type: "string", minLength: 36, maxLength: 36 },
        brief: REVIEW_BRIEF_SCHEMA,
        links: REVIEW_LINKS_SCHEMA,
        channel: REVIEW_CHANNEL_SCHEMA,
        task: {
          type: "string",
          maxLength: 12,
          description:
            "The portal task this piece is for (e.g. `#125`): once approved, the piece goes to that client's portal by itself, to the client or straight to scheduling as the client is set.",
        },
        portal_client: {
          type: "string",
          maxLength: 60,
          description: "The client's id at the approval portal (e.g. `lexeer`), when the piece has no task.",
        },
      },
      required: ["pages"],
      additionalProperties: false,
    },
    describe: (input) => ({ title: `Send "${toolText(input.title) || "a piece"}" for review` }),
    async execute(input, ctx): Promise<ToolOutput> {
      try {
        const sent = await sendDesignForReview(deps, ctx, {
          pages: Array.isArray(input.pages) ? input.pages.filter((p): p is string => typeof p === "string") : [],
          sourceArtifactId: toolText(input.source_artifact_id) || undefined,
          title: toolText(input.title) || undefined,
          client: toolText(input.client) || undefined,
          note: toolText(input.note) || undefined,
          reviewId: toolText(input.review_id) || undefined,
          brief: toolText(input.brief) || undefined,
          links: input.links,
          channel: toolText(input.channel) || undefined,
          task: toolText(input.task) || undefined,
          portalClient: toolText(input.portal_client) || undefined,
        });
        return {
          content:
            `${sent.created ? "In review" : `Version ${sent.review.version} in review`}: "${sent.review.title}" ` +
            `(review_id ${sent.review.id}). Link: ${sent.link}`,
          data: { reviewId: sent.review.id, version: sent.review.version },
        };
      } catch (error) {
        if (error instanceof ValidationError || error instanceof NotFoundError) {
          return { content: `Not sent for review: ${error.message}`, isError: true };
        }
        throw error;
      }
    },
  };
}

/** `send_design_for_review`, for agents in a run (a routine's background run sends nothing). */
export function createDesignReviewToolSource(deps: VideoReviewDeps | null): ToolSource {
  return {
    name: "design-review",
    async tools(ctx) {
      if (!deps || !ctx.runId || ctx.background) return [];
      return [sendDesignTool(deps)];
    },
  };
}

// ---------- the person's side ----------

async function designReview(deps: Pick<VideoReviewDeps, "db">, userId: string, orgId: string, reviewId: string) {
  const review = await requireVideoReview(deps.db, userId, orgId, reviewId);
  if (review.medium !== "design") throw new NotFoundError("No such design review");
  return review;
}

async function versionRow(deps: Pick<VideoReviewDeps, "db">, reviewId: string, version: number) {
  const [v] = await deps.db
    .select()
    .from(videoReviewVersions)
    .where(and(eq(videoReviewVersions.reviewId, reviewId), eq(videoReviewVersions.version, version)));
  if (!v) throw new NotFoundError("No such version");
  return v;
}

async function bytesOf(deps: Pick<VideoReviewDeps, "db" | "artifacts">, orgId: string, artifactId: string) {
  const file = await reviewVersionFile(deps, orgId, artifactId);
  const object = file ? await file.store.get(file.blobKey) : null;
  if (!object) throw new NotFoundError("The file of this version was removed");
  return object;
}

/** One slide's picture, after the same check as the review itself. */
export async function designPage(
  deps: Pick<VideoReviewDeps, "db" | "artifacts">,
  userId: string,
  orgId: string,
  reviewId: string,
  version: number,
  page: number,
): Promise<{ body: Uint8Array; contentType: string }> {
  const review = await designReview(deps, userId, orgId, reviewId);
  const v = await versionRow(deps, review.id, version);
  const slide = (v.pages ?? [])[page - 1];
  if (!slide) throw new NotFoundError("No such slide");
  const object = await bytesOf(deps, orgId, slide.artifactId);
  return { body: object.body, contentType: object.contentType || "image/png" };
}

/** A version's editable page, as text: the editor runs it in a frame cut off from the app and the network. */
export async function designSource(
  deps: Pick<VideoReviewDeps, "db" | "artifacts">,
  userId: string,
  orgId: string,
  reviewId: string,
  version: number,
): Promise<string> {
  const review = await designReview(deps, userId, orgId, reviewId);
  const v = await versionRow(deps, review.id, version);
  if (!v.sourceArtifactId) throw new NotFoundError("This version has no editable page");
  return new TextDecoder().decode((await bytesOf(deps, orgId, v.sourceArtifactId)).body);
}

const slug = (text: string) =>
  text
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 60) || "peca";

/**
 * A person saves what they did in the editor as the next version: the page goes into the review's conversation as
 * their file, the version is theirs (`edited_by`), and the notes they had not sent yet move along with it, so the
 * decision still carries them. Only on the newest version while it is in review: an agent working on changes would
 * otherwise build on a page that is no longer the piece.
 */
export async function saveDesignEdit(
  deps: Pick<VideoReviewDeps, "db" | "pubsub" | "artifacts">,
  userId: string,
  orgId: string,
  reviewId: string,
  input: { baseVersion: number; html: string; note?: string },
): Promise<VideoReviewSummary> {
  const review = await designReview(deps, userId, orgId, reviewId);
  if (review.status !== "in_review") {
    throw new ConflictError("This piece is not in review now", "video_review.not_open");
  }
  if (input.baseVersion !== review.version) {
    throw new ConflictError("A newer version arrived while you edited", "video_review.stale_version");
  }
  const base = await versionRow(deps, review.id, review.version);
  if (!base.sourceArtifactId) throw new ValidationError("This version has no editable page", "video_review.no_page");
  const bytes = new TextEncoder().encode(input.html);
  if (bytes.byteLength === 0) throw new ValidationError("The page is empty", "video_review.empty_page");
  if (bytes.byteLength > DESIGN_SOURCE_BYTES) {
    throw new ValidationError("The page is larger than 40 MB: use smaller photos", "video_review.page_too_large");
  }
  const next = review.version + 1;
  const file = await createFileArtifact(deps.artifacts, { type: "person", userId }, orgId, {
    title: `${review.title} V${next}`.slice(0, 200),
    name: `${slug(review.title)}-v${next}.html`,
    contentType: "text/html",
    channelId: review.channelId,
    threadId: review.threadId,
    note: "Editada no Revisor",
    // Whoever sees the review edits it, reading its conversation or not (doug-0014).
    placed: true,
    bytes,
  });
  const note = cleanReviewText(input.note ?? "");
  await deps.db.transaction(async (tx) => {
    const [locked] = await tx
      .select({ version: videoReviews.version, status: videoReviews.status })
      .from(videoReviews)
      .where(eq(videoReviews.id, review.id))
      .for("update");
    if (!locked || locked.version !== review.version || locked.status !== "in_review") {
      throw new ConflictError("A newer version arrived while you edited", "video_review.stale_version");
    }
    await tx.insert(videoReviewVersions).values({
      orgId,
      reviewId: review.id,
      version: next,
      artifactId: file.id,
      note,
      pages: [],
      sourceArtifactId: file.id,
      editedBy: userId,
    });
    await tx.update(videoReviews).set({ version: next, updatedAt: new Date() }).where(eq(videoReviews.id, review.id));
    await tx
      .update(videoReviewNotes)
      .set({ version: next })
      .where(
        and(
          eq(videoReviewNotes.reviewId, review.id),
          eq(videoReviewNotes.version, review.version),
          isNull(videoReviewNotes.sentAt),
        ),
      );
  });
  const [summary] = await reviewSummaries(deps.db, orgId, [review.id]);
  if (!summary) throw new NotFoundError("No such review");
  return summary;
}
