import { type SectorName, useSectorPills, useShowSectorCard } from "@agenteschat/client";
import { useMemo } from "react";
import { useTranslation } from "react-i18next";
import { haptics, useToast } from "@/ui";
import type { ComposerSuggestion } from "@/ui/Composer";
import { SourceMark } from "../blocks/SectorParts";

/**
 * The right hand's sector pills above the field in a person's conversation with it (docs/adr/doug-0020-doug-sector-cards.md),
 * as the field's own pills: one per sector with something for them (the agenda whenever a Google Calendar is
 * connected), its official mark and what waits there. A tap asks for that sector's card, which the right hand posts at
 * once. Empty (`agentId` ""), anywhere else.
 */
export function useSectorPillSuggestions(orgId: string, agentId: string): ComposerSuggestion[] {
  const { t } = useTranslation();
  const toast = useToast();
  const pills = useSectorPills(orgId, agentId, agentId.length > 0);
  const show = useShowSectorCard(orgId, agentId);
  const { mutate } = show;
  const data = pills.data;
  return useMemo(() => {
    if (!agentId || !data) return [];
    const press = (sector: SectorName) => {
      haptics.selection();
      mutate(sector, { onError: () => toast({ title: t("mobile.sectorPills.failed"), icon: "x" }) });
    };
    return data.map((p) => ({
      icon: "sparkle" as const,
      mark: <SourceMark service={p.sector} size={17} />,
      label: t(`sectorPills.${p.sector}`),
      ...(p.count > 0 ? { count: p.count } : {}),
      onPress: () => press(p.sector),
    }));
  }, [agentId, data, mutate, t, toast]);
}
