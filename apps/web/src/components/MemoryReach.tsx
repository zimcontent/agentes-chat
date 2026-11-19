import { type Memory, useAgentTwins, useMemoryAction } from "@agenteschat/client";
import { Button } from "@agenteschat/ui";
import type { TFunction } from "i18next";
import { useTranslation } from "react-i18next";
import { useOrg } from "@/components/org-context";
import { useToast } from "@/lib/toast";

/**
 * How far each memory goes among the agent's copies in other workspaces (ADR doug-0013 addendum 2026-11-19): `all`,
 * `here`, or null where the agent has no copies or the memory never leaves this workspace (nothing to show).
 */
export function useMemoryReach(agentId: string): (m: Memory) => "all" | "here" | null {
  const { org } = useOrg();
  const twins = useAgentTwins(org.id, agentId).data;
  const copies = twins ? twins.copies.length + twins.hidden > 0 : false;
  return (m) => (copies ? (m.reach ?? null) : null);
}

/** The words for where it holds now: "Em todos os workspaces" or "Só neste workspace". */
export function reachLabel(t: TFunction, reach: "all" | "here") {
  return t(reach === "all" ? "agentPage.memory.reachAll" : "agentPage.memory.reachHere");
}

/** "Manter só aqui" or "Levar para todos", for a memory `useMemoryReach` gave a reach. */
export function ReachButton({ agentId, m, reach }: { agentId: string; m: Memory; reach: "all" | "here" }) {
  const { t } = useTranslation();
  const { org } = useOrg();
  const toast = useToast();
  const act = useMemoryAction(org.id, agentId);
  const next = reach === "all" ? "here" : "all";
  return (
    <Button
      variant="link"
      disabled={act.isPending}
      onClick={() =>
        act.mutate(
          { type: "reach", id: m.id, reach: next },
          {
            onSuccess: () => toast.show(t(next === "here" ? "agentPage.memory.keptHere" : "agentPage.memory.sentAll")),
          },
        )
      }
    >
      {t(next === "here" ? "agentPage.memory.keepHere" : "agentPage.memory.sendAll")}
    </Button>
  );
}
