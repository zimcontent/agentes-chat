import { describe, expect, test } from "bun:test";
import { createHash } from "node:crypto";
import { existsSync } from "node:fs";
import { BadUpload, readStreamedUpload, UploadTooLarge } from "../src/http/multipart-stream";

/** A multipart request whose body arrives in chunks of `chunk` bytes and states no length, as a stream does. */
async function request(fields: Record<string, string | File>, chunk = 7) {
  const form = new FormData();
  for (const [k, v] of Object.entries(fields)) form.set(k, v);
  const res = new Response(form);
  const type = res.headers.get("content-type") ?? "";
  const bytes = new Uint8Array(await res.arrayBuffer());
  let at = 0;
  const body = new ReadableStream<Uint8Array>({
    pull(controller) {
      if (at >= bytes.length) return controller.close();
      controller.enqueue(bytes.slice(at, at + chunk));
      at += chunk;
    },
  });
  return new Request("http://local/upload", { method: "POST", headers: { "content-type": type }, body });
}

const limits = { maxFileBytes: 1000, fieldBytes: 200 };

describe("readStreamedUpload", () => {
  test("the file goes to disk counted and hashed, the fields come back as text", async () => {
    const bytes = new Uint8Array(900).map((_, i) => (i * 31) % 256);
    // A boundary-like run inside the file must not end it.
    bytes.set(new TextEncoder().encode("\r\n--"), 400);
    const req = await request({
      title: "Relatório",
      file: new File([bytes], "fotos.zip", { type: "application/zip" }),
    });
    const upload = await readStreamedUpload(req, limits);
    expect(upload.fields).toEqual({ title: "Relatório" });
    expect(upload.file).toMatchObject({ name: "fotos.zip", contentType: "application/zip", size: 900 });
    expect(upload.file?.sha256).toBe(createHash("sha256").update(bytes).digest("hex"));
    expect(new Uint8Array(await Bun.file(upload.file?.path ?? "").arrayBuffer())).toEqual(bytes);
    expect(upload.file?.head).toEqual(bytes);
    await upload.discard();
    expect(existsSync(upload.file?.path ?? "")).toBe(false);
  });

  test("a file with no type and an empty one are taken", async () => {
    const none = await readStreamedUpload(await request({ file: new File([new Uint8Array([1, 2])], "x.bin") }), limits);
    expect(none.file?.size).toBe(2);
    await none.discard();
    const empty = await readStreamedUpload(await request({ file: new File([], "vazio.txt") }), limits);
    expect(empty.file?.size).toBe(0);
    await empty.discard();
  });

  test("past the limit it stops reading and keeps nothing", async () => {
    const req = await request({ file: new File([new Uint8Array(1001)], "big.bin") }, 64);
    const error = await readStreamedUpload(req, limits).catch((e) => e);
    expect(error).toBeInstanceOf(UploadTooLarge);
    // The same from a stated length, before a byte is read.
    const stated = new Request("http://local/upload", {
      method: "POST",
      headers: { "content-type": "multipart/form-data; boundary=x", "content-length": "5000" },
      body: "--x--",
    });
    expect(await readStreamedUpload(stated, limits).catch((e) => e)).toBeInstanceOf(UploadTooLarge);
  });

  test("fields past their room, a body that isn't multipart, or one cut short are refused", async () => {
    const long = await request({ note: "x".repeat(300), file: new File(["a"], "a.txt") });
    expect(await readStreamedUpload(long, limits).catch((e) => e)).toBeInstanceOf(UploadTooLarge);
    const json = new Request("http://local/upload", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: "{}",
    });
    expect(await readStreamedUpload(json, limits).catch((e) => e)).toBeInstanceOf(BadUpload);
    const cut = new Request("http://local/upload", {
      method: "POST",
      headers: { "content-type": "multipart/form-data; boundary=x" },
      body: '--x\r\ncontent-disposition: form-data; name="file"; filename="a.bin"\r\n\r\nabc',
    });
    expect(await readStreamedUpload(cut, limits).catch((e) => e)).toBeInstanceOf(BadUpload);
  });
});
