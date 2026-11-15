/**
 * A storage server this server's operator runs and hands out to workspaces (docs/adr/doug-0010-storage-server.md):
 * each workspace that switches it on gets a bucket and a key of its own there, the key allowed on that bucket only.
 * One implementation, Garage's admin API v2 (`createGarageStorageHost`); tests use `createMemoryStorageHost`.
 */
export interface StorageHost {
  /** The bucket called `name`, made when it doesn't exist yet. Returns its id on the server. */
  ensureBucket(name: string): Promise<string>;
  /** A new access key named `name` (a label on the server, not unique). */
  createKey(name: string): Promise<{ accessKeyId: string; secretAccessKey: string }>;
  /** Lets the key read and write the bucket (never own it: it can't change who else may). */
  allow(bucketId: string, accessKeyId: string): Promise<void>;
}

export class StorageHostError extends Error {
  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message);
    this.name = "StorageHostError";
  }
}

export interface GarageStorageHostOptions {
  /** The admin API's address, e.g. `https://storage.example.com:3904`. */
  adminUrl: string;
  /** Garage's `admin_token`. */
  token: string;
  fetch?: typeof fetch;
}

/** Garage's admin API v2 (`/v2/GetBucketInfo`, `/v2/CreateBucket`, `/v2/CreateKey`, `/v2/AllowBucketKey`). */
export function createGarageStorageHost(options: GarageStorageHostOptions): StorageHost {
  const base = options.adminUrl.replace(/\/+$/, "");
  const doFetch = options.fetch ?? fetch;
  const call = async <T>(path: string, init: { method: "GET" | "POST"; body?: unknown }): Promise<T | null> => {
    const res = await doFetch(`${base}${path}`, {
      method: init.method,
      headers: { authorization: `Bearer ${options.token}`, "content-type": "application/json" },
      body: init.body === undefined ? undefined : JSON.stringify(init.body),
      signal: AbortSignal.timeout(20_000),
    });
    if (res.status === 404) return null;
    const text = await res.text();
    if (!res.ok) {
      let code = "";
      try {
        code = String((JSON.parse(text) as { code?: unknown }).code ?? "");
      } catch {
        // Not JSON: the status says enough.
      }
      throw new StorageHostError(
        `storage server answered ${res.status}${code ? ` (${code})` : ""} on ${path}`,
        res.status,
      );
    }
    return (text ? JSON.parse(text) : {}) as T;
  };
  const bucketByName = async (name: string) =>
    (await call<{ id: string }>(`/v2/GetBucketInfo?globalAlias=${encodeURIComponent(name)}`, { method: "GET" }))?.id ??
    null;
  return {
    async ensureBucket(name) {
      const found = await bucketByName(name);
      if (found) return found;
      try {
        const made = await call<{ id: string }>("/v2/CreateBucket", { method: "POST", body: { globalAlias: name } });
        if (made?.id) return made.id;
      } catch (error) {
        // Made by a call that crossed this one: read it back.
        const again = await bucketByName(name);
        if (again) return again;
        throw error;
      }
      throw new StorageHostError(`storage server made no bucket ${name}`, 500);
    },
    async createKey(name) {
      const key = await call<{ accessKeyId: string; secretAccessKey: string | null }>("/v2/CreateKey", {
        method: "POST",
        body: { name },
      });
      if (!key?.accessKeyId || !key.secretAccessKey) throw new StorageHostError("storage server made no key", 500);
      return { accessKeyId: key.accessKeyId, secretAccessKey: key.secretAccessKey };
    },
    async allow(bucketId, accessKeyId) {
      await call("/v2/AllowBucketKey", {
        method: "POST",
        body: { bucketId, accessKeyId, permissions: { read: true, write: true, owner: false } },
      });
    },
  };
}

/** Tests: buckets and keys in memory, with who may use which. */
export function createMemoryStorageHost() {
  const buckets = new Map<string, string>();
  const keys = new Map<string, { name: string; secretAccessKey: string; buckets: Set<string> }>();
  let n = 0;
  const host: StorageHost & {
    buckets: Map<string, string>;
    keys: typeof keys;
  } = {
    buckets,
    keys,
    async ensureBucket(name) {
      const found = buckets.get(name);
      if (found) return found;
      const id = `bucket-${++n}`;
      buckets.set(name, id);
      return id;
    },
    async createKey(name) {
      const accessKeyId = `GK${String(++n).padStart(8, "0")}`;
      const secretAccessKey = `secret-${n}-${crypto.randomUUID()}`;
      keys.set(accessKeyId, { name, secretAccessKey, buckets: new Set() });
      return { accessKeyId, secretAccessKey };
    },
    async allow(bucketId, accessKeyId) {
      const key = keys.get(accessKeyId);
      if (!key) throw new StorageHostError("no such key", 404);
      key.buckets.add(bucketId);
    },
  };
  return host;
}
