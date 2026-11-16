import type { WhatsAppAccount, WhatsAppChat, WhatsAppMessage, WhatsAppOverview } from "@agenteschat/client";
import type { WhatsAppWords } from "./words";

/*
 * The WhatsApp screens' pure rules (docs/adr/doug-0001-whatsapp-numbers.md), kept apart from React so they are
 * unit-tested: whether the feature shows, where the first screen goes, and how a conversation and a message read.
 */

/**
 * WhatsApp shows when the server has a gateway and the person has a number, or may connect the first one: the web's
 * rule for its sidebar.
 */
export function whatsappShown(overview: Pick<WhatsAppOverview, "on" | "manage" | "accounts"> | undefined): boolean {
  return Boolean(overview?.on) && Boolean(overview?.manage || (overview?.accounts.length ?? 0) > 0);
}

/** Where WhatsApp opens: with a single number, straight on its conversations (null: the list of numbers). */
export function onlyAccount(accounts: readonly WhatsAppAccount[]): string | null {
  return accounts.length === 1 ? (accounts[0]?.id ?? null) : null;
}

/** The numbers in the order a person wants them: their own first, then by name. */
export function accountsInOrder(accounts: readonly WhatsAppAccount[]): WhatsAppAccount[] {
  return [...accounts].sort((a, b) => Number(b.mine) - Number(a.mine) || a.label.localeCompare(b.label));
}

/** A number as WhatsApp writes it: "+55 11 99999-0000" for a Brazilian one, "+<digits>" for anyone else. */
export function showPhone(digits: string | null | undefined): string {
  if (!digits) return "";
  const br = /^55(\d{2})(\d{4,5})(\d{4})$/.exec(digits);
  return br ? `+55 ${br[1]} ${br[2]}-${br[3]}` : `+${digits}`;
}

/** What a conversation is called: the name WhatsApp told, else its number, else what kind it is. */
export function chatTitle(chat: Pick<WhatsAppChat, "name" | "phone" | "group">, w: WhatsAppWords): string {
  return chat.name || showPhone(chat.phone) || (chat.group ? w.group : w.unknown);
}

type Kind = keyof WhatsAppWords["kind"];
const isKind = (kind: string, w: WhatsAppWords): kind is Kind => kind in w.kind;

/** A message's words in a list: its text, or its kind's name when it has none. */
export function previewOf(kind: string, text: string, w: WhatsAppWords): string {
  if (text) return text;
  if (isKind(kind, w)) return w.kind[kind];
  return kind === "text" ? "" : w.kind.other;
}

/** A conversation's last line: "Você: …" when it was ours. */
export function lastLine(chat: Pick<WhatsAppChat, "lastKind" | "lastText" | "lastFromMe">, w: WhatsAppWords): string {
  const words = previewOf(chat.lastKind, chat.lastText, w);
  return chat.lastFromMe && words ? `${w.you}: ${words}` : words;
}

/** How a message's file is drawn: a picture, a voice to play, or a row that names it. */
export type FileShape = "picture" | "sticker" | "audio" | "row" | null;

export function fileShape(message: Pick<WhatsAppMessage, "kind" | "file" | "media">): FileShape {
  if (message.kind === "text" || message.kind === "deleted") return null;
  // Nothing to fetch (WhatsApp told no file, or kept none): the row names it.
  if (!message.media || !message.file) return "row";
  if (message.kind === "image") return "picture";
  if (message.kind === "sticker") return "sticker";
  if (message.kind === "audio") return "audio";
  return "row";
}

/** "0:07", "1:32": a voice message's length. */
export function clockOf(seconds: number | null | undefined): string {
  const total = Math.max(0, Math.round(seconds ?? 0));
  return `${Math.floor(total / 60)}:${String(total % 60).padStart(2, "0")}`;
}

/** The text above a conversation the agent left to a person: why, in its words or ours. */
export function handedLine(note: string, w: WhatsAppWords): string {
  if (note === "limit") return w.agent.limit;
  if (note === "failed") return w.agent.failed;
  if (note.startsWith("failed: ")) return w.agent.failedWhy(note.slice(8));
  if (note && note !== "handoff") return `${w.agent.handed} ${note}`;
  return w.agent.handed;
}

/** The local day a moment falls on ("2026-11-16"), to put a divider where the day changes. */
export function dayKey(iso: string): string {
  const d = new Date(iso);
  return `${d.getFullYear()}-${d.getMonth() + 1}-${d.getDate()}`;
}

/**
 * In a list drawn latest first (inverted: the screen reads it from the bottom up), whether a day divider goes above
 * the message at `index`: it is the oldest one loaded, or the one before it in time fell on another day.
 */
export function startsDay(messages: readonly Pick<WhatsAppMessage, "at">[], index: number, complete: boolean): boolean {
  const here = messages[index];
  if (!here) return false;
  const older = messages[index + 1];
  if (!older) return complete;
  return dayKey(older.at) !== dayKey(here.at);
}

/** A file the server takes: up to 32 MB (the web's limit). */
export const FILE_MAX = 32 * 1024 * 1024;
