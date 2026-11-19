import { ApiError, keys, useWhatsApp } from "@dougbot/client";
import { errorText } from "@dougbot/client/lib/errors";
import { useQueryClient } from "@tanstack/react-query";
import { useFocusEffect } from "expo-router";
import { useCallback } from "react";
import { useTranslation } from "react-i18next";
import { appHeaders, lastCookie } from "@/lib/auth";
import { serverUrl } from "@/lib/server";
import { router } from "@/ui/navigation";
import { useOrgId } from "../shared/hooks";
import { whatsappShown } from "./rules";
import { useWhatsAppWords } from "./words";

export * from "./rules";

/**
 * Whether WhatsApp is in sight on this phone (the home's tile): the server has a gateway and the person has a number
 * or may connect one, as the web's sidebar decides.
 */
export function useWhatsAppShown(): boolean {
  return whatsappShown(useWhatsApp(useOrgId()).data);
}

/** One of the server's WhatsApp files (a photo, a sticker, a voice) as an image or the player loads it: with the session. */
export const ownFile = (path: (base: string) => string) => ({
  uri: path(serverUrl()),
  headers: appHeaders(lastCookie()),
});

/** What to say of a failed call: our words when the gateway refused, the app's for anything else (as the web's). */
export function useWhatsAppSay() {
  const { t } = useTranslation();
  const w = useWhatsAppWords();
  const ours: Record<string, string> = {
    "whatsapp.unavailable": w.errors.unavailable,
    "whatsapp.new_chats_limit": w.errors.newChatsLimit,
    "whatsapp.voice_off": w.errors.voiceOff,
    "whatsapp.unheard": w.errors.unheard,
    "whatsapp.recording_long": w.errors.recordingLong,
    "whatsapp.ai_busy": w.errors.aiBusy,
    "whatsapp.no_agent": w.errors.noAgent,
  };
  return (error: unknown) =>
    (error instanceof ApiError && error.code ? ours[error.code] : undefined) ?? errorText(t, error);
}

/**
 * While a WhatsApp screen is in front, what it shows is asked again now and then: the phone's realtime doesn't pass the
 * user event `whatsapp.changed` on yet, which is what refreshes the web. Stops when the screen goes behind another.
 */
export function useWhatsAppKeepFresh(key: readonly unknown[] | null, everyMs: number) {
  const qc = useQueryClient();
  const keyText = key ? JSON.stringify(key) : "";
  useFocusEffect(
    // biome-ignore lint/correctness/useExhaustiveDependencies: the key is compared by its text, a new array each render
    useCallback(() => {
      if (!key) return;
      const timer = setInterval(() => void qc.invalidateQueries({ queryKey: key }), everyMs);
      return () => clearInterval(timer);
    }, [keyText, everyMs, qc]),
  );
}

/** The whole of a workspace's WhatsApp, for a pull to refresh. */
export const whatsappKey = (orgId: string) => keys.whatsapp(orgId);

/** Opens a number's conversations. */
export const openWhatsAppAccount = (accountId: string) => router.push(`/whatsapp/${accountId}`);

/** Opens one conversation of a number. */
export const openWhatsAppChat = (accountId: string, chatId: string) =>
  router.push(`/whatsapp/chat?account=${encodeURIComponent(accountId)}&chat=${encodeURIComponent(chatId)}`);
