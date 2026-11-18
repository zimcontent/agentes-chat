import { runBlockAct, SECTORS, type SectorCardDeps, sectorPills, showSectorCard } from "@agenteschat/engine";
import { createRoute, z } from "@hono/zod-openapi";
import { apiError, errorResponse } from "../../http/errors";
import { type AppDeps, createAppRouter, errors, json, requireSession, routineConnectorDeps, security } from "./context";

const tags = ["Right hand"];

const AgentParams = z.object({
  orgId: z.uuid().openapi({ param: { name: "orgId", in: "path" } }),
  agentId: z.uuid().openapi({ param: { name: "agentId", in: "path" } }),
});

const SectorParams = AgentParams.extend({
  sector: z.enum(SECTORS).openapi({ param: { name: "sector", in: "path" } }),
});

const ActParams = z.object({
  orgId: z.uuid().openapi({ param: { name: "orgId", in: "path" } }),
  artifactId: z.uuid().openapi({ param: { name: "artifactId", in: "path" } }),
  act: z
    .string()
    .regex(/^[A-Za-z_]\w{0,63}$/)
    .openapi({ param: { name: "act", in: "path" } }),
});

const SectorPill = z
  .object({
    sector: z.enum(SECTORS),
    count: z.number().int().openapi({ description: "What waits there; 0: a pill with no number (the agenda)." }),
  })
  .openapi("SectorPill");

/**
 * The right hand's sector cards (docs/adr/doug-0020-doug-sector-cards.md): the pills above the composer in a person's
 * conversation with it, a pill pressed (its sector's card, now), and a card's button that runs on the server.
 */
export function sectorCardRoutes(deps: AppDeps) {
  const app = createAppRouter(deps);
  app.use("/organizations/*", requireSession(deps.auth));
  const cards = (): SectorCardDeps => {
    const a = deps.extras?.artifacts;
    if (!a) throw new Error("artifacts are not configured on this server");
    return {
      ...a,
      pubsub: deps.adapters.pubsub,
      connectors: routineConnectorDeps(deps),
      portal: deps.adapters.approvalPortal ?? null,
      judge: deps.extras?.context?.judge,
      talker: deps.extras?.talker,
    };
  };

  app.openapi(
    createRoute({
      method: "get",
      path: "/organizations/{orgId}/agents/{agentId}/sector-pills",
      tags,
      security,
      summary: "The sectors with something for me, as pills above the composer in my conversation with the right hand",
      description:
        "The agenda's pill shows whenever a Google Calendar connection the right hand may read exists; the calendar is read only when it is pressed.",
      request: { params: AgentParams },
      responses: { 200: json(z.object({ pills: z.array(SectorPill) })), ...errors },
    }),
    async (c) => {
      const { orgId, agentId } = c.req.valid("param");
      return c.json({ pills: await sectorPills(cards(), c.get("user").id, orgId, agentId) }, 200);
    },
  );

  app.openapi(
    createRoute({
      method: "post",
      path: "/organizations/{orgId}/agents/{agentId}/sector-cards/{sector}",
      tags,
      security,
      summary: "A pill pressed: the right hand shows that sector's card in my conversation with it, now",
      request: { params: SectorParams },
      responses: {
        201: json(z.object({ id: z.string() }), "Created"),
        ...errors,
        429: errorResponse("Too many at once (`rate_limited`)"),
      },
    }),
    async (c) => {
      const { orgId, agentId, sector } = c.req.valid("param");
      const user = c.get("user");
      const limit = await deps.adapters.rateLimiter.consume(`sector-card:${user.id}`, { limit: 10, windowMs: 30_000 });
      if (!limit.allowed) return apiError(c, 429, "rate_limited", "Slow down");
      const message = await showSectorCard(cards(), user.id, orgId, agentId, sector);
      return c.json({ id: message.id }, 201);
    },
  );

  app.openapi(
    createRoute({
      method: "post",
      path: "/organizations/{orgId}/blocks/{artifactId}/acts/{act}",
      tags: ["Artifacts"],
      security,
      summary: "Press a card's button that runs on the server (its `act`), once",
      description:
        "The block's button names the action (`act`); the server holds what it does. Only the person the card is for, once: a second press is `409 block_act.done`. Everyone looking sees the button done (`block.state`, `_acted`).",
      request: { params: ActParams },
      responses: {
        200: json(
          z.object({
            act: z.string(),
            done: z.literal(true),
            messageId: z
              .string()
              .nullable()
              .openapi({ description: "The person's message it sent, when it sent one." }),
          }),
        ),
        ...errors,
        429: errorResponse("Too many at once (`rate_limited`)"),
      },
    }),
    async (c) => {
      const { orgId, artifactId, act } = c.req.valid("param");
      const user = c.get("user");
      const limit = await deps.adapters.rateLimiter.consume(`post:${user.id}`, { limit: 30, windowMs: 10_000 });
      if (!limit.allowed) return apiError(c, 429, "rate_limited", "Slow down");
      const done = await runBlockAct(cards(), user.id, orgId, artifactId, act);
      deps.wakeWorkers?.();
      return c.json(done, 200);
    },
  );

  return app;
}
