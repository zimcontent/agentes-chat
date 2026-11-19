import type { PortalColumn, PortalLabel, PortalLabelColor } from "@dougbot/client";
import { usePortalLabels } from "@dougbot/client";
import { PORTAL_COLUMNS, PORTAL_LABEL_COLORS, portalErrorText } from "@dougbot/client/lib/portal";
import { Button, Dialog, DialogBody, EmptyState, Input, Select } from "@dougbot/ui";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { useOrg } from "@/components/org-context";
import { useToast } from "@/lib/toast";
import { LabelChip, StageChip } from "./stage";

/**
 * The legend at the schedule's foot (ADR 9001 §8): the stages' colours with their names, so the board reads at a
 * glance, then the team's own labels, and "Manage labels" for who may change the board.
 */
export function PlanLegend({ labels, changes }: { labels: PortalLabel[]; changes: boolean }) {
  const { t } = useTranslation();
  const [managing, setManaging] = useState(false);
  return (
    <section className="plan-legend" aria-label={t("portal.plan.legend")}>
      <StageLegend stages={PORTAL_COLUMNS} />
      <div className="plan-legend__row">
        <h2 className="plan-legend__name">{t("portal.plan.labels")}</h2>
        <ul className="plan-legend__list">
          {labels.map((label) => (
            <li key={label.id}>
              <LabelChip label={label} />
            </li>
          ))}
          {labels.length === 0 && <li className="small muted">{t("portal.plan.noLabels")}</li>}
        </ul>
        {changes && (
          <Button size="sm" icon="edit" title={t("portal.plan.manageLabels")} onClick={() => setManaging(true)}>
            <span className="portal-act__words">{t("portal.plan.manageLabels")}</span>
          </Button>
        )}
      </div>
      <LabelsDialog open={managing} labels={labels} onClose={() => setManaging(false)} />
    </section>
  );
}

/** The stages' colours with their names, on one line that wraps: what a dot or a bar's segment in that colour means. */
export function StageLegend({ stages }: { stages: readonly PortalColumn[] }) {
  const { t } = useTranslation();
  return (
    <div className="plan-legend__row">
      <h2 className="plan-legend__name">{t("portal.plan.stages")}</h2>
      <ul className="plan-legend__list">
        {stages.map((stage) => (
          <li key={stage}>
            <StageChip stage={stage} />
          </li>
        ))}
      </ul>
    </div>
  );
}

/**
 * "Manage labels": the team's labels as a list, each with its name (kept on Enter or on leaving the field), its
 * colour and a way out, then a new one. A change applies at once, to every client's schedule.
 */
export function LabelsDialog({ open, labels, onClose }: { open: boolean; labels: PortalLabel[]; onClose: () => void }) {
  const { t, i18n } = useTranslation();
  const { org } = useOrg();
  const toast = useToast();
  const { create, update, remove } = usePortalLabels(org.id);
  const [name, setName] = useState("");
  const [color, setColor] = useState<PortalLabelColor>("green");
  const failed = (error: unknown) => toast.show(portalErrorText(t, error, i18n.language), "error");
  const colors = PORTAL_LABEL_COLORS.map((value) => ({
    value,
    label: t(`portal.labelsDialog.colors.${value}`),
    leading: <span className="portal-swatch" data-color={value} aria-hidden="true" />,
  }));
  return (
    <Dialog
      open={open}
      onOpenChange={(o) => !o && onClose()}
      title={t("portal.plan.manageLabels")}
      closeLabel={t("common.close")}
      width={520}
    >
      <DialogBody className="plan-labels">
        {labels.length === 0 && <EmptyState size="inline">{t("portal.plan.noLabels")}</EmptyState>}
        <ul className="plan-labels__list">
          {labels.map((label) => (
            <li key={label.id} className="plan-labels__row">
              <span className="portal-swatch" data-color={label.color} aria-hidden="true" />
              <Input
                key={label.name}
                aria-label={`${t("portal.labelsDialog.name")}: ${label.name}`}
                defaultValue={label.name}
                maxLength={40}
                onKeyDown={(e) => e.key === "Enter" && e.currentTarget.blur()}
                onBlur={(e) => {
                  const next = e.currentTarget.value.trim();
                  if (next && next !== label.name)
                    update.mutate({ labelId: label.id, name: next }, { onError: failed });
                }}
              />
              <Select
                aria-label={`${t("portal.labelsDialog.color")}: ${label.name}`}
                value={label.color}
                onValueChange={(next) => update.mutate({ labelId: label.id, color: next }, { onError: failed })}
                options={colors}
              />
              <Button
                variant="ghost"
                iconOnly
                icon="trash"
                aria-label={t("portal.labelsDialog.delete", { name: label.name })}
                onClick={() => remove.mutate(label.id, { onError: failed })}
              />
            </li>
          ))}
        </ul>
        <form
          className="plan-labels__row plan-labels__new"
          onSubmit={(e) => {
            e.preventDefault();
            if (!name.trim()) return;
            create.mutate({ name: name.trim(), color }, { onError: failed });
            setName("");
          }}
        >
          <span className="portal-swatch" data-color={color} aria-hidden="true" />
          <Input
            aria-label={t("portal.labelsDialog.name")}
            placeholder={t("portal.labelsDialog.name")}
            value={name}
            maxLength={40}
            onChange={(e) => setName(e.target.value)}
          />
          <Select aria-label={t("portal.labelsDialog.color")} value={color} onValueChange={setColor} options={colors} />
          <Button type="submit" variant="primary" disabled={!name.trim()} loading={create.isPending}>
            {t("portal.labelsDialog.add")}
          </Button>
        </form>
      </DialogBody>
    </Dialog>
  );
}
