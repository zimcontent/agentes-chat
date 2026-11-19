import type { Agent, LiveVoiceEngine } from "@dougbot/client";
import {
  useAgents,
  useLiveVoice,
  useRemoveLiveVoiceKey,
  useSaveCallNotes,
  useSaveLiveVoiceKey,
  useSetLiveVoiceEngine,
  useSetLiveVoiceLimit,
  useUpdateAgent,
} from "@dougbot/client";
import { errorText } from "@dougbot/client/lib/errors";
import {
  DEFAULT_HOUSE_VOICE,
  HOUSE_VOICE_CATALOG,
  houseVoiceInfo,
  LIVE_VOICE_CATALOG,
  type LiveVoiceInfo,
  liveVoiceInfo,
  liveVoiceLabel,
} from "@dougbot/client/lib/live-voices";
import { can } from "@dougbot/client/lib/permissions";
import {
  Button,
  Card,
  CardFooter,
  CardHeader,
  Chip,
  Dialog,
  DialogBody,
  DialogFooter,
  Input,
  List,
  Locked,
  Segmented,
  Textarea,
} from "@dougbot/ui";
import { Link } from "@tanstack/react-router";
import { useCallback, useEffect, useId, useMemo, useState, useSyncExternalStore } from "react";
import { useTranslation } from "react-i18next";
import { AgentAvatar } from "@/components/AgentAvatar";
import { OpenPage, Step, StepTitle } from "@/components/ai/AddAccountFlow";
import { PrefRow } from "@/components/NoticePrefs";
import { useOrg } from "@/components/org-context";
import { useLiveVoiceActions } from "./LiveVoice";
import { PhoneLineCard } from "./PhoneLineCard";
import { type VoicePreview, voiceRefused } from "./preview";

/*
 * Configurações › Voz (ADR doug-0006): which voice calls use (the house voice paid in credits, or GPT-Live on the
 * workspace's OpenAI key, docs/adr/doug-0036-house-voice.md), the house voice's monthly limit, the GPT-Live key in the
 * same rows as the other keys (`GifKeyCard`), and each agent's voice with a sample to hear it.
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
  const engine: LiveVoiceEngine = view.engine ?? "gpt-live";
  const house = engine === "house";
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
          {view.house && <EngineRow engine={engine} editable={view.editable} />}
          {house && view.house && (
            <MonthlyLimitRow
              key={view.house.monthlyCredits ?? "none"}
              limit={view.house.monthlyCredits}
              spent={view.house.spentThisMonth}
              editable={view.editable}
            />
          )}
          {house ? null : !on ? (
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
        {!house && <CardFooter>{t("liveVoice.settings.price")}</CardFooter>}
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
      {on && <CallNotesCard notes={view.callNotes} editable={view.editable} />}
      <PhoneLineCard />
      {on && team.length > 0 && (
        <Card aria-labelledby={`${id}-voices`}>
          <CardHeader id={`${id}-voices`} icon="sound" title={t("liveVoice.settings.voicesTitle")} />
          <div className="settings-rows">
            {team.map((agent) => (
              <AgentVoiceRow key={`${agent.id}-${engine}`} agent={agent} />
            ))}
          </div>
        </Card>
      )}
    </>
  );
}

/** Which voice calls use here: the house voice, paid in credits, or GPT-Live on the workspace's key. */
function EngineRow({ engine, editable }: { engine: LiveVoiceEngine; editable: boolean }) {
  const { t } = useTranslation();
  const { org } = useOrg();
  const view = useLiveVoice(org.id).data;
  const set = useSetLiveVoiceEngine(org.id);
  const [error, setError] = useState<string | null>(null);
  const house = view?.house;
  const hint =
    engine === "house"
      ? house?.balance == null
        ? t("liveVoice.settings.houseNoWallet", { perMinute: house?.perMinute ?? 0 })
        : t("liveVoice.settings.houseCredits", {
            perMinute: house.perMinute,
            balance: house.balance,
            minutes: Math.floor(house.balance / Math.max(1, house.perMinute)),
          })
      : t("liveVoice.settings.gptLiveHint");
  return (
    <div className="ac-list__row jev__body">
      <span className="list-col">
        <span className="ai-accounts__name">{t("liveVoice.settings.engine")}</span>
        <Locked when={set.isPending}>
          <Segmented<LiveVoiceEngine>
            size="sm"
            label={t("liveVoice.settings.engine")}
            value={engine}
            disabled={!editable}
            onValueChange={(next) => {
              setError(null);
              set.mutate(next, { onError: (e) => setError(errorText(t, e)) });
            }}
            options={[
              { value: "house", label: t("liveVoice.settings.house") },
              { value: "gpt-live", label: t("liveVoice.settings.gptLive") },
            ]}
          />
        </Locked>
        <span className={error ? "small ac-field__error" : "small muted"}>{error ?? hint}</span>
        {engine === "house" && (
          <Link to="/org/$orgId/media" params={{ orgId: org.id }} className="small">
            {t("liveVoice.settings.addCredits")}
          </Link>
        )}
      </span>
    </div>
  );
}

/** The most credits the house voice may spend here in a month, and what it spent so far. */
function MonthlyLimitRow({ limit, spent, editable }: { limit: number | null; spent: number; editable: boolean }) {
  const { t } = useTranslation();
  const { org } = useOrg();
  const set = useSetLiveVoiceLimit(org.id);
  const [draft, setDraft] = useState(limit === null ? "" : String(limit));
  const [error, setError] = useState<string | null>(null);
  const id = useId();
  const value = draft.trim() === "" ? null : Number(draft);
  const valid = value === null || (Number.isInteger(value) && value >= 0);
  const changed = value !== limit;
  return (
    <div className="ac-list__row jev__body">
      <span className="list-col">
        <label className="ai-accounts__name" htmlFor={`${id}-limit`}>
          {t("liveVoice.settings.monthly")}
        </label>
        <span className="lv-limit">
          <Input
            id={`${id}-limit`}
            inputMode="numeric"
            value={draft}
            disabled={!editable}
            invalid={!valid || Boolean(error)}
            placeholder={t("liveVoice.settings.monthlyNone")}
            aria-describedby={`${id}-spent`}
            onChange={(e) => {
              setDraft(e.target.value.replace(/[^\d]/g, ""));
              setError(null);
            }}
          />
          {editable && (
            <Button
              variant="primary"
              disabled={!valid || !changed}
              loading={set.isPending}
              onClick={() => set.mutate(value, { onError: (e) => setError(errorText(t, e)) })}
            >
              {t("common.save")}
            </Button>
          )}
        </span>
        <span id={`${id}-spent`} className={error ? "small ac-field__error" : "small muted"}>
          {error ??
            (limit === null
              ? t("liveVoice.settings.spentNoLimit", { spent })
              : t("liveVoice.settings.spent", { spent, limit }))}
        </span>
      </span>
    </div>
  );
}

/** One agent's voice: its owner or an admin picks it in the picker, hearing each voice first. */
export function AgentVoiceRow({ agent }: { agent: Agent }) {
  return (
    <PrefRow
      id={`voice-agent-${agent.id}`}
      lead={<AgentAvatar agentId={agent.id} name={agent.name} size="sm" />}
      label={agent.name}
      status={agent.role || undefined}
      control={<VoiceChoice agent={agent} size="sm" />}
    />
  );
}

/** The agent's page: its voice, while the workspace has live voice. */
export function AgentVoiceField({ agent }: { agent: Agent }) {
  const { t } = useTranslation();
  const live = useLiveVoiceActions();
  if (!live?.available) return null;
  return (
    <>
      {live.available && (
        <div className="agp-field">
          <span className="newag__label" id={`voice-${agent.id}`}>
            {t("liveVoice.settings.voiceOf", { name: agent.name })}
          </span>
          <span className="ac-acts">
            <VoiceChoice agent={agent} />
          </span>
        </div>
      )}
      <AgentCallNotes agent={agent} />
    </>
  );
}

/**
 * How the workspace's agents behave on voice calls, on top of the base every agent reads there (`live-call.md`,
 * docs/adr/doug-0006-live-voice.md §11): who configures writes it, everyone reads it.
 */
function CallNotesCard({ notes, editable }: { notes: string; editable: boolean }) {
  const { t } = useTranslation();
  const { org } = useOrg();
  const save = useSaveCallNotes(org.id);
  const [draft, setDraft] = useState(notes);
  const id = useId();
  const changed = draft.trim() !== notes.trim();
  return (
    <Card aria-labelledby={`${id}-notes`}>
      <CardHeader
        id={`${id}-notes`}
        icon="bulb"
        title={t("liveVoice.settings.notesTitle")}
        subtitle={t("liveVoice.settings.notesLead")}
      />
      <div className="lv-notes">
        <Textarea
          aria-labelledby={`${id}-notes`}
          value={draft}
          rows={4}
          maxLength={3000}
          disabled={!editable}
          placeholder={t("liveVoice.settings.notesExample")}
          onChange={(e) => setDraft(e.target.value)}
        />
        {editable && (
          <span className="ac-acts">
            <Button
              size="sm"
              variant="primary"
              disabled={!changed}
              loading={save.isPending}
              onClick={() => save.mutate(draft)}
            >
              {t("common.save")}
            </Button>
          </span>
        )}
      </div>
    </Card>
  );
}

/** The agent's own notes for calls (on its page), on top of the workspace's. */
function AgentCallNotes({ agent }: { agent: Agent }) {
  const { t } = useTranslation();
  const { org, me } = useOrg();
  const update = useUpdateAgent(org.id, agent.id);
  const saved = agent.liveCallNotes ?? "";
  const [draft, setDraft] = useState(saved);
  const mayEdit = can(org, "manage_agents") || agent.ownerUserId === me.user.id;
  const id = useId();
  return (
    <div className="agp-field">
      <label className="newag__label" htmlFor={`${id}-call`}>
        {t("liveVoice.settings.agentNotes", { name: agent.name })}
      </label>
      <Textarea
        id={`${id}-call`}
        value={draft}
        rows={3}
        maxLength={1500}
        disabled={!mayEdit}
        placeholder={t("liveVoice.settings.agentNotesExample")}
        onChange={(e) => setDraft(e.target.value)}
      />
      {mayEdit && draft.trim() !== saved.trim() && (
        <span className="ac-acts">
          <Button
            size="sm"
            variant="primary"
            loading={update.isPending}
            onClick={() => update.mutate({ liveCallNotes: draft.trim() || null })}
          >
            {t("common.save")}
          </Button>
        </span>
      )}
    </div>
  );
}

/** The agent's voice by name, opening the picker. */
function VoiceChoice({ agent, size }: { agent: Agent; size?: "sm" }) {
  const { t } = useTranslation();
  const { org, me } = useOrg();
  const update = useUpdateAgent(org.id, agent.id);
  const live = useLiveVoiceActions();
  const describe = useVoiceWords();
  const [open, setOpen] = useState(false);
  const house = useLiveVoice(org.id).data?.engine === "house";
  const pending = update.isPending ? (house ? update.variables?.houseVoice : update.variables?.voice) : undefined;
  const chosen = pending ?? (house ? (agent.houseVoice ?? DEFAULT_HOUSE_VOICE) : (agent.voice ?? "marin"));
  const label = voiceLabel(chosen);
  const mayEdit = can(org, "manage_agents") || agent.ownerUserId === me.user.id;
  return (
    <>
      <Button
        size={size}
        icon="sound"
        disabled={!live?.available}
        loading={update.isPending}
        aria-label={`${t("liveVoice.settings.voiceOf", { name: agent.name })}: ${label}`}
        title={describe(chosen)}
        onClick={() => setOpen(true)}
      >
        {label}
      </Button>
      {open && live && (
        <VoicePicker
          agent={agent}
          house={house}
          current={chosen}
          preview={live.preview}
          mayEdit={mayEdit}
          onClose={() => setOpen(false)}
          onPick={(voice) => {
            setOpen(false);
            if (voice !== chosen) update.mutate(house ? { houseVoice: voice } : { voice });
          }}
        />
      )}
    </>
  );
}

/** "Português · Brasileiro · Feminina": a voice's language (in the app's language), accent and how it sounds. */
function useVoiceWords() {
  const { t, i18n } = useTranslation();
  const names = useMemo(() => {
    try {
      return new Intl.DisplayNames([i18n.language], { type: "language" });
    } catch {
      return null;
    }
  }, [i18n.language]);
  return useCallback(
    (voice: string) => {
      const own = houseVoiceInfo(voice);
      if (own) return t(own.presentation === "feminine" ? "liveVoice.voices.feminine" : "liveVoice.voices.masculine");
      const info = liveVoiceInfo(voice);
      if (!info) return "";
      const lang = names?.of(info.lang) ?? info.lang;
      return [
        lang.charAt(0).toLocaleUpperCase(i18n.language) + lang.slice(1),
        info.accent ? t(ACCENT[info.accent]) : null,
        t(info.presentation === "feminine" ? "liveVoice.voices.feminine" : "liveVoice.voices.masculine"),
      ]
        .filter(Boolean)
        .join(" · ");
    },
    [names, t, i18n.language],
  );
}

type VoiceFilter = "all" | "feminine" | "masculine";

/** A voice's name as shown: the house voice's own label, a GPT-Live voice's capitalized id. */
const voiceLabel = (voice: string) => houseVoiceInfo(voice)?.label ?? liveVoiceLabel(voice);

const ACCENT = {
  australian: "liveVoice.voices.accent.australian",
  british: "liveVoice.voices.accent.british",
  irish: "liveVoice.voices.accent.irish",
  northAmerican: "liveVoice.voices.accent.northAmerican",
  brazilian: "liveVoice.voices.accent.brazilian",
  filipino: "liveVoice.voices.accent.filipino",
  southernUs: "liveVoice.voices.accent.southernUs",
} as const satisfies Record<NonNullable<LiveVoiceInfo["accent"]>, string>;

/**
 * Every GPT-Live voice, each heard as the agent saying hello (`VoicePreview`): the app's language first, then Marin and
 * Cedar, then the rest of OpenAI's table. A voice the key doesn't have says so once heard.
 */
function VoicePicker({
  agent,
  house,
  current,
  preview,
  mayEdit,
  onClose,
  onPick,
}: {
  agent: Agent;
  /** The house voice's own voices instead of GPT-Live's. */
  house: boolean;
  current: string;
  preview: VoicePreview;
  mayEdit: boolean;
  onClose: () => void;
  onPick: (voice: string) => void;
}) {
  const { t, i18n } = useTranslation();
  const describe = useVoiceWords();
  const state = useSyncExternalStore(preview.subscribe, preview.getState);
  const [picked, setPicked] = useState(current);
  const [filter, setFilter] = useState<VoiceFilter>("all");
  useEffect(() => () => preview.stop(), [preview]);
  // Opens on the agent's voice (once the dialog has laid the list out).
  const list = useCallback((node: HTMLDivElement | null) => {
    if (node) requestAnimationFrame(() => node.querySelector("[data-picked]")?.scrollIntoView({ block: "center" }));
  }, []);
  const lang = i18n.language.slice(0, 2);
  const voices = useMemo(
    () =>
      (house
        ? [...HOUSE_VOICE_CATALOG]
        : [...LIVE_VOICE_CATALOG].sort((a, b) => Number(b.lang === lang) - Number(a.lang === lang))
      ).filter((v) => filter === "all" || v.presentation === filter),
    [house, lang, filter],
  );
  return (
    <Dialog
      open
      onOpenChange={(open) => !open && onClose()}
      title={t("liveVoice.settings.voiceOf", { name: agent.name })}
      description={t(house ? "liveVoice.settings.pickerLeadHouse" : "liveVoice.settings.pickerLead", {
        name: agent.name,
      })}
      closeLabel={t("common.close")}
      width={560}
    >
      <DialogBody>
        <Segmented
          size="sm"
          label={t("liveVoice.settings.filter")}
          value={filter}
          onValueChange={setFilter}
          options={[
            { value: "all", label: t("liveVoice.settings.filterAll") },
            { value: "feminine", label: t("liveVoice.settings.filterFeminine") },
            { value: "masculine", label: t("liveVoice.settings.filterMasculine") },
          ]}
        />
        <div className="lv-voices" ref={list}>
          {voices.map((v) => {
            const name = voiceLabel(v.id);
            const phase = preview.isOn(agent.id, v.id) ? state.phase : "idle";
            const playing = phase === "connecting" || phase === "playing";
            const instead = house ? null : (preview.fellBack(agent.id, v.id) ?? (voiceRefused(v.id) ? "marin" : null));
            return (
              <div key={v.id} className="lv-voice" data-picked={picked === v.id || undefined}>
                <button
                  type="button"
                  aria-pressed={picked === v.id}
                  className="lv-voice__pick"
                  disabled={!mayEdit}
                  onClick={() => setPicked(v.id)}
                >
                  <span className="lv-voice__name">
                    {name}
                    {v.id === current && <span className="lv-voice__tag">{t("liveVoice.settings.current")}</span>}
                  </span>
                  <span className="lv-voice__desc" data-refused={instead ? true : undefined}>
                    {instead ? t("liveVoice.settings.refused", { voice: liveVoiceLabel(instead) }) : describe(v.id)}
                  </span>
                </button>
                <Button
                  size="sm"
                  variant={playing ? "default" : "ghost"}
                  iconOnly
                  icon={playing ? "stop" : "play"}
                  loading={phase === "connecting"}
                  aria-label={playing ? t("liveVoice.listen.stop") : t("liveVoice.settings.previewOf", { voice: name })}
                  title={playing ? t("liveVoice.listen.stop") : t("liveVoice.settings.previewOf", { voice: name })}
                  onClick={() => preview.toggle(agent.id, v.id)}
                />
              </div>
            );
          })}
        </div>
        {state.phase === "failed" && (
          <p className="ac-field__error" role="alert">
            {errorText(t, state.error)}
          </p>
        )}
      </DialogBody>
      <DialogFooter>
        <Button onClick={onClose}>{t("common.cancel")}</Button>
        {mayEdit && (
          <Button variant="primary" disabled={picked === current} onClick={() => onPick(picked)}>
            {t("liveVoice.settings.use", { voice: voiceLabel(picked) })}
          </Button>
        )}
      </DialogFooter>
    </Dialog>
  );
}
