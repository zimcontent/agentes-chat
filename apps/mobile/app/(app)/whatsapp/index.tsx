import type { ErrorBoundaryProps } from "expo-router";
import { ScreenError } from "@/features/shared/ScreenError";
import { WhatsAppScreen } from "@/features/whatsapp/WhatsAppScreen";

/** A screen that breaks while drawing says what happened in its own place; back still goes back. */
export function ErrorBoundary(props: ErrorBoundaryProps) {
  return <ScreenError {...props} />;
}

/** WhatsApp (docs/adr/doug-0001-whatsapp-numbers.md): the workspace's numbers, pushed from the home. */
export default function WhatsAppRoute() {
  return <WhatsAppScreen />;
}
