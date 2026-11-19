import { useUpdateAgent } from "@dougbot/client";
import { can } from "@dougbot/client/lib/permissions";
import { Card, Select, SettingRow } from "@dougbot/ui";
import { useTranslation } from "react-i18next";
import { useOrg } from "@/components/org-context";
import { useMediaOn } from "@/components/SidebarSetup";
import { useToast } from "@/lib/toast";
import { CardHead, useAgentEdit } from "./context";

const MONTHLY = [0, 1000, 2000, 5000, 10_000, 20_000, 50_000];
const ASK_ABOVE = ["never", "100", "300", "500", "1000", "2000", "5000"];

/**
 * Configurações → Imagens e vídeos (ADR doug-0011): how many credits the agent's `generate_image` and
 * `generate_video` may spend a month, and from which price a generation waits for a person's approval. Saved at once
 * by who manages agents; everyone else reads it. Only on a server with media generation.
 */
export function MediaAllowanceCard() {
  const { t, i18n } = useTranslation();
  const { org } = useOrg();
  const { agent } = useAgentEdit();
  const update = useUpdateAgent(org.id, agent.id);
  const toast = useToast();
  const on = useMediaOn();
  if (!on || agent.mediaMonthlyCredits === undefined) return null;
  const editable = can(org, "manage_agents");
  const fmt = (n: number) => n.toLocaleString(i18n.language);
  const pending = update.isPending ? update.variables : undefined;
  const monthly = pending?.mediaMonthlyCredits ?? agent.mediaMonthlyCredits;
  const askAbove = pending && "mediaAskAbove" in pending ? pending.mediaAskAbove : agent.mediaAskAbove;
  const monthlyOptions = [...new Set([...MONTHLY, monthly])].sort((a, b) => a - b);
  const askOptions = [...new Set([...ASK_ABOVE, askAbove == null ? "never" : String(askAbove)])];
  const save = (patch: { mediaMonthlyCredits?: number; mediaAskAbove?: number | null }) => {
    if (!editable) return;
    update.mutate(patch, { onError: () => toast.show(t("brakes.failed"), "error") });
  };
  return (
    <Card as="section" className="agp-card" aria-labelledby="agp-media">
      <CardHead id="agp-media" icon="image" title={t("mediaGen.agent.title")} />
      <SettingRow
        title={t("mediaGen.agent.monthly")}
        hint={{
          name: t("common.about", { label: t("mediaGen.agent.monthly") }),
          text: t("mediaGen.agent.monthlyHint"),
        }}
        htmlFor="agp-media-monthly"
      >
        <Select
          id="agp-media-monthly"
          size="sm"
          value={String(monthly)}
          disabled={!editable}
          onValueChange={(v) => save({ mediaMonthlyCredits: Number(v) })}
          options={monthlyOptions.map((n) => ({ value: String(n), label: fmt(n) }))}
        />
      </SettingRow>
      <SettingRow
        title={t("mediaGen.agent.askAbove")}
        hint={{
          name: t("common.about", { label: t("mediaGen.agent.askAbove") }),
          text: t("mediaGen.agent.askAboveHint"),
        }}
        htmlFor="agp-media-ask"
      >
        <Select
          id="agp-media-ask"
          size="sm"
          value={askAbove == null ? "never" : String(askAbove)}
          disabled={!editable || monthly === 0}
          onValueChange={(v) => save({ mediaAskAbove: v === "never" ? null : Number(v) })}
          options={askOptions.map((v) => ({
            value: v,
            label: v === "never" ? t("mediaGen.agent.never") : fmt(Number(v)),
          }))}
        />
      </SettingRow>
    </Card>
  );
}
