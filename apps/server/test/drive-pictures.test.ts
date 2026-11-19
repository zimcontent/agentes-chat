import { afterEach, beforeEach, expect, test } from "bun:test";
import { deflateSync } from "node:zlib";
import { forgetPictures } from "@dougbot/engine";
import { browser, createTestServer, ORIGIN, seedOrg, signUp, type TestServer } from "./harness";

let t: TestServer;
beforeEach(async () => {
  t = await createTestServer();
  forgetPictures();
});
afterEach(() => t.close());

/** A 2400×1600 PNG: heavy, as a screenshot or a render is. */
async function bigPng() {
  // A gradient with grain, as a photo: PNG keeps every grain, WebP is many times lighter.
  const w = 1200;
  const h = 800;
  const pixels = new Uint8Array(w * h * 4).map((_, i) => {
    const p = i >> 2;
    const tone = ((p % w) / w + Math.floor(p / w) / h) * 120;
    return i % 4 === 3 ? 255 : Math.min(255, tone + (i % 4) * 30 + Math.random() * 24);
  });
  return new Bun.Image(rawPng(pixels, w, h)).resize(2400, 1600).png().bytes();
}

/** A PNG from RGBA pixels, by hand (no pixel input on Bun.Image). */
function rawPng(rgba: Uint8Array, w: number, h: number) {
  const rows = new Uint8Array(h * (w * 4 + 1));
  for (let y = 0; y < h; y++) rows.set(rgba.subarray(y * w * 4, (y + 1) * w * 4), y * (w * 4 + 1) + 1);
  const chunk = (type: string, data: Uint8Array) => {
    const out = new Uint8Array(12 + data.length);
    const view = new DataView(out.buffer);
    view.setUint32(0, data.length);
    out.set(new TextEncoder().encode(type), 4);
    out.set(data, 8);
    view.setUint32(8 + data.length, crc(out.subarray(4, 8 + data.length)));
    return out;
  };
  const ihdr = new Uint8Array(13);
  new DataView(ihdr.buffer).setUint32(0, w);
  new DataView(ihdr.buffer).setUint32(4, h);
  ihdr.set([8, 6, 0, 0, 0], 8);
  const parts = [
    new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk("IHDR", ihdr),
    chunk("IDAT", deflateSync(rows)),
    chunk("IEND", new Uint8Array()),
  ];
  const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0));
  let at = 0;
  for (const p of parts) {
    out.set(p, at);
    at += p.length;
  }
  return out;
}

function crc(bytes: Uint8Array) {
  let c = ~0;
  for (const b of bytes) {
    c ^= b;
    for (let k = 0; k < 8; k++) c = c & 1 ? (c >>> 1) ^ 0xedb88320 : c >>> 1;
  }
  return ~c >>> 0;
}

test("a picture's light copy: a small WebP kept for good by the browser, only for raster pictures", async () => {
  const owner = browser(t);
  await signUp(owner, "owner@example.com");
  const { orgId } = await seedOrg(owner);
  const base = `/api/app/organizations/${orgId}`;
  const upload = (file: File) => {
    const form = new FormData();
    form.set("file", file);
    return t.app.request(`${base}/artifacts/files`, {
      method: "POST",
      headers: { cookie: owner.cookie(), origin: ORIGIN },
      body: form,
    });
  };

  const png = await bigPng();
  const created = await upload(new File([png], "render.png", { type: "image/png" }));
  expect(created.status).toBe(201);
  const { id } = (await created.json()) as { id: string };

  const tile = await owner(`${base}/artifacts/${id}/picture?size=tile&version=1`);
  expect(tile.status).toBe(200);
  expect(tile.headers.get("content-type")).toBe("image/webp");
  expect(tile.headers.get("x-content-type-options")).toBe("nosniff");
  expect(tile.headers.get("cache-control")).toBe("private, max-age=31536000, immutable");
  const tileBytes = new Uint8Array(await tile.arrayBuffer());
  expect(tileBytes.length).toBeLessThan(png.length / 4);
  expect(await new Bun.Image(tileBytes).metadata()).toMatchObject({ width: 640, height: 427, format: "webp" });

  const view = await owner(`${base}/artifacts/${id}/picture?size=view&version=1`);
  expect(await new Bun.Image(new Uint8Array(await view.arrayBuffer())).metadata()).toMatchObject({
    width: 2048,
    format: "webp",
  });

  // No version named: the latest, checked again each time.
  const latest = await owner(`${base}/artifacts/${id}/picture?size=tile`);
  expect(latest.headers.get("cache-control")).toBe("private, no-cache");

  // Without a session nothing comes back, even with the copy already made.
  expect((await t.app.request(`${base}/artifacts/${id}/picture?size=tile&version=1`)).status).toBe(401);

  // SVG and the rest are never served inline.
  const svg = await upload(new File(["<svg xmlns='http://www.w3.org/2000/svg'/>"], "a.svg", { type: "image/svg+xml" }));
  const svgId = ((await svg.json()) as { id: string }).id;
  expect((await owner(`${base}/artifacts/${svgId}/picture?size=tile`)).status).toBe(400);

  // A broken picture comes back as it is (the tile falls back to its type).
  const broken = await upload(new File(["not a png"], "broken.png", { type: "image/png" }));
  const brokenId = ((await broken.json()) as { id: string }).id;
  const raw = await owner(`${base}/artifacts/${brokenId}/picture?size=tile`);
  expect(raw.status).toBe(200);
  expect(await raw.text()).toBe("not a png");
});
