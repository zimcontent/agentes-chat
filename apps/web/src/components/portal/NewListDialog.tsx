import { type PortalListKind, usePortalLists } from "@dougbot/client";
import { portalErrorText } from "@dougbot/client/lib/portal";
import { Button, Dialog, DialogBody, DialogFooter, Field, Input } from "@dougbot/ui";
import { useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { useOrg } from "@/components/org-context";
import { useToast } from "@/lib/toast";

/**
 * "New list" from the page's head: a name, and the list is made at the head of the client's schedule (or of its
 * materials, `kind`), before every other (the team moves it from there); its cards are added in the list itself.
 * `onMade` once it exists.
 */
export function NewListDialog({
  open,
  client,
  kind = "plan",
  onClose,
  onMade,
}: {
  open: boolean;
  client: string;
  kind?: PortalListKind;
  onClose: () => void;
  onMade: () => void;
}) {
  const { t, i18n } = useTranslation();
  const { org } = useOrg();
  const toast = useToast();
  const lists = usePortalLists(org.id, client);
  const nameRef = useRef<HTMLInputElement>(null);
  const [name, setName] = useState("");
  const close = () => {
    if (lists.createFirst.isPending) return;
    setName("");
    onClose();
  };
  return (
    <Dialog
      open={open}
      onOpenChange={(o) => !o && close()}
      title={t("portal.plan.newList")}
      description={t(kind === "materials" ? "portal.materials.newListHint" : "portal.plan.newListHint")}
      closeLabel={t("common.close")}
      width={440}
      initialFocus={nameRef}
    >
      <form
        onSubmit={(e) => {
          e.preventDefault();
          if (!name.trim()) return;
          lists.createFirst.mutate(
            { name: name.trim(), kind },
            {
              onSuccess: () => {
                setName("");
                onMade();
              },
              onError: (error) => toast.show(portalErrorText(t, error, i18n.language), "error"),
            },
          );
        }}
      >
        <DialogBody>
          <Field label={t("portal.plan.listName")}>
            <Input ref={nameRef} value={name} maxLength={80} onChange={(e) => setName(e.target.value)} />
          </Field>
        </DialogBody>
        <DialogFooter>
          <Button disabled={lists.createFirst.isPending} onClick={close}>
            {t("common.cancel")}
          </Button>
          <Button type="submit" variant="primary" loading={lists.createFirst.isPending} disabled={!name.trim()}>
            {t("portal.plan.newList")}
          </Button>
        </DialogFooter>
      </form>
    </Dialog>
  );
}
