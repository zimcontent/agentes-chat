import {
  type Agent,
  ApiError,
  useAgents,
  useConnectWhatsApp,
  useCreateAgent,
  useModels,
  useReconnectWhatsApp,
  useRemoveWhatsApp,
  useSendWhatsApp,
  useSetWhatsAppBrain,
  useUpdateWhatsApp,
  useWhatsApp,
  useWhatsAppBrain,
  useWhatsAppVoices,
  type WhatsAppAccount,
  type WhatsAppPace,
  whatsappVoicePreviewUrl,
} from "@dougbot/client";
import { agentThinks } from "@dougbot/client/lib/brain";
import { errorText } from "@dougbot/client/lib/errors";
import { freeHandle, handleForName } from "@dougbot/client/lib/new-agent";
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
  SettingRow,
  Spinner,
  Switch,
  Textarea,
} from "@dougbot/ui";
import { type FormEvent, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { type BrainTarget, ModelPickerButton } from "@/components/ai/ModelPicker";
import { useOrg } from "@/components/org-context";
import { useDirectory } from "@/hooks/useDirectory";
import { useToast } from "@/lib/toast";
import { useWords, type WhatsAppWords } from "./words";

/** As the server takes them (`WHATSAPP_INSTRUCTIONS_MAX`), and the largest file read into them. */
const INSTRUCTIONS_MAX = 20_000;
const INSTRUCTIONS_FILE_MAX = 200_000;

/** What to say of a failed call: our own words when the gateway is what refused, the app's for anything else. */
export function useWhatsAppError() {
  const { t } = useTranslation();
  const w = useWords();
  return (error: unknown) =>
    !(error instanceof ApiError)
      ? errorText(t, error)
      : error.code === "whatsapp.unavailable"
        ? w.errors.unavailable
        : error.code === "whatsapp.new_chats_limit"
          ? w.errors.newChatsLimit
          : errorText(t, error);
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

/** The waits and quiet times offered; one set some other way (the API) shows beside them. */
const WAITS = [3, 8, 15, 30, 60, 120];
const QUIETS = [15, 60, 240, 1440];
const PACES: readonly WhatsAppPace[] = ["fast", "natural", "slow"];
const withOwn = (list: number[], own: number) => (list.includes(own) ? list : [...list, own].sort((a, b) => a - b));

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
  const [agentOn, setAgentOn] = useState(account.agentOn);
  const [style, setStyle] = useState(account.agentStyle);
  const createAgent = useCreateAgent(org.id);
  const [newName, setNewName] = useState("");
  const [instructions, setInstructions] = useState(account.instructions ?? "");
  const [dropping, setDropping] = useState(false);
  const filePicker = useRef<HTMLInputElement>(null);
  /** A text file's words become the instructions: a .md written elsewhere, dropped here or picked. */
  const readFile = async (file: File | undefined) => {
    if (!file) return;
    const text = /\.(md|markdown|txt)$/i.test(file.name) || file.type.startsWith("text/");
    if (!text || file.size > INSTRUCTIONS_FILE_MAX) {
      toast.show(w.settings.fileRefused, "error");
      return;
    }
    setInstructions((await file.text()).slice(0, INSTRUCTIONS_MAX));
  };
  const [step, setStep] = useState<"form" | "people" | "remove" | "newAgent">("form");
  const chosen = (agents.data ?? []).find((a) => a.id === agentId);
  /** An agent made here, for this number: named by the person, with a handle nobody has. */
  const makeAgent = () => {
    const name = newName.trim();
    if (!name) return;
    const taken = new Set([
      ...(agents.data ?? []).map((a) => a.handle),
      ...dir.members.map((m) => m.handle).filter((h): h is string => Boolean(h)),
    ]);
    const handle = handleForName(name) || "whatsapp";
    createAgent.mutate(
      { name, handle: taken.has(handle) ? freeHandle(handle, taken) : handle, role: w.settings.newAgentRole },
      {
        onSuccess: (made) => {
          setAgentId(made.id);
          setAgentOn(true);
          setNewName("");
          setStep("form");
        },
        onError: (e) => toast.show(say(e), "error"),
      },
    );
  };
  const names = people.map((id) => dir.memberById.get(id)?.name).filter((name): name is string => Boolean(name));

  const save = () =>
    update.mutate(
      {
        accountId: account.id,
        label,
        people,
        agentId: agentId === "none" ? null : agentId,
        agentOn: agentId !== "none" && agentOn,
        agentStyle: style,
        instructions,
      },
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

  if (step === "newAgent") {
    return (
      <Dialog
        open
        onOpenChange={(open) => !open && setStep("form")}
        title={w.settings.newAgentTitle}
        description={w.settings.newAgentText}
        closeLabel={w.connectDialog.close}
        width={440}
      >
        <form
          onSubmit={(e) => {
            e.preventDefault();
            makeAgent();
          }}
        >
          <DialogBody>
            <FormStack>
              <Field label={w.settings.newAgentName} example={w.settings.newAgentExample}>
                <Input value={newName} onChange={(e) => setNewName(e.target.value)} maxLength={60} autoFocus />
              </Field>
            </FormStack>
          </DialogBody>
          <DialogFooter>
            <Button type="button" variant="default" onClick={() => setStep("form")}>
              {w.connectDialog.cancel}
            </Button>
            <Button type="submit" variant="primary" loading={createAgent.isPending} disabled={!newName.trim()}>
              {w.settings.newAgentCreate}
            </Button>
          </DialogFooter>
        </form>
      </Dialog>
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
      width={600}
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
              onValueChange={(next) => {
                if (next === "new") {
                  setStep("newAgent");
                  return;
                }
                // Choosing an agent for a number that had none is asking it to answer: the switch starts on.
                if (agentId === "none" && next !== "none") setAgentOn(true);
                setAgentId(next);
              }}
              options={[
                { value: "none", label: w.settings.agentNone },
                ...(agents.data ?? []).map((a) => ({ value: a.id, label: a.name })),
                { value: "new", label: w.settings.newAgent },
              ]}
            />
          </Field>
          {chosen && (
            <Field label={w.settings.ai} hint={{ name: w.settings.ai, text: w.settings.aiHint }}>
              {/* The number's own AI is chosen among the saved agent's accounts: a new agent shows its own first. */}
              {chosen.id === account.agentId ? (
                <NumberAi account={account} agent={chosen} />
              ) : (
                <div className="wa-ai">
                  <ModelPickerButton agent={chosen} size="row" />
                </div>
              )}
            </Field>
          )}
          {agentId !== "none" && (
            <SettingRow
              title={w.settings.agentOn}
              hint={{ name: w.settings.agentOn, text: w.settings.agentOnHint }}
              htmlFor="wa-agent-on"
            >
              <Switch id="wa-agent-on" checked={agentOn} onCheckedChange={setAgentOn} />
            </SettingRow>
          )}
          {agentId !== "none" && (
            <div className="wa-style">
              <Field label={w.style.wait} hint={{ name: w.style.wait, text: w.style.waitHint }}>
                <Select
                  value={String(style.waitSeconds)}
                  onValueChange={(v) => setStyle((s) => ({ ...s, waitSeconds: Number(v) }))}
                  options={withOwn(WAITS, style.waitSeconds).map((n) => ({
                    value: String(n),
                    label: w.style.seconds(n),
                  }))}
                />
              </Field>
              <Field label={w.style.pace} hint={{ name: w.style.pace, text: w.style.paceHint }}>
                <Select
                  value={style.pace}
                  onValueChange={(v) => setStyle((s) => ({ ...s, pace: v as WhatsAppPace }))}
                  options={PACES.map((pace) => ({ value: pace, label: w.style.paces[pace] }))}
                />
              </Field>
              <Field label={w.style.messages} hint={{ name: w.style.messages, text: w.style.messagesHint }}>
                <Select
                  value={String(style.messages)}
                  onValueChange={(v) => setStyle((s) => ({ ...s, messages: Number(v) }))}
                  options={[1, 2, 3].map((n) => ({ value: String(n), label: w.style.upTo(n) }))}
                />
              </Field>
              <Field label={w.style.quiet} hint={{ name: w.style.quiet, text: w.style.quietHint }}>
                <Select
                  value={String(style.quietMinutes)}
                  onValueChange={(v) => setStyle((s) => ({ ...s, quietMinutes: Number(v) }))}
                  options={withOwn(QUIETS, style.quietMinutes).map((n) => ({
                    value: String(n),
                    label: w.style.minutes(n),
                  }))}
                />
              </Field>
            </div>
          )}
          {agentId !== "none" && (
            <VoiceNotes
              on={style.voiceNotes ?? true}
              voice={style.voice ?? null}
              onChange={(next) => setStyle((s) => ({ ...s, ...next }))}
            />
          )}
          <Field
            label={w.settings.instructions}
            hint={{ name: w.settings.instructions, text: w.settings.instructionsHint }}
            labelAside={
              <Button variant="link" onClick={() => filePicker.current?.click()}>
                {w.settings.instructionsFile}
              </Button>
            }
            example={w.settings.instructionsDrop}
          >
            <Textarea
              className="wa-instructions"
              data-dropping={dropping}
              value={instructions}
              onChange={(e) => setInstructions(e.target.value)}
              onDragOver={(e) => {
                e.preventDefault();
                setDropping(true);
              }}
              onDragLeave={() => setDropping(false)}
              onDrop={(e) => {
                e.preventDefault();
                setDropping(false);
                void readFile(e.dataTransfer.files[0]);
              }}
              placeholder={w.settings.instructionsPlaceholder}
              maxLength={INSTRUCTIONS_MAX}
              rows={8}
            />
          </Field>
          <input
            ref={filePicker}
            type="file"
            accept=".md,.markdown,.txt,text/markdown,text/plain"
            hidden
            onChange={(e) => {
              void readFile(e.target.files?.[0]);
              e.target.value = "";
            }}
          />
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

/** The kinds a number can answer with (`whatsapp/brain.ts` on the server). */
const NUMBER_KINDS = ["model", "claude_code", "codex", "antigravity"] as const;

/**
 * What thinks on the number (docs/adr/doug-0004-whatsapp-bridge.md): the agent's own AI, changed for the agent
 * everywhere, or one for this number alone, the agent untouched. Either way the agent answers with what it knows.
 */
/**
 * The agent's voice notes (docs/adr/doug-0004-whatsapp-bridge.md, addendum 2026-11-15): on or off, and the voice, with
 * its sample to hear. Saved with the rest of the number's settings. Nothing here when the server has no voice.
 */
function VoiceNotes({
  on,
  voice,
  onChange,
}: {
  on: boolean;
  voice: string | null;
  onChange: (next: { voiceNotes?: boolean; voice?: string | null }) => void;
}) {
  const w = useWords();
  const { org } = useOrg();
  const voices = useWhatsAppVoices(org.id);
  const sample = useRef<HTMLAudioElement | null>(null);
  if (!voices.data?.on) return null;
  const list = voices.data.voices;
  const chosen = voice ?? "default";
  const options = [
    { value: "default", label: w.style.voiceDefault },
    ...list.map((v) => ({ value: v.id, label: v.labels.length ? `${v.name} · ${v.labels.join(", ")}` : v.name })),
  ];
  if (voice && !list.some((v) => v.id === voice)) options.push({ value: voice, label: voice });
  const listen = () => {
    sample.current?.pause();
    const audio = new Audio(whatsappVoicePreviewUrl(org.id, voice ?? voices.data?.default ?? ""));
    sample.current = audio;
    void audio.play().catch(() => {});
  };
  return (
    <>
      <SettingRow
        title={w.style.voiceNotes}
        hint={{ name: w.style.voiceNotes, text: w.style.voiceNotesHint }}
        htmlFor="wa-voice-notes"
      >
        <Switch id="wa-voice-notes" checked={on} onCheckedChange={(next) => onChange({ voiceNotes: next })} />
      </SettingRow>
      {on && (
        <Field label={w.style.voice}>
          <div className="wa-voice">
            <Select
              className="wa-voice__pick"
              value={chosen}
              onValueChange={(next) => onChange({ voice: next === "default" ? null : next })}
              options={options}
            />
            <Button icon="play" onClick={listen}>
              {w.style.listen}
            </Button>
          </div>
        </Field>
      )}
    </>
  );
}

function NumberAi({ account, agent }: { account: WhatsAppAccount; agent: Agent }) {
  const w = useWords();
  const { t } = useTranslation();
  const { org } = useOrg();
  const toast = useToast();
  const say = useWhatsAppError();
  const dir = useDirectory(org.id);
  const models = useModels();
  const brain = useWhatsAppBrain(org.id, account.id);
  const setBrain = useSetWhatsAppBrain(org.id, account.id);
  // The agent's admin or owner only: anyone else reads the agent's own AI, as before.
  const mayChoose = brain.data?.canEdit === true;
  const own = brain.data?.own ?? account.ownAi ?? false;
  const owner = agent.ownerUserId ? dir.memberById.get(agent.ownerUserId) : undefined;
  const target: BrainTarget | undefined = brain.data
    ? {
        view: brain.data,
        apiModel: brain.data.apiModel,
        kinds: NUMBER_KINDS,
        thinks: agentThinks(
          t,
          { id: agent.id, brain: brain.data.line ?? undefined, model: brain.data.apiModel },
          { owner: owner?.name.split(" ")[0], agents: dir.agents, models: models.data?.models ?? [] },
        ),
        apply: async (pick, model) => {
          await setBrain.mutateAsync({ ...(pick ? { brain: pick } : {}), ...(model !== undefined ? { model } : {}) });
          await brain.refetch();
        },
        saved: (model) => w.settings.aiSaved(model),
      }
    : undefined;
  const choose = (next: string) => {
    if ((next === "own") === own) return;
    // An AI of its own starts as the agent's: what thinks doesn't change until another one is picked.
    setBrain.mutate(next === "own" ? {} : null, {
      onSuccess: () => void brain.refetch(),
      onError: (e) => toast.show(say(e), "error"),
    });
  };
  return (
    <div className="wa-ai">
      {mayChoose && (
        <div className="wa-ai__which">
          <Select
            value={own ? "own" : "same"}
            onValueChange={choose}
            disabled={setBrain.isPending}
            options={[
              { value: "same", label: w.settings.aiSame },
              { value: "own", label: w.settings.aiOwn },
            ]}
          />
        </div>
      )}
      {own && target ? (
        <ModelPickerButton agent={agent} size="row" target={target} />
      ) : (
        <ModelPickerButton agent={agent} size="row" />
      )}
    </div>
  );
}
