import { timingSafeEqual } from "node:crypto";
import { ComposioSignatureError } from "@agenteschat/adapters";
import {
  addGitHubRepoHook,
  createWebhookEndpoint,
  ensureWebhookEndpoint,
  ForbiddenSignatureError,
  HOOK_LIMIT_PER_IP,
  handleComposioWebhook,
  handleWebhook,
  handleWhatsAppEvent,
  NotFoundError,
  portalTasksNow,
  receiveRoutineHook,
  setWebhookSecret,
  ValidationError,
  WEBHOOK_PROVIDERS,
  type WebhookProvider,
  webhookSetup,
  whatsappHookKnown,
  whatsappStickerFile,
} from "@agenteschat/engine";
import { createRoute, type OpenAPIHono, z } from "@hono/zod-openapi";
import { requestLimitIp } from "../http/client-ip";
import { apiError } from "../http/errors";
import {
  type AppDeps,
  body,
  createAppRouter,
  errors,
  json,
  OrgParams,
  requireSession,
  routineHookDeps,
  security,
  whatsappDeps,
} from "./app/context";
import { githubAccess } from "./github-app";
import { readWebhookBytes, readWebhookText } from "./webhook-body";

/**
 * The largest event the WhatsApp gateway may post. Files never ride on events (`WEBHOOK_FILES=false` at the gateway,
 * and the parser drops an inline copy anyway): the large ones are pieces of a number's history, thousands of
 * messages with their small previews. Read only for an address a number listens at.
 */
const WHATSAPP_EVENT_MAX = 64 * 1024 * 1024;

/** What a routine's address answers when it refuses a call (English: the caller is a program). */
const HOOK_REFUSALS = {
  not_found: "No routine is listening at this address",
  invalid_signature: "The signature doesn't match the routine's signing secret",
  too_large: "The body is larger than 256 KB",
  rate_limited: "Too many calls. Try again in a minute.",
} as const;

/**
 * Incoming webhooks: `POST /api/webhooks/{provider}/{endpointId}` (public,
 * signature-checked; no session), and the admin endpoint that creates one.
 */
export function registerWebhookReceiver(api: OpenAPIHono, deps: AppDeps) {
  const webhookDeps = { db: deps.db, keyWrappers: [deps.adapters.keyWrapper, ...deps.adapters.legacyKeyWrappers] };
  // The approval portal's bridge saying something changed there (ADR 9001 §12): its cards and their tasks are put in
  // step now instead of at the worker's next tick. It carries nothing: the bearer token is the one this server calls
  // the bridge with, and what changed is read from the bridge.
  api.post("/webhooks/approval-portal", (c) => {
    const portal = deps.adapters.approvalPortal;
    const token = deps.config.APPROVAL_PORTAL_TOKEN;
    if (!portal || !token) return c.json({ error: "not found" }, 404);
    const given = Buffer.from(c.req.header("authorization") ?? "");
    const wanted = Buffer.from(`Bearer ${token}`);
    if (given.length !== wanted.length || !timingSafeEqual(given, wanted)) {
      return c.json({ error: "unauthorized" }, 401);
    }
    portalTasksNow({ db: deps.db, pubsub: deps.adapters.pubsub, log: deps.log }, portal, () => deps.wakeWorkers?.());
    return c.json({ ok: true }, 202);
  });
  // Composio (ADR 0038): new mail for routines, expired accounts. One endpoint for the whole server,
  // signed with the subscription's secret (checked by the Composio client). Before the generic route.
  api.post("/webhooks/composio", async (c) => {
    const raw = await readWebhookText(c.req.raw, 1_000_000);
    if (raw === null) return c.json({ error: "too large" }, 413);
    try {
      const result = await handleComposioWebhook({ db: deps.db, mail: deps.adapters.mail }, c.req.raw.headers, raw);
      if (result.fired > 0) deps.wakeWorkers?.();
      return c.json({ ok: true, type: result.type, fired: result.fired }, 202);
    } catch (error) {
      if (error instanceof ComposioSignatureError) return c.json({ error: "invalid signature" }, 401);
      if (error instanceof NotFoundError) return c.json({ error: "not found" }, 404);
      if (error instanceof SyntaxError) return c.json({ error: "invalid body" }, 400);
      throw error;
    }
  });
  // A WhatsApp number's events, from the gateway on this machine's network. The secret in the address is the
  // credential (the gateway signs nothing) and says which number. Before the generic route.
  // A sticker's picture, fetched by the gateway when it is asked to send one: no session, only the signature
  // `sendWhatsAppSticker` put in the address, good for two minutes.
  api.get("/webhooks/whatsapp-sticker/:messageId", async (c) => {
    try {
      const file = await whatsappStickerFile(
        whatsappDeps(deps),
        c.req.param("messageId"),
        Number(c.req.query("e")),
        c.req.query("s") ?? "",
      );
      return new Response(file.bytes, {
        headers: {
          "Content-Type": "image/webp",
          "Content-Length": String(file.bytes.byteLength),
          "X-Content-Type-Options": "nosniff",
          "Cache-Control": "no-store",
        },
      });
    } catch {
      // Whatever went wrong, the address says nothing about it.
      return c.json({ error: "not found" }, 404);
    }
  });
  api.post("/webhooks/whatsapp/:secret", async (c) => {
    // Nobody who doesn't hold a number's secret makes the server read a body this large.
    if (!(await whatsappHookKnown(whatsappDeps(deps), c.req.param("secret")))) {
      return c.json({ error: "not found" }, 404);
    }
    const raw = await readWebhookText(c.req.raw, WHATSAPP_EVENT_MAX);
    if (raw === null) return c.json({ error: "too large" }, 413);
    try {
      const result = await handleWhatsAppEvent(whatsappDeps(deps), c.req.param("secret"), JSON.parse(raw));
      return c.json({ ok: true, kind: result.kind }, 200);
    } catch (error) {
      if (error instanceof NotFoundError) return c.json({ error: "not found" }, 404);
      if (error instanceof SyntaxError) return c.json({ error: "invalid body" }, 400);
      throw error;
    }
  });
  api.post("/webhooks/:provider/:endpointId", async (c) => {
    const provider = c.req.param("provider") as WebhookProvider;
    if (!WEBHOOK_PROVIDERS.includes(provider)) return c.json({ error: "unknown provider" }, 404);
    const raw = await readWebhookText(c.req.raw, 1_000_000);
    if (raw === null) return c.json({ error: "too large" }, 413);
    try {
      const result = await handleWebhook(webhookDeps, provider, c.req.param("endpointId"), c.req.raw.headers, raw);
      if (result.fired > 0) deps.wakeWorkers?.();
      return c.json({ ok: true, event: result.event, fired: result.fired }, 202);
    } catch (error) {
      if (error instanceof ForbiddenSignatureError) return c.json({ error: "invalid signature" }, 401);
      if (error instanceof NotFoundError) return c.json({ error: "not found" }, 404);
      if (error instanceof ValidationError) return c.json({ error: error.message }, 400);
      throw error;
    }
  });
}

/**
 * A routine's own address (ADR 0106): `/api/hooks/{token}`, no session, the token is the credential. It answers the
 * methods its managers chose (POST by default; GET's query string is the call's data). Every call counts against its
 * client's address first, before anything is looked up.
 */
export function registerRoutineHooks(api: OpenAPIHono, deps: AppDeps) {
  const hookDeps = routineHookDeps(deps);
  api.on(["GET", "POST", "PUT", "PATCH", "DELETE"], "/hooks/:token", async (c) => {
    const ip = requestLimitIp(c.req.raw.headers, deps.config.TRUSTED_PROXIES);
    if (!(await deps.adapters.rateLimiter.consume(`routine-hook-ip:${ip}`, HOOK_LIMIT_PER_IP)).allowed) {
      c.header("retry-after", "60");
      return apiError(c, 429, "rate_limited", HOOK_REFUSALS.rate_limited);
    }
    const answer = await receiveRoutineHook(hookDeps, {
      token: c.req.param("token"),
      headers: c.req.raw.headers,
      read: (max) => readWebhookBytes(c.req.raw, max),
      method: c.req.method,
      query: c.req.query(),
      rawQuery: new URL(c.req.url).search.slice(1),
    });
    if (answer.status === 405) {
      c.header("allow", answer.allow.join(", "));
      return apiError(c, 405, "method_not_allowed", `Call this address with ${answer.allow.join(" or ")}`);
    }
    if (answer.status !== 202) {
      if (answer.status === 429) c.header("retry-after", "60");
      return apiError(c, answer.status, answer.code, HOOK_REFUSALS[answer.code]);
    }
    if (!answer.duplicate) deps.wakeWorkers?.();
    return c.json({ ok: true as const, runId: answer.runId, ...(answer.duplicate ? { duplicate: true } : {}) }, 202);
  });
}

const Provider = z.enum(["github", "sentry"]);

const Setup = z
  .object({
    provider: Provider,
    id: z.string().nullable().openapi({ description: "Null: the workspace has none yet." }),
    url: z.string().nullable().openapi({ description: "Where the service sends its events (who sets webhooks up)." }),
    secret: z
      .string()
      .nullable()
      .openapi({ description: "GitHub's secret to paste there (who sets webhooks up). Sentry's is its own." }),
    receivedAt: z.string().nullable().openapi({ description: "The last call with a valid signature: it works." }),
    refusedAt: z.string().nullable().openapi({ description: "The last call whose signature didn't match." }),
    secretSet: z.boolean().openapi({ description: "Sentry: its integration's Client Secret was pasted here." }),
    canManage: z.boolean(),
    oneClick: z.boolean().openapi({
      description: "GitHub: the server may add the webhook to a repository itself (`…/github/repository`).",
    }),
  })
  .openapi("WebhookSetup");

export function webhookAdminRoutes(deps: AppDeps) {
  const app = createAppRouter(deps);
  app.use("/organizations/*", requireSession(deps.auth));
  const webhookDeps = {
    db: deps.db,
    keyWrappers: [deps.adapters.keyWrapper, ...deps.adapters.legacyKeyWrappers],
    github: githubAccess(deps),
  };
  const publicUrl = deps.config.PUBLIC_URL;
  const ProviderParams = OrgParams.extend({ provider: Provider });
  app.openapi(
    createRoute({
      method: "get",
      path: "/organizations/{orgId}/webhooks/{provider}",
      tags: ["Routines"],
      security,
      summary: "A service's webhook for this workspace: whether it works; where and with what to set it up",
      request: { params: ProviderParams },
      responses: { 200: json(Setup), ...errors },
    }),
    async (c) => {
      const { orgId, provider } = c.req.valid("param");
      return c.json(await webhookSetup(webhookDeps, c.get("user").id, orgId, provider, publicUrl), 200);
    },
  );
  app.openapi(
    createRoute({
      method: "put",
      path: "/organizations/{orgId}/webhooks/{provider}",
      tags: ["Routines"],
      security,
      summary: "Make the service's webhook when the workspace has none (who sets webhooks up)",
      request: { params: ProviderParams },
      responses: { 200: json(Setup), ...errors },
    }),
    async (c) => {
      const { orgId, provider } = c.req.valid("param");
      return c.json(await ensureWebhookEndpoint(webhookDeps, c.get("user").id, orgId, provider, publicUrl), 200);
    },
  );
  app.openapi(
    createRoute({
      method: "put",
      path: "/organizations/{orgId}/webhooks/{provider}/secret",
      tags: ["Routines"],
      security,
      summary: "The secret the service signs with, pasted from it (Sentry's Client Secret)",
      request: { params: ProviderParams, body: body(z.object({ secret: z.string().max(500) })) },
      responses: { 200: json(Setup), ...errors },
    }),
    async (c) => {
      const { orgId, provider } = c.req.valid("param");
      const { secret } = c.req.valid("json");
      return c.json(await setWebhookSecret(webhookDeps, c.get("user").id, orgId, provider, secret, publicUrl), 200);
    },
  );
  app.openapi(
    createRoute({
      method: "post",
      path: "/organizations/{orgId}/webhooks/github/repository",
      tags: ["Routines"],
      security,
      summary: "Add the workspace's GitHub webhook to a repository with the workspace's GitHub access",
      request: {
        params: OrgParams,
        body: body(z.object({ repo: z.string().max(200).openapi({ description: "`owner/name`." }) })),
      },
      responses: { 200: json(Setup), ...errors },
    }),
    async (c) => {
      const { orgId } = c.req.valid("param");
      const { repo } = c.req.valid("json");
      return c.json(await addGitHubRepoHook(webhookDeps, c.get("user").id, orgId, repo, publicUrl), 200);
    },
  );
  app.openapi(
    createRoute({
      method: "post",
      path: "/organizations/{orgId}/webhooks",
      tags: ["Routines"],
      security,
      summary: "Create an incoming webhook (GitHub, Sentry); the secret is shown once",
      request: { params: OrgParams, body: body(z.object({ provider: z.enum(["github", "sentry"]) })) },
      responses: {
        201: json(z.object({ id: z.uuid(), provider: z.string(), url: z.string(), secret: z.string() }), "Created"),
        ...errors,
      },
    }),
    async (c) => {
      const created = await createWebhookEndpoint(
        webhookDeps,
        c.get("user").id,
        c.req.valid("param").orgId,
        c.req.valid("json").provider,
        publicUrl,
      );
      return c.json(created, 201);
    },
  );
  return app;
}
