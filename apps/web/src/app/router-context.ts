import type { ApiClient } from "@dougbot/client";
import type { QueryClient } from "@tanstack/react-query";

/** What route guards (`beforeLoad`) get from the router. */
export interface RouterContext {
  queryClient: QueryClient;
  api: ApiClient;
}
