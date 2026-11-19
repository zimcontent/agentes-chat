import { type ApiClient, ApiProvider as SharedApiProvider } from "@dougbot/client";
import { playAgentReaction } from "@dougbot/ui";
import type { ReactNode } from "react";

export { useApi } from "@dougbot/client";

/** The shared provider with the web's effects (an agent's face on 👍/👎). */
export function ApiProvider({ client, children }: { client: ApiClient; children: ReactNode }) {
  return (
    <SharedApiProvider client={client} onAgentReaction={playAgentReaction}>
      {children}
    </SharedApiProvider>
  );
}
