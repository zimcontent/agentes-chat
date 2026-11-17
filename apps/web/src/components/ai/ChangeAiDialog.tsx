import type { Agent, AgentBrain } from "@agenteschat/client";
import { keys, useAgentBrain, useApi, useCredentials, useModels, usePlatformKey } from "@agenteschat/client";
import {
  agentModelChip,
  type Intent,
  intentChoices,
  intentOptions,
  pricesInReais,
} from "@agenteschat/client/lib/ai-panel";
import {
  mayPickModel,
  modelPickerSave,
  modelPickerUndo,
  type PickerBefore,
} from "@agenteschat/client/lib/brain-picker";
import { agentGrammar } from "@agenteschat/client/lib/grammar";
import { can } from "@agenteschat/client/lib/permissions";
import { modelChoices } from "@agenteschat/client/lib/providers";
import { Button, Dialog, DialogBody, DialogFooter, Icon, type IconName, OptionList } from "@agenteschat/ui";
import { useQueryClient } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { LoadingList } from "@/components/Loading";
import { useOrg } from "@/components/org-context";
import { useToast } from "@/lib/toast";

const INTENT_ICON: Record<Intent, IconName> = { smart: "bulb", balanced: "swap", fast: "bolt" };

/**
 * "Trocar a IA" (docs/adr/doug-0017-agents-lean.md): an agent's AI changed by intent, Mais inteligente, Equilíbrio or
 * Mais rápida e econômica, each with the model the shared rule picks (`intentChoices`, the phone's too), what it means
 * and what it costs. Nothing changes before "Trocar para …", and its toast undoes it. Every model, account and key is
 * one click away in "Mais opções" (Quem pensa in the agent's Ajustes).
 */
export function ChangeAiDialog({ agent, onClose }: { agent: Agent; onClose: () => void }) {
  const { t } = useTranslation();
  const { org, me } = useOrg();
  const may = mayPickModel(agent, me.user.id, can(org, "manage_agents"));
  const brain = useAgentBrain(org.id, agent.id, may);
  const g = agentGrammar(agent.name);
  return (
    <Dialog
      open
      onOpenChange={(open) => !open && onClose()}
      title={t("aiPanel.dialog.title", g)}
      description={agent.role || undefined}
      closeLabel={t("common.close")}
      width={520}
    >
      {!may ? (
        <>
          <DialogBody>
            <p className="muted">{t("brain.picker.readOnly")}</p>
          </DialogBody>
          <DialogFooter>
            <Button onClick={onClose}>{t("common.close")}</Button>
          </DialogFooter>
        </>
      ) : brain.isPending ? (
        <DialogBody>
          <LoadingList count={3} avatar={false} />
        </DialogBody>
      ) : !brain.data ? (
        <>
          <DialogBody>
            <p className="muted">{t("common.loadFailed")}</p>
          </DialogBody>
          <DialogFooter>
            <Button onClick={() => void brain.refetch()}>{t("common.retry")}</Button>
          </DialogFooter>
        </>
      ) : (
        <Choices agent={agent} view={brain.data} onClose={onClose} />
      )}
    </Dialog>
  );
}

function Choices({ agent, view, onClose }: { agent: Agent; view: AgentBrain; onClose: () => void }) {
  const { t, i18n } = useTranslation();
  const { org } = useOrg();
  const api = useApi();
  const qc = useQueryClient();
  const toast = useToast();
  const models = useModels().data?.models ?? [];
  const credentials = useCredentials(org.id, can(org, "manage_credentials"));
  const platform = usePlatformKey(org.id);
  const choices = modelChoices(models, credentials.data ?? view.keys ?? [], platform.data ?? false);
  const options = intentOptions(t, i18n.language, view, agent.ownerUserId, choices, agent.model, models);
  const picks = intentChoices(view, options);
  const currentIntent = picks.find((p) => p.option.current)?.intent;
  const [intent, setIntent] = useState<Intent | undefined>(
    currentIntent ?? picks.find((p) => p.intent === "balanced")?.intent ?? picks[0]?.intent,
  );
  const [busy, setBusy] = useState(false);
  const more = (
    <Button asChild variant="link">
      <Link
        to="/org/$orgId/agents/$agentId"
        params={{ orgId: org.id, agentId: agent.id }}
        search={{ tab: "settings", sec: "brain" }}
        onClick={onClose}
      >
        {t("aiPanel.dialog.more")}
      </Link>
    </Button>
  );

  if (picks.length === 0)
    return (
      <>
        <DialogBody>
          <p className="muted">{t("aiPanel.dialog.none")}</p>
        </DialogBody>
        <DialogFooter>
          {more}
          <Button onClick={onClose}>{t("common.close")}</Button>
        </DialogFooter>
      </>
    );

  const chosen = picks.find((p) => p.intent === intent)?.option;
  const changes = chosen !== undefined && !chosen.current;
  const refresh = () => {
    for (const key of [
      keys.agentBrain(org.id, agent.id),
      keys.agents(org.id),
      keys.aiStatus(org.id),
      keys.aiAccounts(org.id),
    ])
      void qc.invalidateQueries({ queryKey: key });
  };
  const apply = async (input: ReturnType<typeof modelPickerSave>) => {
    if (input.brain) await api.agents.setBrain(org.id, agent.id, input.brain);
    if (input.model !== undefined) await api.agents.update(org.id, agent.id, { model: input.model });
  };
  const save = async () => {
    if (!chosen || !changes || busy) return;
    const before: PickerBefore = {
      brain: view.brain,
      account: view.account,
      model: view.model,
      effort: view.effort,
      apiModel: agent.model,
    };
    const saving = modelPickerSave(view, chosen.tile, chosen.account, chosen.model.value);
    setBusy(true);
    try {
      await apply(saving);
      onClose();
      toast.show(t("brain.picker.saved", { agent: agent.name, model: chosen.label }), "success", {
        label: t("brain.picker.undo"),
        run: () =>
          void apply(modelPickerUndo(before, saving))
            .catch(() => toast.show(t("agentPage.work.failed"), "error"))
            .finally(refresh),
      });
    } catch {
      toast.show(t("agentPage.work.failed"), "error");
    } finally {
      setBusy(false);
      refresh();
    }
  };
  const lineOf = (i: Intent, prices: boolean) =>
    i === "smart" ? t(prices ? "aiPanel.dialog.smartKey" : "aiPanel.dialog.smartPlan") : t(`aiPanel.dialog.${i}Line`);

  return (
    <>
      <DialogBody>
        {!currentIntent && (
          <p className="small muted">
            {t("aiPanel.dialog.now", { model: agentModelChip(agent, models, t("brain.auto.label")) })}
          </p>
        )}
        <OptionList
          aria-label={t("aiPanel.dialog.title", agentGrammar(agent.name))}
          value={intent ?? ""}
          onValueChange={(v) => setIntent(v as Intent)}
          options={picks.map(({ intent: i, option: o }) => ({
            value: i,
            leading: <Icon name={INTENT_ICON[i]} size={20} />,
            title: t(`aiPanel.dialog.${i}`),
            ...(o.current ? { tag: t("aiPanel.dialog.current") } : {}),
            description: `${o.label} · ${lineOf(i, Boolean(o.prices))}`,
            side: o.prices
              ? t("aiPanel.dialog.price", pricesInReais(o.prices, i18n.language))
              : t("aiPanel.dialog.inPlan"),
          }))}
        />
      </DialogBody>
      <DialogFooter>
        {more}
        <Button onClick={onClose}>{t("common.cancel")}</Button>
        <Button variant="primary" disabled={!changes} loading={busy} onClick={() => void save()}>
          {chosen && changes ? t("aiPanel.dialog.switchTo", { model: chosen.label }) : t("aiPanel.dialog.keep")}
        </Button>
      </DialogFooter>
    </>
  );
}
