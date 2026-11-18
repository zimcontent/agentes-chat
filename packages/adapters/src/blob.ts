/**
 * Object storage for files (artifact versions, uploads). Objects are private:
 * the app hands out short-lived signed URLs after its own org and visibility
 * checks, or streams the bytes itself when a store can't sign.
 *
 * Implementations: S3-compatible buckets (`createS3BlobStore`: Cloudflare R2,
 * AWS S3, MinIO, Wasabi…), a folder on the server's disk (`createDiskBlobStore`),
 * Postgres (`createPostgresBlobStore`, the fallback when neither is configured)
 * and memory (tests). Google Drive and OneDrive (OAuth into a folder the org
 * picks) are planned behind the same interface.
 */
export interface BlobStore {
  /** `s3`, `postgres`, `memory`… */
  readonly kind: string;
  put(key: string, body: Uint8Array, options: { contentType: string }): Promise<void>;
  /**
   * Stores the file at `path` on this server's disk as it is read, never whole in memory, where the store can (a
   * conversation's file of up to 2 GB, ADR 0025). `sha256` (hex) and `size` were counted as it arrived.
   */
  putFile?(key: string, path: string, options: { contentType: string; size: number; sha256: string }): Promise<void>;
  /** The largest object `put` takes, where the store has a limit of its own (a database row). */
  readonly maxObjectBytes?: number;
  get(key: string): Promise<{ body: Uint8Array; contentType: string } | null>;
  /**
   * The part `start`–`end` (both included) of the object's bytes, where the store can read part of one without the
   * whole of it in memory; without it, `get` and a slice. A video read with `Range` asks for a second here, and the
   * store answers just those bytes. `total` is always the object's whole size. Every store refuses a negative
   * `start`/`end` the same way (`RangeError`, `badBlobRange`): a part before the first byte is a caller's mistake,
   * never quietly the file's beginning.
   */
  getRange?(
    key: string,
    start: number,
    end: number,
  ): Promise<{ body: Uint8Array; contentType: string; total: number } | null>;
  /** The object's bytes as they are read, where the store can; without it, `get`. */
  stream?(key: string): Promise<ReadableStream<Uint8Array> | null>;
  delete(key: string): Promise<void>;
  /** Keys under `prefix`, at most `limit` (default 1000). */
  list(prefix: string, limit?: number): Promise<string[]>;
  /** Everything under the folder `prefix` (ends with `/`) at once, folders included, where the store can. */
  deletePrefix?(prefix: string): Promise<void>;
  /**
   * A short-lived URL that downloads the object, or null when this store
   * can't sign (the server streams it instead).
   */
  signedUrl(key: string, options: { expiresInSeconds: number; filename?: string }): Promise<string | null>;
}

/**
 * The refusal every store's `getRange` gives a part that begins before the first byte, or ends before it starts: a
 * caller's mistake, the same in each store, never a silent read of the file's beginning.
 */
export function badBlobRange(start: number, end: number): RangeError {
  return new RangeError(`a blob's part can't be ${start}-${end}: both are whole numbers, 0 ≤ start ≤ end`);
}

/** Whether this part is one a store reads: whole offsets, never before the object's first byte. */
export const readableRange = (start: number, end: number) =>
  Number.isInteger(start) && Number.isInteger(end) && start >= 0 && end >= start;

/**
 * Where blobs of one organization go. `storageConfigId` null = platform
 * storage (with a per-org key prefix). Every read and write goes through a
 * resolver; each stored object records the config it was written to, so a
 * switch never breaks old files.
 */
export interface BlobLocation {
  storageConfigId: string | null;
  store: BlobStore;
  /** Key prefix for new objects of this org in this store (ends with `/`). */
  prefix: string;
}

export interface BlobStoreResolver {
  /** Where new objects of `orgId` are written. */
  forOrg(orgId: string): Promise<BlobLocation>;
  /** The store an existing object was written to. */
  forConfig(orgId: string, storageConfigId: string | null): Promise<BlobStore>;
}

/** Platform storage for every org, with a per-org prefix (core default and tests). */
export function singleStoreResolver(store: BlobStore, root = "orgs"): BlobStoreResolver {
  return {
    async forOrg(orgId) {
      return { storageConfigId: null, store, prefix: `${root}/${orgId}/` };
    },
    async forConfig() {
      return store;
    },
  };
}

/** In-memory store (tests and local experiments). `signedUrl` returns a fake URL unless `sign: false`. */
export function createMemoryBlobStore(options: { sign?: boolean; kind?: string } = {}) {
  const objects = new Map<string, { body: Uint8Array; contentType: string }>();
  const store: BlobStore & { objects: typeof objects } = {
    kind: options.kind ?? "memory",
    objects,
    async put(key, body, { contentType }) {
      objects.set(key, { body: new Uint8Array(body), contentType });
    },
    async putFile(key, path, { contentType }) {
      objects.set(key, { body: new Uint8Array(await Bun.file(path).arrayBuffer()), contentType });
    },
    async get(key) {
      const o = objects.get(key);
      return o ? { body: new Uint8Array(o.body), contentType: o.contentType } : null;
    },
    async getRange(key, start, end) {
      if (!readableRange(start, end)) throw badBlobRange(start, end);
      const o = objects.get(key);
      if (!o) return null;
      return { body: new Uint8Array(o.body.slice(start, end + 1)), contentType: o.contentType, total: o.body.length };
    },
    async delete(key) {
      objects.delete(key);
    },
    async list(prefix, limit = 1000) {
      return [...objects.keys()].filter((k) => k.startsWith(prefix)).slice(0, limit);
    },
    async signedUrl(key, { expiresInSeconds }) {
      if (options.sign === false) return null;
      return `memory://${encodeURIComponent(key)}?expires=${expiresInSeconds}`;
    },
  };
  return store;
}
