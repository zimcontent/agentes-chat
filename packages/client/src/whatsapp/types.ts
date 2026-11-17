import type { AgentBrain, AgentBrainLine, BrainKind } from "../api/types";
/** WhatsApp numbers as the apps read them (`apps/server/src/routes/app/whatsapp.ts`). */

export type WhatsAppStatus = "pending" | "qr" | "connected" | "disconnected" | "logged_out";

export interface WhatsAppAccount {
  id: string;
  label: string;
  status: WhatsAppStatus;
  /** The number's digits once connected. */
  phone: string | null;
  /** The name the phone shows for itself (outside text). */
  pushName: string;
  /** A `data:image/png` address to show now; null when there is none. */
  qr: string | null;
  /** User ids who read and answer its conversations. */
  people: string[];
  /** The agent that answers it; null: only people. */
  agentId: string | null;
  /** How the agent carries itself on this number (Markdown); null for someone who can't change the number. */
  instructions: string | null;
  /** The agent answers this number's conversations now. */
  agentOn: boolean;
  /** How the agent talks here. */
  agentStyle: WhatsAppAgentStyle;
  /** The number answers with an AI of its own (`brain` calls); false: with its agent's. Absent on older servers. */
  ownAi?: boolean;
  /** The person is on its list. */
  mine: boolean;
  /** The person may change or remove it. */
  manage: boolean;
  createdAt: string;
}

export type WhatsAppPace = "fast" | "natural" | "slow";

export interface WhatsAppAgentStyle {
  /** Seconds it waits after a message before reading the conversation (3 to 300). */
  waitSeconds: number;
  pace: WhatsAppPace;
  /** The most messages one answer is split in (1 to 3). */
  messages: number;
  /** Minutes it stays quiet in a conversation after a person wrote there (5 to 1440). */
  quietMinutes: number;
  /** It sends voice notes: always to a voice message, now and then on its own. Absent on older servers. */
  voiceNotes?: boolean;
  /** The voice it speaks in (`voices`); null: the default one. */
  voice?: string | null;
}

export interface WhatsAppOverview {
  /** The server has a gateway. */
  on: boolean;
  /** The person may connect numbers. */
  manage: boolean;
  accounts: WhatsAppAccount[];
}

export interface WhatsAppChat {
  id: string;
  phone: string | null;
  /** Outside text; empty until WhatsApp tells one. */
  name: string;
  group: boolean;
  lastAt: string | null;
  lastText: string;
  lastKind: string;
  lastFromMe: boolean;
  /** While the latest message is ours: how far it got (the list's ticks). Absent on older servers. */
  lastStatus?: WhatsAppMessageStatus | null;
  unread: number;
  /**
   * Where the number's agent stands here: `on` (it answers), `quiet` (a person wrote here less than an hour ago),
   * `off` (someone turned it off here), `person` (it left the conversation to a person). null: no agent answers it.
   */
  agent: WhatsAppChatAgent | null;
  /** While `quiet`: when it answers again. */
  agentQuietUntil: string | null;
  /** While `person`: why, in the agent's words (a model's: text only), or `limit` or `failed`. */
  agentNote: string;
  /** Its profile photo may be loaded (`whatsappPhotoUrl`); false: draw its initials. Absent on older servers. */
  photo?: boolean;
  /** The contact is this member of the workspace (user id): their messages go to their conversation with the agent. */
  member?: string | null;
  /** The contact is this client of the approval portal: the agent's answers read their own work. */
  client?: string | null;
}

export type WhatsAppChatAgent = "on" | "quiet" | "off" | "person";

export type WhatsAppMessageStatus = "received" | "sent" | "delivered" | "read";

export interface WhatsAppMessage {
  id: string;
  chatId: string;
  fromMe: boolean;
  senderName: string;
  senderPhone: string | null;
  kind: string;
  /** Outside text. */
  body: string;
  replyToId: string | null;
  media: { mimeType: string; fileName: string | null; seconds: number | null } | null;
  /** Its file can be loaded (`whatsappFileUrl`). */
  file: boolean;
  status: WhatsAppMessageStatus;
  /** Who wrote it in the app; null: from the phone. */
  sentByUserId: string | null;
  /** The agent that wrote it. */
  sentByAgentId: string | null;
  at: string;
}

/**
 * Where a message's file loads from: our server, which fetches it from WhatsApp. `base` is the server for the
 * phone app (`""` on the web: the same origin).
 */
export function whatsappFileUrl(orgId: string, accountId: string, messageId: string, base = "") {
  const path = `/api/app/organizations/${encodeURIComponent(orgId)}/whatsapp/accounts/${encodeURIComponent(accountId)}/messages/${encodeURIComponent(messageId)}/file`;
  return `${base.replace(/\/+$/, "")}${path}`;
}

/** Where a conversation's profile photo loads from (our server fetches it from WhatsApp); null when it has none. */
export function whatsappPhotoUrl(
  orgId: string,
  accountId: string,
  chat: Pick<WhatsAppChat, "id" | "photo">,
  base = "",
) {
  if (!chat.photo) return null;
  const path = `/api/app/organizations/${encodeURIComponent(orgId)}/whatsapp/accounts/${encodeURIComponent(accountId)}/chats/${encodeURIComponent(chat.id)}/photo`;
  return `${base.replace(/\/+$/, "")}${path}`;
}

/** The voices a number's agent may speak in: `on` false when the server has no voice. */
export interface WhatsAppVoices {
  on: boolean;
  default: string;
  voices: { id: string; name: string; labels: string[] }[];
}

/** Where a voice's sample loads from (our server fetches it from the provider). */
export function whatsappVoicePreviewUrl(orgId: string, voiceId: string, base = "") {
  const path = `/api/app/organizations/${encodeURIComponent(orgId)}/whatsapp/voices/${encodeURIComponent(voiceId)}/preview`;
  return `${base.replace(/\/+$/, "")}${path}`;
}

export interface WhatsAppChatPage {
  chats: WhatsAppChat[];
  next: string | null;
}

export interface WhatsAppMessagePage {
  chat: WhatsAppChat;
  /** The latest first. */
  messages: WhatsAppMessage[];
  next: string | null;
}

export interface WhatsAppAccountPatch {
  label?: string;
  people?: string[];
  agentId?: string | null;
  instructions?: string;
  agentOn?: boolean;
  agentStyle?: Partial<WhatsAppAgentStyle>;
}

export interface WhatsAppSendInput {
  chatId?: string;
  /** With its country code: starts a conversation. */
  phone?: string;
  text: string;
  replyToId?: string | null;
}

/**
 * What thinks on a number (`GET …/whatsapp/accounts/{id}/brain`, docs/adr/doug-0004-whatsapp-bridge.md): its agent's
 * brain view with the number's own choice in its place. The agent stays who answers; only what thinks changes here.
 */
export interface WhatsAppBrain extends AgentBrain {
  /** The number answers with an AI of its own; false: with its agent's. */
  own: boolean;
  /** The API model the picker marks: the number's, else the agent's. */
  apiModel: string;
  /** What thinks here, as an agent's `brain` line (`agentThinks`). */
  line: AgentBrainLine | null;
}

/** A pick for the number: the model picker's choice for a plan (`brain`) or the API model (`model`). */
export interface WhatsAppBrainInput {
  brain?: { brain?: BrainKind; model?: string | null; account?: string | null; effort?: string | null } | null;
  model?: string;
}
