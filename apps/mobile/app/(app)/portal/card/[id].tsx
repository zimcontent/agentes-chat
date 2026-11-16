import { Redirect, useLocalSearchParams } from "expo-router";
import { CardScreen } from "@/features/portal/CardScreen";
import { isClientSlug, isPortalId } from "@/features/portal/logic";

/** One card of a client's board (ADR 9001): `/portal/card/<id>?client=<client>`. */
export default function PortalCardRoute() {
  const { id, client } = useLocalSearchParams<{ id: string; client?: string }>();
  if (!isPortalId(id) || !isClientSlug(client)) return <Redirect href="/" />;
  return <CardScreen key={id} client={client} cardId={id} />;
}
