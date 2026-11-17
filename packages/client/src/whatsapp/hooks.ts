import { useInfiniteQuery, useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useRef } from "react";
import type { ApiClient } from "../api/client";
import { useApi } from "../api/context";
import { keys } from "../api/keys";
import type { WhatsAppAccountPatch, WhatsAppBrainInput, WhatsAppSendInput } from "./types";

/*
 * WhatsApp numbers in the apps. Everything a number's people see refetches on the user event `whatsapp.changed`
 * (the apps invalidate `keys.whatsapp`), so nothing here polls but the QR code, which WhatsApp renews by itself.
 */

/** The client's WhatsApp, or an error on a client without one (an older fake). */
function whatsappOf(api: ApiClient): NonNullable<ApiClient["whatsapp"]> {
  if (!api.whatsapp) throw new Error("This server has no WhatsApp");
  return api.whatsapp;
}

function useWhatsAppRefresh(orgId: string) {
  const qc = useQueryClient();
  return () => qc.invalidateQueries({ queryKey: keys.whatsapp(orgId) });
}

/** The numbers this person may use (every number for someone who manages connectors), and whether the server has a gateway. */
export function useWhatsApp(orgId: string, enabled = true) {
  const api = useApi();
  return useQuery({
    queryKey: keys.whatsappOverview(orgId),
    queryFn: () => whatsappOf(api).overview(orgId),
    enabled: enabled && Boolean(orgId) && Boolean(api.whatsapp),
    // A number waiting for its code to be read is asked again while it waits: the code changes about every 20 s.
    refetchInterval: (query) =>
      query.state.data?.accounts.some((a) => a.manage && (a.status === "pending" || a.status === "qr")) ? 5_000 : false,
  });
}

/** A number's conversations, the latest first, a page at a time. */
export function useWhatsAppChats(orgId: string, accountId: string | null | undefined) {
  const api = useApi();
  return useInfiniteQuery({
    queryKey: keys.whatsappChats(orgId, accountId ?? ""),
    queryFn: ({ pageParam }) => whatsappOf(api).chats(orgId, accountId ?? "", pageParam),
    initialPageParam: undefined as string | undefined,
    getNextPageParam: (last) => last.next ?? undefined,
    enabled: Boolean(orgId) && Boolean(accountId) && Boolean(api.whatsapp),
  });
}

/** A conversation's messages, the latest first, a page at a time. */
export function useWhatsAppMessages(
  orgId: string,
  accountId: string | null | undefined,
  chatId: string | null | undefined,
) {
  const api = useApi();
  return useInfiniteQuery({
    queryKey: keys.whatsappMessages(orgId, accountId ?? "", chatId ?? ""),
    queryFn: ({ pageParam }) => whatsappOf(api).messages(orgId, accountId ?? "", chatId ?? "", pageParam),
    initialPageParam: undefined as string | undefined,
    getNextPageParam: (last) => last.next ?? undefined,
    enabled: Boolean(orgId) && Boolean(accountId) && Boolean(chatId) && Boolean(api.whatsapp),
  });
}

export function useConnectWhatsApp(orgId: string) {
  const api = useApi();
  const refresh = useWhatsAppRefresh(orgId);
  return useMutation({
    mutationFn: (label: string) => whatsappOf(api).connect(orgId, label),
    meta: { silent: true },
    onSuccess: () => void refresh(),
  });
}

export function useReconnectWhatsApp(orgId: string) {
  const api = useApi();
  const refresh = useWhatsAppRefresh(orgId);
  return useMutation({
    mutationFn: (accountId: string) => whatsappOf(api).reconnect(orgId, accountId),
    meta: { silent: true },
    onSuccess: () => void refresh(),
  });
}

export function useUpdateWhatsApp(orgId: string) {
  const api = useApi();
  const refresh = useWhatsAppRefresh(orgId);
  return useMutation({
    mutationFn: ({ accountId, ...patch }: WhatsAppAccountPatch & { accountId: string }) =>
      whatsappOf(api).update(orgId, accountId, patch),
    meta: { silent: true },
    onSuccess: () => void refresh(),
  });
}

export function useRemoveWhatsApp(orgId: string) {
  const api = useApi();
  const refresh = useWhatsAppRefresh(orgId);
  return useMutation({
    mutationFn: (accountId: string) => whatsappOf(api).remove(orgId, accountId),
    meta: { silent: true },
    onSuccess: () => void refresh(),
  });
}

export function useSendWhatsApp(orgId: string, accountId: string) {
  const api = useApi();
  const refresh = useWhatsAppRefresh(orgId);
  return useMutation({
    mutationFn: (input: WhatsAppSendInput) => whatsappOf(api).send(orgId, accountId, input),
    meta: { silent: true },
    onSuccess: () => void refresh(),
  });
}

/** The person opened the conversation: nothing in it is unread, and the other side sees it read. */
export function useReadWhatsAppChat(orgId: string, accountId: string) {
  const api = useApi();
  const refresh = useWhatsAppRefresh(orgId);
  return useMutation({
    mutationFn: (chatId: string) => whatsappOf(api).read(orgId, accountId, chatId),
    meta: { silent: true },
    onSuccess: (done) => {
      if (done.read > 0) void refresh();
    },
  });
}

/** Sends a file or a recording into a conversation. */
export function useSendWhatsAppFile(orgId: string, accountId: string) {
  const api = useApi();
  const refresh = useWhatsAppRefresh(orgId);
  return useMutation({
    mutationFn: (input: { chatId: string; file: Blob; fileName: string; caption?: string; voice?: boolean }) =>
      whatsappOf(api).sendFile(orgId, accountId, input),
    meta: { silent: true },
    onSuccess: () => void refresh(),
  });
}

/** The number's latest stickers, read when the picker's tab opens (`enabled`). */
export function useWhatsAppStickers(orgId: string, accountId: string, enabled: boolean) {
  const api = useApi();
  return useQuery({
    queryKey: keys.whatsappStickers(orgId, accountId),
    queryFn: () => whatsappOf(api).stickers(orgId, accountId),
    enabled,
  });
}

/** Sends a sticker the number already has. */
export function useSendWhatsAppSticker(orgId: string, accountId: string) {
  const api = useApi();
  const refresh = useWhatsAppRefresh(orgId);
  return useMutation({
    mutationFn: (input: { chatId: string; messageId: string }) => whatsappOf(api).sendSticker(orgId, accountId, input),
    meta: { silent: true },
    onSuccess: () => void refresh(),
  });
}

/** Asks the phone for a conversation's older messages; what comes arrives by itself (`whatsapp.changed`). */
export function useWhatsAppOlderHistory(orgId: string, accountId: string) {
  const api = useApi();
  return useMutation({
    mutationFn: (chatId: string) => whatsappOf(api).olderHistory(orgId, accountId, chatId),
    meta: { silent: true },
  });
}

/** The number's agent on or off in one conversation. */
export function useWhatsAppChatAgent(orgId: string, accountId: string) {
  const api = useApi();
  const refresh = useWhatsAppRefresh(orgId);
  return useMutation({
    mutationFn: (input: { chatId: string; on: boolean }) =>
      whatsappOf(api).chatAgent(orgId, accountId, input.chatId, input.on),
    meta: { silent: true },
    onSuccess: () => void refresh(),
  });
}

/** Who a contact is: a member of the workspace, a portal client, or neither. */
export function useWhatsAppChatContact(orgId: string, accountId: string) {
  const api = useApi();
  const refresh = useWhatsAppRefresh(orgId);
  return useMutation({
    mutationFn: (input: { chatId: string; member: string | null; client: string | null }) =>
      whatsappOf(api).chatContact(orgId, accountId, input.chatId, { member: input.member, client: input.client }),
    onSuccess: () => void refresh(),
  });
}

/** The approval portal's clients a contact may be. */
export function useWhatsAppVoices(orgId: string, enabled = true) {
  const api = useApi();
  return useQuery({
    queryKey: keys.whatsappVoices(orgId),
    queryFn: () => whatsappOf(api).voices(orgId),
    enabled,
    staleTime: 10 * 60_000,
  });
}

/** The approval portal's clients a contact may be. */
export function useWhatsAppClients(orgId: string, enabled = true) {
  const api = useApi();
  return useQuery({
    queryKey: keys.whatsappClients(orgId),
    queryFn: () => whatsappOf(api).clients(orgId),
    enabled,
  });
}

/** How often "typing…" is told again while the person keeps writing: WhatsApp drops it after about 10 s. */
const TYPING_EVERY_MS = 5_000;

/**
 * "Typing…" for the other side while the person writes: `typing()` on every keystroke tells it at most every few
 * seconds, `stopped()` ends it (sent, cleared, left). Nothing waits on it and a failure says nothing.
 */
export function useWhatsAppTyping(orgId: string, accountId: string, chatId: string) {
  const api = useApi();
  const last = useRef(0);
  const tell = (on: boolean) => void api.whatsapp?.typing(orgId, accountId, chatId, on).catch(() => {});
  return {
    typing: () => {
      const now = Date.now();
      if (now - last.current < TYPING_EVERY_MS) return;
      last.current = now;
      tell(true);
    },
    stopped: () => {
      if (last.current === 0) return;
      last.current = 0;
      tell(false);
    },
  };
}

/** What thinks on a number, for its settings (managers who may choose its agent's AI). */
export function useWhatsAppBrain(orgId: string, accountId: string, enabled = true) {
  const api = useApi();
  return useQuery({
    queryKey: keys.whatsappBrain(orgId, accountId),
    queryFn: () => whatsappOf(api).brain(orgId, accountId),
    enabled: enabled && Boolean(orgId && accountId) && Boolean(api.whatsapp),
    retry: false,
  });
}

/** Gives the number an AI of its own (`input`), or back its agent's (`null`). */
export function useSetWhatsAppBrain(orgId: string, accountId: string) {
  const api = useApi();
  const refresh = useWhatsAppRefresh(orgId);
  return useMutation({
    mutationFn: (input: WhatsAppBrainInput | null) =>
      input ? whatsappOf(api).setBrain(orgId, accountId, input) : whatsappOf(api).clearBrain(orgId, accountId),
    meta: { silent: true },
    onSuccess: () => void refresh(),
  });
}

/** Rewrites the number's instructions with a direction typed or recorded; answers the draft, saving nothing. */
export function useDraftWhatsAppInstructions(orgId: string, accountId: string) {
  const api = useApi();
  return useMutation({
    mutationFn: (input: {
      text?: string;
      audio?: { file: Blob; fileName: string; seconds?: number };
      current?: string;
    }) => whatsappOf(api).draftInstructions(orgId, accountId, input),
    meta: { silent: true },
  });
}
