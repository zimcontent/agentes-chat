import { type ArtifactKind, useArtifact } from "@dougbot/client";
import { KIND_ICON } from "@dougbot/client/lib/artifacts";
import { fileIcon } from "@dougbot/client/lib/files";
import { type FileLink, filePath } from "@dougbot/client/lib/message-links";
import { Icon } from "@dougbot/ui";
import { useTranslation } from "react-i18next";
import { useMaybeArtifactViewer } from "@/components/artifacts/ArtifactViewer";
import { useOrg } from "@/components/org-context";
import { inPlaceClick } from "@/lib/navigate";

/** What a file's pill shows: its name, and its icon by its kind (an uploaded file's by its name and type). */
export interface PillFile {
  id: string;
  title: string;
  kind: string;
  fileName?: string | null;
  contentType?: string | null;
}

/**
 * A file's pill in a text, wherever it came from (a file's link, `FileRef`; an id, `IdRef`): its icon and name in the
 * #channel pill, the icon beside the name and never over it, the name wrapping inside the pill. A click opens the viewer here; another
 * workspace's file, or a page with no viewer, opens its Drive.
 */
export function FilePill({ orgId, file, version }: { orgId: string; file: PillFile; version?: number }) {
  const { t } = useTranslation();
  const { org } = useOrg();
  const viewer = useMaybeArtifactViewer();
  const icon =
    file.kind === "file"
      ? fileIcon(file.fileName ?? file.title, file.contentType ?? "")
      : (KIND_ICON[file.kind as ArtifactKind] ?? "file");
  const label = t("share.fileRef", { title: file.title });
  return (
    <a
      href={filePath(orgId, file.id, version)}
      className="channel-ref file-ref"
      aria-label={label}
      title={label}
      onClick={orgId === org.id && viewer ? (e) => inPlaceClick(e, () => viewer.open(file.id, version)) : undefined}
    >
      <Icon name={icon} />
      <span className="channel-ref__text">{file.title}</span>
    </a>
  );
}

/**
 * A file's link in a text (`parseFileLink`: the app's address, or the API's address of its bytes that a browser's
 * downloads keep), as its `FilePill`, never the raw address. One the reader can't open, deleted or out of reach, is the
 * same plain "Arquivo sem acesso", as the server keeps them one.
 */
export function FileRef({ link }: { link: FileLink }) {
  const { t } = useTranslation();
  const version = link.version ?? undefined;
  const query = useArtifact(link.orgId, link.artifactId, version);
  const a = query.data;
  if (query.isPending) {
    return (
      <span className="channel-ref file-ref" aria-busy="true">
        <Icon name="file" label={t("share.fileRefNone")} />
      </span>
    );
  }
  if (!a) {
    return (
      <span className="message-ref message-ref--none">
        <Icon name="lock" size={14} />
        {t("share.fileRefNone")}
      </span>
    );
  }
  const content = a.content.kind === "file" ? { fileName: a.content.name, contentType: a.content.contentType } : {};
  return (
    <FilePill orgId={link.orgId} file={{ id: a.id, title: a.title, kind: a.kind, ...content }} version={version} />
  );
}
