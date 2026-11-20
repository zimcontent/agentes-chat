import type { LiveRun } from "@dougbot/client";
import { Sheet } from "@/ui";
import { useDirectory } from "../shared/hooks";
import { agentLook } from "../shared/logic";
import { TurnTools } from "./ToolCalls";
import { turnItems } from "./turn";

/**
 * A working agent's steps, opened from the working line (`WorkingLine`), as the web's `BarStep` opens them over its
 * bar: the reply's own block, already open, in a sheet. Never drawn in the line itself: the live row shows no tools
 * (the reply brings them whole), so they stay folded behind that one line until someone asks for them. The messages it
 * read stay in the conversation: the sheet is the block alone.
 */
export function StepsSheet({
  run,
  agentId,
  agentName,
  open,
  onClose,
}: {
  run: LiveRun | undefined;
  agentId: string;
  agentName: string;
  open: boolean;
  onClose: () => void;
}) {
  const dir = useDirectory();
  return (
    <Sheet open={open && Boolean(run)} onClose={onClose}>
      {run ? (
        <TurnTools
          open
          items={turnItems(run).filter((i) => i.kind !== "steer")}
          agentName={agentName}
          color={agentLook(dir.agentById.get(agentId)).color}
          quoteOf={() => undefined}
        />
      ) : null}
    </Sheet>
  );
}
