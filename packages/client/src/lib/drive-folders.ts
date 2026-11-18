import type { DriveFolder } from "../api/types";

/**
 * The Drive's folders as the apps walk them (docs/adr/doug-0036-drive-folders.md): the way down to one, what is in
 * one, a folder's path, and where a folder may move to.
 */

type Folder = Pick<DriveFolder, "id" | "parentId" | "name">;

/** The folders from the top down to `id` (the folder last); [] for the top of the Drive or a folder gone. */
export function folderChain<T extends Folder>(folders: T[], id: string | null): T[] {
  const byId = new Map(folders.map((f) => [f.id, f]));
  const out: T[] = [];
  const seen = new Set<string>();
  for (
    let at = id ? byId.get(id) : undefined;
    at && !seen.has(at.id);
    at = at.parentId ? byId.get(at.parentId) : undefined
  ) {
    seen.add(at.id);
    out.unshift(at);
  }
  return out;
}

/** The folders right under `parentId` (null: the top), by name in the reader's language. */
export function foldersIn<T extends Folder>(folders: T[], parentId: string | null, locale?: string): T[] {
  return folders
    .filter((f) => (f.parentId ?? null) === parentId)
    .sort((a, b) => a.name.localeCompare(b.name, locale, { sensitivity: "base", numeric: true }));
}

/** "Clientes / Alliance": a folder's way down, for a file's line; "" for the top. */
export function folderPathOf(folders: Folder[], id: string | null | undefined, separator = " / "): string {
  return folderChain(folders, id ?? null)
    .map((f) => f.name)
    .join(separator);
}

/** A folder and every folder under it: where it can't move to. */
export function folderAndBelow(folders: Folder[], id: string): Set<string> {
  const out = new Set([id]);
  let grew = true;
  while (grew) {
    grew = false;
    for (const f of folders) {
      if (f.parentId && out.has(f.parentId) && !out.has(f.id)) {
        out.add(f.id);
        grew = true;
      }
    }
  }
  return out;
}

/** Every folder as a tree's rows, depth first, by name: the "Mover para…" list. */
export function folderRows<T extends Folder>(folders: T[], locale?: string): { folder: T; depth: number }[] {
  const out: { folder: T; depth: number }[] = [];
  const walk = (parentId: string | null, depth: number) => {
    for (const f of foldersIn(folders, parentId, locale)) {
      out.push({ folder: f, depth });
      walk(f.id, depth + 1);
    }
  };
  walk(null, 0);
  return out;
}
