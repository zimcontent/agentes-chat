import { afterEach, describe, expect, test } from "bun:test";
import { eq, schema, sql } from "@agenteschat/db";
import type { ModelRequest } from "@agenteschat/providers";
import {
  type ArtifactActor,
  ConflictError,
  countByFolder,
  createArtifact,
  createFolder,
  deleteFolder,
  drainOutbox,
  ForbiddenError,
  fileArtifacts,
  folderAtPath,
  folderPaths,
  getArtifact,
  grantScopes,
  listArtifacts,
  listFolders,
  postPersonMessage,
  restoreArtifact,
  setDraft,
  trashExpiredDrafts,
  trashOwnFiles,
  updateArtifact,
  updateFolder,
  ValidationError,
} from "../src";
import { addMember, type Fixture, setup } from "./fixtures";

/** The Drive's folders and drafts (docs/adr/doug-0036-drive-folders.md). */

let f: Fixture;
afterEach(async () => {
  const current = f;
  f = undefined as unknown as Fixture;
  await current?.close();
});

const DRIVE = ["drive:read", "drive:write"].map((scope) => ({ connectionId: null, scope }));
const person = (userId: string) => ({ type: "person" as const, userId });
const agentActor = (): ArtifactActor => ({ type: "agent", agentId: f.agent.id, channelId: f.general.id });
const doc = (markdown: string) => ({ kind: "document" as const, markdown });

async function paths() {
  const list = await listFolders(f.db, person(f.owner.id), f.org.id);
  return [...folderPaths(list).values()].sort();
}

describe("folders", () => {
  test("a path is made once, matched whatever its case, and files filed there are listed by folder", async () => {
    f = await setup({});
    const me = person(f.owner.id);
    const a = await createArtifact(f.artifactDeps, me, f.org.id, { title: "Roteiro", content: doc("# 1") });
    const b = await createArtifact(f.artifactDeps, me, f.org.id, { title: "Solto", content: doc("# 2") });
    const made = await folderAtPath(f.artifactDeps, me, f.org.id, "Clientes / Alliance/Roteiros", { create: true });
    expect(made?.made).toEqual(["Clientes", "Alliance", "Roteiros"]);
    const again = await folderAtPath(f.artifactDeps, me, f.org.id, "clientes/ALLIANCE/roteiros", { create: true });
    expect(again).toEqual({ id: made?.id ?? null, made: [] });
    expect(await paths()).toEqual(["Clientes", "Clientes/Alliance", "Clientes/Alliance/Roteiros"]);

    const [filed] = await fileArtifacts(f.artifactDeps, me, f.org.id, [a.id], made?.id ?? null);
    expect(filed?.folderId).toBe(made?.id ?? "");
    const top = await folderAtPath(f.artifactDeps, me, f.org.id, "Clientes", { create: false });
    const ids = async (folder: { id: string | null; deep?: boolean }) =>
      (await listArtifacts(f.db, me, f.org.id, { folder })).map((x) => x.title);
    expect(await ids({ id: null })).toEqual(["Solto"]);
    expect(await ids({ id: top?.id ?? null })).toEqual([]);
    expect(await ids({ id: top?.id ?? null, deep: true })).toEqual(["Roteiro"]);
    expect(await ids({ id: null, deep: true })).toEqual(["Solto", "Roteiro"]);
    expect(await countByFolder(f.db, me, f.org.id)).toEqual({ "": 1, [made?.id ?? ""]: 1 });
    expect(b.folderId).toBeNull();
  });

  test("names are unique per place, a folder never goes inside itself, and removing one keeps every file", async () => {
    f = await setup({});
    const me = person(f.owner.id);
    const projects = await createFolder(f.artifactDeps, me, f.org.id, { name: "Projetos" });
    await expect(createFolder(f.artifactDeps, me, f.org.id, { name: "projetos" })).rejects.toBeInstanceOf(
      ConflictError,
    );
    await expect(createFolder(f.artifactDeps, me, f.org.id, { name: " / " })).rejects.toBeInstanceOf(ValidationError);
    const site = await createFolder(f.artifactDeps, me, f.org.id, { name: "Site", parentId: projects.id });
    const draftsHere = await createFolder(f.artifactDeps, me, f.org.id, { name: "Rascunhos", parentId: projects.id });
    await expect(updateFolder(f.artifactDeps, me, f.org.id, projects.id, { parentId: site.id })).rejects.toBeInstanceOf(
      ValidationError,
    );
    // A "Rascunhos" at the top already: the one moved up gets a number.
    await createFolder(f.artifactDeps, me, f.org.id, { name: "Rascunhos" });
    const file = await createArtifact(f.artifactDeps, me, f.org.id, { title: "Plano", content: doc("x") });
    await fileArtifacts(f.artifactDeps, me, f.org.id, [file.id], projects.id);

    expect(await deleteFolder(f.artifactDeps, me, f.org.id, projects.id)).toEqual({ files: 1, folders: 2 });
    expect(await paths()).toEqual(["Rascunhos", "Rascunhos (2)", "Site"]);
    const kept = await getArtifact(f.artifactDeps, me, f.org.id, file.id);
    expect(kept.folderId).toBeNull();
    expect(draftsHere.id).toBeTruthy();
    const audit = await f.db.select().from(schema.auditLog).where(eq(schema.auditLog.action, "drive.folder_deleted"));
    expect(audit).toHaveLength(1);
  });

  test("a person without upload_files can't change folders or file files", async () => {
    f = await setup({});
    const bia = await addMember(f.db, f.org.id, "member", "bia");
    await f.db
      .update(schema.orgRoles)
      .set({ permissions: sql`array_remove(${schema.orgRoles.permissions}, 'upload_files')` });
    await expect(createFolder(f.artifactDeps, person(bia.id), f.org.id, { name: "Dela" })).rejects.toBeInstanceOf(
      ForbiddenError,
    );
    const file = await createArtifact(f.artifactDeps, person(f.owner.id), f.org.id, { title: "x", content: doc("x") });
    await expect(fileArtifacts(f.artifactDeps, person(bia.id), f.org.id, [file.id], null)).rejects.toBeInstanceOf(
      ForbiddenError,
    );
  });
});

describe("drafts and clearing out", () => {
  test("a draft goes to the trash after its time unless a new version renews it; restored, it is kept", async () => {
    f = await setup({});
    const actor = agentActor();
    const old = await createArtifact(f.artifactDeps, actor, f.org.id, { title: "Teste", content: doc("a") });
    const worked = await createArtifact(f.artifactDeps, actor, f.org.id, { title: "Export", content: doc("b") });
    await setDraft(f.artifactDeps, actor, f.org.id, old.id, true);
    await setDraft(f.artifactDeps, actor, f.org.id, worked.id, true);
    // Both were made long ago; one gets a new version now.
    await f.db.update(schema.artifacts).set({ expiresAt: new Date(Date.now() - 60_000) });
    await updateArtifact(f.artifactDeps, actor, f.org.id, worked.id, { content: doc("b2"), note: "v2" });

    expect(await trashExpiredDrafts(f.artifactDeps)).toBe(1);
    const rows = await f.db.select().from(schema.artifacts);
    const gone = rows.find((r) => r.id === old.id);
    const renewed = rows.find((r) => r.id === worked.id);
    expect(gone?.deletedAt).toBeInstanceOf(Date);
    expect(renewed?.deletedAt).toBeNull();
    expect(renewed?.expiresAt?.getTime()).toBeGreaterThan(Date.now() + 6 * 86_400_000);

    const restored = await restoreArtifact(f.artifactDeps, f.owner.id, f.org.id, old.id);
    expect(restored.expiresAt).toBeNull();
    // A person keeps a draft; only its agent makes one.
    const kept = await setDraft(f.artifactDeps, person(f.owner.id), f.org.id, worked.id, false);
    expect(kept.expiresAt).toBeNull();
    await expect(setDraft(f.artifactDeps, person(f.owner.id), f.org.id, worked.id, true)).rejects.toBeInstanceOf(
      ForbiddenError,
    );
  });

  test("an agent clears out only its own files", async () => {
    f = await setup({});
    const actor = agentActor() as Extract<ArtifactActor, { type: "agent" }>;
    const mine = await createArtifact(f.artifactDeps, actor, f.org.id, { title: "Meu", content: doc("a") });
    const theirs = await createArtifact(f.artifactDeps, person(f.owner.id), f.org.id, {
      title: "Da Ana",
      content: doc("b"),
    });
    const out = await trashOwnFiles(f.artifactDeps, actor, f.org.id, [mine.id, theirs.id], "substituído pela v2");
    expect(out.trashed.map((a) => a.title)).toEqual(["Meu"]);
    expect(out.refused.map((r) => r.id)).toEqual([theirs.id]);
    const [audit] = await f.db.select().from(schema.auditLog).where(eq(schema.auditLog.action, "artifact.deleted"));
    expect(audit).toMatchObject({ actorType: "agent", details: { title: "Meu", why: "substituído pela v2" } });
  });
});

describe("the agent's tools", () => {
  const last = (req: ModelRequest) => JSON.stringify(req.messages.at(-1)?.content);

  test("an agent saves into a project folder as a draft, sees the folders and files loose files", async () => {
    const results: string[] = [];
    f = await setup({
      artifactTools: true,
      reply: (req) => {
        const text = last(req);
        if (text.includes("tool_result")) {
          results.push(text);
          return { chunks: ["feito"] };
        }
        if (text.includes("salva o teste"))
          return {
            chunks: [],
            toolUses: [
              {
                name: "create_artifact",
                input: {
                  title: "Teste de cor",
                  kind: "document",
                  markdown: "# x",
                  folder: "Clientes/Alliance",
                  draft: true,
                },
              },
            ],
          };
        if (text.includes("quais pastas")) return { chunks: [], toolUses: [{ name: "drive_folders", input: {} }] };
        return { chunks: ["ok"] };
      },
    });
    await grantScopes(f.db, f.org.id, f.agent.id, DRIVE);
    const post = (body: string) =>
      postPersonMessage({ db: f.db, pubsub: f.pubsub }, f.owner.id, f.org.id, f.general.id, { body });
    await post("@dev salva o teste");
    await drainOutbox(f.db, f.handlers);
    expect(results.at(-1)).toContain('Filed in the folder \\"Clientes/Alliance\\" (new folders: Clientes, Alliance).');
    expect(results.at(-1)).toContain("A draft: it goes to the trash on its own 7 days after its last version.");
    const [row] = await f.db.select().from(schema.artifacts);
    expect(row?.folderId).toBeTruthy();
    expect(row?.expiresAt).toBeInstanceOf(Date);
    expect(await paths()).toEqual(["Clientes", "Clientes/Alliance"]);

    await post("@dev quais pastas tem?");
    await drainOutbox(f.db, f.handlers);
    expect(results.at(-1)).toContain("Clientes/Alliance — 1 file");
    expect(results.at(-1)).toContain("In no folder: 0 files.");
  });
});
