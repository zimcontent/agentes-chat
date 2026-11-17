import { type ErrorBoundaryProps, Redirect, useLocalSearchParams } from "expo-router";
import { isSafeId } from "@/features/shared/logic";
import { ScreenError } from "@/features/shared/ScreenError";
import { WhatsAppNewChatScreen } from "@/features/whatsapp/WhatsAppNewChatScreen";

export function ErrorBoundary(props: ErrorBoundaryProps) {
  return <ScreenError {...props} />;
}

/** A new WhatsApp conversation from a number (`/whatsapp/new?account=<id>`), as a sheet over its list. */
export default function WhatsAppNewChatRoute() {
  const { account } = useLocalSearchParams<{ account?: string }>();
  if (!isSafeId(account)) return <Redirect href="/whatsapp" />;
  return <WhatsAppNewChatScreen accountId={account} />;
}
