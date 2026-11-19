import type { PortalCardFile } from "@dougbot/client";
import { useArtifact, useArtifacts } from "@dougbot/client";
import { fileIcon, previewKindOfName } from "@dougbot/client/lib/files";
import { PORTAL_SEND_FILES } from "@dougbot/client/lib/portal";
import { Button, Checkbox, Dialog, DialogBody, DialogFooter, EmptyState, Icon, SearchField } from "@dougbot/ui";
import { type ReactNode, useDeferredValue, useId, useState } from "react";
import { useTranslation } from "react-i18next";
import { useMaybeArtifactViewer } from "@/components/artifacts/ArtifactViewer";
import { usePreviewUrl } from "@/components/artifacts/FileView";
import { ErrorState, LoadingList } from "@/components/Loading";
import { useOrg } from "@/components/org-context";

/** What a pick may be: pictures and videos (what goes for approval), or a picture alone (a reel's cover). */
type Accept = "media" | "image";
const fits = (name: string, accept: Accept) => {
  const kind = previewKindOfName(name);
  return accept === "image" ? kind === "image" : kind === "image" || kind === "video";
};

/** The list with the file at `i` one place up (-1) or down (+1). */
const moved = (files: PortalCardFile[], i: number, by: -1 | 1) => {
  const next = [...files];
  const [file] = next.splice(i, 1);
  if (file) next.splice(i + by, 0, file);
  return next;
};

/**
 * A form's group that isn't one control (a list of files with its button): the field's label over it, naming it, and
 * what is wrong with it under it. A `Field` wires one control of the form's height, which this is not.
 */
function FileGroup({ label, error, children }: { label: string; error?: string; children: ReactNode }) {
  const id = useId();
  return (
    // biome-ignore lint/a11y/useSemanticElements: a fieldset brings the browser's own frame and legend placement
    <div className="portal-files" role="group" aria-labelledby={id}>
      <span className="ac-field__label" id={id}>
        {label}
      </span>
      {children}
      {error && (
        <p className="ac-field__error" role="alert">
          {error}
        </p>
      )}
    </div>
  );
}

/**
 * A file's face in a list of attachments: the picture itself, small, when it is one the Drive can show; else its
 * kind's icon. The tile has its size before the picture comes.
 */
function FileThumb({ file }: { file: PortalCardFile }) {
  const { org } = useOrg();
  const picture = previewKindOfName(file.name) === "image";
  const detail = useArtifact(org.id, picture ? file.id : null).data;
  const content = detail?.content.kind === "file" ? detail.content : null;
  return (
    <span className="portal-files__thumb">
      {detail && content ? (
        <ThumbPicture id={detail.id} version={detail.shownVersion} contentType={content.contentType} name={file.name} />
      ) : (
        <Icon name={fileIcon(file.name)} size={18} />
      )}
    </span>
  );
}

function ThumbPicture({
  id,
  version,
  contentType,
  name,
}: {
  id: string;
  version: number;
  contentType: string;
  name: string;
}) {
  const { url, failed } = usePreviewUrl(id, version, contentType, true);
  if (failed) return <Icon name={fileIcon(name)} size={18} />;
  // Beside its name: the name says what it is.
  return url ? <img src={url} alt="" /> : null;
}

/**
 * The files that go up with a card or a send (ADR 9001), in the order a carousel shows them: each with its place
 * (up, down) and a way out, then "Add from the Drive". Only uploaded files of the workspace's Drive can go.
 */
export function PortalFiles({
  label,
  files,
  onChange,
  error,
  max = PORTAL_SEND_FILES,
  preview = false,
}: {
  label: string;
  files: PortalCardFile[];
  onChange: (files: PortalCardFile[]) => void;
  /** Why these files can't go as they are. */
  error?: string;
  max?: number;
  /** Attachments to look at (a card opened): each with its picture, small, and a way to open it. */
  preview?: boolean;
}) {
  const { t } = useTranslation();
  const [picking, setPicking] = useState(false);
  const viewer = useMaybeArtifactViewer();
  return (
    <FileGroup label={label} error={error}>
      {files.length > 0 && (
        <ol className="portal-files__list">
          {files.map((file, i) => (
            <li key={file.id} className="portal-files__row" data-preview={preview || undefined}>
              {preview ? <FileThumb file={file} /> : <Icon name={fileIcon(file.name)} size={16} />}
              <span className="portal-files__name">{file.name}</span>
              <span className="portal-files__acts">
                {preview && viewer && (
                  <Button
                    size="sm"
                    variant="ghost"
                    iconOnly
                    icon="external"
                    aria-label={t("portal.detail.openFile", { name: file.name })}
                    title={t("portal.detail.openFile", { name: file.name })}
                    onClick={() => viewer.open(file.id)}
                  />
                )}
                {files.length > 1 && (
                  <>
                    <Button
                      size="sm"
                      variant="ghost"
                      iconOnly
                      icon="chevronUp"
                      aria-label={`${t("contextMenu.moveUp")}: ${file.name}`}
                      disabled={i === 0}
                      onClick={() => onChange(moved(files, i, -1))}
                    />
                    <Button
                      size="sm"
                      variant="ghost"
                      iconOnly
                      icon="chevronDown"
                      aria-label={`${t("contextMenu.moveDown")}: ${file.name}`}
                      disabled={i === files.length - 1}
                      onClick={() => onChange(moved(files, i, 1))}
                    />
                  </>
                )}
                <Button
                  size="sm"
                  variant="ghost"
                  iconOnly
                  icon="close"
                  aria-label={t("common.removeName", { name: file.name })}
                  onClick={() => onChange(files.filter((f) => f.id !== file.id))}
                />
              </span>
            </li>
          ))}
        </ol>
      )}
      {files.length < max && (
        <Button icon="drive" onClick={() => setPicking(true)}>
          {t("portal.form.addFiles")}
        </Button>
      )}
      <DriveFilePicker
        open={picking}
        taken={files}
        room={max - files.length}
        onClose={() => setPicking(false)}
        onPick={(picked) => onChange([...files, ...picked])}
      />
    </FileGroup>
  );
}

/** A reel's cover: one picture of the Drive, or none. */
export function PortalCover({
  label,
  cover,
  onChange,
}: {
  label: string;
  cover: PortalCardFile | null;
  onChange: (cover: PortalCardFile | null) => void;
}) {
  const { t } = useTranslation();
  const [picking, setPicking] = useState(false);
  return (
    <FileGroup label={label}>
      {cover ? (
        <ol className="portal-files__list">
          <li className="portal-files__row">
            <Icon name="image" size={16} />
            <span className="portal-files__name">{cover.name}</span>
            <span className="portal-files__acts">
              <Button
                size="sm"
                variant="ghost"
                iconOnly
                icon="close"
                aria-label={t("common.removeName", { name: cover.name })}
                onClick={() => onChange(null)}
              />
            </span>
          </li>
        </ol>
      ) : (
        <Button icon="image" onClick={() => setPicking(true)}>
          {t("portal.form.chooseCover")}
        </Button>
      )}
      <DriveFilePicker
        open={picking}
        accept="image"
        taken={[]}
        room={1}
        onClose={() => setPicking(false)}
        onPick={(picked) => onChange(picked[0] ?? null)}
      />
    </FileGroup>
  );
}

/**
 * The Drive's uploaded files to pick from, newest first, with a search: only pictures and videos show (what a
 * client approves), the ones already picked left out. `room`: how many more fit; with room for one, a press picks.
 */
function DriveFilePicker({
  open,
  accept = "media",
  taken,
  room,
  onClose,
  onPick,
}: {
  open: boolean;
  accept?: Accept;
  taken: PortalCardFile[];
  room: number;
  onClose: () => void;
  onPick: (files: PortalCardFile[]) => void;
}) {
  const { t } = useTranslation();
  return (
    <Dialog
      open={open}
      onOpenChange={(o) => !o && onClose()}
      title={t("portal.picker.title")}
      closeLabel={t("common.close")}
      width={600}
    >
      {open && <PickerBody accept={accept} taken={taken} room={room} onClose={onClose} onPick={onPick} />}
    </Dialog>
  );
}

function PickerBody({
  accept,
  taken,
  room,
  onClose,
  onPick,
}: {
  accept: Accept;
  taken: PortalCardFile[];
  room: number;
  onClose: () => void;
  onPick: (files: PortalCardFile[]) => void;
}) {
  const { t } = useTranslation();
  const { org } = useOrg();
  const [q, setQ] = useState("");
  const words = useDeferredValue(q.trim());
  const list = useArtifacts(org.id, { kind: "file", sort: "recent", ...(words ? { q: words } : {}) });
  const [picked, setPicked] = useState<PortalCardFile[]>([]);
  const has = new Set(taken.map((f) => f.id));
  const files = (list.artifacts ?? []).filter((a) => a.kind === "file" && !has.has(a.id) && fits(a.title, accept));
  const full = picked.length >= room;
  const toggle = (file: PortalCardFile, on: boolean) =>
    setPicked((now) => (on ? [...now.filter((f) => f.id !== file.id), file] : now.filter((f) => f.id !== file.id)));
  return (
    <>
      <DialogBody className="portal-pick">
        <SearchField
          size="sm"
          value={q}
          placeholder={t("portal.picker.search")}
          aria-label={t("portal.picker.search")}
          onChange={(e) => setQ(e.target.value)}
        />
        {list.isLoading && <LoadingList count={4} avatar={false} />}
        {list.isError && !list.artifacts && <ErrorState error={list.error} onRetry={() => void list.refetch()} />}
        {list.artifacts && files.length === 0 && (
          <EmptyState size="inline" icon="drive">
            {t("portal.picker.empty")}
          </EmptyState>
        )}
        {files.length > 0 && (
          <ul className="portal-pick__list">
            {files.map((a) => {
              const file = { id: a.id, name: a.title };
              const on = picked.some((f) => f.id === a.id);
              const boxId = `portal-pick-${a.id}`;
              return (
                <li key={a.id} className="portal-pick__row">
                  <Checkbox
                    id={boxId}
                    checked={on}
                    disabled={!on && full && room > 1}
                    onCheckedChange={(next) => (room === 1 && next ? setPicked([file]) : toggle(file, next))}
                  />
                  <label htmlFor={boxId} className="portal-pick__name">
                    <Icon name={fileIcon(a.title)} size={16} />
                    <span>{a.title}</span>
                  </label>
                </li>
              );
            })}
          </ul>
        )}
        {list.hasNextPage && (
          <Button size="sm" loading={list.isFetchingNextPage} onClick={() => void list.fetchNextPage()}>
            {t("portal.picker.more")}
          </Button>
        )}
      </DialogBody>
      <DialogFooter>
        <Button onClick={onClose}>{t("common.cancel")}</Button>
        <Button
          variant="primary"
          disabled={picked.length === 0}
          onClick={() => {
            onPick(picked);
            onClose();
          }}
        >
          {t("portal.picker.add", { count: picked.length || 1 })}
        </Button>
      </DialogFooter>
    </>
  );
}
