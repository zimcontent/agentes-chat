import { connectorOAuthApps } from "@agenteschat/config";
import {
  agentTwinView,
  CARRY_LIMITS,
  type CarryDeps,
  carryOver,
  carrySources,
  composioConnectorsOf,
  connectOverHttp,
  type EndpointNet,
  joinTwin,
  leaveTwin,
  withComposio,
} from "@agenteschat/engine";
import { createRoute, z } from "@hono/zod-openapi";
import { endpointNet } from "./agents";
import { type AppDeps, body, createAppRouter, errors, json, OrgParams, requireSession, security } from "./context";

const tags = ["Connectors"];

const SourceConnection = z.object({
  id: z.uuid(),
  connector: z.string(),
  label: z.string(),
  serverUrl: z.string(),
  authType: z.string(),
  accountLabel: z.string().nullable(),
  icon: z.string().nullable(),
  blocked: z.enum(["github_app", "needs_reconnect"]).nullable().openapi({
    description:
      "Why it can't be brought: GitHub through the app alone (an installation belongs to one workspace), or a sign-in that stopped working.",
  }),
  here: z.boolean().openapi({ description: "This workspace already has it." }),
});

const SourceAgent = z.object({
  id: z.uuid(),
  name: z.string(),
  handle: z.string(),
  role: z.string(),
  appearance: z.object({ color: z.string(), eyes: z.string(), accessory: z.string() }).nullable(),
  skills: z.array(z.string()),
  connectionIds: z.array(z.uuid()).openapi({ description: "Its connections that come with it." }),
  here: z.boolean().openapi({ description: "This workspace has an agent with its handle." }),
});

const SourceKey = z.object({
  id: z.uuid(),
  provider: z.string(),
  label: z.string(),
  hint: z.string().openapi({ description: "The key's last characters, as its workspace shows them. Never the key." }),
  here: z.boolean().openapi({ description: "This workspace has a live key of this provider with the same ending." }),
});

const Source = z
  .object({
    id: z.uuid(),
    name: z.string(),
    logo: z.string().nullable(),
    connections: z.array(SourceConnection),
    agents: z.array(SourceAgent),
    keys: z.array(SourceKey).openapi({ description: "AI provider keys, for who manages keys in both workspaces." }),
  })
  .openapi("CarrySource");

const Result = z
  .object({
    connections: z.array(
      z.object({ sourceId: z.uuid(), id: z.uuid(), label: z.string(), outcome: z.enum(["brought", "here"]) }),
    ),
    agents: z.array(z.object({ sourceId: z.uuid(), id: z.uuid(), name: z.string(), handle: z.string() })),
    keys: z.array(
      z.object({ sourceId: z.uuid(), id: z.uuid(), label: z.string(), outcome: z.enum(["brought", "here"]) }),
    ),
    skills: z.number().int(),
    skipped: z.array(
      z.object({
        kind: z.enum(["connection", "agent", "skill", "key"]),
        id: z.string(),
        label: z.string(),
        reason: z.string(),
      }),
    ),
  })
  .openapi("CarryResult");

/**
 * Bringing connections and agents from the person's other workspaces (ADR 9002): what they can bring, and bringing
 * it. Secrets never leave the server: a copy is sealed again for the workspace it goes to.
 */
/**
 * What bringing things from another workspace needs: the routes' and the workers', which bring a connection or a skill
 * a copy of an agent needs in its workspace (ADR doug-0013).
 */
export function carryDepsOf(input: {
  db: AppDeps["db"];
  config: AppDeps["config"];
  adapters: AppDeps["adapters"];
  blobs?: NonNullable<NonNullable<AppDeps["extras"]>["artifacts"]>["blobs"];
  http?: typeof fetch;
  resolveHost?: NonNullable<AppDeps["extras"]>["resolveHost"];
  mcpConnect?: NonNullable<AppDeps["extras"]>["mcpConnect"];
  net?: EndpointNet;
}): CarryDeps {
  const { db, config, adapters } = input;
  const composio = composioConnectorsOf(adapters.mail);
  return {
    connectors: {
      db,
      keyWrappers: [adapters.keyWrapper, ...adapters.legacyKeyWrappers],
      oauthApps: connectorOAuthApps(config),
      publicUrl: config.PUBLIC_URL,
      http: input.http,
      resolveHost: input.resolveHost,
      connect: withComposio(input.mcpConnect ?? connectOverHttp, composio),
      composio,
    },
    skills: () => {
      if (!input.blobs) throw new Error("storage is not configured on this server");
      return { db, blobs: input.blobs, pubsub: adapters.pubsub };
    },
    credentials: { keyWrapper: adapters.keyWrapper, fetch: input.http, net: input.net },
    pubsub: adapters.pubsub,
  };
}

export function carryRoutes(deps: AppDeps) {
  const { db, config, adapters } = deps;
  const app = createAppRouter(deps);
  app.use("/organizations/*", requireSession(deps.auth));
  const carry = carryDepsOf({
    db,
    config,
    adapters,
    blobs: deps.extras?.artifacts?.blobs,
    http: deps.extras?.http,
    resolveHost: deps.extras?.resolveHost,
    mcpConnect: deps.extras?.mcpConnect,
    net: endpointNet(deps),
  });

  app.openapi(
    createRoute({
      method: "get",
      path: "/organizations/{orgId}/carry",
      tags,
      security,
      summary: "What you can bring here from your other workspaces",
      description:
        "Your other workspaces that have something to bring: the connections you made there (every one where you are the owner) while you still manage connectors there, and the agents you manage or own, each with its skills and the connections that come with it. No secrets. For who manages connectors or creates agents here.",
      request: { params: OrgParams },
      responses: { 200: json(z.object({ sources: z.array(Source) })), ...errors },
    }),
    async (c) => c.json({ sources: await carrySources(db, c.get("user").id, c.req.valid("param").orgId) }, 200),
  );

  app.openapi(
    createRoute({
      method: "post",
      path: "/organizations/{orgId}/carry",
      tags,
      security,
      summary: "Bring connections and agents from your other workspaces",
      description:
        "A key gets a copy of its own here. An OAuth sign-in becomes one sign-in the two workspaces share: renewed once, for both, and disconnecting one leaves the other working. A connection is every agent's here, like any new one. An agent comes as its profile, its skills and its access to its connections, which come with it; never its conversations, model key, computer or routines. From then on it is one agent in both workspaces: what trains one copy (profile, memory, skills, access) reaches the other (`/agents/{agentId}/twins`); one of its handle already here is joined the same way. What can't come is in `skipped` with why (`not_yours`, `github_app`, `needs_reconnect`, `here`, `gone`, `connector.busy`); the rest still comes. Connections need `manage_connectors` here; agents `manage_agents` and `create_agents`.",
      request: {
        params: OrgParams,
        body: body(
          z.object({
            connectionIds: z.array(z.uuid()).max(CARRY_LIMITS.connections).optional(),
            agentIds: z.array(z.uuid()).max(CARRY_LIMITS.agents).optional(),
            credentialIds: z.array(z.uuid()).max(CARRY_LIMITS.keys).optional(),
          }),
        ),
      },
      responses: { 200: json(Result), ...errors },
    }),
    async (c) => c.json(await carryOver(carry, c.get("user").id, c.req.valid("param").orgId, c.req.valid("json")), 200),
  );

  const Copy = z
    .object({ agentId: z.uuid(), orgId: z.uuid(), orgName: z.string(), name: z.string(), handle: z.string() })
    .openapi("AgentTwinCopy");
  const TwinView = z
    .object({
      copies: z
        .array(Copy)
        .openapi({ description: "The same agent in your other workspaces, trained as one with it." }),
      hidden: z.number().int().openapi({ description: "Copies in workspaces you aren't in." }),
      candidates: z.array(Copy).openapi({
        description: "Agents of its handle in your other workspaces, where you manage agents, that can join.",
      }),
      off: z.boolean().openapi({ description: "Taken out on purpose: it isn't joined on its own again." }),
      syncedAt: z.date().nullable(),
      missing: z.array(z.object({ orgName: z.string(), kind: z.enum(["connection", "skill"]), label: z.string() })),
    })
    .openapi("AgentTwins");
  const TwinParams = OrgParams.extend({ agentId: z.uuid() });
  const twinDeps = { db, pubsub: adapters.pubsub, carry };

  app.openapi(
    createRoute({
      method: "get",
      path: "/organizations/{orgId}/agents/{agentId}/twins",
      tags: ["Agents"],
      security,
      summary: "The same agent in your other workspaces",
      description:
        "One agent in several workspaces is trained as one (ADR doug-0013): its name, role, instructions, memory, skills and what it may use are the same in every copy, kept so within a minute. Its model, key, computer, budget, routines and conversations are each workspace's.",
      request: { params: TwinParams },
      responses: { 200: json(TwinView), ...errors },
    }),
    async (c) => {
      const { orgId, agentId } = c.req.valid("param");
      return c.json(await agentTwinView(db, c.get("user").id, orgId, agentId), 200);
    },
  );

  app.openapi(
    createRoute({
      method: "post",
      path: "/organizations/{orgId}/agents/{agentId}/twins",
      tags: ["Agents"],
      security,
      summary: "Train this agent as one with the same agent in another of your workspaces",
      description:
        "Joins it with `agentId` of the body (its copy in another workspace where you manage agents): what each knows is joined, nothing is lost, and from then on what trains one trains both.",
      request: { params: TwinParams, body: body(z.object({ agentId: z.uuid() })) },
      responses: { 200: json(TwinView), ...errors },
    }),
    async (c) => {
      const { orgId, agentId } = c.req.valid("param");
      const view = await joinTwin(twinDeps, c.get("user").id, orgId, agentId, c.req.valid("json").agentId);
      return c.json(view, 200);
    },
  );

  app.openapi(
    createRoute({
      method: "delete",
      path: "/organizations/{orgId}/agents/{agentId}/twins",
      tags: ["Agents"],
      security,
      summary: "Train this agent here alone",
      description:
        "Takes this copy out: it keeps what it knows, and from then on is trained in this workspace alone. It isn't joined on its own again.",
      request: { params: TwinParams },
      responses: { 200: json(TwinView), ...errors },
    }),
    async (c) => {
      const { orgId, agentId } = c.req.valid("param");
      return c.json(await leaveTwin(db, c.get("user").id, orgId, agentId), 200);
    },
  );

  return app;
}
