import type { PortalColumn, PortalLabel } from "@agenteschat/client";
import { Chip } from "@agenteschat/ui";
import type { TFunction } from "i18next";
import { useTranslation } from "react-i18next";

/** A stage's name as a card says it: the columns' own words, and one post that went out is "Posted" in the singular. */
export const stageName = (t: TFunction, stage: PortalColumn) =>
  stage === "posted" ? t("portal.plan.posted") : t(`portal.columns.${stage}`);

/**
 * Where a post is (ADR 9001 §8), as the board's own chip with a dot in the stage's colour: the colour the legend
 * explains and the calendar's chips use, the same in both themes. Automatic: nobody types it.
 */
export function StageChip({ stage }: { stage: PortalColumn }) {
  const { t } = useTranslation();
  return (
    <Chip className="portal-stagechip" lead={<span className="portal-dot" data-stage={stage} aria-hidden="true" />}>
      {stageName(t, stage)}
    </Chip>
  );
}

/** A label as the team named it: the board's chip with a mark in the label's colour. */
export function LabelChip({ label }: { label: PortalLabel }) {
  return (
    <Chip
      className="portal-labelchip"
      lead={<span className="portal-swatch portal-swatch--mark" data-color={label.color} aria-hidden="true" />}
    >
      {label.name}
    </Chip>
  );
}
