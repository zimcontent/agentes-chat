import type { Agent } from "@agenteschat/client";
import {
  useAgents,
  useLiveVoice,
  useRemoveLiveVoiceKey,
  useSaveLiveVoiceKey,
  useUpdateAgent,
} from "@agenteschat/client";
import { errorText } from "@agenteschat/client/lib/errors";
import { LIVE_VOICES, liveVoiceLabel } from "@agenteschat/client/lib/live-voices";
import { can } from "@agenteschat/client/lib/permissions";
import {
  Button,
  Card,
  CardFooter,
  CardHeader,
  Chip,
  Dialog,
  DialogFooter,
  Input,
  List,
  Locked,
  Select,
} from "@agenteschat/ui";
import { useId, useState } from "react";
import { useTranslation } from "react-i18next";
import { AgentAvatar } from "@/components/AgentAvatar";
import { OpenPage, Step, StepTitle } from "@/components/ai/AddAccountFlow";
import { PrefRow } from "@/components/NoticePrefs";
import { useOrg } from "@/components/org-context";
import { useLiveVoiceActions } from "./LiveVoice";

/*
 * Configurações › Voz (ADR doug-0006): the workspace's OpenAI key for GPT-Live (calls with agents, Ouvir), the same rows as
 * the other keys (`GifKeyCard`), and each agent's voice with a sample to hear it.
 */

const OPENAI_KEYS = "https://platform.openai.com/api-keys";
const KEY_MIN = 20;

export function LiveVoiceCard() {
  const { t } = useTranslation();
  const { org } = useOrg();
  const view = useLiveVoice(org.id).data;
  const save = useSaveLiveVoiceKey(org.id);
  const remove = useRemoveLiveVoiceKey(org.id);
  const agents = useAgents(org.id).data ?? [];
  const [steps, setSteps] = useState(false);
  const [draft, setDraft] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [removing, setRemoving] = useState(false);
  const id = useId();
  if (!view) return null;
  const on = view.state === "ok";
  const close = () => {
    setSteps(false);
    setDraft("");
    setError(null);
  };
  const submit = () => save.mutate(draft.trim(), { onSuccess: close, onError: (e) => setError(errorText(t, e)) });
  const key = draft.trim();
  const team = agents.filter((a) => !a.former);

  const keySteps = (
    <div className="agp-addacct jev-steps">
      <Step
        n={1}
        side={
          <OpenPage href={OPENAI_KEYS} primary={key === ""}>
            {t("liveVoice.settings.openSite")}
          </OpenPage>
        }
      >
        <StepTitle title={t("liveVoice.settings.stepKey")} hint={t("liveVoice.settings.stepKeyHint")} />
      </Step>
      <Step n={2}>
        <StepTitle title={t("liveVoice.settings.paste")} htmlFor={`${id}-key`} />
        <span className="agp-addacct__paste">
          <Locked when={save.isPending}>
            <Input
              id={`${id}-key`}
              type="password"
              value={draft}
              autoComplete="off"
              spellCheck={false}
              autoFocus
              invalid={Boolean(error)}
              aria-describedby={`${id}-below`}
              onChange={(e) => {
                setDraft(e.target.value);
                setError(null);
              }}
              onKeyDown={(e) => {
                if (e.key !== "Enter") return;
                e.preventDefault();
                if (key.length >= KEY_MIN && !save.isPending) submit();
              }}
            />
          </Locked>
          <Button variant="primary" disabled={key.length < KEY_MIN} loading={save.isPending} onClick={submit}>
            {t("settings.saveKey")}
          </Button>
          <Button variant="ghost" onClick={close}>
            {t("common.cancel")}
          </Button>
        </span>
        <p
          id={`${id}-below`}
          className={error ? "jev-steps__below ac-field__error" : "jev-steps__below ac-field__example"}
        >
          {error ?? t("liveVoice.settings.sealed")}
        </p>
      </Step>
    </div>
  );

  return (
    <>
      <Card aria-labelledby={`${id}-title`}>
        <CardHeader
          id={`${id}-title`}
          icon="phone"
          title={t("liveVoice.settings.title")}
          subtitle={t("liveVoice.settings.lead")}
          action={
            <Chip icon={on ? "check" : undefined} tone={on ? "done" : undefined}>
              {t(on ? "liveVoice.settings.on" : "liveVoice.settings.off")}
            </Chip>
          }
        />
        <List>
          {!on ? (
            <div className="ac-list__row jev__body">
              <span className="small muted">{t("liveVoice.settings.without")}</span>
              {steps ? (
                keySteps
              ) : view.editable ? (
                <Button size="sm" variant="primary" onClick={() => setSteps(true)}>
                  {t("liveVoice.settings.setUp")}
                </Button>
              ) : null}
            </div>
          ) : (
            <>
              <div className="ac-list__row jev__key">
                <span className="list-col">
                  <span className="ai-accounts__name">{t("settings.keyValue")}</span>
                  {view.hint && <span className="small muted">{t("settings.keyEndsIn", { hint: view.hint })}</span>}
                </span>
                {view.editable && (
                  <span className="ac-acts">
                    <Button size="sm" variant="ghost" onClick={() => setSteps(true)}>
                      {t("settings.rotate")}
                    </Button>
                    <Button size="sm" variant="ghost" className="ac-btn--danger" onClick={() => setRemoving(true)}>
                      {t("settings.remove")}
                    </Button>
                  </span>
                )}
              </div>
              {steps && <div className="ac-list__row jev__body">{keySteps}</div>}
            </>
          )}
        </List>
        <CardFooter>{t("liveVoice.settings.price")}</CardFooter>
        <Dialog
          open={removing}
          onOpenChange={setRemoving}
          title={t("liveVoice.settings.removeTitle")}
          description={t("liveVoice.settings.removeText")}
          closeLabel={t("common.close")}
          width={440}
        >
          <DialogFooter>
            <Button onClick={() => setRemoving(false)}>{t("common.cancel")}</Button>
            <Button
              variant="danger"
              loading={remove.isPending}
              onClick={() => remove.mutate(undefined, { onSuccess: () => setRemoving(false) })}
            >
              {t("settings.remove")}
            </Button>
          </DialogFooter>
        </Dialog>
      </Card>
      {on && team.length > 0 && (
        <Card aria-labelledby={`${id}-voices`}>
          <CardHeader id={`${id}-voices`} icon="sound" title={t("liveVoice.settings.voicesTitle")} />
          <div className="settings-rows">
            {team.map((agent) => (
              <AgentVoiceRow key={agent.id} agent={agent} />
            ))}
          </div>
        </Card>
      )}
    </>
  );
}

/** One agent's voice: its owner or an admin picks it; "Ouvir" plays a hello in it. */
export function AgentVoiceRow({ agent }: { agent: Agent }) {
  const { t } = useTranslation();
  const { org, me } = useOrg();
  const update = useUpdateAgent(org.id, agent.id);
  const live = useLiveVoiceActions();
  const chosen = (update.isPending ? update.variables?.voice : undefined) ?? agent.voice ?? "marin";
  const mayEdit = can(org, "manage_agents") || agent.ownerUserId === me.user.id;
  return (
    <PrefRow
      id={`voice-agent-${agent.id}`}
      lead={<AgentAvatar agentId={agent.id} name={agent.name} size="sm" />}
      label={agent.name}
      status={agent.role || undefined}
      control={
        <span className="ac-acts">
          <Button
            size="sm"
            variant="ghost"
            iconOnly
            icon="play"
            aria-label={t("liveVoice.settings.sample", { name: agent.name })}
            title={t("liveVoice.settings.sample", { name: agent.name })}
            disabled={!live?.available}
            onClick={() => live?.sample(agent.id, chosen)}
          />
          <Select
            size="sm"
            align="end"
            className="lv-voice-select"
            value={chosen}
            disabled={!mayEdit}
            aria-label={t("liveVoice.settings.voiceOf", { name: agent.name })}
            options={LIVE_VOICES.map((v) => ({ value: v, label: liveVoiceLabel(v) }))}
            onValueChange={(voice) => update.mutate({ voice })}
          />
        </span>
      }
    />
  );
}

/** The agent's page: its voice, with a sample, while the workspace has live voice. */
export function AgentVoiceField({ agent }: { agent: Agent }) {
  const { t } = useTranslation();
  const { org, me } = useOrg();
  const live = useLiveVoiceActions();
  const update = useUpdateAgent(org.id, agent.id);
  if (!live?.available) return null;
  const chosen = (update.isPending ? update.variables?.voice : undefined) ?? agent.voice ?? "marin";
  const mayEdit = can(org, "manage_agents") || agent.ownerUserId === me.user.id;
  return (
    <div className="agp-field">
      <span className="newag__label" id={`voice-${agent.id}`}>
        {t("liveVoice.settings.voiceOf", { name: agent.name })}
      </span>
      <span className="ac-acts">
        <Select
          value={chosen}
          disabled={!mayEdit}
          aria-label={t("liveVoice.settings.voiceOf", { name: agent.name })}
          options={LIVE_VOICES.map((v) => ({ value: v, label: liveVoiceLabel(v) }))}
          onValueChange={(voice) => update.mutate({ voice })}
        />
        <Button variant="ghost" icon="play" onClick={() => live.sample(agent.id, chosen)}>
          {t("liveVoice.settings.hear")}
        </Button>
      </span>
    </div>
  );
}
