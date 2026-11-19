import { useAgentTwins, useSetAgentTwin } from "@dougbot/client";
import { timeAgo } from "@dougbot/client/lib/format";
import { can } from "@dougbot/client/lib/permissions";
import { Button, Card, SettingNote, SettingRow } from "@dougbot/ui";
import { useTranslation } from "react-i18next";
import { useOrg } from "@/components/org-context";
import { useToast } from "@/lib/toast";
import { CardHead, useAgentEdit } from "./context";

/**
 * Configurações → "Nos seus outros workspaces" (ADR doug-0013): the same agent in the person's other workspaces, trained
 * as one with this one, and the agents of its handle there that could join. Saved at once, outside the save bar, by
 * who manages agents or the agent's owner. Shown only when there is a copy, a candidate, or it was taken out.
 */
export function TwinsCard() {
  const { t } = useTranslation();
  const { org, me } = useOrg();
  const { agent } = useAgentEdit();
  const twins = useAgentTwins(org.id, agent.id);
  const set = useSetAgentTwin(org.id, agent.id);
  const toast = useToast();
  const view = twins.data;
  if (!view || (view.copies.length === 0 && view.candidates.length === 0 && view.hidden === 0)) return null;
  const editable = can(org, "manage_agents") || agent.ownerUserId === me.user.id;
  const change = (otherAgentId: string | null) =>
    set.mutate(otherAgentId, { onError: () => toast.show(t("agentTwins.failed"), "error") });
  const linked = view.copies.length > 0 || view.hidden > 0;
  return (
    <Card as="section" className="agp-card" aria-labelledby="agp-twins">
      <CardHead
        id="agp-twins"
        icon="layers"
        title={t("agentTwins.title")}
        subtitle={t("agentTwins.subtitle")}
        hint={{ name: t("common.about", { label: t("agentTwins.title") }), text: t("agentTwins.help") }}
      />
      {view.copies.map((c) => (
        <SettingRow key={c.agentId} title={c.orgName} status={`@${c.handle} · ${t("agentTwins.trainedHere")}`} />
      ))}
      {view.hidden > 0 && (
        <SettingNote icon="lock" quiet>
          {t("agentTwins.hidden", { count: view.hidden })}
        </SettingNote>
      )}
      {view.candidates.map((c) => (
        <SettingRow key={c.agentId} title={c.orgName} status={`@${c.handle} · ${t("agentTwins.canJoin")}`}>
          {editable && (
            <Button size="sm" disabled={set.isPending} onClick={() => change(c.agentId)}>
              {t("agentTwins.join")}
            </Button>
          )}
        </SettingRow>
      ))}
      {view.missing.map((m) => (
        <SettingNote key={`${m.orgName}:${m.kind}:${m.label}`} icon="alert">
          {t("agentTwins.missing", { workspace: m.orgName, what: m.label })}
        </SettingNote>
      ))}
      {linked && view.craftOnly && (
        <SettingNote icon="lock" quiet>
          {t("agentTwins.craftOnly")}
        </SettingNote>
      )}
      {linked && (
        <SettingNote icon="repeat" quiet>
          {view.syncedAt ? t("agentTwins.synced", { when: timeAgo(t, view.syncedAt) }) : t("agentTwins.syncing")}
        </SettingNote>
      )}
      {!linked && view.off && (
        <SettingNote icon="info" quiet>
          {t("agentTwins.off")}
        </SettingNote>
      )}
      {linked && editable && view.copies.length > 0 && (
        <div className="ac-acts">
          <Button variant="default" size="sm" disabled={set.isPending} onClick={() => change(null)}>
            {t("agentTwins.leave")}
          </Button>
        </div>
      )}
    </Card>
  );
}
