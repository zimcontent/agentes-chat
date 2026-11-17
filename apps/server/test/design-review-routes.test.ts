import { afterEach, expect, test } from "bun:test";
import { createFileArtifact, sendDesignForReview } from "@agenteschat/engine";
import { browser, createTestServer, seedOrg, signUp, type TestServer } from "./harness";

/** Design review over HTTP (docs/adr/doug-0010-design-review.md): slides, the page, notes on a slide, a saved edit. */

let t: TestServer;
afterEach(async () => {
  await t?.close();
});

const PNG = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 7, 7]);
const PAGE =
  '<!doctype html><html><body><section class="slide"><h1 data-layer="Título">Oi</h1></section></body></html>';

test("a person reads the slides and the page, notes a slide's point and saves an edit as the next version", async () => {
  t = await createTestServer();
  const b = browser(t);
  await signUp(b, "ana@example.com");
  const { orgId, channelId, agentId } = await seedOrg(b);
  const deps = t.engine.videoReviews;
  const actor = { type: "agent" as const, agentId, channelId, runId: null };
  const file = (name: string, bytes: Uint8Array, contentType: string) =>
    createFileArtifact(deps.artifacts, actor, orgId, { title: name, name, bytes, contentType, channelId });
  const slide = await file("01.png", PNG, "image/png");
  const page = await file("peca.html", new TextEncoder().encode(PAGE), "text/html");
  const { review } = await sendDesignForReview(
    deps,
    { orgId, agentId, runId: crypto.randomUUID(), channelId, threadRootId: "", triggerMessageId: "" },
    { pages: [slide.id], sourceArtifactId: page.id, title: "Post" },
  );
  const base = `/api/app/organizations/${orgId}/video-reviews/${review.id}`;

  const listed = (await (await b(`/api/app/organizations/${orgId}/video-reviews`)).json()) as {
    reviews: { id: string; medium: string; cover: string | null }[];
  };
  expect(listed.reviews[0]).toMatchObject({ id: review.id, medium: "design", cover: slide.id });

  const picture = await b(`${base}/versions/1/pages/1`);
  expect(picture.status).toBe(200);
  expect(picture.headers.get("content-security-policy")).toBe("sandbox");
  expect(new Uint8Array(await picture.arrayBuffer())).toEqual(PNG);
  expect((await b(`${base}/versions/1/pages/2`)).status).toBe(404);

  // The page comes as text, never as a page of this site.
  const source = await b(`${base}/versions/1/source`);
  expect(source.headers.get("content-type")).toContain("text/plain");
  expect(await source.text()).toBe(PAGE);

  const note = await b(`${base}/notes`, {
    json: { version: 1, atMs: null, page: 1, x: 0.5, y: 0.2, kind: "type", body: "título maior" },
  });
  expect(note.status).toBe(200);
  expect(await note.json()).toMatchObject({ page: 1, kind: "type" });

  const saved = await b(`${base}/design`, {
    json: { baseVersion: 1, html: PAGE.replace("Oi", "Olá"), note: "título trocado" },
  });
  expect(saved.status).toBe(200);
  expect(await saved.json()).toMatchObject({ version: 2, openNotes: 1 });
  expect(await (await b(`${base}/versions/2/source`)).text()).toContain("Olá");
  const stale = await b(`${base}/design`, { json: { baseVersion: 1, html: PAGE } });
  expect(stale.status).toBe(409);
  expect(((await stale.json()) as { error: { code: string } }).error.code).toBe("video_review.stale_version");

  // Without a session nothing of the piece leaves.
  const stranger = browser(t);
  expect((await stranger(`${base}/versions/1/source`)).status).toBe(401);
  expect((await stranger(`${base}/versions/1/pages/1`)).status).toBe(401);
});

test("a person sends their own piece from Revisão: uploaded to a group, opened there, theirs to send again", async () => {
  t = await createTestServer();
  const b = browser(t);
  await signUp(b, "ana@example.com");
  const { orgId, channelId } = await seedOrg(b);
  const base = `/api/app/organizations/${orgId}`;
  const upload = async (name: string) => {
    const form = new FormData();
    form.append("file", new File([PNG], name, { type: "image/png" }));
    form.append("channelId", channelId);
    const res = await b(`${base}/artifacts/files`, { method: "POST", body: form });
    expect(res.status).toBe(201);
    return ((await res.json()) as { id: string }).id;
  };
  const slides = [await upload("01.png"), await upload("02.png")];
  const sent = await b(`${base}/video-reviews`, {
    json: { medium: "design", files: slides, title: "Carrossel", channelId },
  });
  expect(sent.status).toBe(200);
  const { review } = (await sent.json()) as { review: { id: string; medium: string; sender: { id: string } | null } };
  expect(review.medium).toBe("design");
  expect(review.sender).not.toBeNull();
  expect((await b(`${base}/video-reviews/${review.id}/versions/1/pages/2`)).status).toBe(200);

  // With no group nor task it has nowhere to live.
  const nowhere = await b(`${base}/video-reviews`, { json: { medium: "design", files: slides, title: "X" } });
  expect(nowhere.status).toBe(400);
  expect(((await nowhere.json()) as { error: { code: string } }).error.code).toBe("video_review.no_place");

  const next = await b(`${base}/video-reviews`, {
    json: { medium: "design", files: [await upload("01-v2.png")], reviewId: review.id },
  });
  expect(next.status).toBe(200);
  expect(((await next.json()) as { review: { version: number } }).review.version).toBe(2);
});
