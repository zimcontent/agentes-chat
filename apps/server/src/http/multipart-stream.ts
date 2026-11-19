import { createHash } from "node:crypto";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { SpooledFile } from "@dougbot/engine";

/**
 * A `multipart/form-data` upload read as it arrives: the file part goes to a file on this server's disk, counted and
 * hashed on the way, so a conversation's file of up to 2 GB never sits whole in memory (ADR 0025, 2026-11-14). The
 * other fields are short text, held to `fieldBytes` all together.
 */
export interface StreamedUpload {
  fields: Record<string, string>;
  file: (SpooledFile & { name: string; contentType: string | null }) | null;
  /** Removes the file on disk: call it once the upload is stored (or refused). */
  discard(): Promise<void>;
}

export class UploadTooLarge extends Error {
  constructor() {
    super("the upload is too large");
  }
}

export class BadUpload extends Error {}

/** The first bytes of a file kept beside the copy on disk: enough for a picture's size and a short text. */
const HEAD_BYTES = 1024 * 1024;
const HEADER_BYTES = 16 * 1024;

const CRLF = Buffer.from("\r\n");
const HEADERS_END = Buffer.from("\r\n\r\n");

function boundaryOf(contentType: string | undefined | null) {
  const m = /^multipart\/form-data\s*;.*?boundary=(?:"([^"]+)"|([^\s;]+))/i.exec(contentType ?? "");
  const b = m?.[1] ?? m?.[2];
  if (!b || b.length > 200) throw new BadUpload("send the file as multipart/form-data");
  return b;
}

/** A part's `Content-Disposition` name and file name, and its type. */
function partHeaders(raw: string) {
  let name: string | null = null;
  let filename: string | null = null;
  let contentType: string | null = null;
  for (const line of raw.split("\r\n")) {
    const colon = line.indexOf(":");
    if (colon < 0) continue;
    const key = line.slice(0, colon).trim().toLowerCase();
    const value = line.slice(colon + 1).trim();
    if (key === "content-type") contentType = value;
    if (key !== "content-disposition") continue;
    // `filename*=UTF-8''…` (RFC 5987) wins over `filename="…"`, as browsers send the plain one too.
    const star = /;\s*filename\*\s*=\s*(?:UTF-8|utf-8)''([^;]*)/.exec(value)?.[1];
    const plain = /;\s*filename\s*=\s*(?:"((?:[^"\\]|\\.)*)"|([^;]*))/.exec(value);
    const named = /;\s*name\s*=\s*(?:"((?:[^"\\]|\\.)*)"|([^;]*))/.exec(value);
    name = (named?.[1] ?? named?.[2] ?? "").replace(/\\(.)/g, "$1") || null;
    if (star !== undefined) {
      try {
        filename = decodeURIComponent(star);
      } catch {
        filename = star;
      }
    } else if (plain) {
      filename = (plain[1] ?? plain[2] ?? "").replace(/\\(.)/g, "$1");
    }
  }
  return { name, filename, contentType };
}

/**
 * Reads `request`'s multipart body. The part named `fileField` (the first, if sent twice) goes to disk, at most
 * `maxFileBytes` of it; past that, or past `fieldBytes` of other fields, it throws `UploadTooLarge` and keeps nothing.
 */
export async function readStreamedUpload(
  request: Request,
  options: { maxFileBytes: number; fieldBytes: number; fileField?: string },
): Promise<StreamedUpload> {
  const fileField = options.fileField ?? "file";
  const boundary = boundaryOf(request.headers.get("content-type"));
  const length = Number(request.headers.get("content-length") ?? "");
  if (Number.isFinite(length) && length > options.maxFileBytes + options.fieldBytes) throw new UploadTooLarge();
  if (!request.body) throw new BadUpload("send the file in the field file");

  const opening = Buffer.from(`--${boundary}`);
  const delimiter = Buffer.from(`\r\n--${boundary}`);
  const fields: Record<string, string> = {};
  let fieldBytes = 0;
  let dir: string | null = null;
  let file: StreamedUpload["file"] = null;
  const discard = async () => {
    if (dir) await rm(dir, { recursive: true, force: true });
    dir = null;
  };

  // The part being read: a field's bytes in memory, or the file's on disk.
  type Part =
    | { kind: "field"; name: string; chunks: Buffer[] }
    | {
        kind: "file";
        sink: ReturnType<ReturnType<typeof Bun.file>["writer"]>;
        hash: ReturnType<typeof createHash>;
        size: number;
        head: Buffer[];
        headSize: number;
        name: string;
        contentType: string | null;
        path: string;
      }
    | { kind: "skip" };
  let part: Part | null = null;
  type State = "preamble" | "headers" | "body" | "after" | "done";
  let state = "preamble" as State;
  let pending: Buffer = Buffer.alloc(0);

  const write = async (bytes: Buffer) => {
    if (bytes.length === 0 || !part) return;
    if (part.kind === "skip") return;
    if (part.kind === "field") {
      fieldBytes += bytes.length;
      if (fieldBytes > options.fieldBytes) throw new UploadTooLarge();
      part.chunks.push(bytes);
      return;
    }
    part.size += bytes.length;
    if (part.size > options.maxFileBytes) throw new UploadTooLarge();
    part.hash.update(bytes);
    if (part.headSize < HEAD_BYTES) {
      const take = bytes.subarray(0, HEAD_BYTES - part.headSize);
      part.head.push(Buffer.from(take));
      part.headSize += take.length;
    }
    part.sink.write(bytes);
    // Lets the disk catch up instead of queueing the whole upload in the writer's buffer.
    await part.sink.flush();
  };

  const finishPart = async () => {
    if (!part) return;
    if (part.kind === "field") {
      fields[part.name] = Buffer.concat(part.chunks).toString("utf8");
    } else if (part.kind === "file") {
      await part.sink.end();
      file = {
        name: part.name,
        contentType: part.contentType,
        path: part.path,
        size: part.size,
        sha256: part.hash.digest("hex"),
        head: new Uint8Array(Buffer.concat(part.head)),
      };
    }
    part = null;
  };

  const startPart = async (rawHeaders: string) => {
    const h = partHeaders(rawHeaders);
    if (h.name === fileField && h.filename !== null && !file && !part) {
      dir = await mkdtemp(join(tmpdir(), "agentes-upload-"));
      const path = join(dir, "file");
      part = {
        kind: "file",
        sink: Bun.file(path).writer({ highWaterMark: 1024 * 1024 }),
        hash: createHash("sha256"),
        size: 0,
        head: [],
        headSize: 0,
        name: h.filename,
        contentType: h.contentType,
        path,
      };
    } else if (h.name && h.filename === null) {
      part = { kind: "field", name: h.name, chunks: [] };
    } else {
      part = { kind: "skip" };
    }
  };

  // One step over what is pending; false when it needs more bytes.
  const step = async (ended: boolean): Promise<boolean> => {
    switch (state) {
      case "preamble": {
        const at = pending.indexOf(opening);
        if (at < 0) {
          // Keeps what could still be the start of the boundary.
          pending = pending.subarray(Math.max(0, pending.length - opening.length));
          return false;
        }
        pending = pending.subarray(at + opening.length);
        state = "after";
        return true;
      }
      case "after": {
        if (pending.length < 2) return false;
        if (pending[0] === 0x2d && pending[1] === 0x2d) {
          state = "done";
          return false;
        }
        const crlf = pending.indexOf(CRLF);
        if (crlf < 0) {
          if (pending.length > 256) throw new BadUpload("the upload's parts are malformed");
          return false;
        }
        pending = pending.subarray(crlf + 2);
        state = "headers";
        return true;
      }
      case "headers": {
        const end = pending.indexOf(HEADERS_END);
        if (end < 0) {
          if (pending.length > HEADER_BYTES) throw new BadUpload("the upload's parts are malformed");
          return false;
        }
        await startPart(pending.subarray(0, end).toString("utf8"));
        pending = pending.subarray(end + HEADERS_END.length);
        state = "body";
        return true;
      }
      case "body": {
        const at = pending.indexOf(delimiter);
        if (at < 0) {
          // Everything but a tail that could be the start of the delimiter.
          const keep = ended ? 0 : delimiter.length - 1;
          const out = pending.length - keep;
          if (out > 0) {
            await write(Buffer.from(pending.subarray(0, out)));
            pending = pending.subarray(out);
          }
          return false;
        }
        await write(Buffer.from(pending.subarray(0, at)));
        await finishPart();
        pending = pending.subarray(at + delimiter.length);
        state = "after";
        return true;
      }
      case "done":
        return false;
    }
  };

  const reader = request.body.getReader();
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (value) pending = pending.length ? Buffer.concat([pending, value]) : Buffer.from(value);
      while (await step(done)) {}
      if (done || state === "done") break;
    }
    if (state !== "done") throw new BadUpload("the upload ended before its last part");
  } catch (error) {
    reader.cancel().catch(() => {});
    const open = part as Part | null;
    if (open?.kind === "file") await Promise.resolve(open.sink.end()).catch(() => {});
    await discard();
    throw error;
  }
  return { fields, file, discard };
}
