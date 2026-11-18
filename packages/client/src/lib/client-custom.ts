import type { Instance, Me } from "../api/types";

/**
 * The look a server deployed for one client gives the apps (ADR doug-0032): the name they call the product and the
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

/** A color the apps may paint, `#rrggbb`: the shape the server's `config.json` refuses anything else for. */
const HEX = /^#[0-9a-f]{6}$/i;

/** The color to paint, or null: what a server answers is read once more here, so an old or odd one paints nothing. */
const accentOf = (color: string | null | undefined): string | null =>
  typeof color === "string" && HEX.test(color) ? color : null;

/**
 * The client's look as `me` and the instance say it; nothing from either: NO_CLIENT. `me` wins where both speak. A
 * server with no client sends neither (`client` absent, ADR doug-0032), so the apps read exactly as they do on one
 * that predates the field.
 */
export function clientLookOf(me: Me | null | undefined, instance?: Instance | null): ClientLook {
  const fromMe = me?.client;
  const fromInstance = instance?.client;
  if (!fromMe && !fromInstance) return NO_CLIENT;
  const name = fromMe?.name ?? fromInstance?.name ?? null;
  const accent = fromMe?.accent ?? fromInstance?.accent ?? null;
  return {
    name: typeof name === "string" && name.trim() ? name : null,
    accent: accentOf(accent),
  };
}

/** The product's name for this server: the client's, else the build's (`fallback`). */
export const productName = (client: ClientLook | null | undefined, fallback: string): string =>
  client?.name?.trim() || fallback;
