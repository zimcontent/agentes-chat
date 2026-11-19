import {
  type RondaSchedule,
  useCredentials,
  useModels,
  usePlatformKey,
  useRonda,
  useRoutineAction,
  useSetRonda,
} from "@dougbot/client";
import { nextLabel } from "@dougbot/client/lib/format";
import { can } from "@dougbot/client/lib/permissions";
import { modelChoices } from "@dougbot/client/lib/providers";
import { runOutcome } from "@dougbot/client/lib/routine-view";
import { Button, Card, Select, SettingNote, SettingRow } from "@dougbot/ui";
import { useTranslation } from "react-i18next";
import { ModelSelect, modelOptions } from "@/components/AgentFields";
import { useOrg } from "@/components/org-context";
import { useToast } from "@/lib/toast";
import { CardHead, useAgentEdit } from "./context";

const SCHEDULES: RondaSchedule[] = ["off", "daily", "three_daily", "hourly"];
/** The model select's value for "the agent's own AI" (the API's null). */
const AGENT_AI = "agent";

/**
 * The ronda's state and actions for one agent (ADR 9004), shared by any agent's card and the right hand's row. Saved at
 * once, outside the page's save bar, by who manages agents or the agent's owner; everyone else reads it. The right
 * hand's is each person's own (ADR 9005 §3): whoever sees its row sets theirs. Turning it on makes you its person: it
 * tells you in your DM.
 */
export function useRondaControl(agent: { id: string; ownerUserId?: string | null; builtin?: string | null }) {
  const { t, i18n } = useTranslation();
  const { org, me } = useOrg();
  const ronda = useRonda(org.id, agent.id);
  const set = useSetRonda(org.id, agent.id);
  const act = useRoutineAction(org.id);
  const toast = useToast();
  const editable = agent.builtin === "right_hand" || can(org, "manage_agents") || agent.ownerUserId === me.user.id;
  const schedule = set.isPending ? (set.variables?.schedule ?? "off") : (ronda.data?.schedule ?? "off");
  const save = (next: RondaSchedule) => {
    if (!editable || next === schedule) return;
    set.mutate({ schedule: next }, { onError: () => toast.show(t("ronda.failed"), "error") });
  };
  // Who thinks on it (§5): the agent's own AI, or an API model on one of the workspace's keys.
  const models = useModels();
  const credentials = useCredentials(org.id, can(org, "manage_credentials"));
  const platform = usePlatformKey(org.id);
  const pending = set.isPending && set.variables?.model !== undefined ? set.variables.model : undefined;
  const model = pending !== undefined ? (pending ?? AGENT_AI) : (ronda.data?.model ?? AGENT_AI);
  const modelList = [
    { value: AGENT_AI, label: t("ronda.modelAgent") },
    ...modelOptions(
      t,
      i18n.language,
      modelChoices(models.data?.models ?? [], credentials.data ?? [], platform.data ?? false),
    ),
  ];
  const saveModel = (next: string) => {
    if (!editable || next === model) return;
    set.mutate(
      { schedule, model: next === AGENT_AI ? null : next },
      { onError: () => toast.show(t("ronda.failed"), "error") },
    );
  };
  const data = ronda.data;
  const last = data?.recent[0];
  const lastWords = !last
    ? null
    : last.status === "reported"
      ? t("ronda.reported")
      : last.status === "silent"
        ? t("ronda.silent")
        : last.status === "queued" || last.status === "starting" || last.status === "started"
          ? t("ronda.running")
          : (() => {
              const w = runOutcome({
                status: last.status as Parameters<typeof runOutcome>[0]["status"],
                code: last.code,
              });
              const tt = t as unknown as (key: string, options?: Record<string, unknown>) => string;
              return tt(w.key, { ...w.values, ...(w.fallback ? { defaultValue: tt(w.fallback) } : {}) });
            })();
  const on = schedule !== "off";
  const note =
    on && data
      ? [
          data.nextRunAt ? t("ronda.next", { when: nextLabel(i18n.language, data.nextRunAt) }) : "",
          lastWords ? t("ronda.last", { what: lastWords }) : "",
        ]
          .filter(Boolean)
          .join(" · ")
      : "";
  const routineId = data?.routineId ?? null;
  return {
    schedule,
    save,
    editable,
    loading: ronda.isLoading,
    on,
    note,
    canRun: on && editable && !!routineId,
    running: act.isPending,
    runNow: () => {
      if (routineId) act.mutate({ type: "run", id: routineId });
    },
    options: SCHEDULES.map((s) => ({ value: s, label: t(`ronda.${s}`) })),
    model,
    modelList,
    saveModel,
  };
}

/** "Quem pensa na ronda" (§5): the agent's own AI or an API model, searched like any agent's model. */
export function RondaModelSelect({ r }: { r: ReturnType<typeof useRondaControl> }) {
  const { t } = useTranslation();
  return (
    <ModelSelect
      aria-label={t("ronda.model")}
      value={r.model}
      onChange={r.saveModel}
      options={r.modelList}
      disabled={!r.editable || r.loading}
    />
  );
}

/** Configurações → Ronda (ADR 9004): when the agent looks at the operation on its own, its next pass and last one. */
export function RondaCard() {
  const { t } = useTranslation();
  const { agent } = useAgentEdit();
  const r = useRondaControl(agent);
  return (
    <Card as="section" className="agp-card" aria-labelledby="agp-ronda">
      <CardHead id="agp-ronda" icon="eye" title={t("ronda.title")} subtitle={t("ronda.subtitle")} />
      <SettingRow
        title={t("ronda.schedule")}
        hint={{ name: t("common.about", { label: t("ronda.schedule") }), text: t("ronda.scheduleHelp") }}
        htmlFor="agp-ronda-schedule"
      >
        <Select
          id="agp-ronda-schedule"
          size="sm"
          value={r.schedule}
          disabled={!r.editable || r.loading}
          onValueChange={(v) => r.save(v as RondaSchedule)}
          options={r.options}
        />
      </SettingRow>
      {r.on && (
        <SettingRow
          title={t("ronda.model")}
          hint={{ name: t("common.about", { label: t("ronda.model") }), text: t("ronda.modelHelp") }}
        >
          <RondaModelSelect r={r} />
        </SettingRow>
      )}
      {r.note && (
        <SettingNote icon="repeat" quiet>
          {r.note}
        </SettingNote>
      )}
      {r.canRun && (
        <div className="ac-acts">
          <Button variant="default" size="sm" disabled={r.running} onClick={r.runNow}>
            {t("ronda.runNow")}
          </Button>
        </div>
      )}
    </Card>
  );
}
