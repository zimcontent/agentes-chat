import {
  COMPANY_COMPANY_MAX,
  COMPANY_INTERESTS,
  COMPANY_MESSAGE_MAX,
  COMPANY_NAME_MAX,
  COMPANY_STATUSES,
  COMPANY_TEAM_SIZES,
  companyRequestById,
  EARLY_ACCESS_OUTCOMES,
  inviteCompanyRequest,
  isAgentesCloud,
  joinCompanyRequests,
  listCompanyRequests,
  pinnedOwner,
  setCompanyClientCode,
  setCompanyNotes,
  setCompanyStatus,
  WAITLIST_LOCALES,
} from "@agenteschat/engine";
import { createRoute, type OpenAPIHono, z } from "@hono/zod-openapi";
import { requestLimitIp } from "../../http/client-ip";
import { apiError, errorResponse } from "../../http/errors";
import { humanCheckRefusal } from "../../http/human-check";
import {
  type AppDeps,
  allowedOrigins,
  body,
  createAppRouter,
  errors,
  iso,
  json,
  requireSession,
  security,
} from "./context";

const tags = ["Companies"];

/** A form per address per hour, and in total per hour (each one mails). */
const JOIN_PER_IP = { limit: 10, windowMs: 3600_000 };
const JOIN_TOTAL = { limit: 200, windowMs: 3600_000 };
/** The team's own reads and writes through this route. */
const ADMIN_WRITES = { limit: 60, windowMs: 60_000 };

const TeamSize = z.enum(COMPANY_TEAM_SIZES).openapi("CompanyTeamSize", {
  description: "A size band: `1-5`, `6-20`, `21-50`, `51-200`, `200+`.",
});
const Interest = z.enum(COMPANY_INTERESTS).openapi("CompanyInterest", {
  description: "What the company wants to automate: `design`, `video`, `ads`, `social`, `code`, `finance`.",
});
const Locale = z.enum(WAITLIST_LOCALES).openapi("CompanyLocale", {
  description: "The page's language, for the confirmation email.",
});

const CompanyRequest = z
  .object({
    id: z.uuid(),
    name: z.string(),
    email: z.string(),
    whatsapp: z.string(),
    company: z.string(),
    teamSize: z.string(),
    interests: z.array(z.string()),
    message: z.string(),
    locale: Locale,
    status: z.enum(COMPANY_STATUSES),
    clientCode: z.string().nullable().openapi({ description: "Three digits once the company is a client." }),
    notes: z.string().openapi({ description: "The team's own notes about it." }),
    invitedAt: z.string().nullable(),
    createdAt: z.string(),
    updatedAt: z.string(),
  })
  .openapi("CompanyRequest");

const requestJson = (r: Awaited<ReturnType<typeof companyRequestById>>) => ({
  ...r,
  invitedAt: iso(r.invitedAt),
  createdAt: r.createdAt.toISOString(),
  updatedAt: r.updatedAt.toISOString(),
});

const IdParams = z.object({ requestId: z.uuid().openapi({ param: { name: "requestId", in: "path" } }) });

const join = createRoute({
  method: "post",
  path: "/companies",
  tags: ["Public"],
  summary: "Ask for DougBot on a company's behalf",
  description:
    "Public, from this server's own page (`/empresas`, JSON only). Writes a company's request, or updates it when the address is there already. A consent is required (LGPD): without `consent: true` nothing is kept. Answers 202 whether it was new or an update, so the list can't be probed. Guarded by the bot check when this server has one.",
  request: {
    body: {
      required: true,
      content: {
        "application/json": {
          schema: z.object({
            name: z.string().max(COMPANY_NAME_MAX).openapi({ example: "Ana Souza" }),
            email: z.string().max(254).openapi({ example: "ana@company.com" }),
            whatsapp: z.string().max(40).openapi({ example: "+5511912345678" }),
            company: z.string().max(COMPANY_COMPANY_MAX).openapi({ example: "Aurora Bakery" }),
            teamSize: TeamSize,
            interests: z.array(Interest).max(COMPANY_INTERESTS.length).optional(),
            message: z.string().max(COMPANY_MESSAGE_MAX).optional(),
            locale: Locale.optional(),
            consent: z.boolean().openapi({ description: "The Privacy Policy was accepted (`true`)." }),
          }),
        },
      },
    },
  },
  responses: {
    202: {
      description: "With us",
      content: { "application/json": { schema: z.object({ ok: z.literal(true) }) } },
    },
    400: errorResponse(
      "A field is missing or wrong (`invalid_email`, `invalid_name`, `invalid_whatsapp`, `invalid_company`, `invalid_team_size`, `invalid_interests`, `invalid_message`, `invalid_request`), or the consent is missing (`consent_required`)",
    ),
    403: errorResponse(
      "Not from our origin (`bad_origin`), or the bot check refused (`human_check`, `human_check_blocked`)",
    ),
    429: errorResponse("Too many attempts (`rate_limited`)"),
  },
});

/**
 * `POST /api/companies` (the public page) and, from the apps, the installation's list of requests: `GET /api/app/companies`
 * and one by id, with the team's moves (its step, its notes, its client's code) and the Invite that sends it the
 * early-access link. Public part apart (`registerCompanyRequests`): JSON only, CORS for our own origin.
 */
export function registerCompanyRequests(api: OpenAPIHono, deps: AppDeps) {
  const { config } = deps;
  const { rateLimiter, humanCheck } = deps.adapters;

  api.openapi(join, async (c) => {
    const origin = c.req.header("origin");
    if (!origin || !allowedOrigins(config).has(origin))
      return apiError(c, 403, "bad_origin", "Cross-origin request refused");
    const ip = requestLimitIp(c.req.raw.headers, config.TRUSTED_PROXIES);
    if (!(await rateLimiter.consume(`company-request:${ip}`, JOIN_PER_IP)).allowed)
      return apiError(c, 429, "rate_limited", "Too many requests. Try again later.");
    // Before the total, so refused bots don't spend it.
    const refused = await humanCheckRefusal(humanCheck, c.req.raw.headers, "waitlist", config.TRUSTED_PROXIES);
    if (refused) return apiError(c, 403, refused.code, refused.message);
    const input = c.req.valid("json");
    if (!(await rateLimiter.consume("company-request:all", JOIN_TOTAL)).allowed)
      return apiError(c, 429, "rate_limited", "Too many requests. Try again later.");
    const ownerUserId = await pinnedOwner(deps.db);
    await joinCompanyRequests(deps.db, input, {
      pubsub: deps.adapters.pubsub,
      ownerUserId,
      emailTo: config.COMPANY_REQUESTS_NOTIFY_EMAIL ?? null,
      publicUrl: config.PUBLIC_URL,
    });
    return c.json({ ok: true as const }, 202);
  });

  return api;
}

const Count = z.number().int().min(0);

/**
 * The team's list of company requests, in Settings ("Empresas"), for the installation's pinned owner (ADR for this
 * instance): the requests, filtered and searched, each moved through its step, given notes and its client's code, and
 * invited through early access. A server without email refuses the Invite. The routes answer 404 to everyone else, and
 * live under `/api/app/companies`; the public form alone is `/api/companies`.
 */
export function companyRequestRoutes(deps: AppDeps) {
  const { db, config } = deps;
  const app = createAppRouter(deps);
  const { rateLimiter } = deps.adapters;
  // The team's list is a signed-in person's; the owner check follows in each route.
  app.use("/companies", requireSession(deps.auth));
  app.use("/companies/*", requireSession(deps.auth));

  const guard = async (userId: string) => {
    const owner = await pinnedOwner(db);
    if (!owner || owner !== userId || isAgentesCloud(config.PUBLIC_URL)) return false;
    return true;
  };
  const limited = async (key: string) => (await rateLimiter.consume(key, ADMIN_WRITES)).allowed;

  app.openapi(
    createRoute({
      method: "get",
      path: "/companies",
      tags,
      summary: "The company requests, newest first",
      description: "404 for everyone but the installation's pinned owner, and on agentes.chat itself.",
      security,
      request: {
        query: z.object({
          status: z.enum(COMPANY_STATUSES).optional(),
          q: z
            .string()
            .max(320)
            .optional()
            .openapi({ description: "Any part of the company, the person or the email." }),
          limit: z.coerce.number().int().min(1).max(200).default(50),
          cursor: z.string().max(200).optional(),
        }),
      },
      responses: {
        200: json(
          z
            .object({
              requests: z.array(CompanyRequest),
              counts: z.object({
                all: Count,
                new: Count,
                talking: Count,
                invited: Count,
                deployed: Count,
                discarded: Count,
              }),
              next: z.string().nullable().openapi({ description: "`cursor` for the next page; null on the last one." }),
            })
            .openapi("CompanyRequestPage"),
        ),
        ...errors,
        404: errors[404],
      },
    }),
    async (c) => {
      if (!(await guard(c.get("user").id))) return apiError(c, 404, "not_found", "Not found");
      const page = await listCompanyRequests(db, c.req.valid("query"));
      return c.json({ ...page, requests: page.requests.map(requestJson) }, 200);
    },
  );

  app.openapi(
    createRoute({
      method: "get",
      path: "/companies/{requestId}",
      tags,
      summary: "One company request",
      description: "404 for everyone but the installation's pinned owner, and on agentes.chat itself.",
      security,
      request: { params: IdParams },
      responses: { 200: json(CompanyRequest), ...errors, 404: errors[404] },
    }),
    async (c) => {
      if (!(await guard(c.get("user").id))) return apiError(c, 404, "not_found", "Not found");
      return c.json(requestJson(await companyRequestById(db, c.req.valid("param").requestId)), 200);
    },
  );

  app.openapi(
    createRoute({
      method: "put",
      path: "/companies/{requestId}/status",
      tags,
      summary: "Move a request to another step",
      description:
        "The team's own step: `new`, `talking`, `invited`, `deployed` (the company is a client) or `discarded`. 404 for everyone but the installation's owner, and on agentes.chat itself.",
      security,
      request: { params: IdParams, body: body(z.object({ status: z.enum(COMPANY_STATUSES) })) },
      responses: { 200: json(CompanyRequest), ...errors, 404: errors[404], 429: errorResponse("`rate_limited`") },
    }),
    async (c) => {
      const user = c.get("user");
      if (!(await guard(user.id))) return apiError(c, 404, "not_found", "Not found");
      if (!(await limited(`company-request-write:${user.id}`)))
        return apiError(c, 429, "rate_limited", "Too many requests. Try again later.");
      return c.json(
        requestJson(await setCompanyStatus(db, c.req.valid("param").requestId, c.req.valid("json").status)),
        200,
      );
    },
  );

  app.openapi(
    createRoute({
      method: "put",
      path: "/companies/{requestId}/notes",
      tags,
      summary: "Save the team's notes about a request",
      description: "404 for everyone but the installation's owner, and on agentes.chat itself.",
      security,
      request: { params: IdParams, body: body(z.object({ notes: z.string().max(4000) })) },
      responses: { 200: json(CompanyRequest), ...errors, 404: errors[404], 429: errorResponse("`rate_limited`") },
    }),
    async (c) => {
      const user = c.get("user");
      if (!(await guard(user.id))) return apiError(c, 404, "not_found", "Not found");
      if (!(await limited(`company-request-write:${user.id}`)))
        return apiError(c, 429, "rate_limited", "Too many requests. Try again later.");
      return c.json(
        requestJson(await setCompanyNotes(db, c.req.valid("param").requestId, c.req.valid("json").notes)),
        200,
      );
    },
  );

  app.openapi(
    createRoute({
      method: "put",
      path: "/companies/{requestId}/client-code",
      tags,
      summary: "Keep the company's client code, once it is one",
      description:
        "Three digits (`064`), which the company's deployment reads. Every company has its own. 400 `invalid_client_code` or 409 `client_code_taken`; 404 for everyone but the installation's owner, and on agentes.chat itself.",
      security,
      request: {
        params: IdParams,
        body: body(z.object({ clientCode: z.string().max(8).nullable() })),
      },
      responses: {
        200: json(CompanyRequest),
        ...errors,
        400: errorResponse("`invalid_client_code`, `invalid_request`"),
        404: errors[404],
        409: errorResponse("`client_code_taken`"),
        429: errorResponse("`rate_limited`"),
      },
    }),
    async (c) => {
      const user = c.get("user");
      if (!(await guard(user.id))) return apiError(c, 404, "not_found", "Not found");
      if (!(await limited(`company-request-write:${user.id}`)))
        return apiError(c, 429, "rate_limited", "Too many requests. Try again later.");
      const { clientCode } = c.req.valid("json");
      return c.json(requestJson(await setCompanyClientCode(db, c.req.valid("param").requestId, clientCode)), 200);
    },
  );

  app.openapi(
    createRoute({
      method: "post",
      path: "/companies/{requestId}/invite",
      tags,
      summary: "Send the company its invitation",
      description:
        "Sends the early-access link to the company's address, in its own language, through the same mechanism every invitation goes by, and moves it to `invited`. An address with an account is allowed instead so it may make a workspace (`allowed`). 409 `early_access.no_email` on a server that sends no email; 404 for everyone but the installation's owner, and on agentes.chat itself.",
      security,
      request: { params: IdParams },
      responses: {
        200: json(
          z
            .object({
              request: CompanyRequest,
              outcome: z
                .enum(EARLY_ACCESS_OUTCOMES)
                .openapi({ description: "What the invitation did, as early access answers it." }),
            })
            .openapi("CompanyRequestInvite"),
        ),
        ...errors,
        404: errors[404],
        409: errorResponse("This server sends no email (`early_access.no_email`)"),
        429: errorResponse("`rate_limited`"),
      },
    }),
    async (c) => {
      const user = c.get("user");
      if (!(await guard(user.id))) return apiError(c, 404, "not_found", "Not found");
      if (!(await limited(`company-request-write:${user.id}`)))
        return apiError(c, 429, "rate_limited", "Too many requests. Try again later.");
      if (!deps.adapters.email.delivers)
        return apiError(c, 409, "early_access.no_email", "This server sends no email, so no invitation can go out");
      const { request, outcome } = await inviteCompanyRequest(db, c.req.valid("param").requestId, {
        publicUrl: config.PUBLIC_URL,
        byUserId: user.id,
      });
      return c.json({ request: requestJson(request), outcome }, 200);
    },
  );

  return app;
}
