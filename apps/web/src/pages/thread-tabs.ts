import type { ThreadTab } from "@dougbot/client";

// Apart from the threads page so the route's search check doesn't load the page itself.

/**
 * A channel's conversations and the ones tidied away. Work has its states in Tarefas, missions included, so a
 * conversation has no "Com trabalho", "Missões" or "Fechadas" of its own (ADR doug-0018).
 */
export const THREAD_TABS = ["all", "archived"] as const satisfies readonly ThreadTab[];
export type ThreadsTab = (typeof THREAD_TABS)[number];
