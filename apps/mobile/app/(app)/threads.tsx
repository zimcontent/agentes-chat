import { Redirect } from "expo-router";

/**
 * Threads aren't a place of their own (ADR doug-0018): what has to be done is in Tarefas, missions included, and a
 * thread opens from its conversation. An older link (`agenteschat://threads`) lands on the tasks.
 */
export default function ThreadsRoute() {
  return <Redirect href="/issues" />;
}
