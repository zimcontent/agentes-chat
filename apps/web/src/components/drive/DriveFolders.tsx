import type { DriveFolder } from "@agenteschat/client";
import { useDriveOrganize } from "@agenteschat/client";
import { folderAndBelow, folderChain, folderRows } from "@agenteschat/client/lib/drive-folders";
import { errorText } from "@agenteschat/client/lib/errors";
import {
  Button,
  cx,
  Dialog,
  DialogBody,
  DialogFooter,
  Field,
  GroupHeading,
  Icon,
  Input,
  Locked,
  Menu,
  OptionList,
} from "@agenteschat/ui";
import { type DragEvent, useState } from "react";
import { useTranslation } from "react-i18next";
import { MenuEntries } from "@/components/DesktopMenus";
import { useOrg } from "@/components/org-context";
import type { MenuEntry } from "@/lib/context-menu";
import { entityMenu } from "@/lib/entity-menu";
import { useToast } from "@/lib/toast";

/**
 * The Drive's folders on the web (docs/adr/doug-0036-drive-folders.md): the way down to the folder open
 * (`FolderPath`), the folders in it as tiles (`FolderTiles`, a drop target for files dragged onto them), and the
 * dialogs that make, rename, move and remove folders and file files (`useFolderActions`).
 */

/** What a file being dragged carries: its id and the others selected with it. */
export const DRAG_TYPE = "application/x-agentes-drive-files";

/** The ids a drop carries, or none (something else was dropped: an upload is the page's). */
export function droppedIds(e: DragEvent): string[] {
  const raw = e.dataTransfer.getData(DRAG_TYPE);
  if (!raw) return [];
  try {
    const ids = JSON.parse(raw) as unknown;
    return Array.isArray(ids) ? ids.filter((x): x is string => typeof x === "string") : [];
  } catch {
    return [];
  }
}

const carriesFiles = (e: DragEvent) => e.dataTransfer.types.includes(DRAG_TYPE);

/** A place files can be dropped on: highlighted while files hover it. */
function useDropTarget(onDrop: (ids: string[]) => void) {
  const [over, setOver] = useState(false);
  return {
    over,
    props: {
      onDragOver: (e: DragEvent) => {
        if (!carriesFiles(e)) return;
        e.preventDefault();
        // The page's own drop (an upload) never sees a file moved between folders.
        e.stopPropagation();
        e.dataTransfer.dropEffect = "move";
        setOver(true);
      },
      onDragLeave: () => setOver(false),
      onDrop: (e: DragEvent) => {
        if (!carriesFiles(e)) return;
        e.preventDefault();
        e.stopPropagation();
        setOver(false);
        const ids = droppedIds(e);
        if (ids.length > 0) onDrop(ids);
      },
    },
  };
}

type FolderActions = ReturnType<typeof useFolderActions>;

/** "Drive › Clientes › Alliance": every step opens, a file dropped on one goes there; the last has the folder's menu. */
export function FolderPath({
  folders,
  folderId,
  onOpen,
  actions,
  canChange,
}: {
  folders: DriveFolder[];
  folderId: string | null;
  onOpen: (id: string | null) => void;
  actions: FolderActions;
  canChange: boolean;
}) {
  const { t } = useTranslation();
  const chain = folderChain(folders, folderId);
  const current = chain.at(-1);
  return (
    <nav className="drive-path" aria-label={t("drive.folders.path")}>
      <ol className="drive-path__list">
        <PathStep
          label={t("drive.title")}
          icon="drive"
          current={!current}
          onOpen={() => onOpen(null)}
          onDrop={(ids) => actions.fileInto(ids, null)}
        />
        {chain.map((f) => (
          <PathStep
            key={f.id}
            label={f.name}
            current={f.id === current?.id}
            onOpen={() => onOpen(f.id)}
            onDrop={(ids) => actions.fileInto(ids, f.id)}
          />
        ))}
      </ol>
      {current && canChange && (
        <Menu
          align="start"
          label={t("drive.folders.menu", { name: current.name })}
          trigger={
            <Button
              size="sm"
              variant="ghost"
              iconOnly
              icon="more"
              aria-label={t("drive.folders.menu", { name: current.name })}
              title={t("drive.folders.menuShort")}
            />
          }
        >
          <MenuEntries entries={actions.entries(current)} />
        </Menu>
      )}
    </nav>
  );
}

function PathStep({
  label,
  icon,
  current,
  onOpen,
  onDrop,
}: {
  label: string;
  icon?: "drive";
  current: boolean;
  onOpen: () => void;
  onDrop: (ids: string[]) => void;
}) {
  const drop = useDropTarget(onDrop);
  return (
    <li className="drive-path__step">
      <button
        type="button"
        className={cx("drive-path__btn", drop.over && "drive-path__btn--over")}
        aria-current={current ? "page" : undefined}
        onClick={onOpen}
        {...drop.props}
      >
        {icon && <Icon name={icon} size={16} />}
        <span>{label}</span>
      </button>
    </li>
  );
}

/** The folders in the one open, Google Drive's way: a tile each, its files' count, a drop target. */
export function FolderTiles({
  folders,
  onOpen,
  actions,
  canChange,
}: {
  folders: DriveFolder[];
  onOpen: (id: string) => void;
  actions: FolderActions;
  canChange: boolean;
}) {
  const { t } = useTranslation();
  if (folders.length === 0) return null;
  return (
    <section className="drive-group">
      <GroupHeading className="drive-group__head" title={t("drive.folders.title")} count={folders.length} />
      <ul className="drive-folders" aria-label={t("drive.folders.title")}>
        {folders.map((f) => (
          <FolderTile key={f.id} folder={f} onOpen={() => onOpen(f.id)} actions={actions} canChange={canChange} />
        ))}
      </ul>
    </section>
  );
}

function FolderTile({
  folder,
  onOpen,
  actions,
  canChange,
}: {
  folder: DriveFolder;
  onOpen: () => void;
  actions: FolderActions;
  canChange: boolean;
}) {
  const { t } = useTranslation();
  const drop = useDropTarget((ids) => actions.fileInto(ids, folder.id));
  const menu = entityMenu(() => [{ kind: "header", label: folder.name }, ...actions.entries(folder)]);
  const label = t("drive.folders.menu", { name: folder.name });
  return (
    <li
      className={cx("drive-folder", drop.over && "drive-folder--over")}
      {...(canChange ? { ...drop.props, ...menu } : {})}
    >
      <button type="button" className="drive-folder__open drive-hit" onClick={onOpen}>
        <Icon name="folder" size={20} />
        <span className="drive-folder__name">{folder.name}</span>
        <span className="drive-folder__count tabular">{t("drive.folders.files", { count: folder.files ?? 0 })}</span>
      </button>
      {canChange && (
        <span className="drive-folder__more">
          <Menu
            align="end"
            label={label}
            trigger={
              <Button
                size="sm"
                variant="ghost"
                iconOnly
                icon="more"
                aria-label={label}
                title={t("drive.folders.menuShort")}
              />
            }
          >
            <MenuEntries entries={actions.entries(folder)} />
          </Menu>
        </span>
      )}
    </li>
  );
}

type Asking =
  | { kind: "new"; parentId: string | null }
  | { kind: "rename"; folder: DriveFolder }
  | { kind: "move-folder"; folder: DriveFolder }
  | { kind: "move-files"; ids: string[]; from: string | null }
  | { kind: "remove"; folder: DriveFolder }
  | null;

/**
 * Every folder action with its dialog: "Nova pasta", "Renomear", "Mover para…" (a folder or files), "Remover pasta",
 * and files dropped on a folder. `dialog` goes on the page once.
 */
export function useFolderActions(folders: DriveFolder[], onRemoved?: (folder: DriveFolder) => void) {
  const { t } = useTranslation();
  const { org } = useOrg();
  const toast = useToast();
  const organize = useDriveOrganize(org.id);
  const [asking, setAsking] = useState<Asking>(null);
  const failed = (err: unknown) => toast.show(errorText(t, err), "error");
  const nameOf = (id: string | null) =>
    id ? (folders.find((f) => f.id === id)?.name ?? t("drive.title")) : t("drive.title");

  const fileInto = (ids: string[], folderId: string | null, undoTo?: string | null) => {
    organize.file.mutate(
      { ids, folderId },
      {
        onSuccess: (moved) =>
          toast.show(
            t("drive.folders.filed", { count: moved.length, folder: nameOf(folderId) }),
            "info",
            undoTo !== undefined
              ? {
                  label: t("artifacts.undo"),
                  run: () => organize.file.mutate({ ids, folderId: undoTo }, { onError: failed }),
                }
              : undefined,
          ),
        onError: failed,
      },
    );
  };

  const entries = (folder: DriveFolder): MenuEntry[] => [
    {
      kind: "item",
      id: "rename",
      label: t("drive.folders.rename"),
      icon: "edit",
      run: () => setAsking({ kind: "rename", folder }),
    },
    {
      kind: "item",
      id: "move",
      label: t("drive.folders.moveTo"),
      icon: "move",
      run: () => setAsking({ kind: "move-folder", folder }),
    },
    {
      kind: "item",
      id: "new-inside",
      label: t("drive.folders.newInside"),
      icon: "folderPlus",
      run: () => setAsking({ kind: "new", parentId: folder.id }),
    },
    { kind: "separator" },
    {
      kind: "item",
      id: "remove",
      label: t("drive.folders.remove"),
      icon: "trash",
      danger: true,
      run: () => setAsking({ kind: "remove", folder }),
    },
  ];

  const close = () => setAsking(null);
  const dialog = (
    <>
      <NameDialog
        open={asking?.kind === "new" || asking?.kind === "rename"}
        title={asking?.kind === "rename" ? t("drive.folders.renameTitle") : t("drive.folders.newTitle")}
        confirm={asking?.kind === "rename" ? t("drive.folders.renameConfirm") : t("drive.folders.create")}
        initial={asking?.kind === "rename" ? asking.folder.name : ""}
        busy={organize.createFolder.isPending || organize.updateFolder.isPending}
        onClose={close}
        onSave={(name) => {
          if (asking?.kind === "rename") {
            organize.updateFolder.mutate({ id: asking.folder.id, name }, { onSuccess: close, onError: failed });
          } else if (asking?.kind === "new") {
            organize.createFolder.mutate(
              { name, parentId: asking.parentId },
              {
                onSuccess: (f) => {
                  close();
                  toast.show(t("drive.folders.created", { name: f.name }));
                },
                onError: failed,
              },
            );
          }
        }}
      />
      <MoveDialog
        open={asking?.kind === "move-folder" || asking?.kind === "move-files"}
        folders={folders}
        title={
          asking?.kind === "move-folder"
            ? t("drive.folders.moveFolderTitle", { name: asking.folder.name })
            : t("drive.folders.moveFilesTitle", { count: asking?.kind === "move-files" ? asking.ids.length : 0 })
        }
        hidden={asking?.kind === "move-folder" ? folderAndBelow(folders, asking.folder.id) : new Set()}
        current={
          asking?.kind === "move-folder" ? asking.folder.parentId : asking?.kind === "move-files" ? asking.from : null
        }
        busy={organize.updateFolder.isPending || organize.file.isPending}
        onClose={close}
        onMove={(to) => {
          if (asking?.kind === "move-folder") {
            organize.updateFolder.mutate(
              { id: asking.folder.id, parentId: to },
              {
                onSuccess: () => {
                  close();
                  toast.show(t("drive.folders.moved", { name: asking.folder.name, folder: nameOf(to) }));
                },
                onError: failed,
              },
            );
          } else if (asking?.kind === "move-files") {
            close();
            fileInto(asking.ids, to, asking.from);
          }
        }}
      />
      <Dialog
        open={asking?.kind === "remove"}
        onOpenChange={(o) => !o && close()}
        title={t("drive.folders.removeTitle", { name: asking?.kind === "remove" ? asking.folder.name : "" })}
        description={t("drive.folders.removeBody")}
        closeLabel={t("common.close")}
        width={460}
      >
        <DialogFooter>
          <Button onClick={close}>{t("common.cancel")}</Button>
          <Button
            variant="danger"
            loading={organize.removeFolder.isPending}
            onClick={() => {
              if (asking?.kind !== "remove") return;
              const folder = asking.folder;
              organize.removeFolder.mutate(folder.id, {
                onSuccess: () => {
                  close();
                  onRemoved?.(folder);
                  toast.show(t("drive.folders.removed", { name: folder.name }));
                },
                onError: failed,
              });
            }}
          >
            {t("drive.folders.removeConfirm")}
          </Button>
        </DialogFooter>
      </Dialog>
    </>
  );

  return {
    entries,
    dialog,
    fileInto: (ids: string[], folderId: string | null) => fileInto(ids, folderId),
    newFolder: (parentId: string | null) => setAsking({ kind: "new", parentId }),
    moveFiles: (ids: string[], from: string | null) => setAsking({ kind: "move-files", ids, from }),
  };
}

function NameDialog({
  open,
  title,
  confirm,
  initial,
  busy,
  onClose,
  onSave,
}: {
  open: boolean;
  title: string;
  confirm: string;
  initial: string;
  busy: boolean;
  onClose: () => void;
  onSave: (name: string) => void;
}) {
  const { t } = useTranslation();
  const [name, setName] = useState(initial);
  const [shownFor, setShownFor] = useState<string | null>(null);
  // A fresh field each time it opens (the name being renamed, or empty).
  const key = open ? `${title}:${initial}` : null;
  if (key !== shownFor) {
    setShownFor(key);
    setName(initial);
  }
  const ready = name.trim().length > 0 && name.trim() !== initial;
  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()} title={title} closeLabel={t("common.close")} width={440}>
      <form
        onSubmit={(e) => {
          e.preventDefault();
          if (ready && !busy) onSave(name.trim());
        }}
      >
        <Locked when={busy}>
          <DialogBody>
            <Field label={t("drive.folders.name")} id="drive-folder-name">
              <Input
                id="drive-folder-name"
                value={name}
                maxLength={80}
                autoComplete="off"
                autoFocus
                placeholder={t("drive.folders.namePlaceholder")}
                onChange={(e) => setName(e.target.value)}
              />
            </Field>
          </DialogBody>
        </Locked>
        <DialogFooter>
          <Button onClick={onClose}>{t("common.cancel")}</Button>
          <Button type="submit" variant="primary" loading={busy} disabled={!ready}>
            {confirm}
          </Button>
        </DialogFooter>
      </form>
    </Dialog>
  );
}

const TOP = "__top__";

/** "Mover para…": the Drive's top and every folder as a tree, the one it is in marked. */
function MoveDialog({
  open,
  folders,
  title,
  hidden,
  current,
  busy,
  onClose,
  onMove,
}: {
  open: boolean;
  folders: DriveFolder[];
  title: string;
  /** A folder can't go inside itself or under its own folders. */
  hidden: Set<string>;
  current: string | null;
  busy: boolean;
  onClose: () => void;
  onMove: (folderId: string | null) => void;
}) {
  const { t, i18n } = useTranslation();
  const [to, setTo] = useState<string>(TOP);
  const [shownFor, setShownFor] = useState<boolean>(false);
  if (open !== shownFor) {
    setShownFor(open);
    setTo(current ?? TOP);
  }
  const rows = folderRows(folders, i18n.language).filter((r) => !hidden.has(r.folder.id));
  const here = (id: string | null) => (id === current ? t("drive.folders.here") : undefined);
  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()} title={title} closeLabel={t("common.close")} width={480}>
      <DialogBody className="drive-move">
        <OptionList
          aria-label={t("drive.folders.moveTo")}
          value={to}
          onValueChange={setTo}
          options={[
            {
              value: TOP,
              title: (
                <span className="drive-move__name">
                  <Icon name="drive" size={16} />
                  {t("drive.title")}
                </span>
              ),
              side: here(null),
            },
            ...rows.map((r) => ({
              value: r.folder.id,
              title: (
                <span className="drive-move__name" style={{ paddingInlineStart: `calc(${r.depth} * var(--space-4))` }}>
                  <Icon name="folder" size={16} />
                  {r.folder.name}
                </span>
              ),
              side: here(r.folder.id),
            })),
          ]}
        />
      </DialogBody>
      <DialogFooter>
        <Button onClick={onClose}>{t("common.cancel")}</Button>
        <Button
          variant="primary"
          loading={busy}
          disabled={(to === TOP ? null : to) === current}
          onClick={() => onMove(to === TOP ? null : to)}
        >
          {t("drive.folders.moveHere")}
        </Button>
      </DialogFooter>
    </Dialog>
  );
}
