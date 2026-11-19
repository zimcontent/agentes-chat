import { expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import type { AgentWork } from "@dougbot/client";
import { FRONT_MAX, frontOf, toolsHere } from "../../src/features/chats/all-tools";
import { waitingAgents } from "../../src/features/chats/waiting";

// Início's "Esperando sua resposta" (docs/adr/doug-0014-latest-first.md): the agents whose work waits on you.
const work = (state: AgentWork["state"], since: string, ask: AgentWork["ask"] = "answer"): AgentWork => ({
  state,
  ask,
  since,
  runId: `r-${since}`,
  channelId: null,
  channelKind: null,
  channelName: null,
  threadId: null,
  messageId: null,
  forAgentId: null,
  routine: false,
  count: 1,
});

test("only the agents waiting on you, the one waiting longest first, and only the ones in your lists", () => {
  const statuses = [
    { agentId: "rosa", work: work("you", "2026-11-16T10:00:00Z") },
    { agentId: "sony", work: work("you", "2026-11-16T04:00:00Z", "approval") },
    { agentId: "junin", work: work("working", "2026-11-16T09:00:00Z") },
    { agentId: "sac", work: null },
    { agentId: "hidden", work: work("you", "2026-11-16T01:00:00Z") },
  ];
  const listed = (id: string) => id !== "hidden";
  expect(waitingAgents(statuses, listed).map((w) => [w.agentId, w.work.ask])).toEqual([
    ["sony", "approval"],
    ["rosa", "answer"],
  ]);
  expect(waitingAgents([], listed)).toEqual([]);
});

test("Início: no large title, no greeting; the tools lead with Buscar and keep Drive and Agentes in Tudo", () => {
  const src = (f: string) => readFileSync(new URL(`../../src/${f}`, import.meta.url), "utf8");
  expect(src("features/chats/ChatsScreen.tsx")).toContain("      bare\n");
  // WhatsApp, Mídia, Buscar, Tarefas in front before anyone pins: Drive and Agentes behind "Mais".
  const tools = toolsHere({ whatsapp: true, media: true, portal: false, calendar: false, member: true, hidden: [] });
  expect(frontOf(tools, null)).toEqual(["whatsapp", "media", "search", "issues"]);
  expect(FRONT_MAX).toBe(4);
  const sheet = src("features/chats/AllSheet.tsx");
  expect(sheet).toContain('router.push("/new")');
  // The phone has no form for a new agent: the tile asks the right hand.
  expect(sheet).toContain("onPress: () => go(() => createAgent())");
});
