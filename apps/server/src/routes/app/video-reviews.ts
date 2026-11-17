import {
  addReviewNote,
  addVoiceReviewNote,
  DESIGN_PAGES,
  DESIGN_SOURCE_BYTES,
  decideVideoReview,
  deleteReviewNote,
  designPage,
  designSource,
  getMembership,
  getVideoReview,
  listVideoReviews,
  NotFoundError,
  POST_CAPTION_CHARS,
  REVIEW_NOTE_ATTACHMENTS,
  REVIEW_NOTE_CHARS,
  REVIEW_NOTE_KINDS,
  retryEditorFinal,
  reviewVideo,
  reviewWhatsAppTargets,
  saveDesignEdit,
  sendPersonWork,
  sendPostToClient,
  setReviewPost,
  setReviewWhatsApp,
  submitEditorVideo,
  taskDelivery,
  ValidationError,
  type VideoReviewDeps,
} from "@agenteschat/engine";
import { createRoute, z } from "@hono/zod-openapi";
import { rangedResponse } from "../../http/byte-range";
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
const EDITS = { limit: 20, windowMs: 60_000 };

const ReviewParams = OrgParams.extend({ reviewId: z.uuid() });
const TaskParams = OrgParams.extend({ issueId: z.uuid() });
const SENDS = { limit: 30, windowMs: 60_000 };
const NoteParams = ReviewParams.extend({ noteId: z.uuid() });

const Who = z.object({ id: z.string(), name: z.string() });

const Round = z
  .object({
    id: z.uuid(),
    version: z.number().int(),
    askedBy: z.string(),
    fromClient: z.boolean(),
    notes: z.number().int(),
    askedAt: z.string(),
    notified: z.record(z.string(), z.unknown()).nullable(),
    seenAt: z.string().nullable(),
    answeredAt: z.string().nullable(),
    answeredVersion: z.number().int().nullable(),
  })
  .openapi("ReviewRound", {
    description:
      "One round of changes asked of the person who sent the work (docs/adr/doug-0012-editor-delivery.md §10): who asked, when they were told, saw it and answered it.",
  });

const WhatsAppTarget = z
  .object({
    userId: z.string(),
    accountId: z.uuid(),
    accountLabel: z.string(),
    chatId: z.uuid(),
    chatName: z.string(),
  })
  .openapi("ReviewWhatsAppTarget");

const Attachment = z
  .union([
    z.object({
      type: z.literal("file"),
      artifactId: z.uuid(),
      name: z.string(),
      media: z.enum(["image", "video", "audio", "other"]),
    }),
    z.object({ type: z.literal("link"), url: z.string(), label: z.string() }),
  ])
  .openapi("VideoReviewAttachment");
const AttachmentInput = z
  .array(
    z.union([
      z.object({ artifactId: z.uuid(), name: z.string().max(200).optional() }),
      z.object({ url: z.string().max(2000), label: z.string().max(120).optional() }),
    ]),
  )
  .max(REVIEW_NOTE_ATTACHMENTS)
  .openapi({
    description:
      "Files uploaded to the review's conversation first (`POST …/artifacts/files` with its `channelId`/`threadId`), and links.",
  });

const Summary = z
  .object({
    id: z.uuid(),
    medium: z.enum(["video", "design"]).openapi({ description: "A video, or a design piece (slides and its page)." }),
    title: z.string(),
    client: z.string(),
    status: z.enum(["in_review", "changes", "approved"]),
    version: z.number().int(),
    artifactId: z.uuid().nullable().openapi({ description: "The newest version's video file." }),
    cover: z.uuid().nullable().openapi({
      description: "A design piece's first slide (a picture file), from its newest version with pictures.",
    }),
    agent: z.object({ id: z.uuid(), name: z.string(), handle: z.string() }).nullable(),
    sender: Who.nullable().openapi({
      description:
        "A person of the team who sent it from a task (docs/adr/doug-0012-editor-delivery.md); null: an agent.",
    }),
    taskId: z.uuid().nullable().openapi({ description: "The task it delivers, when sent from one." }),
    taskNumber: z.number().int().nullable(),
    taskTitle: z.string().nullable(),
    taskPart: z
      .number()
      .int()
      .nullable()
      .openapi({ description: "Its number among the task's videos (a task may ask for several)." }),
    round: Round.nullable().openapi({ description: "A person's review: the newest round of changes asked of them." }),
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
    page: z
      .number()
      .int()
      .nullable()
      .openapi({ description: "A design piece's slide, from 1; null: the whole piece." }),
    kind: z.enum(REVIEW_NOTE_KINDS).nullable(),
    x: z.number().nullable(),
    y: z.number().nullable(),
    body: z.string(),
    attachments: z.array(Attachment),
    voice: z.boolean(),
    author: Who.nullable(),
    fromClient: z
      .boolean()
      .openapi({ description: "The client wrote it at the approval portal (`author.id` is empty)." }),
    sent: z.boolean(),
    createdAt: z.string(),
  })
  .openapi("VideoReviewNote");

const Post = z
  .object({
    cover: z.uuid().nullable().optional(),
    noCover: z.boolean().optional(),
    coverOk: z.boolean().optional(),
    caption: z.string().optional(),
    captionOk: z.boolean().optional(),
  })
  .openapi("ReviewPost", { description: "A person's video's post: its cover and caption, each approved or not." });

const Review = Summary.extend({
  portal: z
    .object({ client: z.string(), afterApprove: z.enum(["portal", "direct"]) })
    .nullable()
    .openapi({ description: "A design piece's client at the approval portal and what an approval does there." }),
  delivery: z
    .record(z.string(), z.unknown())
    .nullable()
    .openapi({ description: "What happened at the portal after the approval (`state`, `link`, `when`, `error`)." }),
  post: Post,
  final: z
    .record(z.string(), z.unknown())
    .nullable()
    .openapi({ description: "The approved original kept as the final and its backup (`state`, `backup.link`)." }),
  task: z
    .object({ id: z.uuid(), number: z.number().int(), title: z.string(), stage: z.string().nullable() })
    .nullable()
    .openapi({ description: "The task it delivers and the stage of its post at the portal." }),
  rounds: z.array(Round),
  brief: z.string(),
  links: z.array(z.object({ label: z.string(), url: z.string() })),
  versions: z.array(
    z.object({
      version: z.number().int(),
      artifactId: z.uuid(),
      note: z.string(),
      light: z.boolean().openapi({ description: "Its light copy for phones is ready (`…/versions/{version}/video`)." }),
      pages: z.array(z.uuid()).openapi({ description: "A design version's slides, as picture files, in order." }),
      source: z.boolean().openapi({ description: "A design version's editable page (`…/versions/{version}/source`)." }),
      editedBy: Who.nullable().openapi({ description: "Who made this version in the editor; null: the agent." }),
      createdAt: z.string(),
    }),
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
  // Only the workspace's members read where each one is told.
  const requireReviewer = async (userId: string, orgId: string) => {
    if (!(await getMembership(reviews().db, userId, orgId))) throw new NotFoundError();
  };
  const allowed = async (key: string, limit: { limit: number; windowMs: number }) =>
    (await deps.adapters.rateLimiter.consume(key, limit)).allowed;

  app.openapi(
    createRoute({
      method: "get",
      path: "/organizations/{orgId}/video-reviews",
      tags,
      security,
      summary: "Every review of the workspace (every member sees them, doug-0014), newest first",
      request: { params: OrgParams },
      responses: { 200: json(z.object({ reviews: z.array(Summary) })), ...errors },
    }),
    async (c) => {
      const { orgId } = c.req.valid("param");
      return c.json({ reviews: await listVideoReviews(reviews(), c.get("user").id, orgId) }, 200);
    },
  );
  // A person's work sent from Revisão itself (docs/adr/doug-0015-team-work-review.md).
  app.openapi(
    createRoute({
      method: "post",
      path: "/organizations/{orgId}/video-reviews",
      tags,
      security,
      summary:
        "Send work a person made (a video, or a design piece's slides) for the team's review, or its next version",
      description:
        "The files are uploaded first (`POST …/artifacts/files`) to the conversation the work goes to: the task's (`taskId`, its conversation from `GET …/issues/{issueId}/conversation`), or a group's (`channelId`); a next version (`reviewId`) to its review's (`reviewId` on the upload). A video for a task follows the task's delivery (doug-0012).",
      request: {
        params: OrgParams,
        body: body(
          z.object({
            medium: z.enum(["video", "design"]),
            files: z.array(z.uuid()).min(1).max(DESIGN_PAGES),
            title: z.string().max(200).optional(),
            note: z.string().max(REVIEW_NOTE_CHARS).optional(),
            reviewId: z.uuid().optional(),
            taskId: z.uuid().optional(),
            channelId: z.uuid().optional(),
          }),
        ),
      },
      responses: {
        200: json(z.object({ review: Summary, toClient: z.boolean() })),
        ...errors,
        429: errorResponse("Too many (`rate_limited`)"),
      },
    }),
    async (c) => {
      const user = c.get("user");
      if (!(await allowed(`person-work:${user.id}`, SENDS))) return apiError(c, 429, "rate_limited", "Slow down");
      const { orgId } = c.req.valid("param");
      return c.json(await sendPersonWork(reviews(), user.id, orgId, c.req.valid("json")), 200);
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

  // A version's video for the player: its light copy for phones (about 1 Mb/s, long side 960) while there is one, the
  // original with `?quality=original` (HD) or until the copy is made. In parts, so it starts at once over 4G.
  app.get("/organizations/:orgId/video-reviews/:reviewId/versions/:version/video", async (c) => {
    const version = Number(c.req.param("version"));
    if (!Number.isInteger(version) || version < 1) throw new ValidationError("Bad version", "video_review.bad_version");
    const video = await reviewVideo(
      reviews(),
      c.get("user").id,
      c.req.param("orgId"),
      c.req.param("reviewId"),
      version,
      {
        original: c.req.query("quality") === "original",
      },
    );
    if ("redirect" in video) return c.redirect(video.redirect, 302);
    return rangedResponse(video.body, c.req.header("range"), {
      "content-type": video.contentType,
      "x-content-type-options": "nosniff",
      "content-security-policy": "sandbox",
      "x-video-quality": video.light ? "light" : "original",
      "cache-control": "private, no-store, no-transform",
    });
  });

  // A design version's slide, as a picture (docs/adr/doug-0010-design-review.md).
  app.get("/organizations/:orgId/video-reviews/:reviewId/versions/:version/pages/:page", async (c) => {
    const version = Number(c.req.param("version"));
    const page = Number(c.req.param("page"));
    if (!Number.isInteger(version) || version < 1) throw new ValidationError("Bad version", "video_review.bad_version");
    if (!Number.isInteger(page) || page < 1) throw new ValidationError("Bad slide", "video_review.bad_page");
    const picture = await designPage(
      reviews(),
      c.get("user").id,
      c.req.param("orgId"),
      c.req.param("reviewId"),
      version,
      page,
    );
    return c.body(picture.body as Uint8Array<ArrayBuffer>, 200, {
      "content-type": picture.contentType,
      "x-content-type-options": "nosniff",
      "content-security-policy": "sandbox",
      // A version never changes: the same address is the same picture.
      "cache-control": "private, max-age=86400, immutable",
    });
  });
  // A design version's editable page, as text: the apps run it in a sandboxed frame with no network (ADR 0019), never
  // as a page of this site.
  app.get("/organizations/:orgId/video-reviews/:reviewId/versions/:version/source", async (c) => {
    const version = Number(c.req.param("version"));
    if (!Number.isInteger(version) || version < 1) throw new ValidationError("Bad version", "video_review.bad_version");
    const html = await designSource(
      reviews(),
      c.get("user").id,
      c.req.param("orgId"),
      c.req.param("reviewId"),
      version,
    );
    return c.body(html, 200, {
      "content-type": "text/plain; charset=utf-8",
      "x-content-type-options": "nosniff",
      "content-security-policy": "sandbox",
      "cache-control": "private, max-age=86400, immutable",
    });
  });
  app.openapi(
    createRoute({
      method: "post",
      path: "/organizations/{orgId}/video-reviews/{reviewId}/design",
      tags,
      security,
      summary: "Save a design piece edited by hand as its next version (the open notes move along with it)",
      description:
        "Only on the newest version while it is in review: 409 `video_review.stale_version` when another version arrived, `video_review.not_open` once decided.",
      request: {
        params: ReviewParams,
        body: body(
          z.object({
            baseVersion: z.number().int().min(1).openapi({ description: "The version the editor opened." }),
            html: z.string().max(DESIGN_SOURCE_BYTES).openapi({ description: "The whole edited page." }),
            note: z.string().max(REVIEW_NOTE_CHARS).optional(),
          }),
        ),
      },
      responses: { 200: json(Summary), ...errors, 429: errorResponse("Too many (`rate_limited`)") },
    }),
    async (c) => {
      const user = c.get("user");
      if (!(await allowed(`design-edit:${user.id}`, EDITS))) return apiError(c, 429, "rate_limited", "Slow down");
      const { orgId, reviewId } = c.req.valid("param");
      return c.json(await saveDesignEdit(reviews(), user.id, orgId, reviewId, c.req.valid("json")), 200);
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
            page: z.number().int().min(1).max(DESIGN_PAGES).nullable().optional(),
            kind: z.enum(REVIEW_NOTE_KINDS).nullable().optional(),
            x: z.number().min(0).max(1).nullable().optional(),
            y: z.number().min(0).max(1).nullable().optional(),
            attachments: AttachmentInput.optional(),
            body: z.string().max(REVIEW_NOTE_CHARS).openapi({ description: "May be empty when it has attachments." }),
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
                page: z.string().max(4).optional().openapi({ description: "A design piece's slide; empty: whole." }),
                kind: z.enum(REVIEW_NOTE_KINDS).optional(),
                x: z.string().max(12).optional(),
                y: z.string().max(12).optional(),
                attachments: z
                  .string()
                  .max(20_000)
                  .optional()
                  .openapi({ description: "The same list as a typed note's `attachments`, as JSON." }),
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
      const fraction = (v?: string) => {
        const n = v?.trim() ? Number(v) : Number.NaN;
        return Number.isFinite(n) ? n : null;
      };
      let attachments: unknown;
      try {
        attachments = form.attachments?.trim() ? JSON.parse(form.attachments) : undefined;
      } catch {
        throw new ValidationError("attachments is not JSON", "video_review.bad_attachment");
      }
      try {
        const note = await addVoiceReviewNote(reviews(), user.id, orgId, reviewId, {
          version: form.version,
          atMs: at !== null && Number.isFinite(at) ? at : null,
          endMs: end !== null && Number.isFinite(end) ? end : null,
          page: form.page?.trim() && Number.isInteger(Number(form.page)) ? Number(form.page) : null,
          kind: form.kind ?? null,
          x: fraction(form.x),
          y: fraction(form.y),
          attachments,
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

  // Where each person is told of the changes asked of them (docs/adr/doug-0012-editor-delivery.md §11).
  app.openapi(
    createRoute({
      method: "get",
      path: "/organizations/{orgId}/review-whatsapp",
      tags,
      security,
      summary: "Each person's WhatsApp conversation for the changes asked of them",
      request: { params: OrgParams },
      responses: { 200: json(z.object({ targets: z.array(WhatsAppTarget) })), ...errors },
    }),
    async (c) => {
      const { orgId } = c.req.valid("param");
      await requireReviewer(c.get("user").id, orgId);
      return c.json({ targets: await reviewWhatsAppTargets(reviews().db, orgId) }, 200);
    },
  );
  app.openapi(
    createRoute({
      method: "put",
      path: "/organizations/{orgId}/review-whatsapp/{userId}",
      tags,
      security,
      summary: "Set where a person is told of the changes asked of them (a conversation of a number), or none",
      description:
        "Needs `assign_work`. 400 `review.bad_whatsapp` for a conversation that isn't one of this workspace's numbers.",
      request: {
        params: OrgParams.extend({ userId: z.string().min(1).max(200) }),
        body: body(z.object({ accountId: z.uuid(), chatId: z.uuid() }).nullable()),
      },
      responses: { 200: json(z.object({ target: WhatsAppTarget.nullable() })), ...errors },
    }),
    async (c) => {
      const { orgId, userId } = c.req.valid("param");
      const target = await setReviewWhatsApp(reviews().db, c.get("user").id, orgId, userId, c.req.valid("json"));
      return c.json({ target }, 200);
    },
  );
  // An editor's delivery from a task (docs/adr/doug-0012-editor-delivery.md).
  app.openapi(
    createRoute({
      method: "get",
      path: "/organizations/{orgId}/issues/{issueId}/video-delivery",
      tags,
      security,
      summary: "The video reviews sent from this task, one per video, in their order",
      request: { params: TaskParams },
      responses: {
        200: json(z.object({ reviewId: z.uuid().nullable(), reviewIds: z.array(z.uuid()) })),
        ...errors,
      },
    }),
    async (c) => {
      const { orgId, issueId } = c.req.valid("param");
      return c.json(await taskDelivery(reviews(), c.get("user").id, orgId, issueId), 200);
    },
  );
  app.openapi(
    createRoute({
      method: "post",
      path: "/organizations/{orgId}/issues/{issueId}/video-delivery",
      tags,
      security,
      summary:
        "Send the video edited for this task: to the team's review, or straight to the client after a change they asked for",
      description:
        "The file is uploaded to the task's conversation first (`POST …/artifacts/files` with its `channelId`/`threadId`). Without `reviewId` it is a new video of the task, with its own review; with one, that video's next version. 409 `editor_delivery.with_client` while the client has the post and asked for nothing.",
      request: {
        params: TaskParams,
        body: body(
          z.object({
            artifactId: z.uuid(),
            note: z.string().max(REVIEW_NOTE_CHARS).optional(),
            reviewId: z.uuid().optional().openapi({ description: "The task's video this file is a new version of." }),
          }),
        ),
      },
      responses: {
        200: json(z.object({ review: Summary, toClient: z.boolean() })),
        ...errors,
        429: errorResponse("Too many (`rate_limited`)"),
      },
    }),
    async (c) => {
      const user = c.get("user");
      if (!(await allowed(`editor-video:${user.id}`, SENDS))) return apiError(c, 429, "rate_limited", "Slow down");
      const { orgId, issueId } = c.req.valid("param");
      return c.json(await submitEditorVideo(reviews(), user.id, orgId, issueId, c.req.valid("json")), 200);
    },
  );
  app.openapi(
    createRoute({
      method: "patch",
      path: "/organizations/{orgId}/video-reviews/{reviewId}/post",
      tags,
      security,
      summary: "Set the post's cover and caption, and approve each (changing one takes its approval back)",
      request: {
        params: ReviewParams,
        body: body(
          z.object({
            caption: z.string().max(POST_CAPTION_CHARS).optional(),
            captionOk: z.boolean().optional(),
            cover: z.uuid().nullable().optional().openapi({ description: "A picture uploaded to the task." }),
            noCover: z.boolean().optional(),
            coverOk: z.boolean().optional(),
          }),
        ),
      },
      responses: { 200: json(Post), ...errors },
    }),
    async (c) => {
      const { orgId, reviewId } = c.req.valid("param");
      return c.json(await setReviewPost(reviews(), c.get("user").id, orgId, reviewId, c.req.valid("json")), 200);
    },
  );
  app.openapi(
    createRoute({
      method: "post",
      path: "/organizations/{orgId}/video-reviews/{reviewId}/send",
      tags,
      security,
      summary: "Send the approved post to the client (or straight to scheduling, for a client set to `direct`)",
      description: "Needs `assign_work`, the video approved and the cover and caption approved.",
      request: { params: ReviewParams },
      responses: {
        200: json(
          z.object({ delivery: z.record(z.string(), z.unknown()), afterApprove: z.enum(["portal", "direct"]) }),
        ),
        ...errors,
      },
    }),
    async (c) => {
      const { orgId, reviewId } = c.req.valid("param");
      return c.json(await sendPostToClient(reviews(), c.get("user").id, orgId, reviewId), 200);
    },
  );
  app.openapi(
    createRoute({
      method: "post",
      path: "/organizations/{orgId}/video-reviews/{reviewId}/final/retry",
      tags,
      security,
      summary: "Try the final's backup again, after it failed",
      request: { params: ReviewParams },
      responses: { ...noContent, ...errors },
    }),
    async (c) => {
      const { orgId, reviewId } = c.req.valid("param");
      await retryEditorFinal(reviews(), c.get("user").id, orgId, reviewId);
      return c.body(null, 204);
    },
  );
  return app;
}
