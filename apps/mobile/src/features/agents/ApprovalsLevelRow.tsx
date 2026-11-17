import { useAgents, useSettings, useSetWorkspaceApprovalsLevel } from "@agenteschat/client";
import { APPROVALS_LEVELS, ownApprovalsCount } from "@agenteschat/client/lib/approvals-level";
import { useTranslation } from "react-i18next";
import { GroupedList, GroupedRow } from "@/ui";
import { useFailed } from "../routines/hooks";
import { useOrgId } from "../shared/hooks";
import { pickOne } from "../shared/PickerSheet";

/** The three levels as the picker sheet lists them, each a title and its line. */
const useLevelOptions = () => {
  const { t } = useTranslation();
  return APPROVALS_LEVELS.map((value) => ({
    key: value,
    label: t(`approvalsLevel.${value}.title`),
    sub: t(`approvalsLevel.${value}.text`),
    subLines: 3,
  }));
};

/**
 * Settings → Aprovações (ADR 0173 addendum 2026-11-15), for who may set every agent's level: the workspace's level,
 * which every agent without its own choice follows. The sheet says how many agents keep their own.
 */
export function WorkspaceApprovalsRow() {
  const { t } = useTranslation();
  const orgId = useOrgId();
  const failed = useFailed();
  const options = useLevelOptions();
  const settings = useSettings(orgId);
  const agents = useAgents(orgId).data ?? [];
  const set = useSetWorkspaceApprovalsLevel(orgId);
  const level = (set.isPending ? set.variables?.level : undefined) ?? settings.data?.approvalsLevel ?? "risky";
  const title = t("approvalsLevel.title");
  const own = ownApprovalsCount(agents);
  const choose = async () => {
    const picked = await pickOne({
      title,
      note: own > 0 ? t("approvalsLevel.ownAgents", { count: own }) : t("approvalsLevel.workspaceLead"),
      value: level,
      options,
    });
    const next = APPROVALS_LEVELS.find((value) => value === picked);
    if (next && next !== level) set.mutate({ level: next }, { onError: failed });
  };
  return (
    <GroupedList>
      <GroupedRow
        label={title}
        hint={{ name: t("common.about", { label: title }), text: t("approvalsLevel.workspaceHelp") }}
        value={t(`approvalsLevel.${level}.title`)}
        chevron
        disabled={set.isPending || !settings.data}
        onPress={() => void choose()}
      />
    </GroupedList>
  );
}
