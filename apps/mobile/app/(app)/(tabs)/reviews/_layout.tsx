import { useReviewWords } from "@/features/review/media";
import { TabStack } from "@/ui";

/** Revisão: a stack whose root has the large title. */
export default function ReviewsStack() {
  return <TabStack title={useReviewWords().title} />;
}
