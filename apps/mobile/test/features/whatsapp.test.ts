import { describe, expect, test } from "bun:test";
import type { WhatsAppAccount } from "@agenteschat/client";
import {
  accountsInOrder,
  chatTitle,
  clockOf,
  fileShape,
  handedLine,
  lastLine,
  onlyAccount,
  previewOf,
  showPhone,
  startsDay,
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
