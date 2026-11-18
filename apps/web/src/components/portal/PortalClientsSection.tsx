import { type PortalClientAccount, type PortalClientColor, type PortalContact, useApi } from "@agenteschat/client";
import { can } from "@agenteschat/client/lib/permissions";
import { portalErrorText } from "@agenteschat/client/lib/portal";
import { Button, Card, Dialog, DialogFooter, Field, Input, SettingNote, SettingsSection } from "@agenteschat/ui";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { useOrg } from "@/components/org-context";
import { useToast } from "@/lib/toast";
import "@/pages/portal-clients.css";

/**
 * The clients of the installation's own approval portal (docs/adr/doug-0020-embedded-approval-portal.md), in Settings:
 * each client, its contacts (an e-mail, a WhatsApp number, or both) and the address of its own link, which opens its
 * page with no account. A person who may give agents work adds a client, edits its contacts, copies its link, makes a
 * new one (revoking the old), or removes the client. On a server whose portal is a bridge's the section isn't listed
 * (`approvalPortalEmbedded`).
 */
export function PortalClientsSection() {
  const { t, i18n } = useTranslation();
  const { org } = useOrg();
  const api = useApi();
  // This page exists only where the server has its own portal (`approvalPortalEmbedded`), so `portal` is here.
  const portal = api.portal as NonNullable<typeof api.portal>;
  const toast = useToast();
  const queryClient = useQueryClient();
  const key = ["portal-clients", org.id];
  const changes = can(org, "assign_work");
  const clients = useQuery({
    queryKey: key,
    queryFn: () => portal.clients(org.id),
  });
  const [editing, setEditing] = useState<PortalClientAccount | "new" | null>(null);
  const [removing, setRemoving] = useState<PortalClientAccount | null>(null);

  const invalidate = () => queryClient.invalidateQueries({ queryKey: key });
  const fail = (error: unknown) => toast.show(portalErrorText(t, error, i18n.language), "error");

  const save = useMutation({
    mutationFn: (input: { client: string; name: string; contacts: PortalContact[]; color: PortalClientColor | null }) =>
      portal.saveClient(org.id, input.client, {
        name: input.name,
        contacts: input.contacts,
        color: input.color,
      }),
    onSuccess: () => {
      setEditing(null);
      void invalidate();
    },
    onError: fail,
  });
  const remove = useMutation({
    mutationFn: (client: string) => portal.removeClient(org.id, client),
    onSuccess: () => {
      setRemoving(null);
      void invalidate();
    },
    onError: fail,
  });
  const newLink = useMutation({
    mutationFn: (client: string) => portal.newClientLink(org.id, client),
    onSuccess: () => void invalidate(),
    onError: fail,
  });
  const revoke = useMutation({
    mutationFn: (client: string) => portal.revokeClientLink(org.id, client),
    onSuccess: () => void invalidate(),
    onError: fail,
  });

  const copy = (link: string) => {
    void navigator.clipboard?.writeText(link).then(
      () => toast.show(t("portalClients.copied")),
      () => toast.show(t("portalClients.copyFailed"), "error"),
    );
  };

  const list = clients.data ?? [];

  return (
    <div className="ac-groups portal-clients">
      <div className="portal-clients__bar">
        <Button icon="plus" onClick={() => setEditing("new")} disabled={!changes}>
          {t("portalClients.add")}
        </Button>
      </div>
      <SettingsSection title={t("portalClients.title")} description={t("portalClients.lead")}>
        {clients.isLoading ? (
          <p className="portal-clients__quiet">{t("portalClients.loading")}</p>
        ) : list.length === 0 ? (
          <SettingNote icon="info">{t("portalClients.empty")}</SettingNote>
        ) : (
          <div className="portal-clients__list">
            {list.map((client) => (
              <Card key={client.id} className="portal-clients__client">
                <div className="portal-clients__head">
                  <div className="portal-clients__who">
                    <p className="portal-clients__name">{client.name}</p>
                    <p className="portal-clients__id">{client.client}</p>
                  </div>
                  {changes && (
                    <div className="portal-clients__acts">
                      <Button variant="link" onClick={() => setEditing(client)}>
                        {t("portalClients.edit")}
                      </Button>
                      <Button variant="link" onClick={() => setRemoving(client)}>
                        {t("portalClients.remove")}
                      </Button>
                    </div>
                  )}
                </div>
                {client.contacts.length > 0 ? (
                  <ul className="portal-clients__contacts">
                    {client.contacts.map((p) => (
                      <li key={p.id} className="portal-clients__contact">
                        <span className="portal-clients__contact-name">{p.name}</span>
                        <span className="portal-clients__contact-way">
                          {[p.email, p.whatsapp ? `+${p.whatsapp}` : null].filter(Boolean).join(" · ")}
                        </span>
                      </li>
                    ))}
                  </ul>
                ) : (
                  <p className="portal-clients__quiet">{t("portalClients.noContacts")}</p>
                )}
                <div className="portal-clients__link">
                  {client.link ? (
                    <>
                      <input
                        className="portal-clients__link-input"
                        readOnly
                        value={client.link}
                        aria-label={t("portalClients.link")}
                        onFocus={(e) => e.currentTarget.select()}
                      />
                      <Button size="sm" icon="copy" onClick={() => copy(client.link as string)}>
                        {t("portalClients.copy")}
                      </Button>
                    </>
                  ) : (
                    <span className="portal-clients__quiet">{t("portalClients.revoked")}</span>
                  )}
                  {changes && (
                    <>
                      <Button
                        size="sm"
                        variant="ghost"
                        loading={newLink.isPending}
                        onClick={() => newLink.mutate(client.client)}
                      >
                        {t("portalClients.newLink")}
                      </Button>
                      {client.link && (
                        <Button
                          size="sm"
                          variant="ghost"
                          loading={revoke.isPending}
                          onClick={() => revoke.mutate(client.client)}
                        >
                          {t("portalClients.revoke")}
                        </Button>
                      )}
                    </>
                  )}
                </div>
              </Card>
            ))}
          </div>
        )}
      </SettingsSection>
      {editing && (
        <ClientEditorDialog
          key={editing === "new" ? "new" : editing.id}
          client={editing === "new" ? null : editing}
          saving={save.isPending}
          onSave={(input) => save.mutate(input)}
          onClose={() => setEditing(null)}
        />
      )}
      <Dialog
        open={removing !== null}
        onOpenChange={(o) => !o && !remove.isPending && setRemoving(null)}
        title={t("portalClients.removeTitle")}
        description={t("portalClients.removeText")}
        closeLabel={t("common.close")}
        width={440}
      >
        <DialogFooter>
          <Button disabled={remove.isPending} onClick={() => setRemoving(null)}>
            {t("common.cancel")}
          </Button>
          <Button
            variant="danger"
            loading={remove.isPending}
            onClick={() => removing && remove.mutate(removing.client)}
          >
            {t("portalClients.remove")}
          </Button>
        </DialogFooter>
      </Dialog>
    </div>
  );
}

type Working = { id: string; name: string; email: string; whatsapp: string };

/** A client's editor: its name, its contacts, its colour. */
function ClientEditorDialog({
  client,
  saving,
  onSave,
  onClose,
}: {
  client: PortalClientAccount | null;
  saving: boolean;
  onSave: (input: { client: string; name: string; contacts: PortalContact[]; color: PortalClientColor | null }) => void;
  onClose: () => void;
}) {
  const { t } = useTranslation();
  const [name, setName] = useState(client?.name ?? "");
  const [id, setId] = useState(client?.client ?? "");
  const color: PortalClientColor | null = client?.color ?? null;
  const [contacts, setContacts] = useState<Working[]>(
    (client?.contacts ?? []).map((p) => ({
      id: p.id,
      name: p.name,
      email: p.email ?? "",
      whatsapp: p.whatsapp ?? "",
    })),
  );
  const setContact = (index: number, patch: Partial<Working>) =>
    setContacts((list) => list.map((c, i) => (i === index ? { ...c, ...patch } : c)));
  const add = () =>
    setContacts((list) => (list.length >= 10 ? list : [...list, { id: "", name: "", email: "", whatsapp: "" }]));
  const drop = (index: number) => setContacts((list) => list.filter((_, i) => i !== index));
  const submit = () => {
    if (!name.trim()) return;
    onSave({
      client: client?.client ?? (id.trim() || name.trim()),
      name: name.trim(),
      contacts: contacts
        .filter((c) => c.name.trim())
        .map((c) => ({
          id: c.id || undefined,
          name: c.name.trim(),
          email: c.email.trim() || null,
          whatsapp: c.whatsapp.trim() || null,
        })) as unknown as PortalContact[],
      color,
    });
  };
  return (
    <Dialog
      open
      onOpenChange={(o) => !o && !saving && onClose()}
      title={client ? t("portalClients.editTitle") : t("portalClients.addTitle")}
      closeLabel={t("common.close")}
      width={480}
    >
      <div className="portal-clients__fields">
        {!client && (
          <Field label={t("portalClients.id")}>
            <Input value={id} onChange={(e) => setId(e.target.value)} />
          </Field>
        )}
        <Field label={t("portalClients.name")}>
          <Input value={name} onChange={(e) => setName(e.target.value)} autoFocus />
        </Field>
      </div>
      <div className="portal-clients__contacts-edit">
        {contacts.map((c, i) => (
          <div key={c.id || `new-${i}`} className="portal-clients__contact-edit">
            <Input
              value={c.name}
              placeholder={t("portalClients.contactName")}
              aria-label={t("portalClients.contactName")}
              onChange={(e) => setContact(i, { name: e.target.value })}
            />
            <Input
              value={c.email}
              placeholder={t("portalClients.email")}
              aria-label={t("portalClients.email")}
              onChange={(e) => setContact(i, { email: e.target.value })}
            />
            <Input
              value={c.whatsapp}
              placeholder={t("portalClients.whatsapp")}
              aria-label={t("portalClients.whatsapp")}
              onChange={(e) => setContact(i, { whatsapp: e.target.value })}
            />
            <Button
              variant="ghost"
              iconOnly
              icon="close"
              aria-label={t("portalClients.dropContact")}
              onClick={() => drop(i)}
            />
          </div>
        ))}
        {contacts.length < 10 && (
          <Button variant="link" icon="plus" onClick={add}>
            {t("portalClients.addContact")}
          </Button>
        )}
      </div>
      <DialogFooter>
        <Button variant="ghost" onClick={onClose} disabled={saving}>
          {t("common.cancel")}
        </Button>
        <Button variant="primary" loading={saving} onClick={submit} disabled={!name.trim()}>
          {t("common.save")}
        </Button>
      </DialogFooter>
    </Dialog>
  );
}
