import {
  COMPANY_COMPANY_MAX,
  COMPANY_INTERESTS,
  COMPANY_MAX_EMAILS_PER_ADDRESS_DAY,
  COMPANY_MESSAGE_MAX,
  COMPANY_NAME_MAX,
  COMPANY_STATUSES,
  COMPANY_TEAM_SIZES,
  checkCompanyRequest,
  companyEmailLimitKey,
  companyRequestById,
  companyRequestEmail,
  confirmCompanyRequest,
  deleteCompanyRequest,
  deleteCompanyRequestByToken,
  EARLY_ACCESS_OUTCOMES,
  inviteCompanyRequest,
  isAgentesCloud,
  joinCompanyRequests,
  listCompanyRequests,
  pinnedOwner,
  setCompanyClientCode,
  setCompanyNotes,
  setCompanyStatus,
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

/** A form per address per hour, and in total per hour (each may mail). */
const JOIN_PER_IP = { limit: 10, windowMs: 3600_000 };
const JOIN_TOTAL = { limit: 200, windowMs: 3600_000 };
/** Confirmation attempts per address per hour (tokens are 192 bits; this only stops noise). */
const CONFIRM_PER_IP = { limit: 30, windowMs: 3600_000 };
/** The team's own reads and writes through this route. */
const ADMIN_WRITES = { limit: 60, windowMs: 60_000 };
/** A few emails an address a day, over every form and resend of it: one flood meets a wall, not a row's window. */
const ADDRESS_EMAILS = { limit: COMPANY_MAX_EMAILS_PER_ADDRESS_DAY, windowMs: 24 * 3600_000 };

const TeamSize = z.enum(COMPANY_TEAM_SIZES).openapi("CompanyTeamSize", {
  description: "A size band: `1-5`, `6-20`, `21-50`, `51-200`, `200+`.",
});
const Interest = z.enum(COMPANY_INTERESTS).openapi("CompanyInterest", {
  description: "What the company wants to automate: `design`, `video`, `ads`, `social`, `code`, `finance`.",
});
const Locale = z.string().max(35).openapi("CompanyLocale", {
  description:
    "The page's language, as its app resolved it (`pt-BR`, `es`…): any tag it falls back from is taken (`en-US` reads English, `es-MX` Spanish), and an unknown one reads English. Never refused.",
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
    confirmedAt: z.string().nullable().openapi({ description: "When the address confirmed itself (double opt-in)." }),
    pendingResendAt: z
      .string()
      .nullable()
      .openapi({ description: "A confirmed second form waiting for its link to be opened: when it was sent." }),
    invitedAt: z.string().nullable(),
    createdAt: z.string(),
    updatedAt: z.string(),
  })
  .openapi("CompanyRequest");

const requestJson = (r: Awaited<ReturnType<typeof companyRequestById>>) => ({
  ...r,
  confirmedAt: iso(r.confirmedAt),
  pendingResendAt: iso(r.pendingResendAt),
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
    "Public, from this server's own page (`/empresas`, JSON only). Writes a company's request, or asks the address to confirm what a second form changes. The request is `unconfirmed` until the link in its email is opened, so the installation's owner never hears of it before; a consent is required (LGPD), and without `consent: true` nothing is kept. Answers 202 whether it was new or an update, so the list can't be probed. Guarded by the bot check when this server has one. Not served on agentes.chat's own servers (404).",
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
    404: errorResponse("agentes.chat's own servers (`not_found`): the form is self-hosting's."),
    429: errorResponse("Too many attempts (`rate_limited`)"),
  },
});

const confirm = createRoute({
  method: "post",
  path: "/companies/confirm",
  tags: ["Public"],
  summary: "Confirm a company's request",
  description:
    "Public, from the page the confirmation link opens (POST, so mail scanners that only fetch the URL don't confirm). Confirms the address, and only then is the installation's owner told; a confirmed request's second form is applied, and a `discarded` one comes back to `new`. Not served on agentes.chat's own servers (404).",
  request: {
    body: {
      required: true,
      content: { "application/json": { schema: z.object({ token: z.string().max(64) }) } },
    },
  },
  responses: {
    200: {
      description: "Confirmed",
      content: { "application/json": { schema: z.object({ ok: z.literal(true) }) } },
    },
    400: errorResponse("Unknown or expired link (`invalid_token`) or bad body (`invalid_request`)"),
    403: errorResponse("Not from our origin (`bad_origin`)"),
    404: errorResponse("agentes.chat's own servers (`not_found`): the form is self-hosting's."),
    429: errorResponse("Too many attempts (`rate_limited`)"),
  },
});

const erase = createRoute({
  method: "post",
  path: "/companies/delete",
  tags: ["Public"],
  summary: "Erase a company's request from its own delete link",
  description:
    "Public, from the page the delete link in the confirmation email opens (POST, so a mail scanner that only fetches the link deletes nothing). The link is the person's own token, good for longer than the confirmation's and spent once: it erases the request and everything it holds, the consent included, and every notice about it. An unknown or expired link (`invalid_token`) erases nothing. Not served on agentes.chat's own servers (404).",
  request: {
    body: {
      required: true,
      content: { "application/json": { schema: z.object({ token: z.string().max(64) }) } },
    },
  },
  responses: {
    200: {
      description: "Erased",
      content: { "application/json": { schema: z.object({ ok: z.literal(true) }) } },
    },
    400: errorResponse("Unknown or expired link (`invalid_token`) or bad body (`invalid_request`)"),
    403: errorResponse("Not from our origin (`bad_origin`)"),
    404: errorResponse("agentes.chat's own servers (`not_found`): the form is self-hosting's."),
    429: errorResponse("Too many attempts (`rate_limited`)"),
  },
});

/**
 * `POST /api/companies`, `/api/companies/confirm` and `/api/companies/delete` (the public page), and from the apps
 * the installation's list of requests: `GET /api/app/companies` and one by id, with the team's moves (its step, its
 * notes, its client's code), the Delete that erases it and the Invite that sends it the early-access link.
 *
 * The public part is self-hosting's alone: agentes.chat's own servers register no route and serve no page, so a
 * company that asks there finds nothing (`registerCompanyRequests` answers nothing when `isAgentesCloud`).
 */
export function registerCompanyRequests(api: OpenAPIHono, deps: AppDeps) {
  const { config } = deps;
  // agentes.chat's own servers offer the form nowhere: no route, no page (`companiesPage`).
  if (isAgentesCloud(config.PUBLIC_URL)) return;
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
    // One address a few emails a day, whichever form or resend asks: the count spans every request of it, so a flood
    // meets a wall even across several requests. Checked on the address as it will be stored, before any email goes;
    // a form that still lands (a confirmed request's resend keeps apart) has spent one. The answer is the same either
    // way, since the list is never probed, so a refused send is a 202 that mails nothing (like the row's own window).
    // A mistyped form answers its 400 first, spending nothing of the address's day.
    checkCompanyRequest(input);
    const email = companyRequestEmail(input.email);
    if (email && !(await rateLimiter.consume(companyEmailLimitKey(email), ADDRESS_EMAILS)).allowed)
      return c.json({ ok: true as const }, 202);
    const ownerUserId = await pinnedOwner(deps.db);
    await joinCompanyRequests(deps.db, input, notifyOf(deps, ownerUserId));
    return c.json({ ok: true as const }, 202);
  });

  api.openapi(confirm, async (c) => {
    const origin = c.req.header("origin");
    if (!origin || !allowedOrigins(config).has(origin))
      return apiError(c, 403, "bad_origin", "Cross-origin request refused");
    const ip = requestLimitIp(c.req.raw.headers, config.TRUSTED_PROXIES);
    if (!(await rateLimiter.consume(`company-request-confirm:${ip}`, CONFIRM_PER_IP)).allowed)
      return apiError(c, 429, "rate_limited", "Too many requests. Try again later.");
    const ownerUserId = await pinnedOwner(deps.db);
    const result = await confirmCompanyRequest(deps.db, c.req.valid("json").token, notifyOf(deps, ownerUserId));
    if (!result.confirmed)
      return apiError(c, 400, "invalid_token", "This link is unknown or expired. Send the form again for a new one.");
    return c.json({ ok: true as const }, 200);
  });

  api.openapi(erase, async (c) => {
    const origin = c.req.header("origin");
    if (!origin || !allowedOrigins(config).has(origin))
      return apiError(c, 403, "bad_origin", "Cross-origin request refused");
    const ip = requestLimitIp(c.req.raw.headers, config.TRUSTED_PROXIES);
    if (!(await rateLimiter.consume(`company-request-delete:${ip}`, CONFIRM_PER_IP)).allowed)
      return apiError(c, 429, "rate_limited", "Too many requests. Try again later.");
    const erased = await deleteCompanyRequestByToken(deps.db, c.req.valid("json").token);
    if (!erased)
      return apiError(c, 400, "invalid_token", "This link is unknown or expired. The request is already gone.");
    return c.json({ ok: true as const }, 200);
  });

  return api;
}

/** Who hears a confirmed request: the installation's owner, in the app and (when told where) by email. */
const notifyOf = (deps: AppDeps, ownerUserId: string | null) => ({
  pubsub: deps.adapters.pubsub,
  ownerUserId,
  emailTo: deps.config.COMPANY_REQUESTS_NOTIFY_EMAIL ?? null,
  publicUrl: deps.config.PUBLIC_URL,
});

const Count = z.number().int().min(0);

/**
 * The team's list of company requests, in Settings ("Empresas"), for the installation's pinned owner (ADR doug-0033):
 * the requests, filtered and searched, each moved through its step, given notes and its client's code, deleted, and
 * invited through early access. A server without email refuses the Invite. The routes answer 404 to everyone else and
 * on agentes.chat itself, and live under `/api/app/companies`; the public form alone is `/api/companies`.
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
      method: "delete",
      path: "/companies/{requestId}",
      tags,
      summary: "Delete a company request",
      description:
        "Erases the request and everything it holds, the consent included (the LGPD's right to erasure). 404 for everyone but the installation's owner, and on agentes.chat itself.",
      security,
      request: { params: IdParams },
      responses: {
        204: { description: "Deleted" },
        ...errors,
        404: errors[404],
        429: errorResponse("`rate_limited`"),
      },
    }),
    async (c) => {
      const user = c.get("user");
      if (!(await guard(user.id))) return apiError(c, 404, "not_found", "Not found");
      if (!(await limited(`company-request-write:${user.id}`)))
        return apiError(c, 429, "rate_limited", "Too many requests. Try again later.");
      await deleteCompanyRequest(db, c.req.valid("param").requestId);
      return c.body(null, 204);
    },
  );

  app.openapi(
    createRoute({
      method: "put",
      path: "/companies/{requestId}/status",
      tags,
      summary: "Move a request to another step",
      description:
        "The team's own step: `new`, `talking`, `invited`, `deployed` (the company is a client) or `discarded`. Moving it resolves its notice in the owner's inbox. 404 for everyone but the installation's owner, and on agentes.chat itself.",
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
