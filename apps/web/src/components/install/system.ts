import type { Platform } from "@agenteschat/client/lib/machines";

// Doug: apart from guide.tsx, so the `/download` route's search check doesn't load the guide and its drawings with the
// first screen (guide.tsx re-exports these).

/** The systems as the `/download` page's address names them (`?system=`). */
export type InstallSystem = Platform;
export const INSTALL_SYSTEMS: InstallSystem[] = ["mac", "windows", "linux"];

export function systemOfParam(value: unknown): InstallSystem | undefined {
  return INSTALL_SYSTEMS.find((s) => s === value);
}
