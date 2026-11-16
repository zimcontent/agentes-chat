import { useTranslation } from "react-i18next";
import { TabStack } from "@/ui";

/** Início, the first tab and the app's home (`/`): a stack whose root has the native large title. */
export default function ChatsStack() {
  const { t } = useTranslation();
  return <TabStack title={t("shell.home")} />;
}
