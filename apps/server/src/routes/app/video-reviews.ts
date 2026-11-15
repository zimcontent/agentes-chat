import {
  addReviewNote,
  addVoiceReviewNote,
  decideVideoReview,
  deleteReviewNote,
  getVideoReview,
  listVideoReviews,
  NotFoundError,
  REVIEW_NOTE_CHARS,
  REVIEW_NOTE_KINDS,
  ValidationError,
  type VideoReviewDeps,
} from "@agenteschat/engine";
import { createRoute, z } from "@hono/zod-openapi";
import { apiError, errorResponse } from "../../http/errors";
import {
  type AppDeps,
  body,
  createAppRouter,
  errors,
  json,
  noContent,
  OrgParams,
  requireSession,
  security,
} from "./context";

const tags = ["Video review"];

const NOTES = { limit: 120, windowMs: 60_000 };
const VOICE = { limit: 30, windowMs: 60_000 };

const ReviewParams = OrgParams.extend({ reviewId: z.uuid() });
const NoteParams = ReviewParams.extend({ noteId: z.uuid() });

const Who = z.object({ id: z.string(), name: z.string() });

const Summary = z
  .object({
    id: z.uuid(),
    title: z.string(),
    client: z.string(),
    status: z.enum(["in_review", "changes", "approved"]),
    version: z.number().int(),
    artifactId: z.uuid().nullable().openapi({ description: "The newest version's video file." }),
    agent: z.object({ id: z.uuid(), name: z.string(), handle: z.string() }).nullable(),
    channelId: z.uuid(),
    threadId: z.uuid().nullable(),
    openNotes: z.number().int().openapi({ description: "Notes on the newest version not yet sent to the agent." }),
    updatedAt: z.string(),
    createdAt: z.string(),
  })
  .openapi("VideoReviewSummary");

const Note = z
  .object({
    id: z.uuid(),
    version: z.number().int(),
    atMs: z.number().int().nullable(),
    endMs: z.number().int().nullable(),
    kind: z.enum(REVIEW_NOTE_KINDS).nullable(),
    body: z.string(),
    voice: z.boolean(),
    author: Who.nullable(),
    sent: z.boolean(),
    createdAt: z.string(),
  })
  .openapi("VideoReviewNote");

const Review = Summary.extend({
  versions: z.array(
    z.object({ version: z.number().int(), artifactId: z.uuid(), note: z.string(), createdAt: z.string() }),
  ),
  notes: z.array(Note),
  decidedBy: Who.nullable(),
  decidedAt: z.string().nullable(),
}).openapi("VideoReview");

/**
 * Video review (docs/adr/doug-0007-video-review.md): the videos agents sent for review, notes pinned to their seconds
 * (typed, or said and transcribed) and the decision that goes back to the agent.
 */
export function videoReviewRoutes(deps: AppDeps) {
  const app = createAppRouter(deps);
  app.use("/organizations/*", requireSession(deps.auth));
  const reviews = (): VideoReviewDeps => {
    const d = deps.extras?.videoReviews;
    if (!d) throw new NotFoundError();
    return d;
  };
  const allowed = async (key: string, limit: { limit: number; windowMs: number }) =>
    (await deps.adapters.rateLimiter.consume(key, limit)).allowed;

  app.openapi(
    createRoute({
      method: "get",
      path: "/organizations/{orgId}/video-reviews",
      tags,
      security,
      summary: "The videos in review this person may see (who reads the conversation a video came from), newest first",
      request: { params: OrgParams },
      responses: { 200: json(z.object({ reviews: z.array(Summary) })), ...errors },
    }),
    async (c) => {
      const { orgId } = c.req.valid("param");
      return c.json({ reviews: await listVideoReviews(reviews(), c.get("user").id, orgId) }, 200);
    },
  );

  app.openapi(
    createRoute({
      method: "get",
      path: "/organizations/{orgId}/video-reviews/{reviewId}",
      tags,
      security,
      summary: "A video in review: its versions and every note",
      request: { params: ReviewParams },
      responses: { 200: json(Review), ...errors },
    }),
    async (c) => {
      const { orgId, reviewId } = c.req.valid("param");
      return c.json(await getVideoReview(reviews(), c.get("user").id, orgId, reviewId), 200);
    },
  );

  app.openapi(
    createRoute({
      method: "post",
      path: "/organizations/{orgId}/video-reviews/{reviewId}/notes",
      tags,
      security,
      summary: "Pin a typed note to a second of a version (`atMs` null: about the whole video)",
      request: {
        params: ReviewParams,
        body: body(
          z.object({
            version: z.number().int().min(1),
            atMs: z.number().int().min(0).nullable(),
            endMs: z.number().int().min(1).nullable().optional(),
            kind: z.enum(REVIEW_NOTE_KINDS).nullable().optional(),
            body: z.string().min(1).max(REVIEW_NOTE_CHARS),
          }),
        ),
      },
      responses: { 200: json(Note), ...errors, 429: errorResponse("Too many (`rate_limited`)") },
    }),
    async (c) => {
      const user = c.get("user");
      if (!(await allowed(`video-review-note:${user.id}`, NOTES))) {
        return apiError(c, 429, "rate_limited", "Slow down");
      }
      const { orgId, reviewId } = c.req.valid("param");
      return c.json(await addReviewNote(reviews(), user.id, orgId, reviewId, c.req.valid("json")), 200);
    },
  );

  app.openapi(
    createRoute({
      method: "post",
      path: "/organizations/{orgId}/video-reviews/{reviewId}/notes/voice",
      tags,
      security,
      summary: "Pin a note said aloud: it is transcribed now and kept as its words",
      description:
        "422 `video_review.no_words` when nothing could be made out, `video_review.no_speech` on a server without speech-to-text.",
      request: {
        params: ReviewParams,
        body: {
          required: true,
          content: {
            "multipart/form-data": {
              schema: z.object({
                file: z.any().openapi({ type: "string", format: "binary", description: "The recording." }),
                version: z.coerce.number().int().min(1),
                atMs: z.string().max(12).optional().openapi({ description: "Milliseconds; empty: the whole video." }),
                endMs: z
                  .string()
                  .max(12)
                  .optional()
                  .openapi({ description: "Where a stretch ends; empty: one point." }),
                kind: z.enum(REVIEW_NOTE_KINDS).optional(),
                language: z.string().max(8).optional(),
              }),
            },
          },
        },
      },
      responses: {
        200: json(Note),
        ...errors,
        413: errorResponse("The recording is too large (`video_review.too_large`)"),
        429: errorResponse("Too many (`rate_limited`)"),
      },
    }),
    async (c) => {
      const user = c.get("user");
      if (!(await allowed(`video-review-voice:${user.id}`, VOICE))) {
        return apiError(c, 429, "rate_limited", "Slow down");
      }
      const { orgId, reviewId } = c.req.valid("param");
      const form = c.req.valid("form");
      const file: unknown = form.file;
      if (!(file instanceof File))
        throw new ValidationError("send the recording in the field file", "video_review.bad_type");
      const at = form.atMs?.trim() ? Number(form.atMs) : null;
      const end = form.endMs?.trim() ? Number(form.endMs) : null;
      try {
        const note = await addVoiceReviewNote(reviews(), user.id, orgId, reviewId, {
          version: form.version,
          atMs: at !== null && Number.isFinite(at) ? at : null,
          endMs: end !== null && Number.isFinite(end) ? end : null,
          kind: form.kind ?? null,
          audio: new Uint8Array(await file.arrayBuffer()),
          contentType: file.type,
          language: form.language ?? null,
        });
        return c.json(note, 200);
      } catch (error) {
        if (error instanceof ValidationError && error.code === "video_review.too_large") {
          return apiError(c, 413, error.code, error.message);
        }
        throw error;
      }
    },
  );

  app.openapi(
    createRoute({
      method: "delete",
      path: "/organizations/{orgId}/video-reviews/{reviewId}/notes/{noteId}",
      tags,
      security,
      summary: "Take back one's own note, while it was not sent to the agent",
      request: { params: NoteParams },
      responses: { ...noContent, ...errors },
    }),
    async (c) => {
      const { orgId, reviewId, noteId } = c.req.valid("param");
      await deleteReviewNote(reviews(), c.get("user").id, orgId, reviewId, noteId);
      return c.body(null, 204);
    },
  );

  app.openapi(
    createRoute({
      method: "post",
      path: "/organizations/{orgId}/video-reviews/{reviewId}/decision",
      tags,
      security,
      summary:
        "Approve the newest version, or ask for changes: the notes go to the agent as a message from this person",
      request: {
        params: ReviewParams,
        body: body(
          z.object({
            decision: z.enum(["approve", "changes"]),
            message: z.string().max(REVIEW_NOTE_CHARS).optional(),
          }),
        ),
      },
      responses: { 200: json(Summary), ...errors },
    }),
    async (c) => {
      const { orgId, reviewId } = c.req.valid("param");
      return c.json(await decideVideoReview(reviews(), c.get("user").id, orgId, reviewId, c.req.valid("json")), 200);
    },
  );

  return app;
}
