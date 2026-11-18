import { readValueSync, STORED, writeValue } from "@/lib/storage";
import { type ComputerAsk, computerAskOf, storedComputerAsk } from "./logic";

/**
 * "Conectar computador", asked for while picking who joins the Doug team (docs/adr/doug-0030-time-doug.md): kept for
 * the workspace it was asked in, in the storage the app already remembers the first run's own values in, so a tap
 * survives the app closing before the team is made. Read back here when the first run opens the same workspace again.
 */
export const askedComputer = (orgId: string): ComputerAsk | null =>
  computerAskOf(readValueSync(STORED.dougComputer), orgId);

/** The ask as it is now; `null` forgets it (no ask, or the flow went past it). */
export const keepComputerAsk = (ask: { orgId: string; needs: readonly unknown[]; made: boolean } | null) =>
  void writeValue(STORED.dougComputer, ask ? storedComputerAsk(ask.orgId, ask.needs, ask.made) : null);
