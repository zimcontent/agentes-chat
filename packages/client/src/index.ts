/**
 * @dougbot/client: what the web app and the phone app share (ADR 0035):
 * the API types and client, query keys, React Query options and hooks, and
 * realtime. DOM-free: platform effects come in as options. The helpers live
 * under `@dougbot/client/lib/<name>`.
 */
import type { ApiClient } from "./api/client";
import type { FetchLike } from "./api/http";
import { createHttpApi } from "./api/http-client";

export * from "./api/client";
export * from "./api/context";
export * from "./api/http";
export * from "./api/http-client";
export * from "./api/keys";
export * from "./api/missions";
export * from "./api/outbox";
export * from "./api/queries";
export * from "./api/snapshot";
export * from "./api/types";
export * from "./browser";
export * from "./dashboards";
export * from "./desktop";
export * from "./lib/client-custom";
export * from "./lib/doug-team";
export * from "./media/brand";
export * from "./media/inputs";
export * from "./media/queries";
export * from "./media/types";
export * from "./realtime/connection";
export * from "./realtime/consults";
export * from "./realtime/machines";
export * from "./realtime/receipts";
export * from "./realtime/steer";
export * from "./realtime/streams";
export * from "./realtime/typing";
export * from "./vault/hooks";
export * from "./vault/types";
export * from "./video-reviews/hooks";
export * from "./video-reviews/tabs";
export * from "./video-reviews/types";
export * from "./video-reviews/words";
export * from "./whatsapp/hooks";
export * from "./whatsapp/types";

/** The client the web app uses: the real backend on the same origin (`/api/health`, `/api/app/*`). */
export function createApiClient(options: { fetch?: FetchLike } = {}): ApiClient {
  return createHttpApi({ fetch: options.fetch });
}
