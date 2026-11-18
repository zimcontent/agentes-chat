import {
  ApprovalPortalError,
  PORTAL_CARD_STATES,
  PORTAL_CLIENT_COLORS,
  PORTAL_LABEL_COLORS,
  PORTAL_LIST_KINDS,
  PORTAL_STATUSES,
  PORTAL_TYPES,
} from "@agenteschat/adapters";
import {
  AFTER_APPROVE,
  approveForClient,
  can,
  cancelPortalTask,
  getPortalClient,
  listPortalClients,
  makeClientLink,
  myPortalWork,
  PORTAL_COLUMNS,
  PORTAL_SEND_FILES,
  PORTAL_WHEN,
  personPortalReader,
  portalBelongsTo,
  portalBoard,
  portalClientLogoFile,
  portalClientSettingsOf,
  portalHere,
  portalLogoPath,
  portalNoticeSettingsOf,
  portalOverview,
  portalPipeline,
  portalPlan,
  portalTaskRefs,
  portalToSchedule,
  recordAudit,
  removePortalClient,
  removePortalClientLogo,
  requireChangePermission,
  requirePermission,
  revokeClientLink,
  sendForApproval,
  setAfterApprove,
  setPortalClientLogo,
  setPortalNoticeNumber,
  startPortalAgent,
  syncPortalTasks,
  TEAM_APPROVAL_NOTE,
  upsertPortalClient,
} from "@agenteschat/engine";
import { createRoute, z } from "@hono/zod-openapi";
import type { Context } from "hono";
import { apiError, errorResponse } from "../../http/errors";
import { imageFile } from "../../http/image-file";
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
/** A client of the installation's own portal, with its contacts and the address of its link (`docs/adr/doug-0020`). */
const PortalClient = z
  .object({
    id: z.string(),
    client: z.string(),
    name: z.string(),
    contacts: z.array(
      z.object({ id: z.string(), name: z.string(), email: z.string().nullable(), whatsapp: z.string().nullable() }),
    ),
    color: z.enum(PORTAL_CLIENT_COLORS).nullable(),
    link: z.string().nullable().openapi({ description: "The client's page's own address; null while revoked." }),
    revoked: z.boolean(),
    createdAt: z.string(),
  })
  .openapi("PortalClient");
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
    task: z.string().nullable().openapi({ description: "The workspace task that stands for it (its id)." }),
    done: z.boolean().openapi({ description: "Finished without going through the portal: history, nothing to make." }),
    material: z.boolean().openapi({ description: "In a list of the client's materials: kept for reference, no work." }),
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
const ListKind = z.enum(PORTAL_LIST_KINDS).openapi({
  description:
    "`plan`: a list of the strategic schedule. `materials`: the client's materials (logins, links), no work.",
});
const List = z.object({ id: z.string(), name: z.string(), kind: ListKind }).openapi("PortalList");
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
  members: z
    .array(z.string().min(1).max(64))
    .max(30)
    .openapi({ description: "People and agents on it; the first has its task, and an agent put first starts on it." }),
  checklist: z.array(z.object({ id: z.string().min(1).max(40), text: z.string().max(300), done: z.boolean() })).max(60),
  done: z.boolean(),
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
  const { db, adapters, config } = deps;
  const app = createAppRouter(deps);
  app.use("/organizations/*", requireSession(deps.auth));
  app.use("/portal-logos/*", requireSession(deps.auth));

  const portalOff = <C extends Context>(c: C) => apiError(c, 404, "portal.off", "This server has no approval portal");
  // The portal is one workspace's operation (ADR 9001 §18): every other workspace on this server answers as if there
  // were none, so a second business never sees the first one's clients and posts.
  const onlyItsWorkspace = async (c: Context, next: () => Promise<void>) => {
    const orgId = /\/organizations\/([^/]+)\/portal(?:\/|$)/.exec(c.req.path)?.[1];
    if (orgId && !(await portalHere(db, orgId))) return portalOff(c);
    await next();
  };
  app.use("/organizations/:orgId/portal", onlyItsWorkspace);
  app.use("/organizations/:orgId/portal/*", onlyItsWorkspace);
  /** The portal's own refusal as an answer, instead of a 500: its words when it said no, 502 when it didn't answer. */
  const refused = <C extends Context>(c: C, error: unknown) => {
    if (!(error instanceof ApprovalPortalError)) throw error;
    deps.log?.warn("approval portal call failed", { status: error.status, error: error.message });
    return error.status >= 400 && error.status < 500 && error.status !== 401
      ? apiError(c, 400, "portal.refused", error.message)
      : apiError(c, 502, "portal.unavailable", "The approval portal isn't available right now");
  };

  /**
   * After a person changed a card: its task follows at once instead of at the worker's next pass, and an agent the
   * person just put first on it starts on the task (ADR 9001 §11). Never fails the change: the worker's pass repairs.
   */
  const inStep = async (
    orgId: string,
    userId: string,
    cardId: string,
    leadBefore: string | null,
    lead: string | null,
  ) => {
    const portal = adapters.approvalPortal;
    if (!portal) return;
    const taskDeps = { db, pubsub: adapters.pubsub, log: deps.log };
    try {
      await syncPortalTasks(taskDeps, portal, orgId, { cardId });
      if (lead && lead !== leadBefore) {
        const ref = (await portalTaskRefs(db, orgId)).get(cardId);
        if (ref?.assignee?.type === "agent" && ref.assignee.id === lead) {
          await startPortalAgent(taskDeps, userId, orgId, cardId, lead);
          deps.wakeWorkers?.();
        }
      }
    } catch (error) {
      deps.log?.warn("approval portal: a card's task could not follow it", {
        card: cardId,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  };

  app.openapi(
    createRoute({
      method: "get",
      path: "/organizations/{orgId}/portal/tasks",
      tags,
      security,
      summary: "Each card's task: its id and number, to open it from the board (members)",
      request: { params: OrgParams },
      responses: {
        200: json(
          z.object({ tasks: z.array(z.object({ cardId: z.string(), id: z.string(), number: z.number().int() })) }),
        ),
        ...errors,
        404: off,
      },
    }),
    async (c) => {
      const { orgId } = c.req.valid("param");
      await requirePermission(db, c.get("user").id, orgId, "read");
      if (!adapters.approvalPortal) return portalOff(c);
      const refs = await portalTaskRefs(db, orgId);
      return c.json({ tasks: [...refs].map(([cardId, ref]) => ({ cardId, id: ref.id, number: ref.number })) }, 200);
    },
  );

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
              z.object({
                client: z.string(),
                counts: Counts,
                open: z.number().int(),
                next: z.string().nullable(),
                color: z.enum(PORTAL_CLIENT_COLORS).nullable(),
                logo: z.string().nullable().openapi({ description: "Where the client's logo is read; null: none." }),
              }),
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
          c.json(
            {
              clients: (await portalOverview(portal)).map((summary) => ({
                ...summary,
                logo: summary.logo ? portalLogoPath(orgId, summary.client, summary.logo) : null,
              })),
              state: await portal.state(),
            },
            200,
          ))();
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
        return await (async () => {
          const card = await portal.createCard(client, input, user.id);
          await inStep(orgId, user.id, card.id, null, card.members[0] ?? null);
          return c.json({ card }, 200);
        })();
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
        return await (async () => {
          const patch = c.req.valid("json");
          const before = patch.members ? (await portal.cards()).find((card) => card.id === cardId) : undefined;
          const card = await portal.updateCard(cardId, patch, user.id);
          await inStep(orgId, user.id, card.id, before?.members[0] ?? null, card.members[0] ?? null);
          return c.json({ card }, 200);
        })();
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
          await cancelPortalTask(
            { db, pubsub: adapters.pubsub, log: deps.log },
            { type: "person", userId: user.id },
            orgId,
            cardId,
          ).catch(() => {});
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
              // A date is only cleared here; it is set by scheduling the post (ADR 9001, addendum 2026-11-17).
              scheduledFor: z.null(),
              // Scheduled and posted come from the portal itself, never from an edit.
              status: z.enum(PORTAL_STATUSES).exclude(["scheduled", "published"]),
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

  app.openapi(
    createRoute({
      method: "post",
      path: "/organizations/{orgId}/portal/clients/{client}/items/{itemId}/approve",
      tags,
      security,
      summary: "Approve a post in the client's place, when the client stopped answering (administrator)",
      description:
        "ADR 9001 §19. Only a post waiting on the client (sent, seen, or its new version sent). It turns `approved` at the portal, as a client's approval would, and the card it came from says who approved it and why.",
      request: {
        params: OrgParams.extend({ client: ClientId, itemId: ItemId }),
        body: body(z.object({ note: z.string().trim().max(TEAM_APPROVAL_NOTE).optional() })),
      },
      responses: { ...noContent, 502: unavailable, ...errors, 404: off },
    }),
    async (c) => {
      const { orgId, client, itemId } = c.req.valid("param");
      const user = c.get("user");
      await requireChangePermission(db, user.id, orgId, "administrator");
      const portal = adapters.approvalPortal;
      if (!portal) return portalOff(c);
      const note = c.req.valid("json").note || undefined;
      try {
        const post = await approveForClient(portal, { client, item: itemId, note, by: user.id, byName: user.name });
        await recordAudit(db, {
          orgId,
          actor: { type: "person", id: user.id },
          action: "portal.approved_for_client",
          target: { type: "portal_post", id: `${client}/${itemId}` },
          details: { title: post.title, client, ...(note ? { note } : {}) },
        });
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
      path: "/organizations/{orgId}/portal/to-schedule",
      tags,
      security,
      summary: "Approved posts nobody scheduled yet, across every client, the longest waiting first (members)",
      description:
        "What waits for a person of the team to schedule by hand: Home lists them under Waiting on you. A post only gets a date when someone schedules it (ADR 9001, addendum 2026-11-17).",
      request: { params: OrgParams },
      responses: { 200: json(z.object({ items: z.array(Item) })), 502: unavailable, ...errors, 404: off },
    }),
    async (c) => {
      const { orgId } = c.req.valid("param");
      await requirePermission(db, c.get("user").id, orgId, "read");
      const out = await guarded(c, async (portal) => ({ items: await portalToSchedule(portal) }));
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
      request: {
        params: OrgParams.extend({ client: ClientId }),
        body: body(z.object({ name: ListName, kind: ListKind.optional() })),
      },
      responses: { 200: json(z.object({ list: List })), 502: unavailable, ...errors, 404: off },
    }),
    async (c) => {
      const { orgId, client } = c.req.valid("param");
      await requireChangePermission(db, c.get("user").id, orgId, "assign_work");
      const { name, kind } = c.req.valid("json");
      const out = await guarded(c, (portal) => portal.createList(client, name, kind));
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
      summary: "Rename a list, or move it between the schedule and the client's materials (assign_work)",
      request: {
        params: OrgParams.extend({ listId: ListId }),
        body: body(
          z
            .object({ name: ListName.optional(), kind: ListKind.optional() })
            .refine((v) => v.name !== undefined || v.kind !== undefined, { message: "Give a name or a kind" }),
        ),
      },
      responses: { 200: json(z.object({ list: List })), 502: unavailable, ...errors, 404: off },
    }),
    async (c) => {
      const { orgId, listId } = c.req.valid("param");
      await requireChangePermission(db, c.get("user").id, orgId, "assign_work");
      const { name, kind } = c.req.valid("json");
      const out = await guarded(c, async (portal) => {
        let list = name !== undefined ? await portal.renameList(listId, name) : null;
        if (kind !== undefined) list = await portal.setListKind(listId, kind);
        return list as NonNullable<typeof list>;
      });
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

  // What an approval in the Revisor means for each client (docs/adr/doug-0010-design-review.md §8).
  app.openapi(
    createRoute({
      method: "get",
      path: "/organizations/{orgId}/portal/client-settings",
      tags,
      security,
      summary:
        "What an approved design piece does for each client: goes to the client (`portal`) or `direct` (members)",
      request: { params: OrgParams },
      responses: {
        200: json(
          z.object({
            settings: z.array(z.object({ client: z.string(), afterApprove: z.enum(AFTER_APPROVE) })),
          }),
        ),
        ...errors,
      },
    }),
    async (c) => {
      const { orgId } = c.req.valid("param");
      await requirePermission(db, c.get("user").id, orgId, "read");
      const rows = await portalClientSettingsOf(db, orgId);
      return c.json(
        {
          settings: rows.map(
            (r) => ({ client: r.client, afterApprove: r.afterApprove === "direct" ? "direct" : "portal" }) as const,
          ),
        },
        200,
      );
    },
  );

  app.openapi(
    createRoute({
      method: "put",
      path: "/organizations/{orgId}/portal/clients/{client}/after-approve",
      tags,
      security,
      summary:
        "Set what an approved design piece does for a client: to the client's approval (`portal`) or approved and scheduled on its card's day (`direct`) (assign_work)",
      request: {
        params: OrgParams.extend({ client: ClientId }),
        body: body(z.object({ afterApprove: z.enum(AFTER_APPROVE) })),
      },
      responses: { ...noContent, ...errors },
    }),
    async (c) => {
      const { orgId, client } = c.req.valid("param");
      const user = c.get("user");
      await requireChangePermission(db, user.id, orgId, "assign_work");
      await setAfterApprove(db, orgId, client, c.req.valid("json").afterApprove, user.id);
      return c.body(null, 204);
    },
  );

  app.openapi(
    createRoute({
      method: "put",
      path: "/organizations/{orgId}/portal/clients/{client}/color",
      tags,
      security,
      summary: "Give a client its colour, or take it away with null (assign_work)",
      request: {
        params: OrgParams.extend({ client: ClientId }),
        body: body(z.object({ color: z.enum(PORTAL_CLIENT_COLORS).nullable() })),
      },
      responses: { ...noContent, 502: unavailable, ...errors, 404: off },
    }),
    async (c) => {
      const { orgId, client } = c.req.valid("param");
      await requireChangePermission(db, c.get("user").id, orgId, "assign_work");
      const out = await guarded(c, (portal) => portal.setClientColor(client, c.req.valid("json").color));
      return out.ok ? c.body(null, 204) : out.response;
    },
  );

  app.openapi(
    createRoute({
      method: "put",
      path: "/organizations/{orgId}/portal/clients/{client}/logo",
      tags,
      security,
      summary: "Set a client's logo: a square JPEG, PNG or WebP up to 2 MB (assign_work)",
      request: {
        params: OrgParams.extend({ client: ClientId }),
        body: body(
          z.object({
            imageBase64: z
              .string()
              .min(1)
              .max(3_000_000)
              .openapi({ description: "The image bytes in base64 (a data: URL prefix is accepted)." }),
            contentType: z.enum(["image/jpeg", "image/png", "image/webp"]),
          }),
        ),
      },
      responses: {
        200: json(z.object({ logo: z.string() })),
        429: errorResponse("Too many logo changes"),
        502: unavailable,
        ...errors,
        404: off,
      },
    }),
    async (c) => {
      const { orgId, client } = c.req.valid("param");
      await requireChangePermission(db, c.get("user").id, orgId, "assign_work");
      const limit = await adapters.rateLimiter.consume(`portal-logo:${orgId}`, { limit: 40, windowMs: 3600_000 });
      if (!limit.allowed) return apiError(c, 429, "rate_limited", "Too many logo changes. Try again later.");
      const out = await guarded(c, (portal) =>
        setPortalClientLogo({ blobs: adapters.platformBlobs, portal }, orgId, client, c.req.valid("json")),
      );
      return out.ok ? c.json(out.value, 200) : out.response;
    },
  );

  app.openapi(
    createRoute({
      method: "delete",
      path: "/organizations/{orgId}/portal/clients/{client}/logo",
      tags,
      security,
      summary: "Remove a client's logo: back to its initials (assign_work)",
      request: { params: OrgParams.extend({ client: ClientId }) },
      responses: { ...noContent, 502: unavailable, ...errors, 404: off },
    }),
    async (c) => {
      const { orgId, client } = c.req.valid("param");
      await requireChangePermission(db, c.get("user").id, orgId, "assign_work");
      const out = await guarded(c, (portal) =>
        removePortalClientLogo({ blobs: adapters.platformBlobs, portal }, orgId, client),
      );
      return out.ok ? c.body(null, 204) : out.response;
    },
  );

  // The logo's file, for the org's members, like a channel's photo. The name is a content hash: cached for good.
  app.get("/portal-logos/:orgId/:client/:file", async (c) =>
    imageFile(
      await portalClientLogoFile(
        { db, blobs: adapters.platformBlobs },
        c.get("user").id,
        c.req.param("orgId"),
        c.req.param("client"),
        c.req.param("file"),
      ),
    ),
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

  // ---------- the installation's own portal: its clients and their links ----------

  // Who may see the clients and their links: only where this server keeps its own portal (a bridge's clients live at
  // that service). Every route below answers `404 portal.off` on a server with a bridge or with no portal.
  const ownPortal = () => Boolean(adapters.approvalPortalEmbedded && adapters.approvalPortal);
  const clientDeps = () => ({ db, publicUrl: config.PUBLIC_URL, secret: config.AGENTES_SECRET });
  /**
   * The portal is one workspace's (ADR 9001 §18, `portalBelongsTo`): every other workspace on the same server answers
   * `404 portal.off` on each of these, so a second business never sees or makes a client of the first. Read on every
   * request, not cached: a client made here is the workspace's from then on.
   */
  const itsPortal = async <C extends Context>(c: C, orgId: string) => {
    if (!ownPortal() || !(await portalBelongsTo(db, orgId))) {
      return portalOff(c);
    }
    return null;
  };
  /** What a change of a client or its link leaves in the log (audit.ts): who, what, and which one. */
  const auditClient = async (
    orgId: string,
    userId: string,
    action: "portal.client_created" | "portal.client_updated" | "portal.client_removed" | "portal.link_made" | "portal.link_revoked",
    client: string,
    details: Record<string, unknown> = {},
  ) =>
    recordAudit(db, {
      orgId,
      actor: { type: "person", id: userId },
      action,
      target: { type: "portal_client", id: client },
      details,
    });

  app.openapi(
    createRoute({
      method: "get",
      path: "/organizations/{orgId}/portal-clients",
      tags,
      security,
      summary: "The installation's portal clients, each with its contacts and its own link (members)",
      description:
        "On a server that keeps its own approval portal (no bridge): each client the team makes work for, its name, its contacts told when a post waits on them, and the address of its link, `<PUBLIC_URL>/p/<token>`. 404 `portal.off` when the portal is a bridge's or absent.",
      request: { params: OrgParams },
      responses: {
        200: json(
          z.object({
            clients: z.array(PortalClient.omit({ link: true })),
            /** The clients' links, shown only to who may manage the portal (`assign_work`), by the client's id. */
            links: z.record(z.string(), z.string()).openapi({ description: "Each client's live address; a client the caller can't manage is absent." }),
          }),
        ),
        ...errors,
        404: off,
      },
    }),
    async (c) => {
      const { orgId } = c.req.valid("param");
      const refused = await itsPortal(c, orgId);
      if (refused) return refused;
      const membership = await requirePermission(db, c.get("user").id, orgId, "read");
      const clients = await listPortalClients(clientDeps(), orgId);
      // A client's link is its own address: a member who may read the clients sees the names and contacts, and only
      // someone who may manage the portal (`assign_work`) is given the links to send.
      const mayManage = can(membership, "assign_work");
      const links: Record<string, string> = {};
      for (const client of clients) if (mayManage && client.link) links[client.client] = client.link;
      return c.json(
        { clients: clients.map(({ link: _link, ...row }) => row), links },
        200,
      );
    },
  );

  app.openapi(
    createRoute({
      method: "put",
      path: "/organizations/{orgId}/portal-clients/{client}",
      tags,
      security,
      summary: "Make a client, or change its name, contacts and colour (assign_work)",
      description:
        "The installation's own portal: a client's name, its contacts (each an `id`, a `name`, an `email` and/or a `whatsapp` with the country code) and a colour. A new client starts with a link of its own. What the team's clients are called by is `client` (lowercase letters, digits, hyphens).",
      request: {
        params: OrgParams.extend({ client: z.string().regex(/^[a-z0-9][a-z0-9-]{0,63}$/) }),
        body: body(
          z.object({
            name: z.string().trim().min(1).max(80),
            contacts: z
              .array(
                z.object({
                  id: z.string().max(80).optional(),
                  name: z.string().trim().min(1).max(80),
                  email: z.string().trim().max(200).nullish(),
                  whatsapp: z.string().trim().max(24).nullish(),
                }),
              )
              .max(10)
              .optional(),
            color: z.enum(PORTAL_CLIENT_COLORS).nullable().optional(),
          }),
        ),
      },
      responses: {
        200: json(z.object({ client: PortalClient })),
        ...errors,
        404: off,
      },
    }),
    async (c) => {
      const { orgId, client } = c.req.valid("param");
      const refused = await itsPortal(c, orgId);
      if (refused) return refused;
      const user = c.get("user");
      await requireChangePermission(db, user.id, orgId, "assign_work");
      const input = c.req.valid("json");
      const existed = Boolean(await getPortalClient(db, orgId, client));
      const saved = await upsertPortalClient(clientDeps(), orgId, { client, ...input }, user.id);
      await auditClient(orgId, user.id, existed ? "portal.client_updated" : "portal.client_created", client, {
        name: saved.name,
      });
      return c.json({ client: saved }, 200);
    },
  );

  app.openapi(
    createRoute({
      method: "delete",
      path: "/organizations/{orgId}/portal-clients/{client}",
      tags,
      security,
      summary: "Remove a client and its links (assign_work)",
      request: { params: OrgParams.extend({ client: z.string().regex(/^[a-z0-9][a-z0-9-]{0,63}$/) }) },
      responses: { ...noContent, ...errors, 404: off },
    }),
    async (c) => {
      const { orgId, client } = c.req.valid("param");
      const refused = await itsPortal(c, orgId);
      if (refused) return refused;
      const user = c.get("user");
      await requireChangePermission(db, user.id, orgId, "assign_work");
      const found = await getPortalClient(db, orgId, client);
      await removePortalClient(db, orgId, client);
      if (found) await auditClient(orgId, user.id, "portal.client_removed", client, { name: found.name });
      return c.body(null, 204);
    },
  );

  app.openapi(
    createRoute({
      method: "post",
      path: "/organizations/{orgId}/portal-clients/{client}/link",
      tags,
      security,
      summary: "Make a new link for a client, revoking the one before (assign_work)",
      description:
        "The client's old address stops working as the new one is made. Answers the new address, `<PUBLIC_URL>/p/<token>`, to copy and send.",
      request: { params: OrgParams.extend({ client: z.string().regex(/^[a-z0-9][a-z0-9-]{0,63}$/) }) },
      responses: {
        200: json(z.object({ link: z.string() })),
        ...errors,
        404: off,
      },
    }),
    async (c) => {
      const { orgId, client } = c.req.valid("param");
      const refused = await itsPortal(c, orgId);
      if (refused) return refused;
      const user = c.get("user");
      await requireChangePermission(db, user.id, orgId, "assign_work");
      const found = await getPortalClient(db, orgId, client);
      if (!found) return apiError(c, 404, "not_found", "No such client");
      const link = await makeClientLink(clientDeps(), orgId, found.id, user.id);
      await auditClient(orgId, user.id, "portal.link_made", client);
      return c.json({ link }, 200);
    },
  );

  app.openapi(
    createRoute({
      method: "delete",
      path: "/organizations/{orgId}/portal-clients/{client}/link",
      tags,
      security,
      summary: "Revoke a client's link: the address answers nothing from then on (assign_work)",
      request: { params: OrgParams.extend({ client: z.string().regex(/^[a-z0-9][a-z0-9-]{0,63}$/) }) },
      responses: { ...noContent, ...errors, 404: off },
    }),
    async (c) => {
      const { orgId, client } = c.req.valid("param");
      const refused = await itsPortal(c, orgId);
      if (refused) return refused;
      const user = c.get("user");
      await requireChangePermission(db, user.id, orgId, "assign_work");
      await revokeClientLink({ db }, orgId, client);
      await auditClient(orgId, user.id, "portal.link_revoked", client);
      return c.body(null, 204);
    },
  );

  // The number the portal's notices go out as, and the connected ones to pick from (docs/adr/doug-0020 §7).
  app.openapi(
    createRoute({
      method: "get",
      path: "/organizations/{orgId}/portal-notices",
      tags,
      security,
      summary: "Which of the workspace's WhatsApp numbers tells the portal's clients, and the ones it may be (members)",
      description:
        "The approval portal's notices go out by e-mail to a client's contacts, and by WhatsApp from the number chosen here, when there is one: with none, nothing goes by WhatsApp. `numbers` are the workspace's connected numbers.",
      request: { params: OrgParams },
      responses: {
        200: json(
          z.object({
            number: z.string().nullable(),
            numbers: z.array(z.object({ id: z.string(), label: z.string(), phone: z.string().nullable() })),
          }),
        ),
        ...errors,
        404: off,
      },
    }),
    async (c) => {
      const { orgId } = c.req.valid("param");
      const refused = await itsPortal(c, orgId);
      if (refused) return refused;
      await requirePermission(db, c.get("user").id, orgId, "read");
      return c.json(await portalNoticeSettingsOf(db, orgId), 200);
    },
  );

  app.openapi(
    createRoute({
      method: "put",
      path: "/organizations/{orgId}/portal-notices",
      tags,
      security,
      summary: "Set the number the portal's notices go out as, or none with null (assign_work)",
      request: {
        params: OrgParams,
        body: body(z.object({ number: z.string().nullable() })),
      },
      responses: { ...noContent, ...errors, 404: off },
    }),
    async (c) => {
      const { orgId } = c.req.valid("param");
      const refused = await itsPortal(c, orgId);
      if (refused) return refused;
      const user = c.get("user");
      await requireChangePermission(db, user.id, orgId, "assign_work");
      await setPortalNoticeNumber(db, orgId, c.req.valid("json").number);
      await recordAudit(db, {
        orgId,
        actor: { type: "person", id: user.id },
        action: "portal.notice_number_set",
        target: { type: "portal", id: orgId },
        details: { number: c.req.valid("json").number },
      });
      return c.body(null, 204);
    },
  );

  // A person says a scheduled post is out (the way out of `scheduled` that this server has no publisher for).
  app.openapi(
    createRoute({
      method: "post",
      path: "/organizations/{orgId}/portal/clients/{client}/items/{itemId}/published",
      tags,
      security,
      summary: "Mark a scheduled post posted: when it went out, and where, when known (assign_work)",
      description:
        "A post approved and scheduled turns `published` here, with its date and (when the team wrote one) its address: this server has no publishing service, so a person says it went out. Only a `scheduled` post takes it.",
      request: {
        params: OrgParams.extend({ client: ClientId, itemId: ItemId }),
        body: body(
          z
            .object({
              at: z.string().max(40).nullable().optional(),
              postUrl: z.string().url().max(2000).nullable().optional(),
            })
            .strict(),
        ),
      },
      responses: { ...noContent, 502: unavailable, ...errors, 404: off },
    }),
    async (c) => {
      const { orgId, client, itemId } = c.req.valid("param");
      const user = c.get("user");
      await requireChangePermission(db, user.id, orgId, "assign_work");
      const input = c.req.valid("json");
      const out = await guarded(c, (portal) => portal.markPublished(client, itemId, input, user.id));
      if (!out.ok) return out.response;
      await recordAudit(db, {
        orgId,
        actor: { type: "person", id: user.id },
        action: "portal.published",
        target: { type: "portal_post", id: `${client}/${itemId}` },
        details: { ...(input.postUrl ? { postUrl: input.postUrl } : {}) },
      });
      return c.body(null, 204);
    },
  );

  return app;
}
