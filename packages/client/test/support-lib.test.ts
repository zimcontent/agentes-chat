import { describe, expect, test } from "bun:test";
import type { AuthConfig } from "../src/api/types";
import { supportContactOf, supportDraft, whatsAppHref } from "../src/lib/support";

/** Support under the account (`SUPPORT_EMAIL`, `SUPPORT_WHATSAPP`) and the message "Peça ajuda ao Doug" opens with. */

const config = (over: Partial<AuthConfig>): AuthConfig =>
  ({ socialProviders: { google: false, github: false }, signupOpen: false, firstRun: false, ...over }) as AuthConfig;

describe("who runs this installation", () => {
  test("no address of either kind: no Support", () => {
    expect(supportContactOf(undefined)).toBeNull();
    expect(supportContactOf(config({ support: null }))).toBeNull();
    expect(supportContactOf(config({ support: { email: null, whatsapp: null } }))).toBeNull();
  });

  test("an address, a number, or both, each one alone", () => {
    expect(
      supportContactOf(config({ support: { email: "help@example.com", whatsapp: null }, clientCode: "064" })),
    ).toEqual({ email: "help@example.com", whatsapp: null, clientCode: "064" });
    expect(supportContactOf(config({ support: { email: null, whatsapp: "+55 11 99999-0000" } }))).toEqual({
      email: null,
      whatsapp: "+55 11 99999-0000",
      clientCode: null,
    });
  });

  test("a server from before the pair says only the address, which still counts", () => {
    expect(supportContactOf(config({ supportEmail: "help@example.com" }))).toEqual({
      email: "help@example.com",
      whatsapp: null,
      clientCode: null,
    });
  });
});

test("a WhatsApp number goes as wa.me takes it: digits only", () => {
  expect(whatsAppHref("+55 (11) 99999-0000")).toBe("https://wa.me/5511999990000");
  expect(whatsAppHref("+1 415 555 0142")).toBe("https://wa.me/14155550142");
});

describe("the message to the right hand", () => {
  test("names it, says what's wrong and carries the facts whoever answers needs", () => {
    const text = supportDraft({
      agentName: "Doug",
      version: "1.2.3",
      clientCode: "064",
      page: "/org/abc/settings/roles",
    });
    expect(text).toBe(
      "Doug, preciso de ajuda com o sistema (versão do servidor 1.2.3, instalação 064, na página /org/abc/settings/roles): ",
    );
  });

  test("an installation with no code and no page drops those facts, the sentence still reads", () => {
    expect(supportDraft({ agentName: "Doug", version: "1.2.3", clientCode: null, page: null })).toBe(
      "Doug, preciso de ajuda com o sistema (versão do servidor 1.2.3): ",
    );
    expect(supportDraft({ agentName: "Doug", version: null, clientCode: null, page: null })).toBe(
      "Doug, preciso de ajuda com o sistema: ",
    );
  });
});
