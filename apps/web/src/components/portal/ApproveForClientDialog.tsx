import type { PortalItem } from "@dougbot/client";
import { useApproveForClient } from "@dougbot/client";
import { portalErrorText } from "@dougbot/client/lib/portal";
import { Button, Dialog, DialogBody, DialogFooter, Field, Locked, Textarea } from "@dougbot/ui";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { useOrg } from "@/components/org-context";
import { useToast } from "@/lib/toast";

/** The reason a team approval keeps at most (the server's `TEAM_APPROVAL_NOTE`). */
const NOTE_MAX = 500;

/**
 * "Approve for the client" (ADR 9001 §19): an administrator's way out when the client stopped answering at the
 * portal. The post turns Approved there as if the client had approved it; the reason is optional and goes on the
 * card's comments and in the audit log. The portal's refusal shows here in its own words.
 */
export function ApproveForClientDialog({ item, onClose }: { item: PortalItem | null; onClose: () => void }) {
  const { t } = useTranslation();
  return (
    <Dialog
      open={item !== null}
      onOpenChange={(o) => !o && onClose()}
      title={t("portal.approveForClient.title")}
      description={t("portal.approveForClient.text")}
      closeLabel={t("common.close")}
      width={440}
    >
      {item && <ApproveForm key={item.id} item={item} onClose={onClose} />}
    </Dialog>
  );
}

function ApproveForm({ item, onClose }: { item: PortalItem; onClose: () => void }) {
  const { t, i18n } = useTranslation();
  const { org } = useOrg();
  const toast = useToast();
  const approve = useApproveForClient(org.id);
  const [note, setNote] = useState("");
  const [error, setError] = useState<string | null>(null);
  const submit = () => {
    setError(null);
    approve.mutate(
      { client: item.client, itemId: item.id, note: note.trim() || undefined },
      {
        onSuccess: () => {
          toast.show(t("portal.approveForClient.done", { title: item.title }));
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
      <Locked when={approve.isPending}>
        <DialogBody>
          <Field label={t("portal.approveForClient.note")}>
            <Textarea
              value={note}
              rows={3}
              maxLength={NOTE_MAX}
              placeholder={t("portal.approveForClient.notePlaceholder")}
              onChange={(e) => setNote(e.target.value)}
            />
          </Field>
          {error && (
            <p className="ac-field__error" role="alert">
              {error}
            </p>
          )}
        </DialogBody>
      </Locked>
      <DialogFooter>
        <Button onClick={onClose}>{t("common.cancel")}</Button>
        <Button type="submit" variant="primary" icon="check" loading={approve.isPending}>
          {t("portal.approveForClient.confirm")}
        </Button>
      </DialogFooter>
    </form>
  );
}
