import type { PortalCardReview, PortalColumn, PortalLabel } from "@agenteschat/client";
import { Chip } from "@agenteschat/ui";
import type { TFunction } from "i18next";
import { useTranslation } from "react-i18next";

/** A stage's name as a card says it: the columns' own words, and one post that went out is "Posted" in the singular. */
export const stageName = (t: TFunction, stage: PortalColumn) =>
  stage === "posted" ? t("portal.plan.posted") : t(`portal.columns.${stage}`);

/**
 * A stage's name with what the team decided in Review of a card not sent yet (ADR 9001, addendum 2026-11-18): an
 * approved one is "Approved by the team", not "Approved", which is the client's word on a post at the portal.
 */
export const stageWords = (t: TFunction, stage: PortalColumn, review?: PortalCardReview | null) =>
  review ? t(`portal.teamReview.${review.status}`) : stageName(t, stage);

/**
 * Where a post is (ADR 9001 §8), as the board's own chip with a dot in the stage's colour: the colour the legend
 * explains and the calendar's chips use, the same in both themes. Automatic: nobody types it. A card the team has in
 * Review says that instead, in the stage's colour it takes from it.
 */
export function StageChip({ stage, review }: { stage: PortalColumn; review?: PortalCardReview | null }) {
  const { t } = useTranslation();
  return (
    <Chip className="portal-stagechip" lead={<span className="portal-dot" data-stage={stage} aria-hidden="true" />}>
      {stageWords(t, stage, review)}
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
