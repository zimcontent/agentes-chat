import { type RondaSchedule, useRonda, useRoutineAction, useSetRonda } from "@agenteschat/client";
import { nextLabel } from "@agenteschat/client/lib/format";
import { can } from "@agenteschat/client/lib/permissions";
import { runOutcome } from "@agenteschat/client/lib/routine-view";
import { Button, Card, Select, SettingNote, SettingRow } from "@agenteschat/ui";
import { useTranslation } from "react-i18next";
import { useOrg } from "@/components/org-context";
import { useToast } from "@/lib/toast";
import { CardHead, useAgentEdit } from "./context";

const SCHEDULES: RondaSchedule[] = ["off", "daily", "three_daily", "hourly"];

/**
 * Configurações → Ronda (ADR 9004): when the agent looks at the operation on its own, with its next pass and how the
 * last one ended. Saved at once, outside the page's save bar, by who manages agents or the agent's owner; everyone
 * else reads it. Turning it on makes you its person: it tells you in your DM.
 */
export function RondaCard() {
  const { t, i18n } = useTranslation();
  const { org, me } = useOrg();
  const { agent } = useAgentEdit();
  const ronda = useRonda(org.id, agent.id);
  const set = useSetRonda(org.id, agent.id);
  const act = useRoutineAction(org.id);
  const toast = useToast();
  const editable = can(org, "manage_agents") || agent.ownerUserId === me.user.id;
  const schedule = set.isPending ? (set.variables ?? "off") : (ronda.data?.schedule ?? "off");
  const save = (next: RondaSchedule) => {
    if (!editable || next === schedule) return;
    set.mutate(next, { onError: () => toast.show(t("ronda.failed"), "error") });
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
          value={schedule}
          disabled={!editable || ronda.isLoading}
          onValueChange={(v) => save(v as RondaSchedule)}
          options={SCHEDULES.map((s) => ({ value: s, label: t(`ronda.${s}`) }))}
        />
      </SettingRow>
      {on && data && (data.nextRunAt || lastWords) && (
        <SettingNote icon="repeat" quiet>
          {[
            data.nextRunAt ? t("ronda.next", { when: nextLabel(i18n.language, data.nextRunAt) }) : "",
            lastWords ? t("ronda.last", { what: lastWords }) : "",
          ]
            .filter(Boolean)
            .join(" · ")}
        </SettingNote>
      )}
      {on && editable && data?.routineId && (
        <div className="ac-acts">
          <Button
            variant="default"
            size="sm"
            disabled={act.isPending}
            onClick={() => data.routineId && act.mutate({ type: "run", id: data.routineId })}
          >
            {t("ronda.runNow")}
          </Button>
        </div>
      )}
    </Card>
  );
}
