# doug-0036. The Drive's folders, and agents that keep it tidy

- Status: Accepted
- Date: 2026-11-18
- Code: `packages/db/src/schema/storage.ts` (`driveFolders`, `artifacts.folderId`, `artifacts.expiresAt`, made by `EXTRA_COLUMNS` in `packages/db/src/client.ts`), `packages/engine/src/drive-folders.ts` (folders, paths, `folderAtPath`, `deleteFolder`), `packages/engine/src/artifacts.ts` (`ArtifactFilters.folder`, `countByFolder`, `fileArtifacts`, `setDraft`, `trashOwnFiles`, `trashExpiredDrafts`, `trashRows`, `DRAFT_DAYS`), `packages/engine/src/artifact-tools.ts` (`folder` and `draft` on every tool that saves a file, `drive_folders`, `file_artifacts`, `drive_folder`, `trash_artifacts`), `packages/engine/src/capabilities.ts` (the line that asks agents to keep the Drive tidy), `apps/server/src/workers.ts` (`drafts` tick), `apps/server/src/routes/app/artifacts.ts` (`…/drive-folders`, `…/drive/file`, `DELETE …/artifacts/{id}/draft`, `folderId`/`deep`/`drafts` on the list), `packages/client/src/lib/drive-folders.ts`, web `apps/web/src/components/drive/DriveFolders.tsx` and `pages/DrivePage.tsx`

## Context

The Drive was one flat list. Agents save a lot (reports, tests, intermediate exports, screenshots), and the only ways to find something were the date groups, a conversation or an author. People asked for the Drive to work like a team's Google Drive: a folder per client and project, files filed where they belong, filters by folder as well as by agent, and agents cleaning up after themselves instead of leaving every working file loose forever.

## Decision

1. **Folders are the workspace's**: a row in `drive_folders` per folder, a name under a parent (null: the top), at most 8 levels and 2000 per workspace, one name per place whatever its case. Every member and agent sees every folder. A file has one folder (`artifacts.folder_id`, null: the top). **Filing never changes who sees a file** (ADR 0111, 0157): a folder may hold files some viewers don't see, and the counts each viewer gets are of the files they see.
2. **Who changes them**: people with `upload_files` make, rename, move and remove folders and file any file they read; agents with `drive:write` do the same, filing only files where they work (`writable`). Every change is in the audit log (`drive.folder_created`, `drive.folder_changed`, `drive.folder_deleted`, `artifact.filed`).
3. **Removing a folder never deletes a file**: what was in it (files and folders, also files the remover can't see) goes up one level, a folder that meets one of the same name taking a number ("Roteiros (2)"). Deleting files stays the trash's, with its own rule (ADR 0111).
4. **Agents work by path**: every tool that saves a file (`create_artifact`, `update_artifact`, `upload_file`, `export_file`) takes `folder: "Clientes/Alliance"`, making what is missing; `drive_folders` lists the folders with the files the agent sees in each; `file_artifacts` files files; `drive_folder` renames, moves or removes one; `list_artifacts` filters by folder (`""`: the loose ones) and shows each file's folder. A paragraph in the prompt (`capabilities.ts`) asks them to file each file in its project's folder, reuse the folders there, and tidy loose files of their own.
5. **Drafts clean themselves up**: an agent marks a working file `draft` (a test, an intermediate export, a picture to check something). It goes to the trash `DRAFT_DAYS` (7) after its last version, unless a person keeps it ("Manter"); a new version gives it the whole time back, and a draft restored from the trash is kept. Only the agent that made a file marks it; anyone who reads it may keep it. The hourly `drafts` tick moves them, as the system in the audit log, with `why: "draft_expired"`.
6. **Agents clear out their own files**: `trash_artifacts` sends to the trash only files the agent made, with a reason in the audit log; a person's or another agent's file is left alone and said. The trash keeps them 30 days, as for anything else.
7. **The web's Drive is Google Drive's**: the path at the top (each step opens, each takes dropped files), the folders in the one open as tiles with their counts, files dragged onto a tile or a step to file them, "Nova pasta", "Mover para…" on a file, a folder and the selection, and the open folder in the address (`?folder=`). With no search or filter it shows the folder's own files; searching or filtering looks in the folder and every one under it (at the top, the whole Drive), each file then saying the folder it is in. An upload made inside a folder goes there. A draft says so on its card ("Rascunho", the date in its tip).

## Consequences

- The tables are this instance's own, outside the numbered migrations, like the others in `EXTRA_COLUMNS`.
- A folder's name is seen by the whole workspace even when it only holds private files: people and agents are told folders are shared names.
- The phone app reads the same list unchanged (no `folderId`: every file, as before); folders there are later work.
- Agents decide what is a project and what is a draft. A wrong guess costs a move or a restore, never a file: removing folders deletes nothing, and the trash keeps what an agent cleared for 30 days.
