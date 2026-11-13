import {
  ApprovalPortalError,
  PORTAL_CARD_STATES,
  PORTAL_STATUSES,
  PORTAL_TYPES,
} from "@agenteschat/adapters";
import {
  PORTAL_SEND_FILES,
  personPortalReader,
  portalBoard,
  portalOverview,
  requireChangePermission,
  requirePermission,
  sendForApproval,
} from "@agenteschat/engine";
import { createRoute, z } from "@hono/zod-openapi";
import type { Context } from "hono";
import { apiError, errorResponse } from "../../http/errors";
import { type AppDeps, body, createAppRouter, errors, json, noContent, OrgParams, requireSession, security } from "./context";

const tags = ["Approval portal"];

/** Sends one person may start: a batch of posts fits, a loop doesn't. */
export const PORTAL_SENDS_PER_PERSON = { limit: 30, windowMs: 60_000 };

const Missing = z.enum(["cover", "caption", "editor", "date"]);
const ClientId = z.string().regex(/^[a-z0-9][a-z0-9-]{0,63}$/);
const CardId = z.string().regex(/^c-[0-9a-f]{6,32}$/);
const ItemId = z.string().regex(/^[A-Za-z0-9][A-Za-z0-9_-]{0,80}$/);
const Counts = z.object({
  todo: z.number().int(),
  doing: z.number().int(),
  approval: z.number().int(),
  adjusting: z.number().int(),
  ready: z.number().int(),
  posted: z.number().int(),
});
const Item = z
  .object({
    client: z.string(),
    id: z.string(),
    title: z.string().openapi({ description: "Outside text: typed at the portal." }),
    type: z.enum(PORTAL_TYPES),
    status: z.enum(PORTAL_STATUSES),
    scheduledFor: z.string().nullable(),
    publishedAt: z.string().nullable(),
    createdAt: z.string().nullable(),
    updatedAt: z.string().nullable(),
    editor: z.string().nullable(),
    caption: z.string(),
    files: z.number().int(),
    video: z.boolean(),
    version: z.number().int(),
    missing: z.array(Missing),
    lastNote: z.object({ at: z.string().nullable(), by: z.string().nullable(), text: z.string() }).nullable(),
    postUrl: z.string().nullable(),
    link: z.string(),
  })
  .openapi("PortalItem");
const CardFile = z.object({ id: z.uuid(), name: z.string().max(200) });
const Card = z
  .object({
    id: z.string(),
    client: z.string(),
    title: z.string(),
    type: z.enum(PORTAL_TYPES),
    state: z.enum(PORTAL_CARD_STATES),
    caption: z.string(),
    date: z.string().nullable(),
    editor: z.string().nullable(),
    owner: z.string().nullable(),
    note: z.string(),
    files: z.array(z.object({ id: z.string(), name: z.string() })),
    createdAt: z.number(),
    updatedAt: z.number(),
  })
  .openapi("PortalCard");
const Job = z
  .object({
    id: z.string(),
    state: z.enum(["sending", "done", "failed"]),
    client: z.string(),
    item: z.string().nullable(),
    title: z.string().nullable(),
    missing: z.array(Missing),
    link: z.string().nullable(),
    error: z.string().nullable(),
  })
  .openapi("PortalJob");
const CardFields = {
  title: z.string().trim().min(1).max(120),
  type: z.enum(PORTAL_TYPES),
  state: z.enum(PORTAL_CARD_STATES),
  caption: z.string().max(5000),
  date: z.string().max(40).nullable(),
  editor: z.string().max(40).nullable(),
  owner: z.string().max(120).nullable(),
  note: z.string().max(2000),
  files: z.array(CardFile).max(PORTAL_SEND_FILES),
};
const off = errorResponse("This server has no approval portal");
const unavailable = errorResponse("The approval portal didn't answer");

/**
 * The approval portal (ADR 0177): the team's board per client and the send for a client's approval. Everything goes
 * through the server to the installation's bridge, so its token never reaches a browser. Members read; whoever may
 * give agents work (`assign_work`) changes cards and sends. 404 `portal.off` on a server with no portal.
 */
export function portalRoutes(deps: AppDeps) {
  const { db, adapters } = deps;
  const app = createAppRouter(deps);
  app.use("/organizations/*", requireSession(deps.auth));

  const portalOff = <C extends Context>(c: C) => apiError(c, 404, "portal.off", "This server has no approval portal");
  /** The portal's own refusal as an answer, instead of a 500: its words when it said no, 502 when it didn't answer. */
  const refused = <C extends Context>(c: C, error: unknown) => {
    if (!(error instanceof ApprovalPortalError)) throw error;
    deps.log?.warn("approval portal call failed", { status: error.status, error: error.message });
    return error.status >= 400 && error.status < 500 && error.status !== 401
      ? apiError(c, 400, "portal.refused", error.message)
      : apiError(c, 502, "portal.unavailable", "The approval portal isn't available right now");
  };

  app.openapi(
    createRoute({
      method: "get",
      path: "/organizations/{orgId}/portal",
      tags,
      security,
      summary: "The approval portal's clients, each with its counts per column (members)",
      request: { params: OrgParams },
      responses: {
        200: json(
          z.object({
            clients: z.array(
              z.object({ client: z.string(), counts: Counts, open: z.number().int(), next: z.string().nullable() }),
            ),
          }),
        ),
        502: unavailable,
        ...errors,
        404: off,
      },
    }),
    async (c) => {
      const { orgId } = c.req.valid("param");
      await requirePermission(db, c.get("user").id, orgId, "read");
      const portal = adapters.approvalPortal;
      if (!portal) return portalOff(c);
      try {
        return await (async () => c.json({ clients: await portalOverview(portal) }, 200))();
      } catch (error) {
        return refused(c, error);
      }
    },
  );

  app.openapi(
    createRoute({
      method: "get",
      path: "/organizations/{orgId}/portal/clients/{client}",
      tags,
      security,
      summary: "One client's board: the team's cards and the portal's posts by column (members)",
      request: { params: OrgParams.extend({ client: ClientId }) },
      responses: {
        200: json(
          z.object({
            client: z.string(),
            cards: z.object({ todo: z.array(Card), doing: z.array(Card) }),
            items: z.object({
              approval: z.array(Item),
              adjusting: z.array(Item),
              ready: z.array(Item),
              posted: z.array(Item),
            }),
          }),
        ),
        502: unavailable,
        ...errors,
        404: off,
      },
    }),
    async (c) => {
      const { orgId, client } = c.req.valid("param");
      await requirePermission(db, c.get("user").id, orgId, "read");
      const portal = adapters.approvalPortal;
      if (!portal) return portalOff(c);
      try {
        return await (async () => c.json(await portalBoard(portal, client), 200))();
      } catch (error) {
        return refused(c, error);
      }
    },
  );

  app.openapi(
    createRoute({
      method: "post",
      path: "/organizations/{orgId}/portal/cards",
      tags,
      security,
      summary: "Create a card: a post the team still has to make (assign_work)",
      request: {
        params: OrgParams,
        body: body(z.object({ client: ClientId, ...CardFields }).partial().required({ client: true, title: true })),
      },
      responses: { 200: json(z.object({ card: Card })), 502: unavailable, ...errors, 404: off },
    }),
    async (c) => {
      const { orgId } = c.req.valid("param");
      const { client, ...input } = c.req.valid("json");
      const user = c.get("user");
      await requireChangePermission(db, user.id, orgId, "assign_work");
      const portal = adapters.approvalPortal;
      if (!portal) return portalOff(c);
      try {
        return await (async () => c.json({ card: await portal.createCard(client, input, user.id) }, 200))();
      } catch (error) {
        return refused(c, error);
      }
    },
  );

  app.openapi(
    createRoute({
      method: "patch",
      path: "/organizations/{orgId}/portal/cards/{cardId}",
      tags,
      security,
      summary: "Change a card or move it between `todo` and `doing` (assign_work)",
      request: { params: OrgParams.extend({ cardId: CardId }), body: body(z.object(CardFields).partial()) },
      responses: { 200: json(z.object({ card: Card })), 502: unavailable, ...errors, 404: off },
    }),
    async (c) => {
      const { orgId, cardId } = c.req.valid("param");
      const user = c.get("user");
      await requireChangePermission(db, user.id, orgId, "assign_work");
      const portal = adapters.approvalPortal;
      if (!portal) return portalOff(c);
      try {
        return await (async () =>
        c.json({ card: await portal.updateCard(cardId, c.req.valid("json"), user.id) }, 200),
      )();
      } catch (error) {
        return refused(c, error);
      }
    },
  );

  app.openapi(
    createRoute({
      method: "delete",
      path: "/organizations/{orgId}/portal/cards/{cardId}",
      tags,
      security,
      summary: "Delete a card (assign_work)",
      request: { params: OrgParams.extend({ cardId: CardId }) },
      responses: { ...noContent, 502: unavailable, ...errors, 404: off },
    }),
    async (c) => {
      const { orgId, cardId } = c.req.valid("param");
      const user = c.get("user");
      await requireChangePermission(db, user.id, orgId, "assign_work");
      const portal = adapters.approvalPortal;
      if (!portal) return portalOff(c);
      try {
        return await (async () => {
        await portal.deleteCard(cardId, user.id);
        return c.body(null, 204);
      })();
      } catch (error) {
        return refused(c, error);
      }
    },
  );

  app.openapi(
    createRoute({
      method: "post",
      path: "/organizations/{orgId}/portal/send",
      tags,
      security,
      summary: "Send Drive files to a client's approval (assign_work)",
      description:
        "Each file is read as the caller may download it, then goes to the portal through the bridge. Only the client, the type and the files are required: what a post still lacks comes back in the job's `missing`. Answers at once with the job; read `GET …/portal/jobs/{jobId}` until it is `done` or `failed` (a video takes minutes). `card`: the board's card this send finishes, removed once it is done. The same `key` never sends twice. 429 past 30 sends a minute.",
      request: {
        params: OrgParams,
        body: body(
          z.object({
            client: ClientId,
            type: z.enum(PORTAL_TYPES),
            artifactIds: z.array(z.uuid()).min(1).max(PORTAL_SEND_FILES),
            coverArtifactId: z.uuid().optional(),
            title: z.string().max(120).optional(),
            caption: z.string().max(5000).optional(),
            date: z
              .string()
              .regex(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}/)
              .max(40)
              .optional(),
            editor: z.string().max(40).optional(),
            card: CardId.optional(),
            key: z.string().max(120).optional(),
          }),
        ),
      },
      responses: {
        200: json(z.object({ job: Job })),
        429: errorResponse("Too many sends"),
        502: unavailable,
        ...errors,
        404: off,
      },
    }),
    async (c) => {
      const { orgId } = c.req.valid("param");
      const input = c.req.valid("json");
      const user = c.get("user");
      await requireChangePermission(db, user.id, orgId, "assign_work");
      const artifacts = deps.extras?.artifacts;
      if (!artifacts) throw new Error("artifacts are not configured on this server");
      if (!(await adapters.rateLimiter.consume(`portal-send:${user.id}`, PORTAL_SENDS_PER_PERSON)).allowed) {
        return apiError(c, 429, "rate_limited", "Slow down");
      }
      const portal = adapters.approvalPortal;
      if (!portal) return portalOff(c);
      try {
        return await (async () => {
        const job = await sendForApproval(portal, personPortalReader(artifacts, user.id, orgId), {
          ...input,
          key: input.key ? `${orgId}:${input.key}` : undefined,
          by: user.id,
        });
        return c.json({ job }, 200);
      })();
      } catch (error) {
        return refused(c, error);
      }
    },
  );

  app.openapi(
    createRoute({
      method: "get",
      path: "/organizations/{orgId}/portal/jobs/{jobId}",
      tags,
      security,
      summary: "How a send is going (members)",
      request: { params: OrgParams.extend({ jobId: z.string().regex(/^[0-9a-f]{8,32}$/) }) },
      responses: { 200: json(z.object({ job: Job })), 502: unavailable, ...errors, 404: off },
    }),
    async (c) => {
      const { orgId, jobId } = c.req.valid("param");
      await requirePermission(db, c.get("user").id, orgId, "read");
      const portal = adapters.approvalPortal;
      if (!portal) return portalOff(c);
      try {
        return await (async () => {
        const job = await portal.job(jobId);
        return job ? c.json({ job }, 200) : apiError(c, 404, "not_found", "No such send");
      })();
      } catch (error) {
        return refused(c, error);
      }
    },
  );

  app.openapi(
    createRoute({
      method: "patch",
      path: "/organizations/{orgId}/portal/clients/{client}/items/{itemId}",
      tags,
      security,
      summary: "Complete or change a post at the portal: title, caption, date, status, editor (assign_work)",
      request: {
        params: OrgParams.extend({ client: ClientId, itemId: ItemId }),
        body: body(
          z
            .object({
              title: z.string().trim().min(1).max(120),
              caption: z.string().max(5000),
              scheduledFor: z.string().max(40).nullable(),
              status: z.enum(PORTAL_STATUSES),
              editor: z.string().max(40),
            })
            .partial(),
        ),
      },
      responses: { ...noContent, 502: unavailable, ...errors, 404: off },
    }),
    async (c) => {
      const { orgId, client, itemId } = c.req.valid("param");
      const user = c.get("user");
      await requireChangePermission(db, user.id, orgId, "assign_work");
      const portal = adapters.approvalPortal;
      if (!portal) return portalOff(c);
      try {
        return await (async () => {
        await portal.editItem(client, itemId, c.req.valid("json"), user.id);
        return c.body(null, 204);
      })();
      } catch (error) {
        return refused(c, error);
      }
    },
  );

  return app;
}
