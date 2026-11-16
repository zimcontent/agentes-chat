import { Redirect, useLocalSearchParams } from "expo-router";
import { ReviewScreen } from "@/features/review/ReviewScreen";
import { isSafeId } from "@/features/shared/logic";

/** One video's Revisor (`/review/<id>`): from Revisão, a card in a conversation or the review's link. */
export default function ReviewRoute() {
  const { id } = useLocalSearchParams<{ id: string }>();
  if (!isSafeId(id)) return <Redirect href="/reviews" />;
  return <ReviewScreen key={id} id={id} />;
}
