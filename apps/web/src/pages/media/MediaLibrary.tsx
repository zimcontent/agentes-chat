import { type MediaGenerationView, type MediaRefKind, useMediaGenerations } from "@dougbot/client";
import { Dialog, DialogBody, EmptyState, Icon } from "@dougbot/ui";
import { useTranslation } from "react-i18next";
import { useApi } from "@/api/context";
import { ErrorState, LoadingCards } from "@/components/Loading";
import { useOrg } from "@/components/org-context";

/**
 * The library (ADR doug-0011): what the workspace already generated, to use as a frame or a reference without
 * downloading it and sending it up again (the Zim Studio's "Biblioteca"). Only the kinds the slot takes show; the
 * server reads the Drive file as the person and hands it to the service (`POST …/media/refs/drive`).
 */
export function MediaLibrary({
  open,
  onOpenChange,
  kinds,
  onPick,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  kinds: MediaRefKind[];
  onPick: (generation: MediaGenerationView & { artifactId: string }) => void;
}) {
  const { t } = useTranslation();
  const { org } = useOrg();
  const api = useApi();
  const list = useMediaGenerations(org.id, false);
  const items = (list.data ?? []).filter(
    (g): g is MediaGenerationView & { artifactId: string } =>
      g.status === "succeeded" && g.artifactId !== null && kinds.includes(g.kind),
  );
  return (
    <Dialog
      open={open}
      onOpenChange={onOpenChange}
      title={t("mediaGen.library")}
      description={t("mediaGen.libraryText")}
      closeLabel={t("common.close")}
    >
      <DialogBody>
        {list.isLoading && <LoadingCards count={2} />}
        {list.isError && <ErrorState error={list.error} onRetry={() => void list.refetch()} />}
        {list.data && items.length === 0 && (
          <EmptyState title={t("mediaGen.libraryEmpty.title")}>{t("mediaGen.libraryEmpty.text")}</EmptyState>
        )}
        {items.length > 0 && (
          <ul className="media-library">
            {items.map((g) => {
              const url = api.artifacts.fileUrl(org.id, g.artifactId);
              return (
                <li key={g.id}>
                  <button
                    type="button"
                    className="media-library__item"
                    aria-label={t("mediaGen.libraryUse", { name: g.prompt })}
                    onClick={() => {
                      onPick(g);
                      onOpenChange(false);
                    }}
                  >
                    {g.kind === "image" ? (
                      <img src={url} alt="" loading="lazy" />
                    ) : (
                      <video src={`${url}#t=0.1`} muted playsInline preload="metadata" tabIndex={-1} />
                    )}
                    {g.kind === "video" && (
                      <span className="media-library__mark" aria-hidden="true">
                        <Icon name="video" size={16} />
                      </span>
                    )}
                  </button>
                </li>
              );
            })}
          </ul>
        )}
      </DialogBody>
    </Dialog>
  );
}
