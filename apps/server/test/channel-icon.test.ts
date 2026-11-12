import { afterEach, beforeEach, expect, test } from "bun:test";
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
const image = { imageBase64: Buffer.from(JPEG).toString("base64"), contentType: "image/jpeg" };

type Listed = { id: string; name: string; displayName?: string | null; icon?: string | null };

test("a channel's display name and photo: whoever may rename it sets them; members see them; strangers don't", async () => {
  const owner = browser(t);
  await signUp(owner, "owner@example.com");
  const { orgId } = await seedOrg(owner);
  const made = await owner(`/api/app/organizations/${orgId}/channels`, { json: { name: "marketing" } });
  expect(made.status).toBe(201);
  const channel = (await made.json()) as Listed;
  expect(channel.displayName).toBeNull();
  expect(channel.icon).toBeNull();
  const channelApi = `/api/app/organizations/${orgId}/channels/${channel.id}`;
  const listed = async (who: typeof owner) =>
    ((await (await who(`/api/app/organizations/${orgId}/channels`)).json()) as { channels: Listed[] }).channels.find(
      (c) => c.id === channel.id,
    );

  // Free text: capitals, accents and spaces; the name stays what mentions it.
  const named = await owner(channelApi, { method: "PATCH", json: { displayName: "  Comunicação & Marketing " } });
  expect(named.status).toBe(200);
  expect(((await named.json()) as Listed).displayName).toBe("Comunicação & Marketing");
  expect(await listed(owner)).toMatchObject({ name: "marketing", displayName: "Comunicação & Marketing" });
  expect((await owner(channelApi, { method: "PATCH", json: { displayName: "x".repeat(81) } })).status).toBe(400);

  // Only real JPEG/PNG/WebP bytes.
  const bad = await owner(`${channelApi}/icon`, {
    method: "PUT",
    json: { imageBase64: Buffer.from("<svg/>").toString("base64"), contentType: "image/jpeg" },
  });
  expect(bad.status).toBe(400);
  const put = await owner(`${channelApi}/icon`, { method: "PUT", json: image });
  expect(put.status).toBe(200);
  const { icon } = (await put.json()) as { icon: string };
  expect(icon).toStartWith(`/api/app/channel-icons/${orgId}/${channel.id}/`);
  expect((await listed(owner))?.icon).toBe(icon);
  const served = await owner(icon);
  expect(served.status).toBe(200);
  expect(served.headers.get("content-type")).toBe("image/jpeg");
  expect(served.headers.get("cache-control")).toBe("private, max-age=31536000, immutable");
  expect(Buffer.from(new Uint8Array(await served.arrayBuffer())).includes(Buffer.from("Exif"))).toBe(false);

  // A member sees both but can't change them (they didn't make the channel).
  const ana = await joinByInvitation(t, owner, orgId, "ana@example.com");
  expect(await listed(ana)).toMatchObject({ displayName: "Comunicação & Marketing", icon });
  expect((await ana(icon)).status).toBe(200);
  expect((await ana(channelApi, { method: "PATCH", json: { displayName: "Meu" } })).status).toBe(403);
  expect((await ana(`${channelApi}/icon`, { method: "PUT", json: image })).status).toBe(403);
  expect((await ana(`${channelApi}/icon`, { method: "DELETE" })).status).toBe(403);

  // Signed out or outside the organization: nothing.
  expect((await t.app.request(icon)).status).toBe(401);
  // Invited, never accepted: signed up but not in the organization.
  const invited = await owner(`/api/app/organizations/${orgId}/invitations`, {
    json: { email: "stranger@example.com", role: "member" },
  });
  expect(invited.status).toBe(201);
  const stranger = browser(t);
  await signUp(stranger, "stranger@example.com");
  expect((await stranger(icon)).status).toBe(404);

  // Removed: back to the "#"; blank clears the display name.
  expect((await owner(`${channelApi}/icon`, { method: "DELETE" })).status).toBe(204);
  expect((await owner(icon)).status).toBe(404);
  expect((await owner(channelApi, { method: "PATCH", json: { displayName: " " } })).status).toBe(200);
  expect(await listed(owner)).toMatchObject({ displayName: null, icon: null });
});
