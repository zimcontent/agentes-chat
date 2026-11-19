import { useRemoveAgentPhoto, useSetAgentPhoto } from "@dougbot/client";
import { Button } from "@dougbot/ui";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { AgentAvatar } from "@/components/AgentAvatar";
import { useOrg } from "@/components/org-context";
import { ImageCropDialog } from "@/components/ProfilePhoto";
import { useToast } from "@/lib/toast";

/** The cropped square (base64) as the file the photo endpoint takes (multipart, its `file` field). */
export function blobOf(image: CroppedPhoto): Blob {
  const bytes = Uint8Array.from(atob(image.imageBase64.replace(/^data:[^;]+;base64,/, "")), (c) => c.charCodeAt(0));
  return new Blob([bytes], { type: image.contentType });
}

/** A square cut by `ImageCropDialog`, before it is sent. */
export type CroppedPhoto = { imageBase64: string; contentType: string };

/** The photo endpoint's form: the image in `file`. */
export function photoForm(image: CroppedPhoto): FormData {
  const form = new FormData();
  form.append("file", blobOf(image), "photo");
  return form;
}

/** A cropped square as an address an `<img>` shows (the preview before the agent exists). */
export const photoUrlOf = (image: CroppedPhoto) =>
  image.imageBase64.startsWith("data:") ? image.imageBase64 : `data:${image.contentType};base64,${image.imageBase64}`;

/**
 * "Foto": an agent's real photo in place of its drawn bot (cut to the bot's shape, its state still shown), or back to
 * the DougBot avatar. A row (IDENTIDADE.md §6): the preview, then the two buttons.
 */
export function AgentPhotoBlock({
  agent,
  canEdit,
}: {
  agent: { id: string; name: string; photo?: string | null };
  canEdit: boolean;
}) {
  const { t } = useTranslation();
  const { org } = useOrg();
  const toast = useToast();
  const [open, setOpen] = useState(false);
  const send = useSetAgentPhoto(org.id, agent.id);
  const remove = useRemoveAgentPhoto(org.id, agent.id);
  return (
    <div className="agent-photo">
      <AgentAvatar agentId={agent.id} name={agent.name} size="lg" className="agent-photo__face" />
      <div className="agent-photo__text">
        <span className="agent-photo__title">{t("photo.agent.title")}</span>
        <span className="agent-photo__help">{t("photo.agent.help")}</span>
      </div>
      {canEdit && (
        <div className="agent-photo__acts">
          <Button size="sm" icon="image" onClick={() => setOpen(true)}>
            {t("photo.agent.send")}
          </Button>
          <Button
            size="sm"
            variant="ghost"
            disabled={!agent.photo || remove.isPending}
            loading={remove.isPending}
            onClick={() => remove.mutate(undefined, { onSuccess: () => toast.show(t("photo.agent.removed")) })}
          >
            {t("photo.agent.useBot")}
          </Button>
        </div>
      )}
      <ImageCropDialog
        open={open}
        onClose={() => setOpen(false)}
        title={t("photo.agent.dialogTitle")}
        help={t("photo.help")}
        placeholder={<AgentAvatar agentId={agent.id} name={agent.name} size="lg" />}
        hasImage={Boolean(agent.photo)}
        removeLabel={t("photo.agent.useBot")}
        save={(image) => send.mutateAsync(photoForm(image))}
        remove={() => remove.mutateAsync()}
        onSaved={() => toast.show(t("photo.agent.saved"))}
        onRemoved={() => toast.show(t("photo.agent.removed"))}
      />
    </div>
  );
}
