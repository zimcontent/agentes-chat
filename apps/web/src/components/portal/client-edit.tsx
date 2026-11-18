import { useSetPortalClientHidden, useSetPortalClientName } from "@agenteschat/client";
import { portalClientName, portalClientSlugName, portalErrorText } from "@agenteschat/client/lib/portal";
import { Button, Dialog, DialogBody, DialogFooter, Field, GroupHeading, Input } from "@agenteschat/ui";
import { useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { useOrg } from "@/components/org-context";
import { useToast } from "@/lib/toast";

/** The longest name the team may give a client (`PORTAL_CLIENT_NAME_MAX` on the server). */
const NAME_MAX = 60;

/**
 * "Rename client" (ADR 9001, addendum 2026-11-18): the name the team shows for a client, kept on this side since the
 * portal has no rename. Empty goes back to the name its id reads as.
 */
export function RenameClientDialog({ open, client, onClose }: { open: boolean; client: string; onClose: () => void }) {
  const { t, i18n } = useTranslation();
  const { org } = useOrg();
  const toast = useToast();
  const rename = useSetPortalClientName(org.id);
  const field = useRef<HTMLInputElement>(null);
  const [name, setName] = useState(() => portalClientName(client));
  const close = () => {
    if (rename.isPending) return;
    onClose();
  };
  return (
    <Dialog
      open={open}
      onOpenChange={(o) => !o && close()}
      title={t("portal.clientEdit.renameTitle")}
      description={t("portal.clientEdit.renameHelp", { id: portalClientSlugName(client) })}
      closeLabel={t("common.close")}
      width={440}
      initialFocus={field}
    >
      <form
        onSubmit={(e) => {
          e.preventDefault();
          const typed = name.trim();
          rename.mutate(
            // The id's own reading is no name of the team's.
            { client, name: typed && typed !== portalClientSlugName(client) ? typed : null },
            {
              onSuccess: () => {
                toast.show(t("portal.clientEdit.renamed"));
                onClose();
              },
              onError: (error) => toast.show(portalErrorText(t, error, i18n.language), "error"),
            },
          );
        }}
      >
        <DialogBody>
          <Field label={t("portal.clientEdit.name")}>
            <Input ref={field} value={name} maxLength={NAME_MAX} onChange={(e) => setName(e.target.value)} />
          </Field>
        </DialogBody>
        <DialogFooter>
          <Button disabled={rename.isPending} onClick={close}>
            {t("common.cancel")}
          </Button>
          <Button type="submit" variant="primary" loading={rename.isPending}>
            {t("common.save")}
          </Button>
        </DialogFooter>
      </form>
    </Dialog>
  );
}

/**
 * "Remove client": the portal can't delete one, so the client is hidden from every list and count of the apps.
 * Asked first, naming the client and saying what stays; shown again from the overview's "Hidden clients".
 */
export function HideClientDialog({
  open,
  client,
  onClose,
  onHidden,
}: {
  open: boolean;
  client: string;
  onClose: () => void;
  onHidden: () => void;
}) {
  const { t, i18n } = useTranslation();
  const { org } = useOrg();
  const toast = useToast();
  const hide = useSetPortalClientHidden(org.id);
  const name = portalClientName(client);
  const close = () => {
    if (hide.isPending) return;
    onClose();
  };
  return (
    <Dialog
      open={open}
      onOpenChange={(o) => !o && close()}
      title={t("portal.clientEdit.hideTitle", { name })}
      description={t("portal.clientEdit.hideText")}
      closeLabel={t("common.close")}
      width={440}
    >
      <DialogFooter>
        <Button disabled={hide.isPending} onClick={close}>
          {t("common.cancel")}
        </Button>
        <Button
          variant="danger"
          loading={hide.isPending}
          onClick={() =>
            hide.mutate(
              { client, hidden: true },
              {
                onSuccess: () => {
                  toast.show(t("portal.clientEdit.hidden", { name }));
                  onHidden();
                },
                onError: (error) => toast.show(portalErrorText(t, error, i18n.language), "error"),
              },
            )
          }
        >
          {t("portal.clientEdit.hide")}
        </Button>
      </DialogFooter>
    </Dialog>
  );
}

/** The clients the team hid, at the overview's foot, each with "Show again". Only for who may change the portal. */
export function HiddenClients({ hidden }: { hidden: readonly { client: string }[] }) {
  const { t, i18n } = useTranslation();
  const { org } = useOrg();
  const toast = useToast();
  const show = useSetPortalClientHidden(org.id);
  if (hidden.length === 0) return null;
  return (
    <section className="portal-home__part" aria-label={t("portal.clientEdit.hiddenTitle")}>
      <GroupHeading title={t("portal.clientEdit.hiddenTitle")} count={hidden.length} />
      <ul className="portal-hidden">
        {hidden.map(({ client }) => (
          <li key={client} className="portal-hidden__row">
            <span className="portal-hidden__name">{portalClientName(client)}</span>
            <Button
              size="sm"
              icon="eye"
              loading={show.isPending && show.variables?.client === client}
              onClick={() =>
                show.mutate(
                  { client, hidden: false },
                  { onError: (error) => toast.show(portalErrorText(t, error, i18n.language), "error") },
                )
              }
            >
              {t("portal.clientEdit.show")}
            </Button>
          </li>
        ))}
      </ul>
    </section>
  );
}
