import { Redirect, useLocalSearchParams } from "expo-router";
import { isClientSlug, isPortalId } from "@/features/portal/logic";
import { PostScreen } from "@/features/portal/PostScreen";

/** A post at the portal no card stands for (ADR 9001): `/portal/post/<id>?client=<client>`. */
export default function PortalPostRoute() {
  const { id, client } = useLocalSearchParams<{ id: string; client?: string }>();
  if (!isPortalId(id) || !isClientSlug(client)) return <Redirect href="/" />;
  return <PostScreen key={id} client={client} itemId={id} />;
}
