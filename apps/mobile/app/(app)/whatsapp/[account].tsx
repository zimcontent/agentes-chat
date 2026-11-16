import { type ErrorBoundaryProps, Redirect, useLocalSearchParams } from "expo-router";
import { isSafeId } from "@/features/shared/logic";
import { ScreenError } from "@/features/shared/ScreenError";
import { WhatsAppChatsScreen } from "@/features/whatsapp/WhatsAppChatsScreen";

export function ErrorBoundary(props: ErrorBoundaryProps) {
  return <ScreenError {...props} />;
}

/** One WhatsApp number's conversations (`/whatsapp/<accountId>`). */
export default function WhatsAppAccountRoute() {
  const { account } = useLocalSearchParams<{ account: string }>();
  if (!isSafeId(account)) return <Redirect href="/whatsapp" />;
  return <WhatsAppChatsScreen key={account} accountId={account} />;
}
