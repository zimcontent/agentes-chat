import { Redirect, useLocalSearchParams } from "expo-router";
import { ClientScreen } from "@/features/portal/ClientScreen";
import { isClientSlug } from "@/features/portal/logic";

/** One client of the approval portal (ADR 9001): `/portal/client/<client>`, pushed from the Portal tab. */
export default function PortalClientRoute() {
  const { id, tab } = useLocalSearchParams<{ id: string; tab?: string }>();
  if (!isClientSlug(id)) return <Redirect href="/" />;
  // `?tab=board` (Início's "Alterações") opens on that tab; anything else, the default.
  const start = tab === "board" || tab === "plan" || tab === "posted" || tab === "materials" ? tab : undefined;
  return <ClientScreen key={id} client={id} {...(start ? { initialTab: start } : {})} />;
}
