import { type ErrorBoundaryProps, Redirect, useLocalSearchParams } from "expo-router";
import { isSafeId } from "@/features/shared/logic";
import { ScreenError } from "@/features/shared/ScreenError";
import { WhatsAppConversationScreen } from "@/features/whatsapp/WhatsAppConversationScreen";

export function ErrorBoundary(props: ErrorBoundaryProps) {
  return <ScreenError {...props} />;
}

/** One WhatsApp conversation (`/whatsapp/chat?account=<id>&chat=<id>`). */
export default function WhatsAppChatRoute() {
  const { account, chat } = useLocalSearchParams<{ account?: string; chat?: string }>();
  if (!isSafeId(account)) return <Redirect href="/whatsapp" />;
  if (!isSafeId(chat)) return <Redirect href={`/whatsapp/${account}`} />;
  return <WhatsAppConversationScreen key={`${account}:${chat}`} accountId={account} chatId={chat} />;
}
