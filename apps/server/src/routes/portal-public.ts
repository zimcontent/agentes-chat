import { eq, schema } from "@agenteschat/db";
import {
  CLIENT_NOTE_MAX,
  clientDecision,
  clientPortalFile,
  clientPortalPage,
  PORTAL_CLIENT_NAME_MAX,
  portalClientOfToken,
  portalLogoKeyOf,
  STANDING_COLUMNS,
  workRefusal,
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

/** The most a decision's body may hold: a note of 4000 characters and the fields around it, far inside this. */
export const PORTAL_DECIDE_BYTES = 64 * 1024;

/** The token's shape in the address: the client's link's own. */
const TOKEN = z.string().regex(/^[A-Za-z0-9_-]{20,64}$/);
const ShortText = (max: number) => z.string().trim().max(max);

/**
 * A file's `Content-Disposition`, for a name that may hold anything a person typed: RFC 6266's two forms. The plain
 * `filename` keeps only ASCII (anything else becomes `_`, quotes and backslashes dropped), so an old client reads a
 * name and never breaks on the header; `filename*` carries the real name as UTF-8 percent-encoding, which every browser
 * since the 2000s prefers. A name with control characters (a newline, a tab) is dropped from the plain form too: a
 * header can't hold them, and an answer that fails to build is a 500 for a file that is perfectly readable.
 */
export function contentDisposition(name: string): string {
  // Control characters (a newline, a tab, DEL), and the two that would end the value or open a parameter, never reach
  // the header: each is read one character at a time, so the pattern holds no control character itself.
  const kept = [...name].filter((ch) => {
    const code = ch.codePointAt(0) ?? 0;
    const control = code < 0x20 || code === 0x7f;
    return !control && ch !== '"' && ch !== "\\";
  });
  const clean = kept.join("").trim() || "file";
  const ascii = [...clean]
    .map((ch) => ((ch.codePointAt(0) ?? 0) < 0x20 || (ch.codePointAt(0) ?? 0) > 0x7e ? "_" : ch))
    .join("");
  const encoded = encodeURIComponent(clean).replace(
    /['()*]/g,
    (ch) => `%${ch.charCodeAt(0).toString(16).toUpperCase()}`,
  );
  return `inline; filename="${ascii}"; filename*=UTF-8''${encoded}`;
}

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
 * The client's side of the approval portal (docs/adr/doug-0022-embedded-approval-portal.md): a page with no account,
 * opened by the client's own link (`/p/<token>`), whose data is read at `/p/api/<token>`. The token is the
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

  /** Whether a decision's body is past `PORTAL_DECIDE_BYTES`: `content-length` says so, else the body is read to see. */
  const overLimit = async (c: { req: { raw: Request } }) => {
    const length = c.req.raw.headers.get("content-length");
    if (length !== null) return Number(length) > PORTAL_DECIDE_BYTES;
    const bytes = await c.req.raw.clone().arrayBuffer();
    return bytes.byteLength > PORTAL_DECIDE_BYTES;
  };

  /**
   * The workspace's standing, before anything of the portal answers: a suspended workspace, one being deleted, or one
   * on a hold has its clients' pages closed, as `workRefusal` closes everything that works (standing.ts). Answering
   * nothing (`404`, as a link that names none) is right: the client's page is the workspace's own, not a sign of life
   * from it. Read from `organizations` on every answer, not from a cache: a suspension that just happened closes it at
   * once.
   */
  const closed = async (orgId: string) => {
    const [org] = await db
      .select(STANDING_COLUMNS)
      .from(schema.organizations)
      .where(eq(schema.organizations.id, orgId));
    return Boolean(workRefusal(org ?? undefined));
  };

  // The page's data, and everything the page needs to draw itself. Opening it marks what waits as seen.
  app.get("/p/api/:token", async (c) => {
    if (!TOKEN.safeParse(c.req.param("token")).success) return notFound();
    if (await limited(c, PORTAL_PAGE_PER_IP, "page")) return apiError(c, 429, "rate_limited", "Slow down");
    const client = await portalClientOfToken(db, c.req.param("token"));
    if (!client) return notFound();
    if (await closed(client.orgId)) return notFound();
    const page = await clientPortalPage(db, client, true);
    return c.json(page, 200, { "cache-control": "no-store", "x-robots-tag": "noindex" });
  });

  // The client's decision: approve, or ask for a change (a note, maybe on a second of a video or a spot of a slide).
  // Its body is capped at 64 KiB before it is read: a note holds at most 4000 characters, and a decision never more.
  app.post("/p/api/:token/decide", async (c) => {
    if (!TOKEN.safeParse(c.req.param("token")).success) return notFound();
    if (await limited(c, PORTAL_DECISION_PER_IP, "decide")) return apiError(c, 429, "rate_limited", "Slow down");
    if (await overLimit(c)) return apiError(c, 413, "too_large", "The decision is too large");
    const client = await portalClientOfToken(db, c.req.param("token"));
    if (!client) return notFound();
    if (await closed(client.orgId)) return notFound();
    const parsed = Decision.safeParse(await c.req.json().catch(() => null));
    if (!parsed.success) return apiError(c, 400, "invalid", "Check what you sent");
    // A post takes a decision once: `clientDecision` turns a row still waiting on the client, and refuses a second.
    const result = await clientDecision({ db, wake: () => deps.wakeWorkers?.() }, client, parsed.data);
    return c.json(result, 200, { "cache-control": "no-store" });
  });

  // A post's file, read through the same token: the client whose link it is owns it, and nothing else.
  app.get("/p/api/:token/files/:fileId", async (c) => {
    if (!TOKEN.safeParse(c.req.param("token")).success) return notFound();
    if (await limited(c, PORTAL_FILE_PER_IP, "file")) return apiError(c, 429, "rate_limited", "Slow down");
    const client = await portalClientOfToken(db, c.req.param("token"));
    if (!client) return notFound();
    if (await closed(client.orgId)) return notFound();
    const file = await clientPortalFile(blobs, client, c.req.param("fileId"));
    if (!file) return notFound();
    return rangedResponse(file.body, c.req.header("range"), {
      "content-type": file.contentType,
      // A file's bytes never change under its id: the page keeps them.
      "cache-control": "private, max-age=3600",
      "content-disposition": contentDisposition(file.name),
      "x-content-type-options": "nosniff",
      "x-robots-tag": "noindex",
    });
  });

  // A client's logo, for its own page: the same token, and only the client's own file.
  app.get("/p/api/:token/logo", async (c) => {
    if (!TOKEN.safeParse(c.req.param("token")).success) return notFound();
    if (await limited(c, PORTAL_FILE_PER_IP, "logo")) return apiError(c, 429, "rate_limited", "Slow down");
    const client = await portalClientOfToken(db, c.req.param("token"));
    if (!client?.logo) return notFound();
    if (await closed(client.orgId)) return notFound();
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
