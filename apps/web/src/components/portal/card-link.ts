import { portalCardAddress } from "@dougbot/client/lib/portal";
import { useTranslation } from "react-i18next";
import { useOrg } from "@/components/org-context";
import { copyText } from "@/lib/context-menu";
import { useToast } from "@/lib/toast";

/**
 * Copies the address that opens one card of the board in its dialog, to share it: whoever opens it lands on that
 * client's board with the card open, as any member of the workspace may read it.
 */
export function useCopyCardLink() {
  const { t } = useTranslation();
  const { org } = useOrg();
  const toast = useToast();
  return (card: { id: string; client: string }) =>
    void copyText(portalCardAddress(window.location.origin, org.id, card.client, card.id), () =>
      toast.show(t("portal.card.linkCopied")),
    );
}
