import { Redirect, useLocalSearchParams } from "expo-router";
import { ClientScreen } from "@/features/portal/ClientScreen";
import { isClientSlug } from "@/features/portal/logic";

/** One client of the approval portal (ADR 9001): `/portal/client/<client>`, pushed from the Portal tab. */
export default function PortalClientRoute() {
  const { id } = useLocalSearchParams<{ id: string }>();
  if (!isClientSlug(id)) return <Redirect href="/" />;
  return <ClientScreen key={id} client={id} />;
}
