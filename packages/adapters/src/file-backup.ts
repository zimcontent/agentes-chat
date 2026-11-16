/**
 * Where a team's final files get a second copy (docs/adr/doug-0012-editor-delivery.md): an approved video's original
 * is kept in the workspace's own storage, and a copy goes to a backup the installation chose. The one implementation
 * is Google Drive, through its REST API with an OAuth refresh token (`BACKUP_GOOGLE_DRIVE_*`); without it nothing is
 * backed up and the final stays in the workspace's storage alone.
 */
export interface FileBackup {
  /** What people read: "Google Drive". */
  readonly name: string;
  /**
   * Stores a file under `folders` (made when missing, inside the backup's own root), as it is read. A file of that name
   * and size already there is the same file: a retried job never uploads it twice.
   */
  save(input: {
    folders: string[];
    name: string;
    size: number;
    contentType: string;
    body: ReadableStream<Uint8Array> | Uint8Array;
  }): Promise<{ id: string; link: string | null }>;
}

export interface GoogleDriveBackupOptions {
  clientId: string;
  clientSecret: string;
  refreshToken: string;
  /** The folder everything goes under (its id, from its address); a shared drive's folder works too. */
  folderId: string;
  fetch?: typeof fetch;
}

const FOLDER = "application/vnd.google-apps.folder";
/** A resumable upload's piece: a multiple of 256 KiB, large enough to be quick and small enough to hold. */
export const BACKUP_CHUNK_BYTES = 32 * 1024 * 1024;
const API = "https://www.googleapis.com/drive/v3";
const UPLOAD = "https://www.googleapis.com/upload/drive/v3/files";

/** A name inside a Drive query: quotes and backslashes escaped. */
const quoted = (text: string) => `'${text.replace(/\\/g, "\\\\").replace(/'/g, "\\'")}'`;
/** A folder or file name Drive takes: no slashes, no control characters, not empty. */
export const backupName = (text: string) =>
  text
    // biome-ignore lint/suspicious/noControlCharactersInRegex: control characters are what this removes.
    .replace(/[\u0000-\u001f/\\]+/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 200) || "sem nome";

export class FileBackupError extends Error {
  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message);
    this.name = "FileBackupError";
  }
}

/** Reads a stream (or bytes) in pieces of exactly `size` bytes, the last one shorter. */
export async function* pieces(body: ReadableStream<Uint8Array> | Uint8Array, size: number) {
  if (body instanceof Uint8Array) {
    for (let at = 0; at < body.byteLength; at += size) yield body.subarray(at, Math.min(at + size, body.byteLength));
    return;
  }
  const reader = body.getReader();
  let held: Uint8Array[] = [];
  let heldBytes = 0;
  const take = () => {
    const out = new Uint8Array(Math.min(size, heldBytes));
    let at = 0;
    const rest: Uint8Array[] = [];
    for (const part of held) {
      if (at >= out.byteLength) {
        rest.push(part);
        continue;
      }
      const n = Math.min(part.byteLength, out.byteLength - at);
      out.set(part.subarray(0, n), at);
      at += n;
      if (n < part.byteLength) rest.push(part.subarray(n));
    }
    held = rest;
    heldBytes -= out.byteLength;
    return out;
  };
  for (;;) {
    const { done, value } = await reader.read();
    if (value) {
      held.push(value);
      heldBytes += value.byteLength;
      while (heldBytes >= size) yield take();
    }
    if (done) break;
  }
  if (heldBytes > 0) yield take();
}

export function createGoogleDriveBackup(options: GoogleDriveBackupOptions): FileBackup {
  const http = options.fetch ?? fetch;
  let token: { value: string; until: number } | null = null;

  const accessToken = async () => {
    if (token && token.until > Date.now() + 60_000) return token.value;
    const res = await http("https://oauth2.googleapis.com/token", {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        grant_type: "refresh_token",
        client_id: options.clientId,
        client_secret: options.clientSecret,
        refresh_token: options.refreshToken,
      }),
    });
    if (!res.ok) throw new FileBackupError(`Google refused the backup's sign-in (${res.status})`, res.status);
    const data = (await res.json()) as { access_token?: string; expires_in?: number };
    if (!data.access_token) throw new FileBackupError("Google answered no access token", 502);
    token = { value: data.access_token, until: Date.now() + (data.expires_in ?? 3600) * 1000 };
    return token.value;
  };

  const call = async <T>(url: string, init: RequestInit = {}): Promise<T> => {
    const res = await http(url, {
      ...init,
      headers: { ...(init.headers as Record<string, string>), authorization: `Bearer ${await accessToken()}` },
    });
    if (!res.ok) {
      const why = (await res.text().catch(() => "")).slice(0, 300);
      throw new FileBackupError(`Google Drive answered ${res.status}: ${why}`, res.status);
    }
    return (await res.json()) as T;
  };

  const find = async (parent: string, name: string, folder: boolean) => {
    const q = [
      `${quoted(parent)} in parents`,
      `name = ${quoted(name)}`,
      folder ? `mimeType = '${FOLDER}'` : `mimeType != '${FOLDER}'`,
      "trashed = false",
    ].join(" and ");
    const params = new URLSearchParams({
      q,
      fields: "files(id,size,webViewLink)",
      supportsAllDrives: "true",
      includeItemsFromAllDrives: "true",
      pageSize: "10",
    });
    const data = await call<{ files?: { id: string; size?: string; webViewLink?: string }[] }>(
      `${API}/files?${params}`,
    );
    return data.files ?? [];
  };

  const folderIn = async (parent: string, name: string) => {
    const [found] = await find(parent, name, true);
    if (found) return found.id;
    const made = await call<{ id: string }>(`${API}/files?supportsAllDrives=true&fields=id`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ name, mimeType: FOLDER, parents: [parent] }),
    });
    return made.id;
  };

  return {
    name: "Google Drive",
    async save(input) {
      let parent = options.folderId;
      for (const folder of input.folders) parent = await folderIn(parent, backupName(folder));
      const name = backupName(input.name);
      const same = (await find(parent, name, false)).find((f) => Number(f.size) === input.size);
      if (same) return { id: same.id, link: same.webViewLink ?? null };
      const start = await http(`${UPLOAD}?uploadType=resumable&supportsAllDrives=true&fields=id,webViewLink`, {
        method: "POST",
        headers: {
          authorization: `Bearer ${await accessToken()}`,
          "content-type": "application/json; charset=UTF-8",
          "x-upload-content-type": input.contentType,
          "x-upload-content-length": String(input.size),
        },
        body: JSON.stringify({ name, parents: [parent] }),
      });
      const session = start.headers.get("location");
      if (!start.ok || !session) {
        throw new FileBackupError(`Google Drive did not start the upload (${start.status})`, start.status || 502);
      }
      let at = 0;
      let last: Response | null = null;
      for await (const piece of pieces(input.body, BACKUP_CHUNK_BYTES)) {
        const end = at + piece.byteLength - 1;
        last = await http(session, {
          method: "PUT",
          headers: { "content-range": `bytes ${at}-${end}/${input.size}` },
          body: piece,
        });
        if (last.status !== 308 && !last.ok) {
          const why = (await last.text().catch(() => "")).slice(0, 300);
          throw new FileBackupError(`Google Drive stopped the upload at ${at} (${last.status}): ${why}`, last.status);
        }
        at = end + 1;
      }
      if (at !== input.size || !last?.ok) {
        throw new FileBackupError(`The file ended at ${at} of ${input.size} bytes`, 500);
      }
      const done = (await last.json()) as { id: string; webViewLink?: string };
      return { id: done.id, link: done.webViewLink ?? null };
    },
  };
}

/** A backup in memory, for tests: what it holds by folder path and name. */
export function createFakeFileBackup() {
  const files = new Map<string, Uint8Array>();
  const backup: FileBackup & { files: Map<string, Uint8Array> } = {
    name: "Google Drive",
    files,
    async save(input) {
      const parts: Uint8Array[] = [];
      for await (const piece of pieces(input.body, 1024 * 1024)) parts.push(piece);
      const bytes = new Uint8Array(parts.reduce((n, p) => n + p.byteLength, 0));
      let at = 0;
      for (const p of parts) {
        bytes.set(p, at);
        at += p.byteLength;
      }
      const key = [...input.folders.map(backupName), backupName(input.name)].join("/");
      files.set(key, bytes);
      return { id: `fake-${files.size}`, link: `https://drive.example/${encodeURIComponent(key)}` };
    },
  };
  return backup;
}
