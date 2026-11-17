import { type ErrorBoundaryProps, Redirect, useLocalSearchParams } from "expo-router";
import { isSafeId } from "@/features/shared/logic";
import { ScreenError } from "@/features/shared/ScreenError";
import { WhatsAppNumberAiScreen } from "@/features/whatsapp/WhatsAppNumberAiScreen";

export function ErrorBoundary(props: ErrorBoundaryProps) {
  return <ScreenError {...props} />;
}

/** What thinks on one WhatsApp number (`/whatsapp/ai?account=<id>`), pushed from its settings. */
export default function WhatsAppNumberAiRoute() {
  const { account } = useLocalSearchParams<{ account?: string }>();
  if (!isSafeId(account)) return <Redirect href="/whatsapp" />;
  return <WhatsAppNumberAiScreen accountId={account} />;
}
