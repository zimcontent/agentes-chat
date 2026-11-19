import { afterEach, describe, expect, test } from "bun:test";
import { createFakeS3, createMemoryStorageHost, type StorageHost, StorageHostError } from "@dougbot/adapters";
import { and, eq, schema } from "@dougbot/db";
import {
  createArtifact,
  createBlobStoreResolver,
  createOrganization,
  getArtifact,
  getStorage,
  providedBucketName,
  provideStorage,
  type StorageDeps,
  saveStorage,
  testStorage,
} from "../src";
import { addMember, type Fixture, setup } from "./fixtures";

// The storage server this server hands out (docs/adr/doug-0010-storage-server.md): a bucket and key per workspace.

let f: Fixture;
afterEach(async () => {
  await f?.close();
});

const KEY = { accessKeyId: "GKSTORAGE01", secretAccessKey: "storage-server-secret-123456" };
const person = (userId: string) => ({ type: "person" as const, userId });
const doc = (title: string) => ({ title, content: { kind: "document" as const, markdown: `# ${title}` } });

/** A storage server at storage.example.com: the fake S3 takes the one key it hands out, the host records the rest. */
function storageServer(fx: Fixture, overrides: Partial<StorageHost> = {}) {
  const s3 = createFakeS3({ host: "storage.example.com", region: "garage", ...KEY, buckets: [] });
  const host = createMemoryStorageHost();
  const keys: string[] = [];
  const server: StorageHost = {
    async ensureBucket(name) {
      if (!s3.buckets.has(name)) s3.buckets.set(name, new Map());
      return host.ensureBucket(name);
    },
    async createKey(name) {
      const made = await host.createKey(name);
      keys.push(made.accessKeyId);
      // The fake S3 knows one key: the record of who may use which bucket is the host's.
      host.keys.set(KEY.accessKeyId, {
        ...(host.keys.get(made.accessKeyId) ?? { name, buckets: new Set() }),
        secretAccessKey: KEY.secretAccessKey,
      });
      return KEY;
    },
    allow: (bucketId, accessKeyId) => host.allow(bucketId, accessKeyId),
    ...overrides,
  };
  const deps: StorageDeps = {
    ...fx.storage,
    fetch: s3.fetch,
    provided: { name: "Storage VM", endpoint: "https://storage.example.com", region: "garage", host: server },
  };
  return { s3, host, keys, deps, artifacts: { ...fx.artifactDeps, blobs: createBlobStoreResolver(deps) } };
}

describe("the storage server", () => {
  test("each workspace that switches it on gets a bucket of its own, and its files go there", async () => {
    f = await setup();
    const server = storageServer(f);
    const { organization: other } = await createOrganization(f.db, f.owner.id, { name: "Outra" });

    const view = await provideStorage(server.deps, f.owner.id, f.org.id);
    expect(view).toEqual({ kind: "provided", s3: null, migration: null });
    await provideStorage(server.deps, f.owner.id, other.id);

    const mine = providedBucketName(f.org.id);
    const theirs = providedBucketName(other.id);
    expect(mine).not.toBe(theirs);
    expect([...server.s3.buckets.keys()].sort()).toEqual([mine, theirs].sort());
    // One key per workspace, each allowed on its own bucket alone.
    expect(server.keys).toHaveLength(2);
    const allowed = [...server.host.keys.values()].map((k) => [...k.buckets]);
    expect(allowed.filter((b) => b.length > 0).every((b) => b.length === 1)).toBe(true);

    const a = await createArtifact(server.artifacts, person(f.owner.id), f.org.id, doc("Nosso"));
    const b = await createArtifact(server.artifacts, person(f.owner.id), other.id, doc("Deles"));
    const inMine = [...(server.s3.buckets.get(mine)?.keys() ?? [])];
    const inTheirs = [...(server.s3.buckets.get(theirs)?.keys() ?? [])];
    // The probe object is gone; each file sits in its own workspace's bucket, at the bucket's root.
    expect(inMine).toHaveLength(1);
    expect(inMine[0]?.startsWith(`artifacts/${a.id}/v1-`)).toBe(true);
    expect(inTheirs).toHaveLength(1);
    expect(inTheirs[0]?.startsWith(`artifacts/${b.id}/v1-`)).toBe(true);
    expect((await getArtifact(server.artifacts, person(f.owner.id), f.org.id, a.id)).content).toEqual(
      doc("Nosso").content,
    );

    const audit = await f.db
      .select()
      .from(schema.auditLog)
      .where(and(eq(schema.auditLog.orgId, f.org.id), eq(schema.auditLog.action, "storage.provided")));
    expect(audit).toHaveLength(1);
    expect(audit[0]?.details).toEqual({ name: "Storage VM", bucket: mine });
  });

  test("switched off and on again, the same bucket and key come back", async () => {
    f = await setup();
    const server = storageServer(f);
    await provideStorage(server.deps, f.owner.id, f.org.id);
    await provideStorage(server.deps, f.owner.id, f.org.id);
    expect((await saveStorage(server.deps, f.owner.id, f.org.id, { kind: "agentes" })).kind).toBe("agentes");
    expect((await provideStorage(server.deps, f.owner.id, f.org.id)).kind).toBe("provided");
    expect(server.keys).toHaveLength(1);
    const rows = await f.db.select().from(schema.storageConfigs).where(eq(schema.storageConfigs.orgId, f.org.id));
    expect(rows).toHaveLength(1);
    expect(rows[0]?.status).toBe("active");
  });

  test("two clicks at once make one key", async () => {
    f = await setup();
    const server = storageServer(f);
    await Promise.all([
      provideStorage(server.deps, f.owner.id, f.org.id),
      provideStorage(server.deps, f.owner.id, f.org.id),
    ]);
    expect(server.keys).toHaveLength(1);
  });

  test("its rows follow the address the server gives now", async () => {
    f = await setup();
    const server = storageServer(f);
    await provideStorage(server.deps, f.owner.id, f.org.id);
    const moved = createFakeS3({ host: "files.example.com", region: "garage", ...KEY, buckets: [] });
    moved.buckets.set(providedBucketName(f.org.id), new Map());
    const deps: StorageDeps = {
      ...server.deps,
      fetch: moved.fetch,
      provided: {
        ...(server.deps.provided as NonNullable<StorageDeps["provided"]>),
        endpoint: "https://files.example.com",
      },
    };
    const made = await createArtifact(
      { ...f.artifactDeps, blobs: createBlobStoreResolver(deps) },
      person(f.owner.id),
      f.org.id,
      doc("Mudou"),
    );
    expect([...(moved.buckets.get(providedBucketName(f.org.id))?.keys() ?? [])][0]).toStartWith(
      `artifacts/${made.id}/`,
    );
  });

  test("refused when the server offers none, or when it doesn't answer; nothing switches", async () => {
    f = await setup();
    await expect(provideStorage(f.storage, f.owner.id, f.org.id)).rejects.toMatchObject({
      code: "storage.provided_off",
    });
    const down = storageServer(f, {
      ensureBucket: async () => {
        throw new StorageHostError("storage server answered 503", 503);
      },
    });
    await expect(provideStorage(down.deps, f.owner.id, f.org.id)).rejects.toMatchObject({
      code: "storage.provided_failed",
    });
    expect((await getStorage(f.db, f.owner.id, f.org.id)).kind).toBe("agentes");
  });

  test("only admins switch it on, and its key is never lent to a bucket someone types", async () => {
    f = await setup();
    const server = storageServer(f);
    const bia = await addMember(f.db, f.org.id, "member", "bia");
    await expect(provideStorage(server.deps, bia.id, f.org.id)).rejects.toThrow();
    expect(server.keys).toHaveLength(0);
    await provideStorage(server.deps, f.owner.id, f.org.id);
    const typed = await testStorage(server.deps, f.owner.id, f.org.id, {
      endpoint: "https://s3.example.com",
      region: "us-east-1",
      bucket: "acme-files",
      prefix: null,
      pathStyle: true,
    });
    expect(typed.ok).toBe(false);
    expect(typed.steps[0]?.code).toBe("storage.credentials_required");
  });
});
