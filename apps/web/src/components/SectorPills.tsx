import { type SectorName, useSectorPills, useShowSectorCard } from "@agenteschat/client";
import { Button } from "@agenteschat/ui";
import { useTranslation } from "react-i18next";
import { useOrg } from "@/components/org-context";
import { useToast } from "@/lib/toast";
import { SourceMark } from "./blocks/SourceMark";
import "./sector-pills.css";

/**
 * Above the composer in a person's conversation with the right hand (docs/adr/doug-0020-doug-sector-cards.md): one
 * button per sector with something for them (the agenda whenever a Google Calendar is connected), each with its
 * official mark and what waits there. A press asks for that sector's card, which the right hand posts at once.
 */
export function SectorPills({ agentId }: { agentId: string }) {
  const { t } = useTranslation();
  const { org } = useOrg();
  const toast = useToast();
  const pills = useSectorPills(org.id, agentId);
  const show = useShowSectorCard(org.id, agentId);
  const list = pills.data ?? [];
  if (list.length === 0) return null;
  const press = (sector: SectorName) =>
    show.mutate(sector, { onError: () => toast.show(t("sectorPills.failed"), "error") });
  return (
    <nav className="sector-pills" aria-label={t("sectorPills.label")}>
      {list.map((p) => (
        <Button
          key={p.sector}
          size="sm"
          className="sector-pills__pill"
          disabled={show.isPending}
          loading={show.isPending && show.variables === p.sector}
          onClick={() => press(p.sector)}
        >
          <SourceMark service={p.sector} />
          <span>{t(`sectorPills.${p.sector}`)}</span>
          {p.count > 0 && <span className="sector-pills__count">{p.count > 99 ? "99+" : p.count}</span>}
        </Button>
      ))}
    </nav>
  );
}
