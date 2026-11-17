import type { PortalItem, PortalItemEdit } from "@agenteschat/client";
import { useEditPortalItem } from "@agenteschat/client";
import { portalErrorText } from "@agenteschat/client/lib/portal";
import { Button, Dialog, DialogBody, DialogFooter, Field, Input, Locked, Textarea } from "@agenteschat/ui";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { useOrg } from "@/components/org-context";
import { useToast } from "@/lib/toast";

/**
 * A post at the portal, completed or changed from here (ADR 9001): its title and caption. Only what changed is sent.
 * Its date isn't here: a post gets one only when a person schedules it (ADR 9001, addendum 2026-11-17).
 */
export function ItemDialog({ item, onClose }: { item: PortalItem | null; onClose: () => void }) {
  const { t } = useTranslation();
  return (
    <Dialog
      open={item !== null}
      onOpenChange={(o) => !o && onClose()}
      title={t("portal.post.editTitle")}
      closeLabel={t("common.close")}
      width={600}
    >
      {item && <ItemForm key={item.id} item={item} onClose={onClose} />}
    </Dialog>
  );
}

function ItemForm({ item, onClose }: { item: PortalItem; onClose: () => void }) {
  const { t, i18n } = useTranslation();
  const { org } = useOrg();
  const toast = useToast();
  const edit = useEditPortalItem(org.id);
  const [title, setTitle] = useState(item.title);
  const [caption, setCaption] = useState(item.caption);
  const [error, setError] = useState<string | null>(null);
  const changes: PortalItemEdit = {
    ...(title.trim() !== item.title ? { title: title.trim() } : {}),
    ...(caption !== item.caption ? { caption } : {}),
  };
  const ready = title.trim().length > 0 && Object.keys(changes).length > 0;
  const submit = () => {
    if (!ready) return;
    setError(null);
    edit.mutate(
      { client: item.client, itemId: item.id, edit: changes },
      {
        onSuccess: () => {
          toast.show(t("portal.post.saved"));
          onClose();
        },
        onError: (failure) => setError(portalErrorText(t, failure, i18n.language)),
      },
    );
  };
  return (
    <form
      className="portal-form"
      onSubmit={(e) => {
        e.preventDefault();
        submit();
      }}
    >
      <Locked when={edit.isPending}>
        <DialogBody>
          <Field label={t("portal.form.title")}>
            <Input value={title} maxLength={120} onChange={(e) => setTitle(e.target.value)} />
          </Field>
          <Field label={t("portal.form.caption")}>
            <Textarea value={caption} rows={4} maxLength={5000} onChange={(e) => setCaption(e.target.value)} />
          </Field>
          {/* The portal's own refusal, as it said it. */}
          {error && (
            <p className="ac-field__error" role="alert">
              {error}
            </p>
          )}
        </DialogBody>
      </Locked>
      <DialogFooter>
        <Button onClick={onClose}>{t("common.cancel")}</Button>
        <Button type="submit" variant="primary" disabled={!ready} loading={edit.isPending}>
          {t("common.save")}
        </Button>
      </DialogFooter>
    </form>
  );
}
