import {
  ApprovalPortalError,
  PORTAL_CARD_STATES,
  PORTAL_LABEL_COLORS,
  PORTAL_STATUSES,
  PORTAL_TYPES,
} from "@agenteschat/adapters";
import {
  can,
  myPortalWork,
  PORTAL_COLUMNS,
  PORTAL_SEND_FILES,
  PORTAL_WHEN,
  personPortalReader,
  portalBoard,
  portalOverview,
  portalPipeline,
  portalPlan,
  requireChangePermission,
  requirePermission,
  sendForApproval,
} from "@agenteschat/engine";
import { createRoute, z } from "@hono/zod-openapi";
import type { Context } from "hono";
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
  approved: z.number().int(),
  scheduled: z.number().int(),
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
    released: z.boolean().openapi({
      description: "Approved and already released for scheduling: `scheduled` within minutes, never released twice.",
    }),
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
    produceOn: z.string().nullable().openapi({
      description: "The day whoever is on it makes it (YYYY-MM-DD). Not `date`, the day the post goes out.",
    }),
    list: z.string().nullable(),
    order: z.number(),
    description: z.string(),
    labels: z.array(z.string()),
    members: z.array(z.string()).openapi({ description: "Workspace members on it (user ids)." }),
    checklist: z.array(z.object({ id: z.string(), text: z.string(), done: z.boolean() })),
    comments: z.array(z.object({ id: z.string(), by: z.string(), text: z.string(), at: z.number() })),
    item: z.string().nullable().openapi({ description: "The portal's post this card became, once sent." }),
    createdAt: z.number(),
    updatedAt: z.number(),
  })
  .openapi("PortalCard");
const PlanCard = Card.extend({
  stage: z.enum(PORTAL_COLUMNS).openapi({
    description: "Where the post is: the card's own stage, or the portal's once it was sent. Never typed.",
  }),
  postOn: z.string().nullable(),
  link: z.string().nullable(),
}).openapi("PortalPlanCard");
const ListId = z.string().regex(/^l-[0-9a-f]{6,32}$/);
const LabelId = z.string().regex(/^e-[0-9a-f]{6,32}$/);
const List = z.object({ id: z.string(), name: z.string() }).openapi("PortalList");
const Label = z.object({ id: z.string(), name: z.string(), color: z.enum(PORTAL_LABEL_COLORS) }).openapi("PortalLabel");
const ListName = z.string().trim().min(1).max(80);
const LabelName = z.string().trim().min(1).max(40);
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
  produceOn: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/)
    .nullable(),
  list: ListId.nullable(),
  order: z.number().finite(),
  description: z.string().max(20000),
  labels: z.array(LabelId).max(30),
  members: z.array(z.string().min(1).max(64)).max(30),
  checklist: z.array(z.object({ id: z.string().min(1).max(40), text: z.string().max(300), done: z.boolean() })).max(60),
};
const State = z
  .object({
    stale: z.boolean().openapi({
      description: "The portal isn't answering: the posts are the last good read, taken at `readAt`.",
    }),
    readAt: z.string().nullable(),
    queued: z.number().int().openapi({ description: "Edits and schedules still on their way to the portal." }),
  })
  .openapi("PortalState");
const off = errorResponse("This server has no approval portal");
const unavailable = errorResponse("The approval portal didn't answer");

/**
 * The approval portal (ADR 9001): the team's board per client and the send for a client's approval. Everything goes
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
            state: State,
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
        return await (async () =>
          c.json({ clients: await portalOverview(portal), state: await portal.state() }, 200))();
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
            state: State,
            cards: z.object({ todo: z.array(Card), doing: z.array(Card) }),
            items: z.object({
              approval: z.array(Item),
              adjusting: z.array(Item),
              approved: z.array(Item),
              scheduled: z.array(Item),
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
        body: body(
          z
            .object({ client: ClientId, ...CardFields })
            .partial()
            .required({ client: true, title: true }),
        ),
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
          c.json({ card: await portal.updateCard(cardId, c.req.valid("json"), user.id) }, 200))();
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

  app.openapi(
    createRoute({
      method: "post",
      path: "/organizations/{orgId}/portal/clients/{client}/items/{itemId}/schedule",
      tags,
      security,
      summary:
        "Schedule an approved post: released at the portal, which takes it to the publishing service (assign_work)",
      description:
        "Only a post the client approved, at a time in the future. The post turns `scheduled` once the publishing service has it, usually within minutes; until then it stays `approved` with its date.",
      request: {
        params: OrgParams.extend({ client: ClientId, itemId: ItemId }),
        body: body(z.object({ scheduledFor: z.string().regex(PORTAL_WHEN).max(40) })),
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
        await portal.scheduleItem(client, itemId, c.req.valid("json").scheduledFor, user.id);
        return c.body(null, 204);
      } catch (error) {
        return refused(c, error);
      }
    },
  );

  // ── The strategic schedule (ADR 9001 §8) ──────────────────────────────────────────────────────────────────────

  /** One typed handler for a portal call: off, the call, or the portal's refusal as an answer. */
  const guarded = async <C extends Context, T>(
    c: C,
    run: (portal: NonNullable<typeof adapters.approvalPortal>) => Promise<T>,
  ) => {
    const portal = adapters.approvalPortal;
    if (!portal) return { ok: false as const, response: portalOff(c) };
    try {
      return { ok: true as const, value: await run(portal) };
    } catch (error) {
      return { ok: false as const, response: refused(c, error) };
    }
  };

  app.openapi(
    createRoute({
      method: "get",
      path: "/organizations/{orgId}/portal/pipeline",
      tags,
      security,
      summary: "Everything not posted yet across every client, one entry each: the overview's pipeline (members)",
      description:
        "A team's card or a post at the portal no card stands for, with its stage, the members on it, its production and post dates, whether it is late, and the client's note when it waits on an adjustment.",
      request: { params: OrgParams },
      responses: {
        200: json(
          z.object({
            day: z.string(),
            state: State,
            entries: z.array(
              z.object({
                client: z.string(),
                kind: z.enum(["card", "post"]),
                id: z.string(),
                title: z.string(),
                type: z.enum(PORTAL_TYPES),
                stage: z.enum(PORTAL_COLUMNS),
                members: z.array(z.string()),
                produceOn: z.string().nullable(),
                postOn: z.string().nullable(),
                late: z.boolean(),
                note: z.string().nullable(),
                link: z.string().nullable(),
                updatedAt: z.number(),
              }),
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
      const out = await guarded(c, (portal) => portalPipeline(portal));
      return out.ok ? c.json(out.value, 200) : out.response;
    },
  );

  app.openapi(
    createRoute({
      method: "get",
      path: "/organizations/{orgId}/portal/clients/{client}/plan",
      tags,
      security,
      summary:
        "A client's strategic schedule: its lists with their cards, the labels, and posts no card stands for (members)",
      request: { params: OrgParams.extend({ client: ClientId }) },
      responses: {
        200: json(
          z.object({
            client: z.string(),
            state: State,
            lists: z.array(List.extend({ cards: z.array(PlanCard) })),
            unlisted: z.array(PlanCard),
            loose: z.array(Item),
            labels: z.array(Label),
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
      const out = await guarded(c, (portal) => portalPlan(portal, client));
      return out.ok ? c.json(out.value, 200) : out.response;
    },
  );

  app.openapi(
    createRoute({
      method: "get",
      path: "/organizations/{orgId}/portal/mine",
      tags,
      security,
      summary: "What the caller has to make: the cards they are on that aren't out yet, by production date (members)",
      description:
        "`late` (production date before today), `today`, `next` and `undated`. Today is the portal's own day. A card leaves once its post is with the client, approved or out.",
      request: { params: OrgParams },
      responses: {
        200: json(
          z.object({
            day: z.string(),
            late: z.array(PlanCard),
            today: z.array(PlanCard),
            next: z.array(PlanCard),
            undated: z.array(PlanCard),
          }),
        ),
        502: unavailable,
        ...errors,
        404: off,
      },
    }),
    async (c) => {
      const { orgId } = c.req.valid("param");
      const user = c.get("user");
      await requirePermission(db, user.id, orgId, "read");
      const out = await guarded(c, (portal) => myPortalWork(portal, user.id));
      if (!out.ok) return out.response;
      const work = out.value;
      return c.json(
        { day: work.today, late: work.late, today: work.today_, next: work.next, undated: work.undated },
        200,
      );
    },
  );

  app.openapi(
    createRoute({
      method: "post",
      path: "/organizations/{orgId}/portal/clients/{client}/lists",
      tags,
      security,
      summary: "Add a list to a client's schedule; a name it already has answers that list (assign_work)",
      request: { params: OrgParams.extend({ client: ClientId }), body: body(z.object({ name: ListName })) },
      responses: { 200: json(z.object({ list: List })), 502: unavailable, ...errors, 404: off },
    }),
    async (c) => {
      const { orgId, client } = c.req.valid("param");
      await requireChangePermission(db, c.get("user").id, orgId, "assign_work");
      const out = await guarded(c, (portal) => portal.createList(client, c.req.valid("json").name));
      return out.ok ? c.json({ list: out.value }, 200) : out.response;
    },
  );

  app.openapi(
    createRoute({
      method: "put",
      path: "/organizations/{orgId}/portal/clients/{client}/lists/order",
      tags,
      security,
      summary: "Reorder a client's lists: every list once, in the new order (assign_work)",
      request: {
        params: OrgParams.extend({ client: ClientId }),
        body: body(z.object({ ids: z.array(ListId).max(200) })),
      },
      responses: { 200: json(z.object({ lists: z.array(List) })), 502: unavailable, ...errors, 404: off },
    }),
    async (c) => {
      const { orgId, client } = c.req.valid("param");
      await requireChangePermission(db, c.get("user").id, orgId, "assign_work");
      const out = await guarded(c, (portal) => portal.orderLists(client, c.req.valid("json").ids));
      return out.ok ? c.json({ lists: out.value }, 200) : out.response;
    },
  );

  app.openapi(
    createRoute({
      method: "patch",
      path: "/organizations/{orgId}/portal/lists/{listId}",
      tags,
      security,
      summary: "Rename a list (assign_work)",
      request: { params: OrgParams.extend({ listId: ListId }), body: body(z.object({ name: ListName })) },
      responses: { 200: json(z.object({ list: List })), 502: unavailable, ...errors, 404: off },
    }),
    async (c) => {
      const { orgId, listId } = c.req.valid("param");
      await requireChangePermission(db, c.get("user").id, orgId, "assign_work");
      const out = await guarded(c, (portal) => portal.renameList(listId, c.req.valid("json").name));
      return out.ok ? c.json({ list: out.value }, 200) : out.response;
    },
  );

  app.openapi(
    createRoute({
      method: "delete",
      path: "/organizations/{orgId}/portal/lists/{listId}",
      tags,
      security,
      summary: "Delete a list; its cards stay, in no list (assign_work)",
      request: { params: OrgParams.extend({ listId: ListId }) },
      responses: { ...noContent, 502: unavailable, ...errors, 404: off },
    }),
    async (c) => {
      const { orgId, listId } = c.req.valid("param");
      await requireChangePermission(db, c.get("user").id, orgId, "assign_work");
      const out = await guarded(c, (portal) => portal.deleteList(listId));
      return out.ok ? c.body(null, 204) : out.response;
    },
  );

  app.openapi(
    createRoute({
      method: "get",
      path: "/organizations/{orgId}/portal/labels",
      tags,
      security,
      summary: "The team's labels, the same for every client (members)",
      request: { params: OrgParams },
      responses: { 200: json(z.object({ labels: z.array(Label) })), 502: unavailable, ...errors, 404: off },
    }),
    async (c) => {
      const { orgId } = c.req.valid("param");
      await requirePermission(db, c.get("user").id, orgId, "read");
      const out = await guarded(c, (portal) => portal.labels());
      return out.ok ? c.json({ labels: out.value }, 200) : out.response;
    },
  );

  app.openapi(
    createRoute({
      method: "post",
      path: "/organizations/{orgId}/portal/labels",
      tags,
      security,
      summary: "Create a label (assign_work)",
      request: {
        params: OrgParams,
        body: body(z.object({ name: LabelName, color: z.enum(PORTAL_LABEL_COLORS) })),
      },
      responses: { 200: json(z.object({ label: Label })), 502: unavailable, ...errors, 404: off },
    }),
    async (c) => {
      const { orgId } = c.req.valid("param");
      await requireChangePermission(db, c.get("user").id, orgId, "assign_work");
      const { name, color } = c.req.valid("json");
      const out = await guarded(c, (portal) => portal.createLabel(name, color));
      return out.ok ? c.json({ label: out.value }, 200) : out.response;
    },
  );

  app.openapi(
    createRoute({
      method: "patch",
      path: "/organizations/{orgId}/portal/labels/{labelId}",
      tags,
      security,
      summary: "Rename or recolour a label (assign_work)",
      request: {
        params: OrgParams.extend({ labelId: LabelId }),
        body: body(z.object({ name: LabelName, color: z.enum(PORTAL_LABEL_COLORS) }).partial()),
      },
      responses: { 200: json(z.object({ label: Label })), 502: unavailable, ...errors, 404: off },
    }),
    async (c) => {
      const { orgId, labelId } = c.req.valid("param");
      await requireChangePermission(db, c.get("user").id, orgId, "assign_work");
      const out = await guarded(c, (portal) => portal.updateLabel(labelId, c.req.valid("json")));
      return out.ok ? c.json({ label: out.value }, 200) : out.response;
    },
  );

  app.openapi(
    createRoute({
      method: "delete",
      path: "/organizations/{orgId}/portal/labels/{labelId}",
      tags,
      security,
      summary: "Delete a label; it leaves every card (assign_work)",
      request: { params: OrgParams.extend({ labelId: LabelId }) },
      responses: { ...noContent, 502: unavailable, ...errors, 404: off },
    }),
    async (c) => {
      const { orgId, labelId } = c.req.valid("param");
      await requireChangePermission(db, c.get("user").id, orgId, "assign_work");
      const out = await guarded(c, (portal) => portal.deleteLabel(labelId));
      return out.ok ? c.body(null, 204) : out.response;
    },
  );

  app.openapi(
    createRoute({
      method: "post",
      path: "/organizations/{orgId}/portal/cards/{cardId}/comments",
      tags,
      security,
      summary: "Comment on a card (members who may post)",
      request: {
        params: OrgParams.extend({ cardId: CardId }),
        body: body(z.object({ text: z.string().trim().min(1).max(5000) })),
      },
      responses: { 200: json(z.object({ card: Card })), 502: unavailable, ...errors, 404: off },
    }),
    async (c) => {
      const { orgId, cardId } = c.req.valid("param");
      const user = c.get("user");
      await requireChangePermission(db, user.id, orgId, "post");
      const out = await guarded(c, (portal) => portal.comment(cardId, c.req.valid("json").text, user.id));
      return out.ok ? c.json({ card: out.value }, 200) : out.response;
    },
  );

  app.openapi(
    createRoute({
      method: "delete",
      path: "/organizations/{orgId}/portal/cards/{cardId}/comments/{commentId}",
      tags,
      security,
      summary: "Delete a comment: one's own, or any with assign_work",
      request: {
        params: OrgParams.extend({ cardId: CardId, commentId: z.string().regex(/^m-[0-9a-f]{6,32}$/) }),
      },
      responses: { 200: json(z.object({ card: Card })), 502: unavailable, ...errors, 404: off },
    }),
    async (c) => {
      const { orgId, cardId, commentId } = c.req.valid("param");
      const user = c.get("user");
      const membership = await requireChangePermission(db, user.id, orgId, "post");
      const out = await guarded(c, async (portal) => {
        const card = (await portal.cards()).find((found) => found.id === cardId);
        const comment = card?.comments.find((m) => m.id === commentId);
        if (!comment) return null;
        if (comment.by !== user.id && !can(membership, "assign_work")) return "forbidden" as const;
        return portal.deleteComment(cardId, commentId);
      });
      if (!out.ok) return out.response;
      if (out.value === null) return apiError(c, 404, "not_found", "No such comment");
      if (out.value === "forbidden") return apiError(c, 403, "forbidden", "That comment isn't yours");
      return c.json({ card: out.value }, 200);
    },
  );

  return app;
}
