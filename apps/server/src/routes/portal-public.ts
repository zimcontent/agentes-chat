import {
  CLIENT_NOTE_MAX,
  clientDecision,
  clientPortalFile,
  clientPortalPage,
  PORTAL_CLIENT_NAME_MAX,
  portalClientOfToken,
  portalLogoKeyOf,
} from "@agenteschat/engine";
import type { OpenAPIHono } from "@hono/zod-openapi";
import { z } from "zod";
import { rangedResponse } from "../http/byte-range";
import { requestLimitIp } from "../http/client-ip";
import { apiError } from "../http/errors";
import type { AppDeps } from "./app/context";

/** The client's page's own rate limits: opening it, deciding on a post, and reading each file. */
export const PORTAL_PAGE_PER_IP = { limit: 120, windowMs: 60_000 };
export const PORTAL_DECISION_PER_IP = { limit: 40, windowMs: 60_000 };
export const PORTAL_FILE_PER_IP = { limit: 600, windowMs: 60_000 };

/** The token's shape in the address: the client's link's own. */
const TOKEN = z.string().regex(/^[A-Za-z0-9_-]{20,64}$/);
const ShortText = (max: number) => z.string().trim().max(max);

const Decision = z
  .object({
    postId: z.string().uuid(),
    decision: z.enum(["approve", "adjust"]),
    text: ShortText(CLIENT_NOTE_MAX).optional(),
    atSeconds: z
      .number()
      .min(0)
      .max(24 * 3600)
      .nullish(),
    page: z.number().int().min(1).max(1000).nullish(),
    x: z.number().min(0).max(1).nullish(),
    y: z.number().min(0).max(1).nullish(),
    by: ShortText(PORTAL_CLIENT_NAME_MAX).nullish(),
  })
  .strict();

/**
 * The client's side of the approval portal (docs/adr/doug-0020-embedded-approval-portal.md): a page with no account,
 * opened by the client's own link (`/portal/<token>`), whose data is read at `/portal/api/<token>`. The token is the
 * whole of the access, good for one client of one workspace; nothing of the app's signed-in routes is read here, and
 * nothing of the workspace but the client's own name and logo reaches the page. Each answer is `no-store`, and each
 * request counts against a limit of the caller's address.
 *
 * These routes are mounted on the app itself, outside `/api/`, so nothing of the workspace's API is reachable from a
 * client's link and the page loads no session.
 */
export function registerPortalPublicRoutes(app: OpenAPIHono, deps: AppDeps) {
  // A server given a bridge keeps that portal's page: this one is this server's own only.
  if (!deps.adapters.approvalPortalEmbedded || !deps.adapters.approvalPortal) return;
  const { db, adapters, config } = deps;
  const blobs = { db, blobs: adapters.platformBlobs };
  const limited = async (c: { req: { raw: Request } }, rule: { limit: number; windowMs: number }, key: string) => {
    const ip = requestLimitIp(c.req.raw.headers, config.TRUSTED_PROXIES);
    return !(await adapters.rateLimiter.consume(`portal-public:${key}:${ip}`, rule)).allowed;
  };
  const notFound = () => new Response("Not found", { status: 404, headers: { "cache-control": "no-store" } });

  // The page's data, and everything the page needs to draw itself. Opening it marks what waits as seen.
  app.get("/portal/api/:token", async (c) => {
    if (!TOKEN.safeParse(c.req.param("token")).success) return notFound();
    if (await limited(c, PORTAL_PAGE_PER_IP, "page")) return apiError(c, 429, "rate_limited", "Slow down");
    const client = await portalClientOfToken(db, c.req.param("token"));
    if (!client) return notFound();
    const page = await clientPortalPage(db, client, true);
    return c.json(page, 200, { "cache-control": "no-store", "x-robots-tag": "noindex" });
  });

  // The client's decision: approve, or ask for a change (a note, maybe on a second of a video or a spot of a slide).
  app.post("/portal/api/:token/decide", async (c) => {
    if (!TOKEN.safeParse(c.req.param("token")).success) return notFound();
    if (await limited(c, PORTAL_DECISION_PER_IP, "decide")) return apiError(c, 429, "rate_limited", "Slow down");
    const client = await portalClientOfToken(db, c.req.param("token"));
    if (!client) return notFound();
    const parsed = Decision.safeParse(await c.req.json().catch(() => null));
    if (!parsed.success) return apiError(c, 400, "invalid", "Check what you sent");
    // A post takes a decision once: `clientDecision` reads the row's status and refuses a second one.
    const result = await clientDecision({ db, wake: () => deps.wakeWorkers?.() }, client, parsed.data);
    return c.json(result, 200, { "cache-control": "no-store" });
  });

  // A post's file, read through the same token: the client whose link it is owns it, and nothing else.
  app.get("/portal/api/:token/files/:fileId", async (c) => {
    if (!TOKEN.safeParse(c.req.param("token")).success) return notFound();
    if (await limited(c, PORTAL_FILE_PER_IP, "file")) return apiError(c, 429, "rate_limited", "Slow down");
    const client = await portalClientOfToken(db, c.req.param("token"));
    if (!client) return notFound();
    const file = await clientPortalFile(blobs, client, c.req.param("fileId"));
    if (!file) return notFound();
    return rangedResponse(file.body, c.req.header("range"), {
      "content-type": file.contentType,
      // A file's bytes never change under its id: the page keeps them.
      "cache-control": "private, max-age=3600",
      "content-disposition": `inline; filename="${file.name.replace(/["\\]/g, "")}"`,
      "x-content-type-options": "nosniff",
      "x-robots-tag": "noindex",
    });
  });

  // A client's logo, for its own page: the same token, and only the client's own file.
  app.get("/portal/api/:token/logo", async (c) => {
    if (!TOKEN.safeParse(c.req.param("token")).success) return notFound();
    if (await limited(c, PORTAL_FILE_PER_IP, "logo")) return apiError(c, 429, "rate_limited", "Slow down");
    const client = await portalClientOfToken(db, c.req.param("token"));
    if (!client?.logo) return notFound();
    // The logo is kept in the workspace's own bucket, under the same key the members' route reads (`portalLogoPath`).
    const object = await adapters.platformBlobs.get(portalLogoKeyOf(client.orgId, client.client, client.logo));
    if (!object) return notFound();
    return new Response(object.body as Uint8Array<ArrayBuffer>, {
      headers: {
        "content-type": object.contentType,
        "cache-control": "private, max-age=3600",
        "x-content-type-options": "nosniff",
        "x-robots-tag": "noindex",
      },
    });
  });
}
