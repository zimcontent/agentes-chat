import "i18next";
import type { en } from "@dougbot/i18n";

// Makes `t("shell.approvals")` type-checked against the English source.
declare module "i18next" {
  interface CustomTypeOptions {
    resources: { translation: typeof en };
  }
}
