import { describe, expect, test } from "bun:test";
import { BACKUP_CHUNK_BYTES, backupName, createGoogleDriveBackup, pieces } from "../src/file-backup";

/** The final's backup on Google Drive (docs/adr/doug-0012-editor-delivery.md), against a Drive kept in memory. */

function fakeDrive() {
  const calls: string[] = [];
  const folders = new Map<string, string>(); // `${parent}/${name}` → id
  const files = new Map<string, { id: string; size: number }>();
  let received = 0;
  let pending: { parent: string; name: string; size: number } | null = null;
  const http = (async (input: string | URL | Request, init?: RequestInit) => {
    const url = new URL(String(input));
    const method = init?.method ?? "GET";
    if (url.host === "oauth2.googleapis.com") {
      calls.push("token");
      return Response.json({ access_token: "tok", expires_in: 3600 });
    }
    if (url.pathname === "/drive/v3/files" && method === "GET") {
      const q = url.searchParams.get("q") ?? "";
      const parent = /'([^']+)' in parents/.exec(q)?.[1] ?? "";
      const name = /name = '([^']+)'/.exec(q)?.[1] ?? "";
      if (q.includes("mimeType = 'application/vnd.google-apps.folder'")) {
        const id = folders.get(`${parent}/${name}`);
        return Response.json({ files: id ? [{ id }] : [] });
      }
      const file = files.get(`${parent}/${name}`);
      return Response.json({
        files: file ? [{ id: file.id, size: String(file.size), webViewLink: `https://d/${file.id}` }] : [],
      });
    }
    if (url.pathname === "/drive/v3/files" && method === "POST") {
      const body = JSON.parse(String(init?.body)) as { name: string; parents: string[] };
      const id = `folder-${folders.size + 1}`;
      folders.set(`${body.parents[0]}/${body.name}`, id);
      calls.push(`folder ${body.name}`);
      return Response.json({ id });
    }
    if (url.pathname === "/upload/drive/v3/files") {
      const body = JSON.parse(String(init?.body)) as { name: string; parents: string[] };
      const size = Number(((init?.headers ?? {}) as Record<string, string>)["x-upload-content-length"]);
      pending = { parent: body.parents[0] as string, name: body.name, size };
      received = 0;
      calls.push(`start ${body.name} ${size}`);
      return new Response(null, { status: 200, headers: { location: "https://upload.example/session-1" } });
    }
    if (url.host === "upload.example") {
      const range = ((init?.headers ?? {}) as Record<string, string>)["content-range"];
      received += ((init?.body ?? new Uint8Array()) as Uint8Array).byteLength;
      calls.push(`put ${range}`);
      if (pending && received === pending.size) {
        files.set(`${pending.parent}/${pending.name}`, { id: "file-1", size: pending.size });
        return Response.json({ id: "file-1", webViewLink: "https://d/file-1" });
      }
      return new Response(null, { status: 308 });
    }
    return new Response("not here", { status: 404 });
  }) as typeof fetch;
  return { http, calls };
}

describe("Google Drive backup", () => {
  test("makes the folders, uploads in pieces, and a second save of the same file is the first", async () => {
    const { http, calls } = fakeDrive();
    const backup = createGoogleDriveBackup({
      clientId: "client",
      clientSecret: "secret",
      refreshToken: "refresh",
      folderId: "root",
      fetch: http,
    });
    const size = BACKUP_CHUNK_BYTES + 10;
    const bytes = new Uint8Array(size).fill(7);
    // A stream that arrives in odd sizes, as a store's does.
    const stream = new ReadableStream<Uint8Array>({
      start(c) {
        for (let at = 0; at < size; at += 5_000_000) c.enqueue(bytes.subarray(at, Math.min(size, at + 5_000_000)));
        c.close();
      },
    });
    const saved = await backup.save({
      folders: ["Zim", "lexeer"],
      name: "2026-11-15 - Reel.mp4",
      size,
      contentType: "video/mp4",
      body: stream,
    });
    expect(saved).toEqual({ id: "file-1", link: "https://d/file-1" });
    expect(calls).toEqual([
      "token",
      "folder Zim",
      "folder lexeer",
      `start 2026-11-15 - Reel.mp4 ${size}`,
      `put bytes 0-${BACKUP_CHUNK_BYTES - 1}/${size}`,
      `put bytes ${BACKUP_CHUNK_BYTES}-${size - 1}/${size}`,
    ]);
    const again = await backup.save({
      folders: ["Zim", "lexeer"],
      name: "2026-11-15 - Reel.mp4",
      size,
      contentType: "video/mp4",
      body: bytes,
    });
    expect(again.id).toBe("file-1");
    expect(calls.filter((c) => c.startsWith("start"))).toHaveLength(1);
  });

  test("pieces are exact, and names lose slashes and control characters", async () => {
    const sizes: number[] = [];
    for await (const p of pieces(new Uint8Array(10), 4)) sizes.push(p.byteLength);
    expect(sizes).toEqual([4, 4, 2]);
    expect(backupName("a/b\\c\n d")).toBe("a b c d");
    expect(backupName("   ")).toBe("sem nome");
  });
});
