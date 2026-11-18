import { type Database, eq, like, schema } from "@agenteschat/db";
import type { BlobStore } from "./blob";

const { blobs } = schema;
/** An org's files (`orgs/{orgId}/…`) and its logo (`org-logos/{orgId}/…`). */
const ORG_KEY = /^(?:orgs|org-logos)\/([0-9a-f-]{36})\//i;
/** A person's photo (`avatars/{userId}/…`): theirs in every org, so it belongs to none. */
const PERSON_KEY = /^avatars\/[^/]+\//;
/**
 * A file added to a feedback (`feedback/{fileId}`): kept before any workspace is named, and removed by the
 * feedback's own purge and sweep, so it belongs to no org either.
 */
const FEEDBACK_KEY = /^feedback\/[0-9a-f-]{36}$/i;

/** The largest file a Postgres row keeps: what the Drive took before files went up to 2 GB (ADR 0025). */
export const POSTGRES_OBJECT_BYTES = 50 * 1024 * 1024;

/**
 * Platform storage in Postgres, for deployments without a bucket. A key
 * starts with `orgs/{orgId}/` or `org-logos/{orgId}/` (the row carries that
 * org and is deleted with it), `avatars/{userId}/` or is `feedback/{fileId}`
 * (no org); any other key is refused. Can't sign URLs: downloads are streamed
 * by the server after its checks.
 */
export function createPostgresBlobStore(db: Database): BlobStore {
  const orgOf = (key: string) => {
    const orgId = ORG_KEY.exec(key)?.[1];
    if (orgId) return orgId;
    if (PERSON_KEY.test(key) || FEEDBACK_KEY.test(key)) return null;
    throw new Error(
      `blob key must start with orgs/{orgId}/, org-logos/{orgId}/ or avatars/{userId}/, or be feedback/{fileId}: ${key}`,
    );
  };
  return {
    kind: "postgres",
    // A row holds the bytes as base64 text, read and written whole: files past this go on disk or in a bucket.
    maxObjectBytes: POSTGRES_OBJECT_BYTES,
    async put(key, body, { contentType }) {
      const row = {
        key,
        orgId: orgOf(key),
        contentType,
        size: body.byteLength,
        content: Buffer.from(body).toString("base64"),
      };
      await db
        .insert(blobs)
        .values(row)
        .onConflictDoUpdate({
          target: blobs.key,
          set: { contentType: row.contentType, size: row.size, content: row.content },
        });
    },
    async get(key) {
      const [row] = await db.select().from(blobs).where(eq(blobs.key, key));
      if (!row) return null;
      return { body: new Uint8Array(Buffer.from(row.content, "base64")), contentType: row.contentType };
    },
    async getRange(key, start, end) {
      // The bytes are one base64 column, so the part is cut after it is read: no less memory than `get`, and the same
      // answer as the slice a caller would make. A store that can read a part as it streams has one of its own.
      const [row] = await db.select().from(blobs).where(eq(blobs.key, key));
      if (!row) return null;
      const whole = Buffer.from(row.content, "base64");
      return {
        body: new Uint8Array(whole.subarray(start, end + 1)),
        contentType: row.contentType,
        total: whole.length,
      };
    },
    async delete(key) {
      await db.delete(blobs).where(eq(blobs.key, key));
    },
    async list(prefix, limit = 1000) {
      const escaped = prefix.replace(/[\\%_]/g, (c) => `\\${c}`);
      const rows = await db
        .select({ key: blobs.key })
        .from(blobs)
        .where(like(blobs.key, `${escaped}%`))
        .orderBy(blobs.key)
        .limit(limit);
      return rows.map((r) => r.key);
    },
    async signedUrl() {
      return null;
    },
  };
}
