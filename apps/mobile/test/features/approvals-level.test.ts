import { expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const read = (path: string) => readFileSync(join(import.meta.dir, "..", "..", "src", path), "utf8");

test("Settings → Aprovações: the workspace's level for who manages agents, with its ⓘ and how many keep their own", () => {
  const row = read("features/agents/ApprovalsLevelRow.tsx");
  expect(row).toContain(
    'hint={{ name: t("common.about", { label: title }), text: t("approvalsLevel.workspaceHelp") }}',
  );
  expect(row).toContain('t("approvalsLevel.ownAgents", { count: own })');
  expect(row).toContain("set.mutate({ level: next }, { onError: failed })");
  expect(row).toContain("disabled={set.isPending || !settings.data}");
  const general = read("features/settings/GeneralScreen.tsx");
  expect(general).toMatch(/can\(org, "manage_agents"\) \? \(\s*<>\s*<WorkspaceApprovalsRow \/>/);
});

test("Mudar quando perguntar: in the approval sheet's Da próxima vez and under a notification's decision", () => {
  const when = read("features/approvals/when-asks.tsx");
  // Only for who decides it and may set the agent's level; the switch for every agent only for who manages agents.
  expect(when).toContain("changesWhenAsks(org, approval)");
  expect(when).toContain('toggle: { label: t("approvalsLevel.everyAgent")');
  // A choice approves nothing: it saves the level, then a toast with Desfazer.
  expect(when).not.toContain("useDecideApproval");
  expect(when).toContain("{ agentId: agent.id, level: next, everyAgent }");
  expect(when).toContain('label: t("approvalsLevel.undo")');
  expect(when).toContain("undo.mutate({ before, everyAgent }");
  const sheet = read("features/approvals/ApprovalSheet.tsx");
  expect(sheet).toContain("(approveAlwaysOffered(a) || when.shown)");
  expect(sheet).toMatch(/label=\{t\("approvalsLevel\.change"\)\}[\s\S]*?chevron[\s\S]*?onPress=\{when\.open\}/);
  // Pendentes: on the card's foot line, under the decision, only where it shows.
  expect(read("features/activity/ActivityScreen.tsx")).toContain(
    "footNote={decidable && whenAsks.shown ? <WhenAsksLink approval={decidable} /> : undefined}",
  );
  // The conversation's cards, one request or several, as the web's.
  const cards = read("features/chat/cards.tsx");
  expect(cards).toContain("<WhenAsksLink approval={a} />");
  expect(cards).toContain("{decider ? <WhenAsksLink approval={decider} /> : null}");
  // The right hand's routine group, when one agent asked them all.
  expect(read("features/ai/OfferApprovals.tsx")).toContain("{oneAgent ? <WhenAsksLink approval={oneAgent} /> : null}");
  // The picker's switch starts off on every ask and tells the caller each change.
  const picker = read("features/shared/PickerSheet.tsx");
  expect(picker).toContain("setToggled(false);");
  expect(picker).toContain("ask.toggle?.onChange(on);");
});
