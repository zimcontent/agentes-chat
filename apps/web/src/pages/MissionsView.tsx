import { MISSIONS_WAITING_COUNT, useMissionList } from "@dougbot/client";
import { can } from "@dougbot/client/lib/permissions";
import { Button, Icon, PageHeader, SearchField, Toolbar } from "@dougbot/ui";
import { useDeferredValue, useState } from "react";
import { useTranslation } from "react-i18next";
import { useFilterCopy } from "@/components/filters";
import { NewMissionDialog } from "@/components/missions/MissionDialogs";
import { MissionsTab } from "@/components/missions/MissionList";
import { useOrg } from "@/components/org-context";

/**
 * Missions inside Tarefas (ADR doug-0018): a mission is a task an agent runs with a plan, so it lives with the tasks,
 * not under a list of conversations. Its own view of the board's page (`?view=missions`), with the way back to the
 * tasks before its title.
 */
export function MissionsView({ onBack }: { onBack: () => void }) {
  const { t } = useTranslation();
  const { org } = useOrg();
  const copy = useFilterCopy();
  const [q, setQ] = useState("");
  const query = useDeferredValue(q.trim());
  const [creating, setCreating] = useState(false);
  const opens = can(org, "post") && can(org, "assign_work");
  // With none yet, the empty state holds the button (the same two lists it reads, unfiltered).
  const open = useMissionList(org.id, { status: "open" });
  const closed = useMissionList(org.id, { status: "closed" });
  const none = open.data?.missions.length === 0 && closed.data?.missions.length === 0;
  return (
    <div className="page issues">
      <div className="issues__main">
        <PageHeader
          className="issues-head"
          lead={
            <Button
              size="sm"
              variant="ghost"
              iconOnly
              icon="chevronLeft"
              aria-label={t("issues.missions.back")}
              title={t("issues.missions.back")}
              onClick={onBack}
            />
          }
          title={t("missions.title")}
          meta={t("missions.subtitle")}
          actions={
            opens &&
            !none && (
              <Button variant="primary" icon="plus" onClick={() => setCreating(true)}>
                {t("missions.new.open")}
              </Button>
            )
          }
        />
        <Toolbar
          search={
            <SearchField
              value={q}
              onChange={(e) => setQ(e.target.value)}
              onClear={() => setQ("")}
              clearLabel={copy.clearSearch}
              placeholder={t("missions.search")}
              aria-label={t("missions.search")}
            />
          }
        />
        <MissionsTab filters={{ q: query }} onNew={() => setCreating(true)} onClear={() => setQ("")} />
        <NewMissionDialog open={creating} onOpenChange={setCreating} />
      </div>
    </div>
  );
}

/**
 * On the tasks' page, while missions run: "2 missões em andamento · 1 esperando você" and the way to them. Nothing
 * when none runs, so a workspace that never used one never sees the word.
 */
export function MissionsLine({ onOpen }: { onOpen: () => void }) {
  const { t } = useTranslation();
  const { org } = useOrg();
  const counts = useMissionList(org.id, { status: "open", limit: 1 }).data?.counts;
  const waiting = useMissionList(org.id, MISSIONS_WAITING_COUNT).data?.counts.waitingYou ?? 0;
  const active = counts?.active ?? 0;
  if (active === 0) return null;
  return (
    <section className="issues-now" aria-label={t("missions.title")}>
      <div className="issues-stalled issues-missions">
        <Icon name="flag" size={16} className="issues-stalled__icon" />
        <span className="issues-stalled__text">
          <b>{t("issues.missions.running", { count: active })}</b>
          {waiting > 0 && <span> · {t("issues.missions.waiting", { count: waiting })}</span>}
        </span>
        <span className="issues-stalled__acts">
          <Button size="sm" variant="ghost" onClick={onOpen}>
            {t("issues.missions.see")}
          </Button>
        </span>
      </div>
    </section>
  );
}
