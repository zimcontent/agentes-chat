import { describe, expect, test } from "bun:test";
import { createGarageStorageHost, StorageHostError } from "../src/storage-host";

/** A Garage admin API in memory: the calls it got, and the answers it gives. */
function fakeGarage() {
  const calls: { method: string; path: string; auth: string | null; body: unknown }[] = [];
  const buckets = new Map<string, string>();
  const fetch = (async (input: string | URL | Request, init?: RequestInit) => {
    const url = new URL(String(input));
    const body = init?.body ? JSON.parse(String(init.body)) : undefined;
    calls.push({
      method: init?.method ?? "GET",
      path: url.pathname + url.search,
      auth: new Headers(init?.headers).get("authorization"),
      body,
    });
    const json = (status: number, value: unknown) => new Response(JSON.stringify(value), { status });
    switch (url.pathname) {
      case "/v2/GetBucketInfo": {
        const id = buckets.get(url.searchParams.get("globalAlias") ?? "");
        return id ? json(200, { id }) : json(404, { code: "NoSuchBucket" });
      }
      case "/v2/CreateBucket": {
        const name = (body as { globalAlias: string }).globalAlias;
        if (buckets.has(name)) return json(409, { code: "BucketAlreadyExists" });
        buckets.set(name, `id-${name}`);
        return json(200, { id: `id-${name}` });
      }
      case "/v2/CreateKey":
        return json(200, { accessKeyId: "GK1", secretAccessKey: "s3cr3t", name: (body as { name: string }).name });
      case "/v2/AllowBucketKey":
        return json(200, { id: (body as { bucketId: string }).bucketId });
      default:
        return json(500, { code: "Unexpected" });
    }
  }) as typeof globalThis.fetch;
  return { calls, buckets, fetch };
}

describe("Garage as the storage server", () => {
  test("makes the bucket once, a key, and allows the key on that bucket alone", async () => {
    const g = fakeGarage();
    const host = createGarageStorageHost({
      adminUrl: "https://storage.example.com:3904/",
      token: "tok",
      fetch: g.fetch,
    });
    expect(await host.ensureBucket("ws-a")).toBe("id-ws-a");
    expect(await host.ensureBucket("ws-a")).toBe("id-ws-a");
    expect(g.calls.filter((c) => c.path === "/v2/CreateBucket")).toHaveLength(1);
    expect(await host.createKey("workspace a")).toEqual({ accessKeyId: "GK1", secretAccessKey: "s3cr3t" });
    await host.allow("id-ws-a", "GK1");
    expect(g.calls.at(-1)).toMatchObject({
      method: "POST",
      path: "/v2/AllowBucketKey",
      body: { bucketId: "id-ws-a", accessKeyId: "GK1", permissions: { read: true, write: true, owner: false } },
    });
    expect(g.calls.every((c) => c.auth === "Bearer tok")).toBe(true);
  });

  test("a refusal is a StorageHostError with its status", async () => {
    const fetch = (async () =>
      new Response(JSON.stringify({ code: "Forbidden" }), { status: 403 })) as unknown as typeof globalThis.fetch;
    const host = createGarageStorageHost({ adminUrl: "https://storage.example.com:3904", token: "bad", fetch });
    const error = await host.createKey("x").catch((e: unknown) => e);
    expect(error).toBeInstanceOf(StorageHostError);
    expect((error as StorageHostError).status).toBe(403);
  });
});
