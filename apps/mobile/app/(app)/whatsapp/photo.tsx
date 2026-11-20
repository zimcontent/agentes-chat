import { Redirect, useLocalSearchParams } from "expo-router";
import { isSafeId } from "@/features/shared/logic";
import { WhatsAppPhotoScreen } from "@/features/whatsapp/WhatsAppPhotoScreen";

/** A WhatsApp photo full screen (`/whatsapp/photo?account=<id>&message=<id>&title=…&sub=…`), over its conversation. */
export default function WhatsAppPhotoRoute() {
  const { account, message, title, sub } = useLocalSearchParams<{
    account?: string;
    message?: string;
    title?: string;
    sub?: string;
  }>();
  if (!isSafeId(account) || !isSafeId(message)) return <Redirect href="/whatsapp" />;
  return <WhatsAppPhotoScreen accountId={account} messageId={message} title={title ?? ""} sub={sub ?? ""} />;
}
