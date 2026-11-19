import type { WhatsAppAccount, WhatsAppChat, WhatsAppMessage, WhatsAppOverview } from "@dougbot/client";
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

/** The list's filters, as WhatsApp's own row of them. */
export type ChatFilter = "all" | "unread" | "groups";

/** Whether a conversation's words hold every word searched for (its name, number or last line), any case or accent. */
function matches(chat: WhatsAppChat, query: string, w: WhatsAppWords): boolean {
  const fold = (s: string) => s.normalize("NFD").replace(/\p{M}/gu, "").toLowerCase();
  const words = fold(query).split(/\s+/).filter(Boolean);
  if (words.length === 0) return true;
  const hay = fold(`${chatTitle(chat, w)} ${chat.phone ?? ""} ${chat.lastText}`);
  return words.every((word) => hay.includes(word));
}

/** The conversations a filter and a search leave, in the order they came. */
export function filterChats(
  chats: readonly WhatsAppChat[],
  filter: ChatFilter,
  query: string,
  w: WhatsAppWords,
): WhatsAppChat[] {
  return chats.filter(
    (chat) => (filter === "all" || (filter === "unread" ? chat.unread > 0 : chat.group)) && matches(chat, query, w),
  );
}

/** How many conversations have something unread (the "Não lidas" filter's count). */
export const unreadChats = (chats: readonly WhatsAppChat[]) => chats.filter((chat) => chat.unread > 0).length;

/**
 * How long after the other side wrote the list still says the agent is answering. The agent answers every message
 * of a conversation it is on (docs/adr/doug-0002-whatsapp-agent.md), after a wait the number sets (3 to 300 s) and
 * "typing…": past this it has answered, or something stopped it, and the list shows the last line again.
 */
export const ANSWERING_MS = 6 * 60_000;

/**
 * Whether the number's agent is answering this conversation now: it is on here, the last message is the other
 * side's and recent. A group it answers only once called, so a group never says it from the list alone.
 */
export function agentAnswering(
  chat: Pick<WhatsAppChat, "agent" | "group" | "lastFromMe" | "lastAt">,
  now = Date.now(),
): boolean {
  if (chat.agent !== "on" || chat.group || chat.lastFromMe || !chat.lastAt) return false;
  const since = now - new Date(chat.lastAt).getTime();
  return since >= 0 && since < ANSWERING_MS;
}

/** The agent answers here (its face on the photo's corner): on, or only paused while a person writes. */
export const agentHere = (chat: Pick<WhatsAppChat, "agent">) => chat.agent === "on" || chat.agent === "quiet";

/** Whether the strip above the field offers to stop the agent here: it answers, or would after its pause. */
export const agentStoppable = (chat: Pick<WhatsAppChat, "agent"> | null | undefined) =>
  chat?.agent === "on" || chat?.agent === "quiet";

/** Initials for a photo that has none: the first letters of the first two words, else the number's last two digits. */
export function initialsOf(title: string): string {
  const words = title
    .replace(/[^\p{L}\p{N}\s]/gu, " ")
    .split(/\s+/)
    .filter(Boolean);
  const letters = words.filter((word) => /\p{L}/u.test(word[0] ?? ""));
  if (letters.length >= 2) return `${letters[0]?.[0] ?? ""}${letters[1]?.[0] ?? ""}`.toUpperCase();
  if (letters.length === 1) return (letters[0] ?? "").slice(0, 2).toUpperCase();
  const digits = title.replace(/\D/g, "");
  return digits.slice(-2) || "?";
}

/** One of a few tones for a photo with no picture, the same for the same conversation every time. */
export function toneOf(id: string, tones: readonly string[]): string {
  let hash = 0;
  for (let i = 0; i < id.length; i++) hash = (hash * 31 + id.charCodeAt(i)) >>> 0;
  return tones[hash % tones.length] ?? tones[0] ?? "#4F7DF0";
}
