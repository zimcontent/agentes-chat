import {
  ApiError,
  useAgents,
  useConnectWhatsApp,
  useReconnectWhatsApp,
  useRemoveWhatsApp,
  useSendWhatsApp,
  useUpdateWhatsApp,
  useWhatsApp,
  type WhatsAppAccount,
} from "@agenteschat/client";

import { errorText } from "@agenteschat/client/lib/errors";
import {
  AccessDialog,
  type AccessSubject,
  Avatar,
  Button,
  Dialog,
  DialogBody,
  DialogFooter,
  Field,
  FormStack,
  Input,
  Select,
  Spinner,
  Textarea,
} from "@agenteschat/ui";
import { type FormEvent, useState } from "react";
import { useTranslation } from "react-i18next";
import { useOrg } from "@/components/org-context";
import { useDirectory } from "@/hooks/useDirectory";
import { useToast } from "@/lib/toast";
import { useWords, type WhatsAppWords } from "./words";

/** What to say of a failed call: our own words when the gateway is what refused, the app's for anything else. */
export function useWhatsAppError() {
  const { t } = useTranslation();
  const w = useWords();
  return (error: unknown) =>
    error instanceof ApiError && error.code === "whatsapp.unavailable" ? w.errors.unavailable : errorText(t, error);
}

/** The number's QR code and the three steps on the phone, or what stands in for the code while there is none. */
function QrPanel({ account, w }: { account: WhatsAppAccount; w: WhatsAppWords }) {
  const reconnect = useReconnectWhatsApp(useOrg().org.id);
  const say = useWhatsAppError();
  const toast = useToast();
  if (account.status === "connected") {
    return (
      <div className="wa-qr wa-qr--done" role="status">
        <strong>{w.connectDialog.done}</strong>
        <span>{w.connectDialog.doneText}</span>
      </div>
    );
  }
  // Out for good, or a code nobody read in time: only asking again brings a new one.
  const stale = account.status === "logged_out" || account.status === "disconnected";
  return (
    <div className="wa-qr">
      <div className="wa-qr__code">
        {account.qr ? (
          <img src={account.qr} alt={w.connectDialog.qrLabel} width={224} height={224} />
        ) : stale ? (
          <Button
            variant="default"
            icon="refresh"
            loading={reconnect.isPending}
            onClick={() => reconnect.mutate(account.id, { onError: (e) => toast.show(say(e), "error") })}
          >
            {w.connectDialog.newCode}
          </Button>
        ) : (
          <span className="wa-qr__wait" role="status">
            <Spinner />
            {w.connectDialog.waiting}
          </span>
        )}
      </div>
      <ol className="wa-qr__steps">
        <li>{w.connectDialog.step1}</li>
        <li>{w.connectDialog.step2}</li>
        <li>{w.connectDialog.step3}</li>
      </ol>
    </div>
  );
}

/**
 * Connecting a number: its name, then its QR code, which follows the number's state by itself (the list refetches
 * while a code is waited for). `accountId`: a number made before, whose code is shown at once.
 */
export function ConnectDialog({ accountId, onClose }: { accountId?: string; onClose: (connectedId?: string) => void }) {
  const w = useWords();
  const { org } = useOrg();
  const [madeId, setMadeId] = useState(accountId);
  const [label, setLabel] = useState("");
  const connect = useConnectWhatsApp(org.id);
  const say = useWhatsAppError();
  const overview = useWhatsApp(org.id);
  const account = overview.data?.accounts.find((a) => a.id === madeId);
  const submit = (event: FormEvent) => {
    event.preventDefault();
    if (!label.trim() || connect.isPending) return;
    connect.mutate(label, { onSuccess: (made) => setMadeId(made.id) });
  };
  const close = () => onClose(account?.status === "connected" ? account.id : madeId);
  return (
    <Dialog
      open
      onOpenChange={(open) => !open && close()}
      title={madeId ? w.connectDialog.qrTitle : w.connectDialog.title}
      closeLabel={w.connectDialog.close}
      width={440}
    >
      {madeId ? (
        <>
          <DialogBody>{account ? <QrPanel account={account} w={w} /> : <Spinner />}</DialogBody>
          <DialogFooter note={account?.status === "connected" ? undefined : w.connectDialog.banNote}>
            <Button variant={account?.status === "connected" ? "primary" : "default"} onClick={close}>
              {w.connectDialog.close}
            </Button>
          </DialogFooter>
        </>
      ) : (
        <form onSubmit={submit}>
          <DialogBody>
            <FormStack>
              <Field
                label={w.connectDialog.name}
                example={w.connectDialog.nameExample}
                error={connect.isError ? say(connect.error) : undefined}
              >
                <Input value={label} onChange={(e) => setLabel(e.target.value)} maxLength={40} autoFocus />
              </Field>
            </FormStack>
          </DialogBody>
          <DialogFooter>
            <Button type="button" variant="default" onClick={() => onClose()}>
              {w.connectDialog.cancel}
            </Button>
            <Button type="submit" variant="primary" loading={connect.isPending} disabled={!label.trim()}>
              {w.connectDialog.start}
            </Button>
          </DialogFooter>
        </form>
      )}
    </Dialog>
  );
}

/** A number's name, its people, the agent in charge, and removing it. */
export function NumberDialog({ account, onClose }: { account: WhatsAppAccount; onClose: () => void }) {
  const w = useWords();
  const { t } = useTranslation();
  const { org } = useOrg();
  const dir = useDirectory(org.id);
  const agents = useAgents(org.id);
  const update = useUpdateWhatsApp(org.id);
  const remove = useRemoveWhatsApp(org.id);
  const toast = useToast();
  const say = useWhatsAppError();
  const [label, setLabel] = useState(account.label);
  const [people, setPeople] = useState(account.people);
  const [agentId, setAgentId] = useState(account.agentId ?? "none");
  const [step, setStep] = useState<"form" | "people" | "remove">("form");
  const names = people.map((id) => dir.memberById.get(id)?.name).filter((name): name is string => Boolean(name));

  const save = () =>
    update.mutate(
      { accountId: account.id, label, people, agentId: agentId === "none" ? null : agentId },
      {
        onSuccess: () => {
          toast.show(w.settings.saved);
          onClose();
        },
        onError: (e) => toast.show(say(e), "error"),
      },
    );

  if (step === "people") {
    const subjects: AccessSubject[] = dir.members.map((m) => ({
      id: m.userId,
      name: m.name,
      detail: m.email,
      lead: <Avatar name={m.name} imageUrl={m.avatarUrl ?? m.image} size="sm" />,
    }));
    const use = { value: "use" as const, label: w.access.level };
    return (
      <AccessDialog<"use">
        title={w.access.title}
        description={w.access.text}
        base={[]}
        subjects={subjects}
        levelOf={(s) => (people.includes(s.id) ? "use" : undefined)}
        levelsFor={() => [use]}
        onLevelChange={(s, level) =>
          setPeople((list) => (level ? [...new Set([...list, s.id])] : list.filter((id) => id !== s.id)))
        }
        labels={{
          add: w.access.add,
          addList: w.access.addList,
          addSearch: w.access.addSearch,
          noResults: w.access.noResults,
          removeOf: w.access.removeOf,
          levelOf: w.access.levelOf,
          close: w.connectDialog.close,
          cancel: w.connectDialog.cancel,
          save: t("common.save"),
        }}
        onSave={() => setStep("form")}
        onClose={() => setStep("form")}
      />
    );
  }

  if (step === "remove") {
    return (
      <Dialog
        open
        onOpenChange={(open) => !open && setStep("form")}
        title={w.settings.removeTitle}
        description={w.settings.removeText}
        closeLabel={w.connectDialog.close}
        width={440}
      >
        <DialogFooter>
          <Button variant="default" onClick={() => setStep("form")}>
            {w.connectDialog.cancel}
          </Button>
          <Button
            variant="danger"
            loading={remove.isPending}
            onClick={() =>
              remove.mutate(account.id, {
                onSuccess: () => {
                  toast.show(w.settings.removed);
                  onClose();
                },
                onError: (e) => toast.show(say(e), "error"),
              })
            }
          >
            {w.settings.removeConfirm}
          </Button>
        </DialogFooter>
      </Dialog>
    );
  }

  return (
    <Dialog
      open
      onOpenChange={(open) => !open && onClose()}
      title={w.settings.title}
      closeLabel={w.connectDialog.close}
      width={440}
    >
      <DialogBody>
        <FormStack>
          <Field label={w.settings.name}>
            <Input value={label} onChange={(e) => setLabel(e.target.value)} maxLength={40} />
          </Field>
          <Field
            label={w.settings.people}
            labelAside={
              <Button variant="link" onClick={() => setStep("people")}>
                {w.settings.peopleEdit}
              </Button>
            }
          >
            <p className="wa-people">{names.length > 0 ? names.join(", ") : w.settings.peopleNone}</p>
          </Field>
          <Field label={w.settings.agent} hint={{ name: w.settings.agent, text: w.settings.agentHint }}>
            <Select
              value={agentId}
              onValueChange={setAgentId}
              options={[
                { value: "none", label: w.settings.agentNone },
                ...(agents.data ?? []).map((a) => ({ value: a.id, label: a.name })),
              ]}
            />
          </Field>
        </FormStack>
      </DialogBody>
      <DialogFooter
        note={
          <Button variant="link" onClick={() => setStep("remove")}>
            {w.settings.remove}
          </Button>
        }
      >
        <Button variant="default" onClick={onClose}>
          {w.connectDialog.cancel}
        </Button>
        <Button variant="primary" loading={update.isPending} disabled={!label.trim()} onClick={save}>
          {w.settings.save}
        </Button>
      </DialogFooter>
    </Dialog>
  );
}

/** A first message to a phone number the number never talked to. */
export function NewChatDialog({ accountId, onClose }: { accountId: string; onClose: (chatId?: string) => void }) {
  const w = useWords();
  const { org } = useOrg();
  const send = useSendWhatsApp(org.id, accountId);
  const say = useWhatsAppError();
  const [phone, setPhone] = useState("");
  const [text, setText] = useState("");
  const ready = phone.replace(/\D/g, "").length >= 8 && text.trim().length > 0;
  const submit = (event: FormEvent) => {
    event.preventDefault();
    if (!ready || send.isPending) return;
    send.mutate({ phone, text }, { onSuccess: (sent) => onClose(sent.chatId) });
  };
  return (
    <Dialog
      open
      onOpenChange={(open) => !open && onClose()}
      title={w.newChatDialog.title}
      closeLabel={w.connectDialog.close}
      width={440}
    >
      <form onSubmit={submit}>
        <DialogBody>
          <FormStack>
            <Field label={w.newChatDialog.phone} example={w.newChatDialog.phoneExample}>
              <Input
                value={phone}
                onChange={(e) => setPhone(e.target.value)}
                inputMode="tel"
                autoComplete="off"
                maxLength={32}
                autoFocus
              />
            </Field>
            <Field label={w.newChatDialog.text} error={send.isError ? say(send.error) : undefined}>
              <Textarea value={text} onChange={(e) => setText(e.target.value)} rows={3} maxLength={4096} />
            </Field>
          </FormStack>
        </DialogBody>
        <DialogFooter>
          <Button type="button" variant="default" onClick={() => onClose()}>
            {w.connectDialog.cancel}
          </Button>
          <Button type="submit" variant="primary" loading={send.isPending} disabled={!ready}>
            {w.newChatDialog.send}
          </Button>
        </DialogFooter>
      </form>
    </Dialog>
  );
}
