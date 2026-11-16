import { usePortalWords } from "@/features/portal/hooks";
import { TabStack } from "@/ui";

/** Portal: a stack whose root has the large title. */
export default function PortalStack() {
  return <TabStack title={usePortalWords().title} />;
}
