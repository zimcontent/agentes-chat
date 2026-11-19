import { and, type Database, type Executor, eq, inArray, isNull, schema, sql } from "@agenteschat/db";
import type { ArtifactActor, ArtifactAuthor, ArtifactDeps } from "./artifacts";
import { recordAudit } from "./audit";
import { UUID } from "./authority";
import { ConflictError, ForbiddenError, NotFoundError, ValidationError } from "./errors";
import { publishListChanged } from "./events";
import { can, requireActiveMembership } from "./organizations";

/**
 * The Drive's folders (docs/adr/doug-0036-drive-folders.md): names under a parent, the whole workspace's. Every member
 * and agent sees them all; a file filed in one keeps its own audience (ADR 0111, 0157), so a folder may hold files a
 * viewer doesn't see. People need `upload_files` to change them, agents `drive:write`.
 */

const { artifacts, driveFolders } = schema;

/** A folder name's longest. */
export const FOLDER_NAME_MAX = 80;
/** How deep folders go. */
export const FOLDER_DEPTH_MAX = 8;
/** Folders per workspace. */
export const FOLDERS_MAX = 2000;

export interface DriveFolderView {
  id: string;
  parentId: string | null;
  name: string;
  createdBy: ArtifactAuthor;
  createdAt: string;
  updatedAt: string;
}

type FolderRow = typeof driveFolders.$inferSelect;

const viewOf = (f: FolderRow): DriveFolderView => ({
  id: f.id,
  parentId: f.parentId,
  name: f.name,
  createdBy: { type: f.createdByType, id: f.createdById },
  createdAt: f.createdAt.toISOString(),
  updatedAt: f.updatedAt.toISOString(),
});

const authorOf = (actor: ArtifactActor): ArtifactAuthor =>
  actor.type === "person" ? { type: "person", id: actor.userId } : { type: "agent", id: actor.agentId };

/** A folder's name as stored: one line, no slash (paths use it), no leading or trailing spaces. */
export function cleanFolderName(raw: string): string {
  const name = raw
    .replace(/[\p{Cc}/\\]+/gu, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, FOLDER_NAME_MAX)
    .trim();
  if (!name || name === "." || name === "..") throw new ValidationError("Give the folder a name", "drive.folder_name");
  return name;
}

/** A path's names, "Clientes / Alliance/Roteiros" → ["Clientes", "Alliance", "Roteiros"]; "" or "/" → []. */
export function splitFolderPath(path: string): string[] {
  return path
    .split("/")
    .map((p) => p.trim())
    .filter(Boolean)
    .map(cleanFolderName);
}

async function canChange(db: Database, actor: ArtifactActor, orgId: string) {
  if (actor.type !== "person") return;
  const membership = await requireActiveMembership(db, actor.userId, orgId);
  if (!can(membership, "upload_files")) throw new ForbiddenError();
}

/** Every folder of the workspace, by name. */
export async function listFolders(db: Database, actor: ArtifactActor, orgId: string): Promise<DriveFolderView[]> {
  if (actor.type === "person") await requireActiveMembership(db, actor.userId, orgId);
  const rows = await db
    .select()
    .from(driveFolders)
    .where(eq(driveFolders.orgId, orgId))
    .orderBy(sql`lower(${driveFolders.name})`, driveFolders.id);
  return rows.map(viewOf);
}

/** Each folder's path ("Clientes/Alliance"), by id. */
export function folderPaths(list: Pick<DriveFolderView, "id" | "parentId" | "name">[]): Map<string, string> {
  const byId = new Map(list.map((f) => [f.id, f]));
  const out = new Map<string, string>();
  const pathOf = (id: string, seen: Set<string>): string => {
    const known = out.get(id);
    if (known !== undefined) return known;
    const f = byId.get(id);
    if (!f) return "";
    // A cycle can't be made (`moveFolder` refuses it); a broken row still ends.
    const up = f.parentId && !seen.has(f.parentId) ? pathOf(f.parentId, new Set([...seen, id])) : "";
    const path = up ? `${up}/${f.name}` : f.name;
    out.set(id, path);
    return path;
  };
  for (const f of list) pathOf(f.id, new Set());
  return out;
}

async function loadFolder(db: Executor, orgId: string, id: string): Promise<FolderRow> {
  const [f] = UUID.test(id)
    ? await db
        .select()
        .from(driveFolders)
        .where(and(eq(driveFolders.id, id), eq(driveFolders.orgId, orgId)))
    : [];
  if (!f) throw new NotFoundError("Folder not found", "drive.folder_not_found");
  return f;
}

/** The chain from a folder up to the top, the folder first. */
async function ancestry(db: Executor, orgId: string, id: string | null): Promise<string[]> {
  const out: string[] = [];
  let at = id;
  while (at && out.length <= FOLDER_DEPTH_MAX + 1) {
    out.push(at);
    const [f] = await db
      .select({ parentId: driveFolders.parentId })
      .from(driveFolders)
      .where(and(eq(driveFolders.id, at), eq(driveFolders.orgId, orgId)));
    at = f?.parentId ?? null;
  }
  return out;
}

/** How many levels a folder's subtree has below it (0: no subfolders). */
async function heightOf(db: Executor, orgId: string, id: string): Promise<number> {
  let level = [id];
  let height = 0;
  while (level.length > 0 && height <= FOLDER_DEPTH_MAX) {
    const next = await db
      .select({ id: driveFolders.id })
      .from(driveFolders)
      .where(and(eq(driveFolders.orgId, orgId), inArray(driveFolders.parentId, level)));
    if (next.length === 0) break;
    height++;
    level = next.map((r) => r.id);
  }
  return height;
}

const sameName = (orgId: string, parentId: string | null, name: string) =>
  and(
    eq(driveFolders.orgId, orgId),
    parentId ? eq(driveFolders.parentId, parentId) : isNull(driveFolders.parentId),
    sql`lower(${driveFolders.name}) = lower(${name})`,
  );

async function findNamed(db: Executor, orgId: string, parentId: string | null, name: string) {
  const [f] = await db
    .select()
    .from(driveFolders)
    .where(sameName(orgId, parentId, name));
  return f ?? null;
}

async function insertFolder(
  db: Database,
  actor: ArtifactActor,
  orgId: string,
  parentId: string | null,
  name: string,
): Promise<FolderRow> {
  const [count] = await db
    .select({ n: sql<number>`count(*)::int` })
    .from(driveFolders)
    .where(eq(driveFolders.orgId, orgId));
  if ((count?.n ?? 0) >= FOLDERS_MAX) {
    throw new ConflictError(`This workspace has ${FOLDERS_MAX} folders already`, "drive.folders_full", {
      max: FOLDERS_MAX,
    });
  }
  if ((await ancestry(db, orgId, parentId)).length >= FOLDER_DEPTH_MAX) {
    throw new ValidationError(`Folders go at most ${FOLDER_DEPTH_MAX} levels deep`, "drive.folder_too_deep", {
      max: FOLDER_DEPTH_MAX,
    });
  }
  const by = authorOf(actor);
  return db.transaction(async (tx) => {
    const [row] = await tx
      .insert(driveFolders)
      .values({ orgId, parentId, name, createdByType: by.type, createdById: by.id })
      .onConflictDoNothing()
      .returning();
    // Made at the same moment by someone else: theirs is the one.
    if (!row) {
      const there = await findNamed(tx, orgId, parentId, name);
      if (!there) throw new ConflictError("A folder with that name is already there", "drive.folder_exists");
      return there;
    }
    await recordAudit(tx, {
      orgId,
      actor: by,
      action: "drive.folder_created",
      target: { type: "drive_folder", id: row.id },
      details: { name, parentId },
    });
    return row;
  });
}

/** A new folder under `parentId` (null: the top). One with that name already there is refused. */
export async function createFolder(
  deps: Pick<ArtifactDeps, "db" | "pubsub">,
  actor: ArtifactActor,
  orgId: string,
  input: { name: string; parentId?: string | null },
): Promise<DriveFolderView> {
  await canChange(deps.db, actor, orgId);
  const name = cleanFolderName(input.name);
  const parentId = input.parentId ?? null;
  if (parentId) await loadFolder(deps.db, orgId, parentId);
  if (await findNamed(deps.db, orgId, parentId, name)) {
    throw new ConflictError("A folder with that name is already there", "drive.folder_exists");
  }
  const row = await insertFolder(deps.db, actor, orgId, parentId, name);
  await publishListChanged(deps.pubsub, orgId, "artifacts");
  return viewOf(row);
}

/**
 * The folder at a path, made with every missing folder on the way when `create` (an agent filing into
 * "Clientes/Alliance" makes both if need be). Names match whatever their case. Null for the top ("" or "/"), or for a
 * path not there without `create`.
 */
export async function folderAtPath(
  deps: Pick<ArtifactDeps, "db" | "pubsub">,
  actor: ArtifactActor,
  orgId: string,
  path: string,
  opts: { create: boolean },
): Promise<{ id: string | null; made: string[] } | null> {
  const names = splitFolderPath(path);
  if (names.length > FOLDER_DEPTH_MAX) {
    throw new ValidationError(`Folders go at most ${FOLDER_DEPTH_MAX} levels deep`, "drive.folder_too_deep", {
      max: FOLDER_DEPTH_MAX,
    });
  }
  let parentId: string | null = null;
  const made: string[] = [];
  for (const name of names) {
    const there = await findNamed(deps.db, orgId, parentId, name);
    if (there) {
      parentId = there.id;
      continue;
    }
    if (!opts.create) return null;
    await canChange(deps.db, actor, orgId);
    const row = await insertFolder(deps.db, actor, orgId, parentId, name);
    made.push(name);
    parentId = row.id;
  }
  if (made.length > 0) await publishListChanged(deps.pubsub, orgId, "artifacts");
  return { id: parentId, made };
}

/** Renames a folder and/or moves it under another (null: the top). A folder never goes inside itself. */
export async function updateFolder(
  deps: Pick<ArtifactDeps, "db" | "pubsub">,
  actor: ArtifactActor,
  orgId: string,
  folderId: string,
  input: { name?: string; parentId?: string | null },
): Promise<DriveFolderView> {
  await canChange(deps.db, actor, orgId);
  const current = await loadFolder(deps.db, orgId, folderId);
  const name = input.name === undefined ? current.name : cleanFolderName(input.name);
  const parentId = input.parentId === undefined ? current.parentId : input.parentId;
  if (parentId) {
    await loadFolder(deps.db, orgId, parentId);
    const chain = await ancestry(deps.db, orgId, parentId);
    if (chain.includes(folderId)) {
      throw new ValidationError("A folder can't go inside itself", "drive.folder_cycle");
    }
    if (chain.length + 1 + (await heightOf(deps.db, orgId, folderId)) > FOLDER_DEPTH_MAX) {
      throw new ValidationError(`Folders go at most ${FOLDER_DEPTH_MAX} levels deep`, "drive.folder_too_deep", {
        max: FOLDER_DEPTH_MAX,
      });
    }
  }
  if (name === current.name && parentId === current.parentId) return viewOf(current);
  const clash = await findNamed(deps.db, orgId, parentId, name);
  if (clash && clash.id !== folderId) {
    throw new ConflictError("A folder with that name is already there", "drive.folder_exists");
  }
  const row = await deps.db.transaction(async (tx) => {
    const [out] = await tx
      .update(driveFolders)
      .set({ name, parentId, updatedAt: new Date() })
      .where(and(eq(driveFolders.id, folderId), eq(driveFolders.orgId, orgId)))
      .returning();
    if (!out) throw new NotFoundError("Folder not found", "drive.folder_not_found");
    await recordAudit(tx, {
      orgId,
      actor: authorOf(actor),
      action: "drive.folder_changed",
      target: { type: "drive_folder", id: folderId },
      details: { name, from: current.name, parentId, fromParentId: current.parentId },
    });
    return out;
  });
  await publishListChanged(deps.pubsub, orgId, "artifacts");
  return viewOf(row);
}

/**
 * Removes a folder, never a file: what was in it (files, even ones the remover can't see, and folders) goes up to its
 * parent. A folder moved up next to one of the same name gets a number, "Roteiros (2)".
 */
export async function deleteFolder(
  deps: Pick<ArtifactDeps, "db" | "pubsub">,
  actor: ArtifactActor,
  orgId: string,
  folderId: string,
): Promise<{ files: number; folders: number }> {
  await canChange(deps.db, actor, orgId);
  const folder = await loadFolder(deps.db, orgId, folderId);
  const out = await deps.db.transaction(async (tx) => {
    const files = await tx
      .update(artifacts)
      .set({ folderId: folder.parentId })
      .where(and(eq(artifacts.orgId, orgId), eq(artifacts.folderId, folderId)))
      .returning({ id: artifacts.id });
    const children = await tx
      .select()
      .from(driveFolders)
      .where(and(eq(driveFolders.orgId, orgId), eq(driveFolders.parentId, folderId)));
    for (const child of children) {
      let name = child.name;
      for (let n = 2; await findNamed(tx, orgId, folder.parentId, name); n++) {
        name = `${child.name.slice(0, FOLDER_NAME_MAX - 6)} (${n})`;
      }
      await tx
        .update(driveFolders)
        .set({ parentId: folder.parentId, name, updatedAt: new Date() })
        .where(eq(driveFolders.id, child.id));
    }
    await tx.delete(driveFolders).where(eq(driveFolders.id, folderId));
    await recordAudit(tx, {
      orgId,
      actor: authorOf(actor),
      action: "drive.folder_deleted",
      target: { type: "drive_folder", id: folderId },
      details: { name: folder.name, files: files.length, folders: children.length },
    });
    return { files: files.length, folders: children.length };
  });
  await publishListChanged(deps.pubsub, orgId, "artifacts");
  return out;
}
