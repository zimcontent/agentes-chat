import { useTranslation } from "react-i18next";
import { TabStack } from "@/ui";

/** Esperando você: a stack whose root has the native large title. */
export default function ActivityStack() {
  const { t } = useTranslation();
  return <TabStack title={t("shell.waiting")} />;
}
