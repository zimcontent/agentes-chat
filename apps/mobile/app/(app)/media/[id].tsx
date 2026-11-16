import { Redirect, useLocalSearchParams } from "expo-router";
import { GenerationScreen } from "@/features/media-gen/GenerationScreen";
import { isSafeId } from "@/features/shared/logic";

/** One generation (`/media/<id>`), from Mídia's gallery. */
export default function GenerationRoute() {
  const { id } = useLocalSearchParams<{ id: string }>();
  if (!isSafeId(id)) return <Redirect href="/media" />;
  return <GenerationScreen key={id} id={id} />;
}
