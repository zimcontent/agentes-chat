import {
  ARTIFACT_LIMITS,
  DESIGN_SOURCE_BYTES,
  FEEDBACK_INBOX_BYTES,
  MEDIA_REF_LIMITS,
  REVIEW_VOICE_BYTES,
  SKILL_LIMITS,
} from "@dougbot/engine";
import { SKILL_ZIP_BASE64_CHARS } from "@dougbot/tokens/skills";
import type { Context } from "hono";
import { bodyLimit } from "hono/body-limit";
import { createMiddleware } from "hono/factory";
import { MULTIPART_PATHS, MULTIPART_SLACK_BYTES } from "../routes/app/context";
import { apiError } from "./errors";

const KIB = 1024;
const MIB = 1024 * KIB;

/**
 * The most an `/api/*` request may send unless its path says otherwise below. Above the largest thing the apps send
 * as plain JSON (a table of `ARTIFACT_LIMITS.tableBytes`), so no route has to ask for it.
 */
export const API_BODY_BYTES = 8 * MIB;

/**
 * Routes that cap their own body: the uploads and imports with their own answer when it is too large, the webhooks
 * and a computer's upload, which count the bytes as they read them, and the git proxy, which passes a push through
 * without holding it.
 */
const OWN_LIMIT = [
  ...MULTIPART_PATHS,
  /\/organizations\/[^/]+\/imports$/,
  /\/organizations\/[^/]+\/vault\/import$/,
  /^\/api\/machines\/uploads\//,
  /^\/api\/webhooks\//,
  /^\/api\/hooks\//,
  /^\/api\/github-app\/webhook$/,
  /^\/api\/git\//,
];

/**
 * The most the HTTP server reads of any request (Bun's own default is 128 MB): a conversation's file, up to 2 GB
 * (ADR 0025), with its form around it. Every other route holds its body far below that (`apiBodyLimit`).
 */
export const SERVER_BODY_BYTES = ARTIFACT_LIMITS.fileBytes + MULTIPART_SLACK_BYTES;

/** A file sent to the Drive or a conversation, or a new version of one: the uploads that take up to 2 GB. */
export const FILE_UPLOAD_PATH = /^\/api\/app\/organizations\/[^/]+\/artifacts(\/[^/]+)?\/files$/;

/** A skill's folder as a base64 zip: what the import's own schema accepts, and the fields around it. */
const SKILL_ZIP_BYTES = SKILL_ZIP_BASE64_CHARS + MIB;

/**
 * Paths with a limit of their own, first match wins, and before the routes that cap themselves: nothing under
 * `/api/auth/` is left without a limit by how its path ends. A new route with a large JSON body gets a line here.
 */
const LIMITS: [RegExp, number][] = [
  // Signing in and up: read before anyone is known, and never more than a few fields.
  [/^\/api\/auth\//, 256 * KIB],
  [/\/organizations\/[^/]+\/skills\/import$/, SKILL_ZIP_BYTES],
  // A batch of notes: the web app keeps one under 8 Mi characters of JSON, and a character is up to 3 bytes on the wire.
  [/\/organizations\/[^/]+\/wiki\/import$/, 32 * MIB],
  // Another server's feedback with its pictures as base64 (ADR 0160 §13).
  [/^\/api\/feedback\/inbox$/, FEEDBACK_INBOX_BYTES],
  // A note said aloud on a video in review: the recording and its form (docs/adr/doug-0007-video-review.md).
  [/\/organizations\/[^/]+\/video-reviews\/[^/]+\/notes\/voice$/, REVIEW_VOICE_BYTES + MULTIPART_SLACK_BYTES],
  // A design piece edited by hand: its whole page, photos inlined, as JSON (docs/adr/doug-0010-design-review.md).
  [/\/organizations\/[^/]+\/video-reviews\/[^/]+\/design$/, Math.ceil(DESIGN_SOURCE_BYTES * 1.1) + 64 * 1024],
  // A media generation's reference file, at most a video's 50 MB, and its form (docs/adr/doug-0011-media-generation.md).
  [/\/organizations\/[^/]+\/media\/refs$/, MEDIA_REF_LIMITS.video + MULTIPART_SLACK_BYTES],
];

/** The most a request to `path` may send, or null where the route caps it itself. */
export function apiBodyMax(path: string): number | null {
  const own = LIMITS.find(([p]) => p.test(path))?.[1];
  if (own !== undefined) return own;
  return OWN_LIMIT.some((p) => p.test(path)) ? null : API_BODY_BYTES;
}

const tooLarge = (c: Context) => apiError(c, 413, "too_large", "The request is too large");
const limiters = new Map<number, ReturnType<typeof bodyLimit>>();
const limiter = (maxSize: number) => {
  const made = limiters.get(maxSize) ?? bodyLimit({ maxSize, onError: tooLarge });
  limiters.set(maxSize, made);
  return made;
};

/**
 * Refuses a body past its path's limit before any route reads it: without it a request nobody signed could make the
 * server hold as much as the HTTP server accepts.
 */
export const apiBodyLimit = createMiddleware((c, next) => {
  const max = apiBodyMax(c.req.path);
  return max === null ? next() : limiter(max)(c, next);
});
