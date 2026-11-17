import { type ErrorBoundaryProps, Redirect, useLocalSearchParams } from "expo-router";
import { isSafeId } from "@/features/shared/logic";
import { ScreenError } from "@/features/shared/ScreenError";
import { WhatsAppNumberScreen } from "@/features/whatsapp/WhatsAppNumberScreen";

export function ErrorBoundary(props: ErrorBoundaryProps) {
  return <ScreenError {...props} />;
}

/** One WhatsApp number's settings (`/whatsapp/settings?account=<id>`), pushed from the numbers or their conversations. */
export default function WhatsAppSettingsRoute() {
  const { account } = useLocalSearchParams<{ account?: string }>();
  if (!isSafeId(account)) return <Redirect href="/whatsapp" />;
  return <WhatsAppNumberScreen accountId={account} />;
}
