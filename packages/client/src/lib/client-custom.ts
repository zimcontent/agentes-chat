import type { Instance, Me } from "../api/types";

/**
 * The look a server deployed for one client gives the apps (ADR doug-0023): the name they call the product and the
 * color they highlight, read from `GET /me` (`client`), with `GET /api/instance` filling in for a reader that only has
 * that one (the sign-in page, the server picker). A server with no client reads as NO_CLIENT.
 */
export interface ClientLook {
  /** What the apps call the product; null: the build's own name. */
  name: string | null;
  /** The color the apps highlight, `#rrggbb`; null: the build's own. */
  accent: string | null;
}

export const NO_CLIENT: ClientLook = { name: null, accent: null };

/** The client's look as `me` and the instance say it; nothing from either: NO_CLIENT. `me` wins where both speak. */
export function clientLookOf(me: Me | null | undefined, instance?: Instance | null): ClientLook {
  const fromMe = me?.client;
  const fromInstance = instance?.client;
  if (!fromMe && !fromInstance) return NO_CLIENT;
  return {
    name: fromMe?.name ?? fromInstance?.name ?? null,
    accent: fromMe?.accent ?? fromInstance?.accent ?? null,
  };
}

/** The product's name for this server: the client's, else the build's (`fallback`). */
export const productName = (client: ClientLook | null | undefined, fallback: string): string =>
  client?.name?.trim() || fallback;
