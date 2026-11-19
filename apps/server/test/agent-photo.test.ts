import { afterEach, beforeEach, expect, test } from "bun:test";
import { eq, schema } from "@dougbot/db";
import { agentPhotoKey, purgeOrgFiles } from "@dougbot/engine";
import { browser, createTestServer, joinByInvitation, seedOrg, signUp, type TestServer } from "./harness";

let t: TestServer;
beforeEach(async () => {
  t = await createTestServer({ reply: () => ({ chunks: ["ok"] }) });
});
afterEach(() => t.close());

/** Smallest JPEG-shaped bytes (SOI, EXIF, scan, EOI). */
const JPEG = new Uint8Array([
  0xff, 0xd8, 0xff, 0xe1, 0x00, 0x08, 0x45, 0x78, 0x69, 0x66, 0x00, 0x00, 0xff, 0xda, 0x00, 0x02, 0x01, 0xff, 0xd9,
]);
/** A 1×1 PNG. */
const PNG = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==",
  "base64",
);
const form = (bytes: Uint8Array, name = "photo.jpg", type = "image/jpeg") => {
  const f = new FormData();
  f.set("file", new File([bytes], name, { type }));
  return f;
};

type Listed = { id: string; photo?: string | null };

test("an agent's photo: its owner or an admin sets it (multipart), the org's members see it, removing it deletes the file", async () => {
  const owner = browser(t);
  await signUp(owner, "owner@example.com");
  const { orgId, agentId } = await seedOrg(owner);
  const photoApi = `/api/app/organizations/${orgId}/agents/${agentId}/photo`;
  const listed = async (who: typeof owner) =>
    ((await (await who(`/api/app/organizations/${orgId}/agents`)).json()) as { agents: Listed[] }).agents.find(
      (a) => a.id === agentId,
    );
  expect((await listed(owner))?.photo).toBeNull();

  // Only real JPEG/PNG/WebP bytes, whatever the declared type.
  const bad = await owner(photoApi, {
    method: "PUT",
    body: form(new TextEncoder().encode("<svg/>"), "x.png", "image/png"),
  });
  expect(bad.status).toBe(400);
  // JSON isn't an upload: the route only takes a form.
  expect((await owner(photoApi, { method: "PUT", json: { file: "x" } })).status).toBe(415);

  const put = await owner(photoApi, { method: "PUT", body: form(JPEG) });
  expect(put.status).toBe(200);
  const { photo } = (await put.json()) as { photo: string };
  expect(photo).toMatch(new RegExp(`^/api/app/organizations/${orgId}/agents/${agentId}/photo/[0-9a-f]{16}\\.jpg$`));
  const [row] = await t.db
    .select({ photo: schema.agents.photo })
    .from(schema.agents)
    .where(eq(schema.agents.id, agentId));
  expect(row?.photo).toBe(photo);
  expect((await listed(owner))?.photo).toBe(photo);

  const served = await owner(photo);
  expect(served.status).toBe(200);
  expect(served.headers.get("content-type")).toBe("image/jpeg");
  expect(served.headers.get("cache-control")).toBe("private, max-age=31536000, immutable");
  expect(Buffer.from(new Uint8Array(await served.arrayBuffer())).includes(Buffer.from("Exif"))).toBe(false);

  // A new photo replaces the file: the old one is gone.
  const png = await owner(photoApi, { method: "PUT", body: form(PNG, "p.png", "image/png") });
  expect(png.status).toBe(200);
  const second = ((await png.json()) as { photo: string }).photo;
  expect(second).toEndWith(".png");
  expect((await owner(photo)).status).toBe(404);
  const servedPng = await owner(second);
  expect(servedPng.status).toBe(200);
  expect(servedPng.headers.get("content-type")).toBe("image/png");
  expect(new Uint8Array(await servedPng.arrayBuffer())).toEqual(new Uint8Array(PNG));

  // A member sees it but can't change it (not its owner, can't manage agents).
  const ana = await joinByInvitation(t, owner, orgId, "ana@example.com");
  expect((await listed(ana))?.photo).toBe(second);
  expect((await ana(second)).status).toBe(200);
  expect((await ana(photoApi, { method: "PUT", body: form(JPEG) })).status).toBe(403);
  expect((await ana(photoApi, { method: "DELETE" })).status).toBe(403);

  // Signed out, or someone outside the organization: nothing.
  expect((await t.app.request(second)).status).toBe(401);
  // Invited, never accepted: signed up but not in the organization.
  const invited = await owner(`/api/app/organizations/${orgId}/invitations`, {
    json: { email: "stranger@example.com", role: "member" },
  });
  expect(invited.status).toBe(201);
  const stranger = browser(t);
  await signUp(stranger, "stranger@example.com");
  expect((await stranger(second)).status).toBe(404);
  expect((await stranger(photoApi, { method: "PUT", body: form(JPEG) })).status).toBe(403);

  // Removed: back to the drawn look, the file deleted.
  expect((await owner(photoApi, { method: "DELETE" })).status).toBe(204);
  const [after] = await t.db
    .select({ photo: schema.agents.photo })
    .from(schema.agents)
    .where(eq(schema.agents.id, agentId));
  expect(after?.photo).toBeNull();
  expect((await owner(second)).status).toBe(404);
  const key = second.split("/photo/")[1];
  expect(await t.platformBlobs.get(agentPhotoKey(orgId, agentId, key as string))).toBeNull();
  expect((await listed(owner))?.photo).toBeNull();
});

test("the photo routes are /organizations/…, behind the session: signed out is 401 on every verb", async () => {
  const owner = browser(t);
  await signUp(owner, "owner@example.com");
  const { orgId, agentId } = await seedOrg(owner);
  const photoApi = `/api/app/organizations/${orgId}/agents/${agentId}/photo`;
  const put = await owner(photoApi, { method: "PUT", body: form(JPEG) });
  const { photo } = (await put.json()) as { photo: string };
  for (const [path, method] of [
    [photoApi, "PUT"],
    [photoApi, "DELETE"],
    [photo, "GET"],
  ] as const) {
    const res = await t.app.request(path, {
      method,
      headers: { "X-Agentes-Client": "mobile" },
      ...(method === "PUT" ? { body: form(JPEG) } : {}),
    });
    expect(res.status).toBe(401);
  }
  // The old address isn't a route.
  expect((await owner(`/api/app/orgs/${orgId}/agents/${agentId}/photo`, { method: "DELETE" })).status).toBe(404);
});

test("the file lives in the workspace's folder (org-logos/{orgId}/agents/…) and leaves with the workspace", async () => {
  const owner = browser(t);
  await signUp(owner, "owner@example.com");
  const { orgId, agentId } = await seedOrg(owner);
  const put = await owner(`/api/app/organizations/${orgId}/agents/${agentId}/photo`, {
    method: "PUT",
    body: form(PNG, "p.png", "image/png"),
  });
  const file = ((await put.json()) as { photo: string }).photo.split("/photo/")[1] as string;
  const key = agentPhotoKey(orgId, agentId, file);
  expect(key).toBe(`org-logos/${orgId}/agents/${agentId}/${file}`);
  expect(await t.platformBlobs.get(key)).not.toBeNull();
  // The workspace deleted for good: its files job takes the photo with the logo and the groups' photos.
  await t.db.delete(schema.organizations).where(eq(schema.organizations.id, orgId));
  await purgeOrgFiles({ db: t.db, keyWrappers: [], platform: t.platformBlobs }, orgId);
  expect(await t.platformBlobs.get(key)).toBeNull();
});
