import { useNotificationCount, useOverview } from "@dougbot/client";
import { Tabs } from "@dougbot/ui";
import { useNavigate } from "@tanstack/react-router";
import type { ReactNode } from "react";
import { useTranslation } from "react-i18next";
import { useOrg } from "./org-context";

const TAB_TO = {
  waiting: "/org/$orgId/waiting",
  requests: "/org/$orgId/approvals",
  proposals: "/org/$orgId/proposals",
} as const;

/**
 * The one place for what waits on you (ADR 0172 addendum), as three tabs: all of it, each answered in place
 * ("Esperando você"); what agents ask to do now, with its history (Aprovações); and what they propose to change.
 * `actions` sit at the tabs' right, as a toolbar's do.
 */
export function ApprovalsTabs({ value, actions }: { value: keyof typeof TAB_TO; actions?: ReactNode }) {
  const { t } = useTranslation();
  const { org } = useOrg();
  const navigate = useNavigate();
  const overview = useOverview(org.id).data;
  const waiting = useNotificationCount(org.id).data?.waiting;
  return (
    <div className="tabs-bar">
      <Tabs
        value={value}
        onValueChange={(tab) => void navigate({ to: TAB_TO[tab], params: { orgId: org.id } })}
        label={t("shell.waiting")}
        items={[
          { value: "waiting", label: t("shell.waiting"), count: waiting || undefined },
          {
            value: "requests",
            label: t("approvals.title"),
            count: overview?.approvalsWaitingForMe || undefined,
          },
          { value: "proposals", label: t("proposals.title"), count: overview?.proposalsWaitingForMe || undefined },
        ]}
      >
        {actions ?? null}
      </Tabs>
    </div>
  );
}
