import { useLocalSearchParams } from "expo-router";
import { SendWorkScreen } from "@/features/review/SendWorkScreen";
import { isSafeId } from "@/features/shared/logic";

/** "Mandar para revisão" (docs/adr/doug-0015-team-work-review.md), pushed from Revisão; `?next=<id>`: its next version. */
export default function SendWorkRoute() {
  const { next } = useLocalSearchParams<{ next?: string }>();
  return <SendWorkScreen {...(isSafeId(next) ? { next } : {})} />;
}
