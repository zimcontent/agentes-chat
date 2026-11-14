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
  /** The person is on its list. */
  mine: boolean;
  /** The person may change or remove it. */
  manage: boolean;
  createdAt: string;
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
  status: WhatsAppMessageStatus;
  /** Who wrote it in the app; null: from the phone. */
  sentByUserId: string | null;
  /** The agent that wrote it. */
  sentByAgentId: string | null;
  at: string;
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
}

export interface WhatsAppSendInput {
  chatId?: string;
  /** With its country code: starts a conversation. */
  phone?: string;
  text: string;
  replyToId?: string | null;
}
