import { useMe } from "@agenteschat/client";
import type { HeaderAction } from "@/ui";
import { useDirectory, useMeId } from "./hooks";
import { usePersonPhoto } from "./photo";

/**
 * Your name and photo as the directory has them (as Ajustes shows them): `me` comes from the session, which the
 * server caches for minutes, so a new photo would show late. A personal workspace's mark (ADR 0159).
 */
export function useMyFace(): { name: string; photo: ReturnType<typeof usePersonPhoto> } {
  const me = useMe();
  const meId = useMeId();
  const dir = useDirectory();
  const mine = meId ? dir.memberById.get(meId) : undefined;
  const photo = usePersonPhoto(mine?.avatarUrl ?? mine?.image ?? me.data?.user.image);
  return { name: me.data?.user.name ?? "", photo };
}

/**
 * The bar of the tabs: DougBot's signature alone in the middle, nothing on its sides. The workspace and your photo
 * live in Ajustes (its tab, and Workspaces inside it); "New" is a row of Início's "Mais". A tab adds its own buttons
 * to `actions` (Pendentes' "clear all").
 */
export function useTabHeader(): { actions: HeaderAction[]; brand: true } {
  return { actions: [], brand: true };
}
