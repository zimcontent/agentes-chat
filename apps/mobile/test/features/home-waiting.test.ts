import { expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import type { AgentWork } from "@agenteschat/client";
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

test("Início: no large title, no greeting; the tools lead with Buscar and keep Drive and Agentes in Mais", () => {
  const src = (f: string) => readFileSync(new URL(`../../src/${f}`, import.meta.url), "utf8");
  expect(src("features/chats/ChatsScreen.tsx")).toContain("      bare\n");
  const tools = src("features/chats/HomeTools.tsx");
  // WhatsApp, Mídia, Buscar, Tarefas in front: Drive and Agentes come after them, so behind "Mais".
  const order = ['key: "whatsapp"', 'key: "media"', 'key: "search"', 'key: "issues"', 'key: "drive"', 'key: "team"'];
  const at = order.map((k) => tools.indexOf(k));
  expect(at.every((i) => i > 0)).toBe(true);
  expect([...at].sort((a, b) => a - b)).toEqual(at);
  expect(tools).toContain("const FRONT = 4;");
  expect(tools).toContain('href: "/new-agent"');
  // The phone has no form for it: the tool asks the right hand.
  expect(tools).toContain('if (tool?.key === "new-agent") createAgent();');
});
