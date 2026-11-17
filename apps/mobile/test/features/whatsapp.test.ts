import { describe, expect, test } from "bun:test";
import type { WhatsAppAccount, WhatsAppChat } from "@agenteschat/client";
import {
  ANSWERING_MS,
  accountsInOrder,
  agentAnswering,
  agentHere,
  agentStoppable,
  chatTitle,
  clockOf,
  fileShape,
  filterChats,
  handedLine,
  initialsOf,
  lastLine,
  onlyAccount,
  previewOf,
  showPhone,
  startsDay,
  toneOf,
  unreadChats,
  whatsappShown,
} from "../../src/features/whatsapp/rules";
import { whatsappWords } from "../../src/features/whatsapp/words";

const pt = whatsappWords("pt-BR");
const en = whatsappWords("en");

const account = (over: Partial<WhatsAppAccount>): WhatsAppAccount =>
  ({ id: "a", label: "Comercial", status: "connected", phone: null, mine: true, ...over }) as WhatsAppAccount;

describe("whatsappShown", () => {
  test("hidden without a gateway, or before it answers", () => {
    expect(whatsappShown(undefined)).toBe(false);
    expect(whatsappShown({ on: false, manage: true, accounts: [account({})] })).toBe(false);
  });
  test("shown with a number, or to who may connect the first one", () => {
    expect(whatsappShown({ on: true, manage: false, accounts: [account({})] })).toBe(true);
    expect(whatsappShown({ on: true, manage: true, accounts: [] })).toBe(true);
    expect(whatsappShown({ on: true, manage: false, accounts: [] })).toBe(false);
  });
});

describe("accounts", () => {
  test("a single number opens straight on its conversations", () => {
    expect(onlyAccount([account({ id: "x" })])).toBe("x");
    expect(onlyAccount([])).toBeNull();
    expect(onlyAccount([account({ id: "x" }), account({ id: "y" })])).toBeNull();
  });
  test("mine first, then by name", () => {
    const list = accountsInOrder([
      account({ id: "1", label: "Zeta", mine: true }),
      account({ id: "2", label: "Alfa", mine: false }),
      account({ id: "3", label: "Beta", mine: true }),
    ]);
    expect(list.map((a) => a.id)).toEqual(["3", "1", "2"]);
  });
});

describe("words of a conversation", () => {
  test("a Brazilian number reads as WhatsApp writes it", () => {
    expect(showPhone("5511999990000")).toBe("+55 11 99999-0000");
    expect(showPhone("14155550100")).toBe("+14155550100");
    expect(showPhone(null)).toBe("");
  });
  test("the title falls back to the number, then to what it is", () => {
    expect(chatTitle({ name: "Ana", phone: "5511999990000", group: false }, pt)).toBe("Ana");
    expect(chatTitle({ name: "", phone: "5511999990000", group: false }, pt)).toBe("+55 11 99999-0000");
    expect(chatTitle({ name: "", phone: null, group: true }, pt)).toBe("Grupo");
    expect(chatTitle({ name: "", phone: null, group: false }, en)).toBe("Unknown number");
  });
  test("a file with no words says its kind, ours says so", () => {
    expect(previewOf("image", "", pt)).toBe("Foto");
    expect(previewOf("image", "olha", pt)).toBe("olha");
    expect(previewOf("text", "", pt)).toBe("");
    expect(previewOf("reaction", "", en)).toBe("Message");
    expect(lastLine({ lastKind: "audio", lastText: "", lastFromMe: true }, pt)).toBe("Você: Mensagem de voz");
    expect(lastLine({ lastKind: "text", lastText: "oi", lastFromMe: false }, en)).toBe("oi");
  });
  test("why the agent left it to a person", () => {
    expect(handedLine("", en)).toBe(en.agent.handed);
    expect(handedLine("handoff", en)).toBe(en.agent.handed);
    expect(handedLine("limit", en)).toBe(en.agent.limit);
    expect(handedLine("failed: 429", en)).toBe(en.agent.failedWhy("429"));
    expect(handedLine("Pediu um orçamento.", pt)).toBe(`${pt.agent.handed} Pediu um orçamento.`);
  });
  test("a voice message's length", () => {
    expect(clockOf(7)).toBe("0:07");
    expect(clockOf(92.4)).toBe("1:32");
    expect(clockOf(null)).toBe("0:00");
  });
  test("any other language reads English", () => {
    expect(whatsappWords("es")).toBe(en);
    expect(whatsappWords("pt")).toBe(pt);
  });
});

describe("messages", () => {
  const media = { mimeType: "image/jpeg", fileName: null, seconds: null };
  test("how a file is drawn", () => {
    expect(fileShape({ kind: "text", file: false, media: null })).toBeNull();
    expect(fileShape({ kind: "deleted", file: false, media: null })).toBeNull();
    expect(fileShape({ kind: "image", file: true, media })).toBe("picture");
    expect(fileShape({ kind: "sticker", file: true, media })).toBe("sticker");
    expect(fileShape({ kind: "audio", file: true, media })).toBe("audio");
    expect(fileShape({ kind: "document", file: true, media })).toBe("row");
    // Nothing kept to fetch it with: the row names it.
    expect(fileShape({ kind: "image", file: false, media })).toBe("row");
    expect(fileShape({ kind: "location", file: false, media: null })).toBe("row");
  });
  test("a day divider over the first message of each day, latest first", () => {
    const at = (d: number, h: number) => new Date(2026, 10, d, h).toISOString();
    const list = [{ at: at(16, 10) }, { at: at(16, 9) }, { at: at(15, 20) }];
    expect(startsDay(list, 0, true)).toBe(false);
    expect(startsDay(list, 1, true)).toBe(true);
    // The oldest loaded starts its day only when nothing older is left to load.
    expect(startsDay(list, 2, true)).toBe(true);
    expect(startsDay(list, 2, false)).toBe(false);
    expect(startsDay(list, 5, true)).toBe(false);
  });
});

const chat = (over: Partial<WhatsAppChat>): WhatsAppChat =>
  ({
    id: "c",
    phone: "5511999990000",
    name: "",
    group: false,
    lastAt: null,
    lastText: "",
    lastKind: "text",
    lastFromMe: false,
    unread: 0,
    agent: null,
    agentQuietUntil: null,
    agentNote: "",
    ...over,
  }) as WhatsAppChat;

describe("the list", () => {
  const list = [
    chat({ id: "1", name: "Fernanda Lima", unread: 2, lastText: "Quinta às 15h" }),
    chat({ id: "2", name: "Alliance Group", group: true, phone: null, unread: 3, lastText: "vídeo novo" }),
    chat({ id: "3", name: "Marcos", lastText: "Combinado" }),
  ];
  test("the filters: all, unread, groups", () => {
    expect(filterChats(list, "all", "", pt).map((c) => c.id)).toEqual(["1", "2", "3"]);
    expect(filterChats(list, "unread", "", pt).map((c) => c.id)).toEqual(["1", "2"]);
    expect(filterChats(list, "groups", "", pt).map((c) => c.id)).toEqual(["2"]);
    expect(unreadChats(list)).toBe(2);
  });
  test("the search finds every word in the name, the number or the last line, any case or accent", () => {
    expect(filterChats(list, "all", "fernanda", pt).map((c) => c.id)).toEqual(["1"]);
    expect(filterChats(list, "all", "VIDEO", pt).map((c) => c.id)).toEqual(["2"]);
    expect(filterChats(list, "all", "99999", pt).map((c) => c.id)).toEqual(["1", "3"]);
    expect(filterChats(list, "all", "marcos combinado", pt).map((c) => c.id)).toEqual(["3"]);
    expect(filterChats(list, "unread", "marcos", pt)).toEqual([]);
  });
  test("the agent is answering while it is on and the other side wrote last, a short while ago", () => {
    const now = Date.parse("2026-11-17T10:06:00Z");
    const wrote = (min: number) => new Date(now - min * 60_000).toISOString();
    expect(agentAnswering(chat({ agent: "on", lastAt: wrote(1) }), now)).toBe(true);
    expect(agentAnswering(chat({ agent: "on", lastAt: wrote(ANSWERING_MS / 60_000 + 1) }), now)).toBe(false);
    expect(agentAnswering(chat({ agent: "on", lastAt: wrote(1), lastFromMe: true }), now)).toBe(false);
    expect(agentAnswering(chat({ agent: "quiet", lastAt: wrote(1) }), now)).toBe(false);
    expect(agentAnswering(chat({ agent: "on", lastAt: wrote(1), group: true }), now)).toBe(false);
    expect(agentAnswering(chat({ agent: null, lastAt: wrote(1) }), now)).toBe(false);
  });
  test("the agent's face and the strip's stop: where it answers or only waits a person out", () => {
    expect(agentHere(chat({ agent: "on" }))).toBe(true);
    expect(agentHere(chat({ agent: "quiet" }))).toBe(true);
    expect(agentHere(chat({ agent: "off" }))).toBe(false);
    expect(agentHere(chat({ agent: "person" }))).toBe(false);
    expect(agentStoppable(chat({ agent: "quiet" }))).toBe(true);
    expect(agentStoppable(chat({ agent: "person" }))).toBe(false);
    expect(agentStoppable(null)).toBe(false);
  });
  test("a photo without a picture: initials, else the number's last digits, on a tone that is always its own", () => {
    expect(initialsOf("Fernanda Lima")).toBe("FL");
    expect(initialsOf("Marcos · Obra 3720")).toBe("MO");
    expect(initialsOf("Dr. Mancini")).toBe("DM");
    expect(initialsOf("ana")).toBe("AN");
    expect(initialsOf("+55 11 99999-0000")).toBe("00");
    const tones = ["#1", "#2", "#3"];
    expect(toneOf("abc", tones)).toBe(toneOf("abc", tones));
    expect(tones).toContain(toneOf("xyz", tones));
  });
  test("the agent's words carry its name, in both languages", () => {
    expect(pt.list.answering("ROSA")).toBe("ROSA está respondendo…");
    expect(pt.chat.strip("ROSA")).toBe("ROSA responde esta conversa");
    expect(pt.chat.stop).toBe("Parar a IA aqui");
    expect(pt.chat.takeOver("ROSA", 60)).toBe("Você assume. ROSA para de responder por 60 min.");
    expect(pt.sentBy("ROSA")).toBe("Enviada por ROSA");
    expect(en.chat.strip("ROSA")).toBe("ROSA answers this conversation");
  });
});
