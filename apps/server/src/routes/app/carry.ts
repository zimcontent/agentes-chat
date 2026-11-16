import { connectorOAuthApps } from "@agenteschat/config";
import {
  CARRY_LIMITS,
  type CarryDeps,
  carryOver,
  carrySources,
  composioConnectorsOf,
  connectOverHttp,
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
export function carryRoutes(deps: AppDeps) {
  const { db, config, adapters } = deps;
  const app = createAppRouter(deps);
  app.use("/organizations/*", requireSession(deps.auth));
  const composio = composioConnectorsOf(adapters.mail);
  const carry: CarryDeps = {
    connectors: {
      db,
      keyWrappers: [adapters.keyWrapper, ...adapters.legacyKeyWrappers],
      oauthApps: connectorOAuthApps(config),
      publicUrl: config.PUBLIC_URL,
      http: deps.extras?.http,
      resolveHost: deps.extras?.resolveHost,
      connect: withComposio(deps.extras?.mcpConnect ?? connectOverHttp, composio),
      composio,
    },
    skills: () => {
      const blobs = deps.extras?.artifacts?.blobs;
      if (!blobs) throw new Error("storage is not configured on this server");
      return { db, blobs, pubsub: adapters.pubsub };
    },
    credentials: { keyWrapper: adapters.keyWrapper, fetch: deps.extras?.http, net: endpointNet(deps) },
    pubsub: adapters.pubsub,
  };

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
        "A key gets a copy of its own here. An OAuth sign-in becomes one sign-in the two workspaces share: renewed once, for both, and disconnecting one leaves the other working. A connection is every agent's here, like any new one. An agent comes as its profile, its skills and its access to its connections, which come with it; never its conversations, memory, model key, computer or routines. What can't come is in `skipped` with why (`not_yours`, `github_app`, `needs_reconnect`, `here`, `gone`, `connector.busy`); the rest still comes. Connections need `manage_connectors` here; agents `manage_agents` and `create_agents`.",
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

  return app;
}
