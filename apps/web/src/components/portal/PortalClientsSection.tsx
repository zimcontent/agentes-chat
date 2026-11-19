import { type PortalClientAccount, type PortalClientColor, type PortalContact, useApi } from "@dougbot/client";
import { can } from "@dougbot/client/lib/permissions";
import { portalErrorText } from "@dougbot/client/lib/portal";
import { readyLocales } from "@dougbot/i18n/locale";
import { Button, Card, Dialog, DialogFooter, Field, Input, Select, SettingNote, SettingsSection } from "@dougbot/ui";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { useOrg } from "@/components/org-context";
import { useToast } from "@/lib/toast";
import "@/pages/portal-clients.css";

/** A language's own name, as its registry says it (`Deutsch`, `Português (Brasil)`); the code itself when unknown. */
function languageName(code: string | null, fallback: string): string {
  if (!code) return fallback;
  return readyLocales().find((l) => l.code === code)?.native ?? code;
}

/**
 * The clients of the installation's own approval portal (docs/adr/doug-0031-embedded-approval-portal.md), in Settings:
 * each client, its contacts (an e-mail, a WhatsApp number, or both) and the address of its own link, which opens its
 * page with no account. A person who may give agents work adds a client, edits its contacts, copies its link, makes a
 * new one (revoking the old), or removes the client. On a server whose portal is a bridge's the section isn't listed
 * (`approvalPortalEmbedded`).
 */
export function PortalClientsSection() {
  const { t, i18n } = useTranslation();
  const { org } = useOrg();
  const api = useApi();
  // A client with no language of its own is told in the workspace owner's: the member reading this is told in their
  // own, which is what the select's "the team's language" says.
  const ownerLocale = i18n.language;
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
  // The clients' links come from the same answer, by the client's id, and only for who may manage the portal.
  const links = clients.data?.links ?? {};
  // The editor works with the list's rows (no `link`: that one comes from `links`, by the client's id).
  const [editing, setEditing] = useState<ClientRow | "new" | null>(null);
  const [removing, setRemoving] = useState<ClientRow | null>(null);

  const invalidate = () => queryClient.invalidateQueries({ queryKey: key });
  const fail = (error: unknown) => toast.show(portalErrorText(t, error, i18n.language), "error");

  // Which of the workspace's numbers tells the portal's clients why they're being written to, if the workspace chose one.
  const noticesKey = ["portal-notices", org.id];
  const notices = useQuery({
    queryKey: noticesKey,
    queryFn: () => portal.noticeSettings(org.id),
  });
  const setNumber = useMutation({
    mutationFn: (number: string | null) => portal.setNoticeNumber(org.id, number),
    onSuccess: () => void queryClient.invalidateQueries({ queryKey: noticesKey }),
    onError: fail,
  });

  const save = useMutation({
    mutationFn: (input: {
      client: string;
      name: string;
      contacts: PortalContact[];
      color: PortalClientColor | null;
      locale: string | null;
    }) =>
      portal.saveClient(org.id, input.client, {
        name: input.name,
        contacts: input.contacts,
        color: input.color,
        locale: input.locale,
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

  const list = clients.data?.clients ?? [];

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
                {/* The language its notices are written in (ADR doug-0031 §8): its own, or the team's. */}
                <p className="portal-clients__quiet">
                  {t("portalClients.locale", {
                    language: languageName(client.locale || ownerLocale, i18n.language),
                  })}
                </p>
                <div className="portal-clients__link">
                  {links[client.client] ? (
                    <>
                      <input
                        className="portal-clients__link-input"
                        readOnly
                        value={links[client.client]}
                        aria-label={t("portalClients.link")}
                        onFocus={(e) => e.currentTarget.select()}
                      />
                      <Button size="sm" icon="copy" onClick={() => copy(links[client.client] as string)}>
                        {t("portalClients.copy")}
                      </Button>
                    </>
                  ) : (
                    <span className="portal-clients__quiet">
                      {client.linkStale ? t("portalClients.linkStale") : t("portalClients.revoked")}
                    </span>
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
                      {links[client.client] && (
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
      {/* Which number tells the clients (ADR doug-0031 §7): e-mail always goes; WhatsApp only from a number the
          workspace picks here. With none, a client is never texted from a number nobody chose. */}
      <SettingsSection title={t("portalClients.noticesTitle")} description={t("portalClients.noticesLead")}>
        <Field label={t("portalClients.noticesNumber")}>
          <Select
            value={notices.data?.number ?? "none"}
            onValueChange={(value) => setNumber.mutate(value === "none" ? null : value)}
            disabled={!changes || setNumber.isPending || (notices.data?.numbers.length ?? 0) === 0}
            options={[
              { value: "none", label: t("portalClients.noticesNone") },
              ...(notices.data?.numbers ?? []).map((n) => ({
                value: n.id,
                label: n.phone ? `${n.label} · +${n.phone}` : n.label,
              })),
            ]}
          />
        </Field>
        {(notices.data?.numbers.length ?? 0) === 0 && (
          <SettingNote icon="info">{t("portalClients.noticesNoNumbers")}</SettingNote>
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

/** A client as the list reads it: its link is in `links`, never on the row. */
type ClientRow = Omit<PortalClientAccount, "link">;

type Working = { id: string; name: string; email: string; whatsapp: string };

/** A client's editor: its name, its contacts, its colour. */
function ClientEditorDialog({
  client,
  saving,
  onSave,
  onClose,
}: {
  client: ClientRow | null;
  saving: boolean;
  onSave: (input: {
    client: string;
    name: string;
    contacts: PortalContact[];
    color: PortalClientColor | null;
    locale: string | null;
  }) => void;
  onClose: () => void;
}) {
  const { t } = useTranslation();
  const [locale, setLocale] = useState<string>(client?.locale ?? "");
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
      // Empty is the workspace owner's own language, sent as none.
      locale: locale || null,
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
        <Field
          label={t("portalClients.localeLabel")}
          hint={{ name: t("portalClients.localeLabel"), text: t("portalClients.localeHint") }}
        >
          <Select
            value={locale || "none"}
            onValueChange={(value) => setLocale(value === "none" ? "" : value)}
            options={[
              { value: "none", label: t("portalClients.localeOwner") },
              ...readyLocales().map((l) => ({ value: l.code, label: l.native })),
            ]}
          />
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
